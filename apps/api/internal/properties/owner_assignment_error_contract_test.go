package properties

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestPropertyOwnerAssignmentViolationUsesStableConflictContract(t *testing.T) {
	databaseError := &pgconn.PgError{
		Code:           "23514",
		ConstraintName: "property_owner_assignment_invalid",
	}
	normalized := normalizeWorkspaceDatabaseError(databaseError)
	if !errors.Is(normalized, ErrPropertyOwnerAssignmentInvalid) {
		t.Fatalf("database error normalized to %v, want ErrPropertyOwnerAssignmentInvalid", normalized)
	}
	if errors.Is(normalized, ErrPropertyOwnerInUse) {
		t.Fatal("invalid assignment must not reuse the owner deactivation contract")
	}

	request := httptest.NewRequest(http.MethodPatch, "/v1/properties/example/ownerships/link", nil)
	response := httptest.NewRecorder()
	writePropertyError(response, request, databaseError)

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
	if payload.Error.Code != "property_owner_assignment_invalid" {
		t.Fatalf("error code = %q, want property_owner_assignment_invalid", payload.Error.Code)
	}
	const expectedMessage = "A associa\u00e7\u00e3o do propriet\u00e1rio n\u00e3o \u00e9 v\u00e1lida. Selecione um propriet\u00e1rio ativo desta organiza\u00e7\u00e3o e resolva eventuais nomes legados duplicados."
	if payload.Error.Message != expectedMessage {
		t.Fatalf("error message = %q, want %q", payload.Error.Message, expectedMessage)
	}
}
