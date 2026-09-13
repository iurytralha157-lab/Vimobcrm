package analytics

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
)

const (
	marketingSchemaUnavailableCode   = "marketing_schema_unavailable"
	marketingCapacityUnavailableCode = "marketing_capacity_unavailable"
	marketingQueryTimeoutCode        = "marketing_query_timeout"
)

func marketingAnalyticsErrorResponse(err error) (int, string, string) {
	if errors.Is(err, ErrInvalidInput) {
		return http.StatusBadRequest, "invalid_analytics_filters",
			"Analytics filters are invalid."
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return http.StatusServiceUnavailable, marketingQueryTimeoutCode,
			"The Marketing query exceeded the available processing time."
	}

	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) {
		switch postgresError.Code {
		case "42P01", "42703", "3F000":
			return http.StatusServiceUnavailable, marketingSchemaUnavailableCode,
				"The Marketing database structure is not available in this environment."
		case "53300", "53400", "57P03":
			return http.StatusServiceUnavailable, marketingCapacityUnavailableCode,
				"The database connection capacity is temporarily exhausted."
		}
	}

	message := strings.ToLower(err.Error())
	if strings.Contains(message, "emaxconnsession") ||
		strings.Contains(message, "max clients reached") ||
		strings.Contains(message, "too many connections") ||
		strings.Contains(message, "remaining connection slots are reserved") {
		return http.StatusServiceUnavailable, marketingCapacityUnavailableCode,
			"The database connection capacity is temporarily exhausted."
	}
	if strings.Contains(message, "context deadline exceeded") ||
		strings.Contains(message, "query timeout") ||
		strings.Contains(message, "statement timeout") {
		return http.StatusServiceUnavailable, marketingQueryTimeoutCode,
			"The Marketing query exceeded the available processing time."
	}

	return http.StatusInternalServerError, "analytics_failed", "Unable to load analytics."
}
