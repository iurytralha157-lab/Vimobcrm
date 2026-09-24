package leads

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestLeadConversationBindingConflictUsesStableConflictContract(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/v1/leads", nil)
	response := httptest.NewRecorder()

	writeLeadError(response, request, ErrConversationBindingChanged)

	if response.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusConflict)
	}
	if !strings.Contains(response.Body.String(), `"code":"whatsapp_conversation_binding_changed"`) {
		t.Fatalf("unexpected response: %s", response.Body.String())
	}
}

func TestLeadPhoneUniqueViolationUsesStableConflictContract(t *testing.T) {
	for _, constraintName := range []string{"leads_org_scope_phone_unique", "leads_org_phone_unique"} {
		databaseError := &pgconn.PgError{
			Code:           "23505",
			ConstraintName: constraintName,
		}
		if !isLeadPhoneUniqueViolation(databaseError) {
			t.Fatalf("expected %s to be recognized", constraintName)
		}
		if got := leadPhoneUniqueViolationConstraint(databaseError); got != constraintName {
			t.Fatalf("constraint = %q, want %q", got, constraintName)
		}
	}
	if isLeadPhoneUniqueViolation(&pgconn.PgError{Code: "23505", ConstraintName: "unrelated_unique"}) {
		t.Fatal("unrelated unique constraint was recognized as lead phone identity")
	}

	request := httptest.NewRequest(http.MethodPatch, "/v1/leads/11111111-1111-4111-8111-111111111111", nil)
	response := httptest.NewRecorder()
	writeLeadError(response, request, ErrLeadPhoneConflict)

	if response.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusConflict)
	}

	var payload struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Error.Code != "lead_phone_conflict" {
		t.Fatalf("error code = %q, want lead_phone_conflict", payload.Error.Code)
	}
	if payload.Error.Message != "Já existe um lead cadastrado com este telefone." {
		t.Fatalf("unexpected error message: %q", payload.Error.Message)
	}
}

func TestLeadIntakeRechecksLegacyAndScopedIdentityInsideTheTransaction(t *testing.T) {
	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) Create(")
	if start < 0 {
		t.Fatal("Create source was not found")
	}
	end := strings.Index(source[start:], "func (repo Repository) Update(")
	if end < 0 {
		t.Fatal("Create boundary was not found")
	}
	createSource := source[start : start+end]
	for _, required := range []string{
		"leadIntakeMaxAttempts",
		"errLeadIntakeRetry",
		"isLeadPhoneUniqueViolation",
		"repo.findExistingLeadByPhoneLegacy",
		"repo.findExistingLeadByPhone(ctx",
		"legacyLeadPhoneUniquenessActive",
	} {
		if !strings.Contains(createSource, required) {
			t.Fatalf("lead identity rollout contract is missing %q", required)
		}
	}
	for _, required := range []string{
		"$1 || ':legacy-global:' || normalize_phone($2)",
		"$1 || ':' || $3 || ':' || normalize_phone($2)",
		"order by lock_candidates.lock_id",
		"findExistingLeadByPhoneForUpdate",
		"for update of l",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("lead advisory identity contract is missing %q", required)
		}
	}

	createNewStart := strings.Index(source, "func (repo Repository) createNewLead")
	registerStart := strings.Index(source, "func (repo Repository) registerReentry")
	resolveStart := strings.Index(source, "func (repo Repository) resolveDestination")
	if createNewStart < 0 || registerStart < 0 || resolveStart < 0 {
		t.Fatal("could not isolate lead intake transaction functions")
	}
	createNew := source[createNewStart:registerStart]
	reentry := source[registerStart:resolveStart]
	for _, required := range []string{
		"lockLeadIntakeIdentity",
		"legacyLeadPhoneUniquenessActive(ctx, tx)",
		"findExistingLeadByPhoneForUpdate",
		"errLeadIntakeRetry",
	} {
		if !strings.Contains(createNew, required) {
			t.Fatalf("new-lead transaction contract is missing %q", required)
		}
		if !strings.Contains(reentry, required) {
			t.Fatalf("reentry transaction contract is missing %q", required)
		}
	}
	lockIndex := strings.Index(reentry, "lockLeadIntakeIdentity")
	lookupIndex := strings.Index(reentry, "findExistingLeadByPhoneForUpdate")
	authorizeIndex := strings.Index(reentry, "authorization.CanUseLeadForMutation")
	updateIndex := strings.Index(reentry, "update public.leads")
	if !(lockIndex >= 0 && lockIndex < lookupIndex && lookupIndex < authorizeIndex && authorizeIndex < updateIndex) {
		t.Fatal("reentry must lock, re-read, reauthorize, and only then update")
	}
}

func TestLeadIntakeScopeKeyUsesOnlyValidatedExplicitQueue(t *testing.T) {
	if got := leadIntakeScopeKey(nil); got != "unscoped" {
		t.Fatalf("nil queue scope = %q", got)
	}
	blank := "  "
	if got := leadIntakeScopeKey(&blank); got != "unscoped" {
		t.Fatalf("blank queue scope = %q", got)
	}
	queueID := "33333333-3333-4333-8333-333333333333"
	if got := leadIntakeScopeKey(&queueID); got != "queue:"+queueID {
		t.Fatalf("queue scope = %q", got)
	}
}

func TestManualReentryPendingRedistributionKeepsThePersistedAssignee(t *testing.T) {
	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) registerReentry")
	if start < 0 {
		t.Fatal("registerReentry source was not found")
	}
	end := strings.Index(source[start:], "func (repo Repository) resolveDestination")
	if end < 0 {
		t.Fatal("registerReentry boundary was not found")
	}
	reentry := source[start : start+end]
	for _, required := range []string{
		`distributionResult.Reason == "no_matching_queue"`,
		`distributionResult.Reason == "no_available_members"`,
		"select l.assigned_user_id::text, u.name",
		"assignedUserID = textValue(currentAssignedUserID)",
		"redistribuicao pendente",
		`"redistribution_pending": redistributionPending`,
		"distributionOutcome = CreateDistributionOutcome(distributionResult.Reason)",
	} {
		if !strings.Contains(reentry, required) {
			t.Fatalf("manual reentry pending-distribution contract is missing %q", required)
		}
	}
	if strings.Contains(reentry, `assignedUserID = ""`) {
		t.Fatal("manual reentry must not clear the assignee when distribution has no destination")
	}
}

func TestLostReasonRequiredUsesStableMoveStageContract(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/v1/leads/11111111-1111-4111-8111-111111111111/move-stage", nil)
	response := httptest.NewRecorder()
	writeLeadError(response, request, ErrLostReasonRequired)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
	var payload struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Error.Code != "lead_lost_reason_required" {
		t.Fatalf("error code = %q", payload.Error.Code)
	}
}

func TestLinkedDevelopmentPropertyConsistencyViolationUsesLeadConflictContract(t *testing.T) {
	for _, constraintName := range []string{
		"property_development_unit_status_sync",
		"property_development_unit_price_sync",
		"property_development_unit_publication_sync",
	} {
		t.Run(constraintName, func(t *testing.T) {
			if !isLinkedDevelopmentPropertyConsistencyViolation(&pgconn.PgError{
				Code:           "23514",
				ConstraintName: constraintName,
			}) {
				t.Fatalf("expected %s to be recognized", constraintName)
			}
		})
	}

	if isLinkedDevelopmentPropertyConsistencyViolation(&pgconn.PgError{
		Code:           "23514",
		ConstraintName: "unrelated_check",
	}) {
		t.Fatal("unrelated check constraint was recognized")
	}
}

func TestChangedLeadAuditDataKeepsOnlyRealChanges(t *testing.T) {
	current := map[string]any{
		"name":                  "Maria",
		"email":                 nil,
		"phone":                 "5511999999999",
		"empresa":               "Vimob",
		"is_own_resource":       nil,
		"valor_interesse":       float64(1500),
		"commission_percentage": float64(5),
	}
	requested := map[string]any{
		"name":                  "Maria",
		"email":                 "maria@example.com",
		"phone":                 "5511999999999",
		"empresa":               "Vimob",
		"is_own_resource":       false,
		"valor_interesse":       "1500.00",
		"commission_percentage": "6",
	}

	oldData, newData := changedLeadAuditData(current, requested)
	if len(newData) != 2 {
		t.Fatalf("changed fields = %#v, want only email and commission_percentage", newData)
	}
	if oldData["email"] != nil || newData["email"] != "maria@example.com" {
		t.Fatalf("unexpected email change: old=%#v new=%#v", oldData["email"], newData["email"])
	}
	if oldData["commission_percentage"] != float64(5) || newData["commission_percentage"] != "6" {
		t.Fatalf("unexpected commission change: old=%#v new=%#v", oldData["commission_percentage"], newData["commission_percentage"])
	}
}
