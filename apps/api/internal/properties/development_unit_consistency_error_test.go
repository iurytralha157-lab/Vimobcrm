package properties

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestPropertyDevelopmentUnitConsistencyViolationUsesStableConflictContract(t *testing.T) {
	for _, constraintName := range []string{
		"property_development_unit_deal_type_sync",
		"property_development_unit_status_sync",
		"property_development_unit_price_sync",
		"property_development_unit_publication_sync",
	} {
		t.Run(constraintName, func(t *testing.T) {
			databaseError := &pgconn.PgError{
				Code:           "23514",
				ConstraintName: constraintName,
			}
			if !isPropertyDevelopmentUnitConsistencyViolation(fmt.Errorf("update property: %w", databaseError)) {
				t.Fatalf("expected %s to be recognized", constraintName)
			}
		})
	}

	request := httptest.NewRequest(http.MethodPatch, "/v1/properties/11111111-1111-4111-8111-111111111111", nil)
	response := httptest.NewRecorder()
	writePropertyError(response, request, ErrPropertyManagedByDevelopmentUnit)

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
	if payload.Error.Code != "property_managed_by_development_unit" {
		t.Fatalf("error code = %q, want property_managed_by_development_unit", payload.Error.Code)
	}
	const expectedMessage = "Esta ficha est\u00e1 vinculada a uma unidade de empreendimento. Altere modalidade, status, pre\u00e7o e publica\u00e7\u00e3o pelo espelho do empreendimento."
	if payload.Error.Message != expectedMessage {
		t.Fatalf("error message = %q, want %q", payload.Error.Message, expectedMessage)
	}
}

func TestPropertyDevelopmentUnitConsistencyViolationRejectsUnrelatedDatabaseErrors(t *testing.T) {
	tests := []struct {
		name string
		err  error
	}{
		{
			name: "different constraint",
			err: &pgconn.PgError{
				Code:           "23514",
				ConstraintName: "properties_preco_nonnegative_check",
			},
		},
		{
			name: "different sqlstate",
			err: &pgconn.PgError{
				Code:           "23505",
				ConstraintName: "property_development_unit_status_sync",
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if isPropertyDevelopmentUnitConsistencyViolation(test.err) {
				t.Fatalf("did not expect %v to be recognized", test.err)
			}
		})
	}
}
