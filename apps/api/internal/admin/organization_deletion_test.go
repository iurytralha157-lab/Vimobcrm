package admin

import (
	"context"
	"net/http"
	"net/http/httptest"
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

func TestStorageObjectFromURLOnlyAcceptsConfiguredSupabaseProject(t *testing.T) {
	t.Parallel()

	object, ok := storageObjectFromURL(
		"https://project.supabase.co",
		"https://project.supabase.co/storage/v1/object/public/site-images/sites/banner.webp?download=1",
	)
	if !ok {
		t.Fatal("expected project storage URL to be accepted")
	}
	if object.Bucket != "site-images" || object.Name != "sites/banner.webp" {
		t.Fatalf("unexpected storage object: %#v", object)
	}

	if _, ok := storageObjectFromURL(
		"https://project.supabase.co",
		"https://another-project.supabase.co/storage/v1/object/public/site-images/sites/banner.webp",
	); ok {
		t.Fatal("expected an external project URL to be rejected")
	}
}

func TestStorageObjectHasTenantPrefixDoesNotAcceptAnotherOrganization(t *testing.T) {
	t.Parallel()

	targetOrganizationID := "30e33931-3ef5-4e32-aeb8-410b8e833b48"
	if !storageObjectHasTenantPrefix(
		organizationStorageObject{Bucket: "properties", Name: "orgs/" + targetOrganizationID + "/properties/photo.webp"},
		targetOrganizationID,
		nil,
	) {
		t.Fatal("expected target organization prefix to be accepted")
	}
	if storageObjectHasTenantPrefix(
		organizationStorageObject{Bucket: "properties", Name: "orgs/4380157e-4830-4066-a1a4-22af0ca5031b/properties/photo.webp"},
		targetOrganizationID,
		nil,
	) {
		t.Fatal("expected another organization prefix to be rejected")
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
		response.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	repository := Repository{
		asaasURL:    server.URL,
		asaasAPIKey: "asaas-secret",
		httpClient:  server.Client(),
	}
	if err := repository.deleteAsaasResource(context.Background(), "subscriptions", "sub_123"); err != nil {
		t.Fatalf("unexpected Asaas cleanup error: %v", err)
	}
}
