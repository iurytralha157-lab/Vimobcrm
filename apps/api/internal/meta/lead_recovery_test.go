package meta

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/realtime"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type recoveryQueryCapture struct {
	query string
	args  []any
}

func (capture *recoveryQueryCapture) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	capture.query = query
	capture.args = args
	return capture
}

func (capture *recoveryQueryCapture) Scan(dest ...any) error {
	*dest[0].(*bool) = false
	return nil
}

type recoveryExecutorStub struct {
	request LeadRecoveryRequest
	calls   int
}

func (stub *recoveryExecutorStub) PreviewLeadRecovery(_ context.Context, request LeadRecoveryRequest) (LeadRecoveryPreview, error) {
	stub.calls++
	stub.request = request
	return LeadRecoveryPreview{Date: request.Date, Items: []LeadRecoveryPreviewItem{}}, nil
}

func (stub *recoveryExecutorStub) RecoverLead(_ context.Context, request LeadRecoveryRequest) (LeadRecoveryResult, error) {
	stub.calls++
	stub.request = request
	return LeadRecoveryResult{Status: "processed", LeadID: "internal-lead", LeadgenID: "123456789"}, nil
}

func recoveryToday(t *testing.T) string {
	t.Helper()
	location, err := time.LoadLocation("America/Sao_Paulo")
	if err != nil {
		t.Fatal(err)
	}
	return time.Now().In(location).Format("2006-01-02")
}

func recoveryHTTPRequest(t *testing.T, body string, role string) *http.Request {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/v1/integrations/meta/pages/1699718443627883/forms/1821344389285749/leads/recover", strings.NewReader(body))
	request.SetPathValue("pageId", "1699718443627883")
	request.SetPathValue("formId", "1821344389285749")
	request.Header.Set("Content-Type", "application/json")
	return request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
		MemberRole:     role,
	}))
}

func TestLeadRecoveryHandlerRequiresPermissionAndTenantFromContext(t *testing.T) {
	stub := &recoveryExecutorStub{}
	handler := LeadRecoveryHTTPHandler{executor: stub, publisher: realtime.NoopPublisher{}}
	body := fmt.Sprintf(`{"date":%q,"leadgenId":"123456789"}`, recoveryToday(t))
	denied := httptest.NewRecorder()
	handler.Recover(denied, recoveryHTTPRequest(t, body, "user"))
	if denied.Code != http.StatusForbidden || stub.calls != 0 {
		t.Fatalf("unauthorized request reached executor: status=%d calls=%d", denied.Code, stub.calls)
	}

	spoofed := httptest.NewRecorder()
	handler.Recover(spoofed, recoveryHTTPRequest(t, strings.TrimSuffix(body, "}")+`,"organizationId":"33333333-3333-4333-8333-333333333333"}`, "admin"))
	if spoofed.Code != http.StatusBadRequest || stub.calls != 0 {
		t.Fatalf("tenant override reached executor: status=%d calls=%d", spoofed.Code, stub.calls)
	}

	allowed := httptest.NewRecorder()
	handler.Recover(allowed, recoveryHTTPRequest(t, body, "admin"))
	if allowed.Code != http.StatusOK || stub.calls != 1 || stub.request.OrganizationID != "11111111-1111-4111-8111-111111111111" {
		t.Fatalf("authorized request: status=%d calls=%d org=%q", allowed.Code, stub.calls, stub.request.OrganizationID)
	}
	if strings.Contains(allowed.Body.String(), "internal-lead") || strings.Contains(allowed.Body.String(), "123456789") {
		t.Fatalf("private identifiers leaked in response: %s", allowed.Body.String())
	}
	if allowed.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("lead recovery response must not be cached")
	}
}

func TestPrepareRecoveryCandidateUsesCanonicalGraphIDAndRejectsWrongForm(t *testing.T) {
	request := LeadRecoveryRequest{OrganizationID: "org-1", PageID: "1699718443627883", FormID: "1821344389285749", LeadgenID: "csv-alias"}
	details := map[string]any{
		"id":           "1809687780036368",
		"form_id":      request.FormID,
		"created_time": "2026-09-23T13:55:28-0300",
		"field_data":   []any{},
	}
	candidate, err := prepareRecoveryCandidate(request, metaIntegration{OrganizationID: "org-1"}, metaFormConfig{}, details)
	if err != nil {
		t.Fatal(err)
	}
	if candidate.change.LeadgenID != "1809687780036368" || candidate.change.RecoveryOrganizationID != "org-1" || candidate.change.CreatedTime != "1790182528" {
		t.Fatalf("canonical candidate was not preserved: %#v", candidate.change)
	}
	details["form_id"] = "999999999"
	if _, err := prepareRecoveryCandidate(request, metaIntegration{}, metaFormConfig{}, details); !errors.Is(err, errRecoveryLeadMismatch) {
		t.Fatalf("wrong form error = %v", err)
	}
}

func TestRecoveryGraphListingPinsOriginAndNeverSendsTokenInURL(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		requests++
		if request.URL.Path != "/v25.0/1821344389285749/leads" || request.Header.Get("Authorization") != "Bearer page-token" || strings.Contains(request.URL.RawQuery, "page-token") {
			t.Errorf("unsafe Graph request: path=%q query=%q authorization=%q", request.URL.Path, request.URL.RawQuery, request.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		if requests == 1 {
			fmt.Fprint(w, `{"data":[{"id":"11111"}],"paging":{"next":"https://attacker.invalid/steal?access_token=page-token","cursors":{"after":"cursor-2"}}}`)
			return
		}
		if request.URL.Query().Get("after") != "cursor-2" {
			t.Errorf("unexpected cursor: %q", request.URL.Query().Get("after"))
		}
		fmt.Fprint(w, `{"data":[{"id":"22222"}]}`)
	}))
	defer server.Close()
	repo := NewRepository(nil, Config{GraphBaseURL: server.URL, GraphVersion: "v25.0"})
	items, err := repo.listRecoveryLeads(context.Background(), "1821344389285749", "page-token")
	if err != nil || len(items) != 2 || requests != 2 {
		t.Fatalf("listing result: items=%d requests=%d error=%v", len(items), requests, err)
	}
}

func TestLeadRecoveryResultHidesInternalIdentifiers(t *testing.T) {
	encoded, err := json.Marshal(LeadRecoveryResult{Status: "processed", LeadID: "private-lead", LeadgenID: "private-provider"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "private") {
		t.Fatalf("response included internal IDs: %s", encoded)
	}
}

func TestRecoveryAliasCheckExcludesOwnProviderIDAndRequiresExactSubmission(t *testing.T) {
	phone := "11987654321"
	email := "example@example.com"
	instant := time.Date(2026, 9, 23, 16, 55, 28, 0, time.UTC)
	capture := &recoveryQueryCapture{}
	_, err := recoveryAliasExists(context.Background(), capture, "org-1", "1821344389285749", instant, "canonical-123", &phone, &email)
	if err != nil {
		t.Fatal(err)
	}
	for _, clause := range []string{"entry.organization_id = $1::uuid", "entry.form_id = $2", "entry.occurred_at = $3", "entry.provider_event_id <> $4", "normalize_phone(lead.phone) = normalize_phone($5)", "lower(btrim(lead.email)) = lower(btrim($6))"} {
		if !strings.Contains(capture.query, clause) {
			t.Fatalf("alias guard lacks %q", clause)
		}
	}
	if len(capture.args) != 6 || capture.args[3] != "canonical-123" || capture.args[4] != phone || capture.args[5] != email {
		t.Fatalf("alias guard arguments = %#v", capture.args)
	}
}

func TestRecoveryRouteReResolutionRejectsOrganizationChange(t *testing.T) {
	change := leadgenChange{Recovery: true, RecoveryOrganizationID: "org-1"}
	if recoveryRouteMatchesExpectedOrganization(change, "org-2") || !recoveryRouteMatchesExpectedOrganization(change, "org-1") {
		t.Fatal("recovery route must remain bound to the authorized organization")
	}
	change.RecoveryOrganizationID = ""
	if recoveryRouteMatchesExpectedOrganization(change, "org-1") {
		t.Fatal("missing expected organization must fail closed")
	}
	if !recoveryRouteMatchesExpectedOrganization(leadgenChange{}, "org-2") {
		t.Fatal("ordinary signed webhook must retain its existing route behavior")
	}
}

func TestAliasGuardDoesNotChangeOrdinaryWebhookIntake(t *testing.T) {
	phone := "11987654321"
	lead := leadData{Phone: &phone}
	if recoveryAliasGuardEnabled(leadgenChange{Recovery: false}, lead) {
		t.Fatal("ordinary webhook must not use recovery-only alias suppression")
	}
	if !recoveryAliasGuardEnabled(leadgenChange{Recovery: true}, lead) {
		t.Fatal("recovery must guard against aliased provider IDs")
	}
	if recoveryAliasGuardEnabled(leadgenChange{Recovery: true}, leadData{}) {
		t.Fatal("recovery without contact identity cannot make an alias assertion")
	}
}
