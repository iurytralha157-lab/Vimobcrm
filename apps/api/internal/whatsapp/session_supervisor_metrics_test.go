package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestSupervisorFailureMetricsRedactsProviderError(t *testing.T) {
	cause := fmt.Errorf("%w: token=private-provider-credential", context.DeadlineExceeded)
	failure := &supervisorStageFailure{
		stage:   "instance_status",
		elapsed: 10*time.Second + 250*time.Millisecond,
		cause:   cause,
	}
	if !errors.Is(failure, context.DeadlineExceeded) {
		t.Fatal("stage failure must preserve the timeout category for retry decisions")
	}
	if strings.Contains(failure.Error(), "private-provider-credential") {
		t.Fatal("stage failure must not expose the provider response")
	}
	stage, code, elapsedMillis := supervisorFailureMetrics(failure)
	if stage != "instance_status" || code != "timeout" || elapsedMillis != 10250 {
		t.Fatalf("failure metrics = %q/%q/%d, want instance_status/timeout/10250", stage, code, elapsedMillis)
	}
}

func TestSupervisorFailureMetricsReportsSQLStateWithoutDetail(t *testing.T) {
	failure := &supervisorStageFailure{
		stage: "persist_status",
		cause: &pgconn.PgError{Code: "42P01", Message: "private table name and value"},
	}
	stage, code, elapsedMillis := supervisorFailureMetrics(failure)
	if stage != "persist_status" || code != "postgres_42P01" || elapsedMillis != 0 {
		t.Fatalf("failure metrics = %q/%q/%d, want persist_status/postgres_42P01/0", stage, code, elapsedMillis)
	}
	if strings.Contains(failure.Error(), "private table name") {
		t.Fatal("stage failure must not expose SQL error detail")
	}
}
