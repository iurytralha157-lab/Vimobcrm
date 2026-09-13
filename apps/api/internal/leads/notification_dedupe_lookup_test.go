package leads

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
)

type notificationDedupeNoRowsQueryer struct{}

func (notificationDedupeNoRowsQueryer) QueryRow(context.Context, string, ...any) pgx.Row {
	return notificationDedupeNoRowsRow{}
}

type notificationDedupeNoRowsRow struct{}

func (notificationDedupeNoRowsRow) Scan(...any) error {
	return pgx.ErrNoRows
}

func TestFindRecentNotificationByDedupeKeyTreatsMissingRowAsAvailable(t *testing.T) {
	t.Parallel()

	notification, found, err := (Repository{}).findRecentNotificationByDedupeKeyWithQueryer(
		context.Background(),
		notificationDedupeNoRowsQueryer{},
		"11111111-1111-4111-8111-111111111111",
		"22222222-2222-4222-8222-222222222222",
		"update_phone_reminder:22222222-2222-4222-8222-222222222222:Sun Sep 06 2026",
	)
	if err != nil {
		t.Fatalf("missing dedupe row returned error: %v", err)
	}
	if found {
		t.Fatalf("missing dedupe row reported found: %#v", notification)
	}
}
