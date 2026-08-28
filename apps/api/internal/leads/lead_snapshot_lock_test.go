package leads

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

type leadSnapshotLockTx struct {
	pgx.Tx
	query string
}

func (tx *leadSnapshotLockTx) QueryRow(_ context.Context, query string, _ ...any) pgx.Row {
	tx.query = query
	return leadSnapshotLockRow{}
}

type leadSnapshotLockRow struct{}

func (leadSnapshotLockRow) Scan(...any) error {
	return pgx.ErrNoRows
}

func TestLeadSnapshotUsesNoKeyUpdateLock(t *testing.T) {
	tx := &leadSnapshotLockTx{}

	_, err := (Repository{}).getLeadSnapshotForUpdate(
		context.Background(),
		tx,
		"11111111-1111-4111-8111-111111111111",
		"22222222-2222-4222-8222-222222222222",
	)
	if !errors.Is(err, ErrLeadNotFound) {
		t.Fatalf("get lead snapshot error = %v, want ErrLeadNotFound", err)
	}

	query := strings.ToLower(strings.Join(strings.Fields(tx.query), " "))
	if !strings.Contains(query, "for no key update of l") {
		t.Fatalf("lead snapshot lock must be FOR NO KEY UPDATE OF l: %s", query)
	}
	if strings.Contains(query, "for update of l") {
		t.Fatalf("lead snapshot must not take the FK-blocking FOR UPDATE lock: %s", query)
	}
}
