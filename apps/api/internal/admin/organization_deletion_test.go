package admin

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestSortOrganizationScopedTablesOrdersRequiredChildrenBeforeParents(t *testing.T) {
	t.Parallel()

	tables := []organizationScopedTable{
		{Schema: "public", Name: "automations"},
		{Schema: "public", Name: "automation_flow_versions"},
		{Schema: "public", Name: "automation_execution_steps"},
	}
	edges := map[string][]string{
		"public.automation_execution_steps": {"public.automation_flow_versions"},
		"public.automation_flow_versions":   {"public.automations"},
	}

	ordered, ok := sortOrganizationScopedTables(tables, edges)
	if !ok {
		t.Fatal("expected an acyclic deletion order")
	}
	got := []string{ordered[0].key(), ordered[1].key(), ordered[2].key()}
	want := []string{
		"public.automation_execution_steps",
		"public.automation_flow_versions",
		"public.automations",
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("unexpected deletion order: got %v want %v", got, want)
		}
	}
}

func TestSortOrganizationScopedTablesRejectsUnsafeCycle(t *testing.T) {
	t.Parallel()

	tables := []organizationScopedTable{
		{Schema: "public", Name: "a"},
		{Schema: "public", Name: "b"},
	}
	_, ok := sortOrganizationScopedTables(tables, map[string][]string{
		"public.a": {"public.b"},
		"public.b": {"public.a"},
	})
	if ok {
		t.Fatal("expected an unsafe cycle to be rejected")
	}
}

func TestStorageObjectHasTenantPrefixDoesNotAcceptAnotherOrganization(t *testing.T) {
	t.Parallel()

	targetOrganizationID := "30e33931-3ef5-4e32-aeb8-410b8e833b48"
	if !storageObjectHasTenantPrefix(
		organizationStorageObject{Bucket: "properties", Name: "orgs/" + targetOrganizationID + "/properties/photo.webp"},
		targetOrganizationID,
	) {
		t.Fatal("expected target organization prefix to be accepted")
	}
	if storageObjectHasTenantPrefix(
		organizationStorageObject{Bucket: "properties", Name: "orgs/4380157e-4830-4066-a1a4-22af0ca5031b/properties/photo.webp"},
		targetOrganizationID,
	) {
		t.Fatal("expected another organization prefix to be rejected")
	}
	if storageObjectHasTenantPrefix(
		organizationStorageObject{Bucket: "avatars", Name: "users/11111111-1111-4111-8111-111111111111/avatar.webp"},
		targetOrganizationID,
	) {
		t.Fatal("user-scoped assets must not be owned by an organization purge")
	}
	if storageObjectHasTenantPrefix(
		organizationStorageObject{Bucket: "site-images", Name: "shared/banner.webp"},
		targetOrganizationID,
	) {
		t.Fatal("generic assets require a separate durable ownership proof")
	}
}

func TestOrganizationDeletionSourcePreservesCrossTenantIdentities(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("organization_deletion.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) DeleteOrganization(")
	end := strings.Index(source, "func (repo Repository) cancelOrganizationAsaasBilling(")
	if start < 0 || end <= start {
		t.Fatal("could not isolate DeleteOrganization source")
	}
	deleteFlow := source[start:end]
	for _, forbidden := range []string{
		"listExclusiveOrganizationUsers",
		"deleteOrganizationAuthUser",
		"purgeOrganizationDatabaseWithExplicitUsers",
	} {
		if strings.Contains(deleteFlow, forbidden) {
			t.Fatalf("organization deletion must not use stale identity cleanup: %s", forbidden)
		}
	}
	if !strings.Contains(deleteFlow, "DeletedUsers:    0") {
		t.Fatal("organization deletion must report that it preserved user identities")
	}
	if strings.Contains(source, "/instance/delete/") {
		t.Fatal("organization deletion must not issue an unfenced Evolution Go DELETE")
	}
}

func TestEvolutionInstanceKeyForDeletionUsesResolvedProviderKey(t *testing.T) {
	t.Parallel()

	got := evolutionInstanceKeyForDeletion(whatsappSessionCleanup{
		InstanceName: "friendly-name",
		InstanceID:   "legacy-id",
		Settings: map[string]any{
			"evolution_go_resolved_instance_key": "provider-key",
		},
	})
	if got != "provider-key" {
		t.Fatalf("unexpected instance key: %q", got)
	}
}

func TestDeleteAsaasResourceUsesAuthenticatedDelete(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodDelete {
			t.Fatalf("unexpected method: %s", request.Method)
		}
		if request.URL.Path != "/subscriptions/sub_123" {
			t.Fatalf("unexpected path: %s", request.URL.Path)
		}
		if request.Header.Get("access_token") != "asaas-secret" {
			t.Fatal("expected the Asaas access token header")
		}
		if request.Header.Get("User-Agent") != "VimobCRM/1.0 (Go API)" {
			t.Fatalf("unexpected User-Agent: %s", request.Header.Get("User-Agent"))
		}
		_ = json.NewEncoder(response).Encode(map[string]any{
			"deleted": true,
			"id":      "sub_123",
		})
	}))
	defer server.Close()

	repository := Repository{
		asaasURL:    server.URL,
		asaasAPIKey: "asaas-secret",
		httpClient:  server.Client(),
	}
	result, err := repository.deleteAsaasResource(context.Background(), "subscription", "sub_123")
	if err != nil {
		t.Fatalf("unexpected Asaas cleanup error: %v", err)
	}
	if result.HTTPStatus != http.StatusOK || !result.Deleted || result.ID != "sub_123" {
		t.Fatalf("unexpected verified delete result: %#v", result)
	}
}

func TestOrganizationCleanupRPCAuthUsesBearerOnlyForJWTKeys(t *testing.T) {
	t.Parallel()

	jwtRequest := httptest.NewRequest(http.MethodPost, "https://example.test", nil)
	setSupabaseServiceAPIAuth(jwtRequest, "header.payload.signature")
	if jwtRequest.Header.Get("apikey") != "header.payload.signature" ||
		jwtRequest.Header.Get("Authorization") != "Bearer header.payload.signature" {
		t.Fatalf("unexpected JWT service-role headers: %#v", jwtRequest.Header)
	}

	opaqueRequest := httptest.NewRequest(http.MethodPost, "https://example.test", nil)
	setSupabaseServiceAPIAuth(opaqueRequest, "sb_secret_cleanup")
	if opaqueRequest.Header.Get("apikey") != "sb_secret_cleanup" ||
		opaqueRequest.Header.Get("Authorization") != "" {
		t.Fatalf("opaque secret leaked into bearer auth: %#v", opaqueRequest.Header)
	}
}

func TestDeleteStorageObjectBatchUsesCompatibleSupabaseServiceAuth(t *testing.T) {
	testCases := []struct {
		name           string
		apiKey         string
		expectedBearer string
	}{
		{name: "opaque secret", apiKey: "sb_secret_cleanup", expectedBearer: ""},
		{
			name:           "legacy service role JWT",
			apiKey:         "header.payload.signature",
			expectedBearer: "Bearer header.payload.signature",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				if request.Method != http.MethodDelete || request.URL.Path != "/storage/v1/object/billing-files" {
					t.Fatalf("unexpected Storage cleanup request: %s %s", request.Method, request.URL.Path)
				}
				if request.Header.Get("apikey") != testCase.apiKey ||
					request.Header.Get("Authorization") != testCase.expectedBearer {
					t.Fatalf("unexpected Storage service auth headers: %#v", request.Header)
				}
				response.WriteHeader(http.StatusOK)
			}))
			defer server.Close()

			repository := Repository{
				projectURL: server.URL,
				apiKey:     testCase.apiKey,
				httpClient: server.Client(),
			}
			if err := repository.deleteStorageObjectBatch(
				context.Background(),
				"billing-files",
				[]string{"organization/file.pdf"},
			); err != nil {
				t.Fatalf("unexpected Storage cleanup error: %v", err)
			}
		})
	}
}

func TestDeleteAsaasResourceRejectsAmbiguousNotFound(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(response).Encode(map[string]any{
			"errors": []map[string]string{{"description": "not found"}},
		})
	}))
	defer server.Close()

	repository := Repository{
		asaasURL:    server.URL,
		asaasAPIKey: "asaas-secret",
		httpClient:  server.Client(),
	}
	result, err := repository.deleteAsaasResource(context.Background(), "payment", "pay_123")
	if err == nil {
		t.Fatal("expected 404 to remain unverified")
	}
	if result.HTTPStatus != http.StatusNotFound || result.Deleted || result.ID != "" {
		t.Fatalf("404 was treated as an authoritative deletion: %#v", result)
	}
}

func TestDeleteAsaasResourceRejectsWhitespacePaddedIdentifier(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		_ = json.NewEncoder(response).Encode(map[string]any{
			"deleted": true,
			"id":      " pay_123 ",
		})
	}))
	defer server.Close()

	repository := Repository{
		asaasURL:    server.URL,
		asaasAPIKey: "asaas-secret",
		httpClient:  server.Client(),
	}
	result, err := repository.deleteAsaasResource(context.Background(), "payment", "pay_123")
	if err == nil {
		t.Fatal("expected a whitespace-padded provider identifier to remain unverified")
	}
	if result.HTTPStatus != http.StatusOK || !result.Deleted || result.ID != " pay_123 " {
		t.Fatalf("provider response was normalized instead of compared exactly: %#v", result)
	}
}

func TestCancelOrganizationAsaasBillingClaimsDeletesAndFinalizes(t *testing.T) {
	t.Parallel()

	const organizationID = "30e33931-3ef5-4e32-aeb8-410b8e833b48"
	const claimToken = "630cedf0-fb2c-40db-a1e2-7ab79839aeba"
	resources := []struct {
		Kind         string
		ID           string
		AttemptToken string
	}{
		{Kind: "payment", ID: "pay_123", AttemptToken: "9b8b8a55-e36d-4e47-bd43-18aa79ad4339"},
		{Kind: "subscription", ID: "sub_123", AttemptToken: "e5563f4b-5962-445f-9149-a5b075aeb095"},
		{Kind: "customer", ID: "cus_123", AttemptToken: "ffbd6ad2-c44e-498e-9aec-84c0439bd9de"},
	}
	resourceIndex := 0
	calls := make([]string, 0, 12)

	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		calls = append(calls, request.Method+" "+request.URL.Path)
		switch request.URL.Path {
		case "/rest/v1/rpc/claim_billing_organization_asaas_cleanup":
			if request.Method != http.MethodPost {
				t.Fatalf("unexpected claim method: %s", request.Method)
			}
			if request.Header.Get("apikey") != "sb_secret_cleanup" {
				t.Fatal("expected the Supabase secret key header")
			}
			if request.Header.Get("Authorization") != "" {
				t.Fatal("opaque Supabase secret keys must not be sent as bearer JWTs")
			}
			var payload map[string]any
			if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
				t.Fatalf("decode claim payload: %v", err)
			}
			if payload["p_organization_id"] != organizationID {
				t.Fatalf("unexpected claim organization: %#v", payload)
			}
			if !strings.HasPrefix(payload["p_lease_owner"].(string), "go-admin:") {
				t.Fatalf("unexpected lease owner: %#v", payload["p_lease_owner"])
			}
			if payload["p_lease_seconds"] != float64(600) {
				t.Fatalf("unexpected lease duration: %#v", payload["p_lease_seconds"])
			}
			_ = json.NewEncoder(response).Encode(map[string]any{
				"outcome":         "proceed",
				"claim_token":     claimToken,
				"organization_id": organizationID,
				"resource_count":  len(resources),
				"remaining_count": len(resources),
			})
		case "/rest/v1/rpc/claim_billing_organization_asaas_cleanup_resource":
			if resourceIndex == len(resources) {
				_ = json.NewEncoder(response).Encode(map[string]any{"outcome": "complete"})
				return
			}
			resource := resources[resourceIndex]
			resourceIndex++
			_ = json.NewEncoder(response).Encode(map[string]any{
				"outcome":       "proceed",
				"resource_kind": resource.Kind,
				"resource_id":   resource.ID,
				"attempt_token": resource.AttemptToken,
			})
		case "/subscriptions/sub_123", "/payments/pay_123", "/customers/cus_123":
			if request.Method != http.MethodDelete {
				t.Fatalf("unexpected Asaas method: %s", request.Method)
			}
			if request.Header.Get("access_token") != "asaas-secret" {
				t.Fatal("expected the Asaas access token header")
			}
			resourceID := request.URL.Path[strings.LastIndex(request.URL.Path, "/")+1:]
			_ = json.NewEncoder(response).Encode(map[string]any{
				"deleted": true,
				"id":      resourceID,
			})
		case "/rest/v1/rpc/ack_billing_organization_asaas_cleanup_resource":
			if resourceIndex == 0 || resourceIndex > len(resources) {
				t.Fatalf("ack without a matching resource claim")
			}
			resource := resources[resourceIndex-1]
			var payload map[string]any
			if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
				t.Fatalf("decode resource ack payload: %v", err)
			}
			providerResponse, ok := payload["p_provider_response"].(map[string]any)
			if !ok || providerResponse["deleted"] != true || providerResponse["id"] != resource.ID {
				t.Fatalf("unexpected sanitized provider acknowledgement: %#v", payload)
			}
			if payload["p_resource_kind"] != resource.Kind ||
				payload["p_resource_id"] != resource.ID ||
				payload["p_attempt_token"] != resource.AttemptToken ||
				payload["p_http_status"] != float64(http.StatusOK) {
				t.Fatalf("unexpected resource ack binding: %#v", payload)
			}
			_ = json.NewEncoder(response).Encode(map[string]any{"outcome": "succeeded"})
		case "/rest/v1/rpc/finalize_billing_organization_asaas_cleanup":
			if request.Method != http.MethodPost {
				t.Fatalf("unexpected finalization method: %s", request.Method)
			}
			var payload map[string]any
			if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
				t.Fatalf("decode finalization payload: %v", err)
			}
			if payload["p_organization_id"] != organizationID || payload["p_claim_token"] != claimToken {
				t.Fatalf("unexpected finalization binding: %#v", payload)
			}
			_ = json.NewEncoder(response).Encode(map[string]any{
				"outcome":         "completed",
				"organization_id": organizationID,
			})
		default:
			t.Fatalf("unexpected request path: %s", request.URL.Path)
		}
	}))
	defer server.Close()

	repository := Repository{
		projectURL:  server.URL,
		apiKey:      "sb_secret_cleanup",
		asaasURL:    server.URL,
		asaasAPIKey: "asaas-secret",
		httpClient:  server.Client(),
	}
	if err := repository.cancelOrganizationAsaasBilling(context.Background(), organizationID); err != nil {
		t.Fatalf("unexpected organization billing cleanup error: %v", err)
	}

	want := []string{
		"POST /rest/v1/rpc/claim_billing_organization_asaas_cleanup",
		"POST /rest/v1/rpc/claim_billing_organization_asaas_cleanup_resource",
		"DELETE /payments/pay_123",
		"POST /rest/v1/rpc/ack_billing_organization_asaas_cleanup_resource",
		"POST /rest/v1/rpc/claim_billing_organization_asaas_cleanup_resource",
		"DELETE /subscriptions/sub_123",
		"POST /rest/v1/rpc/ack_billing_organization_asaas_cleanup_resource",
		"POST /rest/v1/rpc/claim_billing_organization_asaas_cleanup_resource",
		"DELETE /customers/cus_123",
		"POST /rest/v1/rpc/ack_billing_organization_asaas_cleanup_resource",
		"POST /rest/v1/rpc/claim_billing_organization_asaas_cleanup_resource",
		"POST /rest/v1/rpc/finalize_billing_organization_asaas_cleanup",
	}
	if len(calls) != len(want) {
		t.Fatalf("unexpected cleanup call count: got %v want %v", calls, want)
	}
	for index := range want {
		if calls[index] != want[index] {
			t.Fatalf("unexpected cleanup order: got %v want %v", calls, want)
		}
	}
}

func TestCancelOrganizationAsaasBillingDoesNotDeleteWhenClaimIsBusy(t *testing.T) {
	t.Parallel()

	const organizationID = "30e33931-3ef5-4e32-aeb8-410b8e833b48"
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requestCount++
		if request.URL.Path != "/rest/v1/rpc/claim_billing_organization_asaas_cleanup" {
			t.Fatalf("busy claims must not reach Asaas: %s", request.URL.Path)
		}
		_ = json.NewEncoder(response).Encode(map[string]any{
			"outcome":             "busy",
			"busy_reason":         "card_update_provider_request",
			"retry_after_seconds": 45,
		})
	}))
	defer server.Close()

	repository := Repository{
		projectURL:  server.URL,
		apiKey:      "header.payload.signature",
		asaasURL:    server.URL,
		asaasAPIKey: "asaas-secret",
		httpClient:  server.Client(),
	}
	err := repository.cancelOrganizationAsaasBilling(context.Background(), organizationID)
	if err == nil || !strings.Contains(err.Error(), "card_update_provider_request") {
		t.Fatalf("expected a busy cleanup error, got %v", err)
	}
	if requestCount != 1 {
		t.Fatalf("busy claim performed provider calls: %d requests", requestCount)
	}
}

func TestCancelOrganizationAsaasBillingRejectsActiveOrganization(t *testing.T) {
	t.Parallel()

	const organizationID = "30e33931-3ef5-4e32-aeb8-410b8e833b48"
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requestCount++
		if request.URL.Path != "/rest/v1/rpc/claim_billing_organization_asaas_cleanup" {
			t.Fatalf("an active organization must not reach a provider endpoint: %s", request.URL.Path)
		}
		_ = json.NewEncoder(response).Encode(map[string]any{
			"outcome": "organization_active",
		})
	}))
	defer server.Close()

	repository := Repository{
		projectURL:  server.URL,
		apiKey:      "sb_secret_cleanup",
		asaasURL:    server.URL,
		asaasAPIKey: "asaas-secret",
		httpClient:  server.Client(),
	}
	err := repository.cancelOrganizationAsaasBilling(context.Background(), organizationID)
	if err == nil || !strings.Contains(err.Error(), "requires a disabled organization") {
		t.Fatalf("expected the destructive precondition error, got %v", err)
	}
	if requestCount != 1 {
		t.Fatalf("active organization performed provider calls: %d requests", requestCount)
	}
}

func TestCancelOrganizationAsaasBillingNeverFinalizesAmbiguous404(t *testing.T) {
	t.Parallel()

	const organizationID = "30e33931-3ef5-4e32-aeb8-410b8e833b48"
	const claimToken = "630cedf0-fb2c-40db-a1e2-7ab79839aeba"
	const attemptToken = "9b8b8a55-e36d-4e47-bd43-18aa79ad4339"
	calls := make([]string, 0, 4)

	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		calls = append(calls, request.Method+" "+request.URL.Path)
		switch request.URL.Path {
		case "/rest/v1/rpc/claim_billing_organization_asaas_cleanup":
			_ = json.NewEncoder(response).Encode(map[string]any{
				"outcome":         "proceed",
				"claim_token":     claimToken,
				"organization_id": organizationID,
				"resource_count":  1,
				"remaining_count": 1,
			})
		case "/rest/v1/rpc/claim_billing_organization_asaas_cleanup_resource":
			_ = json.NewEncoder(response).Encode(map[string]any{
				"outcome":       "proceed",
				"resource_kind": "payment",
				"resource_id":   "pay_404",
				"attempt_token": attemptToken,
			})
		case "/payments/pay_404":
			response.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(response).Encode(map[string]any{
				"errors": []map[string]string{{"description": "not found"}},
			})
		case "/rest/v1/rpc/ack_billing_organization_asaas_cleanup_resource":
			var payload map[string]any
			if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
				t.Fatalf("decode ambiguous ack payload: %v", err)
			}
			if payload["p_http_status"] != float64(http.StatusNotFound) {
				t.Fatalf("unexpected ambiguous status: %#v", payload)
			}
			_ = json.NewEncoder(response).Encode(map[string]any{
				"outcome": "manual_review",
				"reason":  "provider_delete_not_confirmed",
			})
		case "/rest/v1/rpc/finalize_billing_organization_asaas_cleanup":
			t.Fatal("an ambiguous 404 must never finalize the cleanup")
		default:
			t.Fatalf("unexpected request path: %s", request.URL.Path)
		}
	}))
	defer server.Close()

	repository := Repository{
		projectURL:  server.URL,
		apiKey:      "sb_secret_cleanup",
		asaasURL:    server.URL,
		asaasAPIKey: "asaas-secret",
		httpClient:  server.Client(),
	}
	err := repository.cancelOrganizationAsaasBilling(context.Background(), organizationID)
	if err == nil || !strings.Contains(err.Error(), "unverified response") {
		t.Fatalf("expected an unverified provider response, got %v", err)
	}
	want := []string{
		"POST /rest/v1/rpc/claim_billing_organization_asaas_cleanup",
		"POST /rest/v1/rpc/claim_billing_organization_asaas_cleanup_resource",
		"DELETE /payments/pay_404",
		"POST /rest/v1/rpc/ack_billing_organization_asaas_cleanup_resource",
	}
	if len(calls) != len(want) {
		t.Fatalf("ambiguous cleanup performed unexpected calls: got %v want %v", calls, want)
	}
	for index := range want {
		if calls[index] != want[index] {
			t.Fatalf("ambiguous cleanup call order: got %v want %v", calls, want)
		}
	}
}
