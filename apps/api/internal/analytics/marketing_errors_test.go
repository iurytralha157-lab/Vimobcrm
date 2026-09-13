package analytics

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestMarketingAnalyticsErrorResponse(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{
			name:       "invalid marketing filters",
			err:        ErrInvalidInput,
			wantStatus: http.StatusBadRequest,
			wantCode:   "invalid_analytics_filters",
		},
		{
			name:       "missing marketing relation",
			err:        &pgconn.PgError{Code: "42P01", Message: `relation "public.marketing_performance_daily" does not exist`},
			wantStatus: http.StatusServiceUnavailable,
			wantCode:   marketingSchemaUnavailableCode,
		},
		{
			name:       "missing marketing column",
			err:        &pgconn.PgError{Code: "42703", Message: "column does not exist"},
			wantStatus: http.StatusServiceUnavailable,
			wantCode:   marketingSchemaUnavailableCode,
		},
		{
			name:       "postgres connection limit",
			err:        &pgconn.PgError{Code: "53300", Message: "too many connections"},
			wantStatus: http.StatusServiceUnavailable,
			wantCode:   marketingCapacityUnavailableCode,
		},
		{
			name:       "supabase session pool limit",
			err:        errors.New("FATAL: (EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 20"),
			wantStatus: http.StatusServiceUnavailable,
			wantCode:   marketingCapacityUnavailableCode,
		},
		{
			name:       "query deadline",
			err:        context.DeadlineExceeded,
			wantStatus: http.StatusServiceUnavailable,
			wantCode:   marketingQueryTimeoutCode,
		},
		{
			name:       "unknown repository error",
			err:        errors.New("unexpected read failure"),
			wantStatus: http.StatusInternalServerError,
			wantCode:   "analytics_failed",
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			status, code, message := marketingAnalyticsErrorResponse(test.err)
			if status != test.wantStatus || code != test.wantCode {
				t.Fatalf("marketingAnalyticsErrorResponse() = (%d, %q), want (%d, %q)", status, code, test.wantStatus, test.wantCode)
			}
			if strings.TrimSpace(message) == "" {
				t.Fatal("marketingAnalyticsErrorResponse() returned an empty safe message")
			}
		})
	}
}
