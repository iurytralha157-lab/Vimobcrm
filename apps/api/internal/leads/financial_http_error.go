package leads

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
)

// Match only this domain's named constraints. Other constraint violations keep
// their existing authorization/reference/conflict behavior and public messages.
func writeLeadFinancialError(w http.ResponseWriter, r *http.Request, err error) bool {
	invalid := errors.Is(err, ErrLeadFinancialValuesInvalid)
	generated := false
	var pgError *pgconn.PgError
	if errors.As(err, &pgError) && pgError.Code == "23514" {
		invalid = invalid || pgError.ConstraintName == "lead_financial_values_contract"
		generated = pgError.ConstraintName == "lead_financial_generated_amount_contract"
	}
	if generated {
		httpserver.WriteError(w, r, http.StatusBadRequest, "lead_financial_amount_out_of_range",
			"O valor excede o limite do lançamento financeiro. Revise os valores antes de marcar o lead como ganho.")
		return true
	}
	if invalid {
		httpserver.WriteError(w, r, http.StatusBadRequest, "lead_financial_values_invalid",
			"Revise o valor do lead e a comissão. Use um valor válido e não negativo e uma comissão entre 0% e 100%.")
		return true
	}
	return false
}
