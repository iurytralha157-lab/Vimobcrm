package schedule

import (
	"errors"

	"github.com/jackc/pgx/v5/pgconn"
)

// Match only the integration's explicit fencing error. Other lock/contention
// errors must not be mislabeled as a Google disconnect or swallowed.
func isGoogleCalendarDisconnectingError(err error) bool {
	var databaseError *pgconn.PgError
	return errors.As(err, &databaseError) && databaseError.Code == "55P03" && databaseError.Message == "google_calendar_connection_disconnecting"
}
