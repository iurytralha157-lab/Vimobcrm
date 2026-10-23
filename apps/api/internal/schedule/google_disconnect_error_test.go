package schedule

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestGoogleDisconnectFenceUsesExplicitConflictAndDoesNotMislabelOtherDatabaseErrors(t *testing.T) {
	fence := &pgconn.PgError{Code: "55P03", Message: "google_calendar_connection_disconnecting"}
	for _, err := range []error{fence, fmt.Errorf("enqueue Google: %w", fence)} {
		if !isGoogleCalendarDisconnectingError(err) {
			t.Fatal("exact/wrapped fence not recognized")
		}
		recorder := httptest.NewRecorder()
		writeScheduleError(recorder, httptest.NewRequest(http.MethodPatch, "/api/schedule/events/synthetic", nil), err)
		if recorder.Code != http.StatusConflict || !strings.Contains(recorder.Body.String(), "google_calendar_disconnecting") || strings.Contains(recorder.Body.String(), "55P03") {
			t.Fatalf("unsafe/incorrect fence response: %d %s", recorder.Code, recorder.Body.String())
		}
	}
	for _, err := range []error{nil, &pgconn.PgError{Code: "55P03", Message: "lock timeout"}, &pgconn.PgError{Code: "23505", Message: fence.Message}, fmt.Errorf("%s", fence.Message)} {
		if isGoogleCalendarDisconnectingError(err) {
			t.Fatalf("unrelated error mislabeled: %v", err)
		}
	}
}
