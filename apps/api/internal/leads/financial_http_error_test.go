package leads

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestLeadFinancialPublicErrorsAreStableAndDoNotExposeStorageDetails(t *testing.T) {
	for _, item := range []struct {
		name string
		err  error
		code string
	}{
		{"input", fmt.Errorf("%w: interestValue is invalid", ErrLeadFinancialValuesInvalid), "lead_financial_values_invalid"},
		{"stored or fallback", &pgconn.PgError{Code: "23514", ConstraintName: "lead_financial_values_contract", Message: "synthetic-private-detail"}, "lead_financial_values_invalid"},
		{"generated amount", fmt.Errorf("wrapped: %w", &pgconn.PgError{Code: "23514", ConstraintName: "lead_financial_generated_amount_contract", Detail: "synthetic-private-detail"}), "lead_financial_amount_out_of_range"},
	} {
		t.Run(item.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			writeLeadError(response, httptest.NewRequest(http.MethodPatch, "/v1/leads/synthetic", nil), item.err)
			body := response.Body.String()
			if response.Code != 400 || !strings.Contains(body, `"code":"`+item.code+`"`) {
				t.Fatalf("financial validation is not a stable client error: status=%d body=%s", response.Code, body)
			}
			for _, private := range []string{"synthetic-private-detail", "23514", "interestValue", "lead_financial_values_contract", "lead_financial_generated_amount_contract"} {
				if strings.Contains(body, private) {
					t.Fatalf("financial validation leaked storage/input detail: %s", body)
				}
			}
		})
	}
}

func TestLeadFinancialErrorMappingDoesNotCaptureOtherDomainErrors(t *testing.T) {
	for _, err := range []error{
		errors.New("synthetic transport failure"), ErrInvalidInput, ErrLeadChanged,
		&pgconn.PgError{Code: "23514", ConstraintName: "unrelated_constraint"},
		&pgconn.PgError{Code: "23503", ConstraintName: "lead_financial_values_contract"},
		&pgconn.PgError{Code: "23514", Message: "lead_financial_values_contract"},
	} {
		response := httptest.NewRecorder()
		if writeLeadFinancialError(response, httptest.NewRequest(http.MethodPatch, "/v1/leads/synthetic", nil), err) || response.Body.Len() != 0 {
			t.Fatal("financial error mapping intercepted another domain's failure")
		}
	}
}
