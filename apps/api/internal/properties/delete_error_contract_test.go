package properties

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestPropertyHasLinkedLeadsForeignKeyViolationUsesStableConflictContract(t *testing.T) {
	databaseError := &pgconn.PgError{
		Code:           "23503",
		ConstraintName: "leads_property_id_fkey",
	}
	if !isPropertyHasLinkedLeadsForeignKeyViolation(fmt.Errorf("delete property: %w", databaseError)) {
		t.Fatal("expected leads_property_id_fkey to be recognized")
	}

	request := httptest.NewRequest(http.MethodDelete, "/v1/properties/11111111-1111-4111-8111-111111111111", nil)
	response := httptest.NewRecorder()
	writePropertyError(response, request, ErrPropertyHasLinkedLeads)

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
	if payload.Error.Code != "property_has_linked_leads" {
		t.Fatalf("error code = %q, want property_has_linked_leads", payload.Error.Code)
	}
	const expectedMessage = "N\u00e3o \u00e9 poss\u00edvel excluir este im\u00f3vel porque h\u00e1 leads vinculados a ele. Desvincule o im\u00f3vel desses leads e tente novamente."
	if payload.Error.Message != expectedMessage {
		t.Fatalf("error message = %q, want %q", payload.Error.Message, expectedMessage)
	}
}

func TestPropertyHasLinkedLeadsForeignKeyViolationRejectsUnrelatedDatabaseErrors(t *testing.T) {
	tests := []struct {
		name string
		err  error
	}{
		{
			name: "different constraint",
			err: &pgconn.PgError{
				Code:           "23503",
				ConstraintName: "property_development_units_property_fkey",
			},
		},
		{
			name: "different error code",
			err: &pgconn.PgError{
				Code:           "23505",
				ConstraintName: "leads_property_id_fkey",
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if isPropertyHasLinkedLeadsForeignKeyViolation(test.err) {
				t.Fatalf("did not expect %v to be recognized", test.err)
			}
		})
	}
}
