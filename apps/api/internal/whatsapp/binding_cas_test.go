package whatsapp

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

const (
	bindingCASTestConversationID = "11111111-1111-4111-8111-111111111111"
	bindingCASTestLeadAID        = "22222222-2222-4222-8222-222222222222"
	bindingCASTestLeadBID        = "33333333-3333-4333-8333-333333333333"
)

type bindingCASTestRow struct {
	payload string
	err     error
}

func (row bindingCASTestRow) Scan(destinations ...any) error {
	if row.err != nil {
		return row.err
	}
	if len(destinations) != 1 {
		return errors.New("unexpected binding CAS scan destination count")
	}
	target, ok := destinations[0].(*string)
	if !ok {
		return errors.New("unexpected binding CAS scan destination")
	}
	*target = row.payload
	return nil
}

type bindingCASTestQueryer struct {
	payload string
	query   string
	args    []any
}

func (queryer *bindingCASTestQueryer) QueryRow(_ context.Context, query string, arguments ...any) pgx.Row {
	queryer.query = query
	queryer.args = arguments
	return bindingCASTestRow{payload: queryer.payload}
}

func TestLinkLeadRequestRequiresExpectedPreviousLeadSnapshot(t *testing.T) {
	leadID, expectedPreviousLeadID, err := (LinkLeadRequest{
		LeadID:                 bindingCASTestLeadBID,
		ExpectedPreviousLeadID: unlinkedConversationLeadSnapshot,
	}).Validate()
	if err != nil || leadID != bindingCASTestLeadBID || expectedPreviousLeadID != unlinkedConversationLeadSnapshot {
		t.Fatalf("unlinked LinkLeadRequest.Validate() = %q/%q/%v", leadID, expectedPreviousLeadID, err)
	}

	leadID, expectedPreviousLeadID, err = (LinkLeadRequest{
		LeadID:                 bindingCASTestLeadBID,
		ExpectedPreviousLeadID: bindingCASTestLeadAID,
	}).Validate()
	if err != nil || leadID != bindingCASTestLeadBID || expectedPreviousLeadID != bindingCASTestLeadAID {
		t.Fatalf("linked LinkLeadRequest.Validate() = %q/%q/%v", leadID, expectedPreviousLeadID, err)
	}

	if _, _, err := (LinkLeadRequest{LeadID: bindingCASTestLeadBID}).Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("missing expectedPreviousLeadId error = %v, want ErrInvalidInput", err)
	}
	if _, _, err := (LinkLeadRequest{
		LeadID:                 bindingCASTestLeadBID,
		ExpectedPreviousLeadID: "not-a-snapshot",
	}).Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("invalid expectedPreviousLeadId error = %v, want ErrInvalidInput", err)
	}
}

func TestManualBindingCASMapsStaleResultToConflict(t *testing.T) {
	queryer := &bindingCASTestQueryer{payload: `{
		"success": false,
		"changed": false,
		"stale": true,
		"is_current": false,
		"conversation_id": "11111111-1111-4111-8111-111111111111",
		"lead_id": "33333333-3333-4333-8333-333333333333",
		"active_lead_id": "22222222-2222-4222-8222-222222222222",
		"binding_id": null
	}`}

	_, err := activateRepositoryWhatsAppConversationLeadBindingIfExpected(
		context.Background(),
		queryer,
		"44444444-4444-4444-8444-444444444444",
		bindingCASTestConversationID,
		bindingCASTestLeadBID,
		bindingCASTestLeadAID,
	)
	if !errors.Is(err, ErrConversationBindingChanged) {
		t.Fatalf("stale CAS error = %v, want ErrConversationBindingChanged", err)
	}
	if !strings.Contains(queryer.query, "p_expected_previous_lead_id => $4") {
		t.Fatalf("manual binding query does not call the expected-previous overload:\n%s", queryer.query)
	}
	if len(queryer.args) != 4 || queryer.args[3] != bindingCASTestLeadAID {
		t.Fatalf("manual binding CAS args = %#v", queryer.args)
	}
}

func TestManualBindingCASAcceptsOnlyCurrentDestination(t *testing.T) {
	queryer := &bindingCASTestQueryer{payload: `{
		"success": true,
		"changed": true,
		"stale": false,
		"is_current": true,
		"conversation_id": "11111111-1111-4111-8111-111111111111",
		"lead_id": "33333333-3333-4333-8333-333333333333",
		"active_lead_id": "33333333-3333-4333-8333-333333333333",
		"binding_id": "55555555-5555-4555-8555-555555555555"
	}`}

	binding, err := activateRepositoryWhatsAppConversationLeadBindingIfExpected(
		context.Background(),
		queryer,
		"44444444-4444-4444-8444-444444444444",
		bindingCASTestConversationID,
		bindingCASTestLeadBID,
		unlinkedConversationLeadSnapshot,
	)
	if err != nil || !binding.IsCurrent || binding.ActiveLeadID != bindingCASTestLeadBID {
		t.Fatalf("successful CAS = %#v / %v", binding, err)
	}
}

func TestConversationBindingConflictHasDedicatedHTTPContract(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/v1/whatsapp/conversations/"+bindingCASTestConversationID+"/link-lead", nil)
	response := httptest.NewRecorder()

	writeWhatsAppError(response, request, ErrConversationBindingChanged)

	if response.Code != http.StatusConflict {
		t.Fatalf("binding conflict status = %d, want %d", response.Code, http.StatusConflict)
	}
	if !strings.Contains(response.Body.String(), `"code":"whatsapp_conversation_binding_changed"`) {
		t.Fatalf("binding conflict response = %s", response.Body.String())
	}
}

func TestLinkConversationLockUsesDenseSimpleProtocolArguments(t *testing.T) {
	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) LinkConversationToLead(")
	end := strings.Index(source, "func (repo Repository) GetMessageMediaURL(")
	if start < 0 || end <= start {
		t.Fatal("could not isolate LinkConversationToLead source")
	}
	linkSource := source[start:end]
	for _, required := range []string{
		"lockArgs := []any{tenantContext.OrganizationID, conversationID}",
		"and wc.id = $2::uuid",
		"`, lockArgs...).Scan",
	} {
		if !strings.Contains(linkSource, required) {
			t.Fatalf("LinkConversationToLead lock query is missing %q", required)
		}
	}
	if strings.Contains(linkSource, "args := append(baseConversationArgs(tenantContext), conversationID)") {
		t.Fatal("LinkConversationToLead lock query leaves visibility arguments unused in pgx simple-protocol mode")
	}
}

func TestStartConversationUsesExpectedPreviousCASOnEveryActivation(t *testing.T) {
	raw, err := os.ReadFile("conversation_start_operations.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	if !strings.Contains(source, "validateExpectedPreviousConversationLeadID(request.ExpectedPreviousLeadID)") {
		t.Fatal("StartConversation does not require the browser's previous lead snapshot")
	}
	if count := strings.Count(source, "activateRepositoryWhatsAppConversationLeadBindingIfExpected("); count != 2 {
		t.Fatalf("StartConversation direct activation CAS count = %d, want 2 (new and quarantine claim)", count)
	}
	if !strings.Contains(source, "repo.LinkConversationToLead(") {
		t.Fatal("existing conversation activation must cross the authorization-fenced CAS path")
	}
	if strings.Contains(source, "activateRepositoryWhatsAppConversationLeadBinding(\n") {
		t.Fatal("StartConversation still contains a non-CAS manual activation")
	}
	if !strings.Contains(source, "expectedPreviousLeadID != unlinkedConversationLeadSnapshot") {
		t.Fatal("StartConversation can create a replacement row from a stale linked snapshot")
	}
}
