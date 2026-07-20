package leads

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestLeadPhoneUniqueViolationUsesStableConflictContract(t *testing.T) {
	databaseError := &pgconn.PgError{
		Code:           "23505",
		ConstraintName: "leads_org_phone_unique",
	}
	if !isLeadPhoneUniqueViolation(databaseError) {
		t.Fatal("expected leads_org_phone_unique to be recognized")
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
