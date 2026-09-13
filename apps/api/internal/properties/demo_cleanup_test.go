package properties

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type demoCleanupTx struct {
	pgx.Tx
	query string
	args  []any
}

func (tx *demoCleanupTx) Exec(_ context.Context, query string, arguments ...any) (pgconn.CommandTag, error) {
	tx.query = query
	tx.args = arguments
	return pgconn.CommandTag{}, nil
}

func TestCanonicalDemoCreateSkipsCleanup(t *testing.T) {
	if shouldCleanupDemoPropertiesAfterCreate(Property{"is_demo": true}) {
		t.Fatal("a newly-created canonical demo would be removed by cleanup")
	}
}

func TestRealCreateCleansCanonicalAndLegacyDemos(t *testing.T) {
	if !shouldCleanupDemoPropertiesAfterCreate(Property{"is_demo": false}) {
		t.Fatal("a real property must trigger demo cleanup")
	}

	tx := &demoCleanupTx{}
	const (
		organizationID = "11111111-1111-4111-8111-111111111111"
		createdID      = "22222222-2222-4222-8222-222222222222"
	)
	if err := (Repository{}).removeDemoProperties(context.Background(), tx, organizationID, createdID); err != nil {
		t.Fatal(err)
	}
	for _, predicate := range []string{
		"coalesce(is_demo, false) = true",
		"metadata ->> 'is_demo'",
		"id <> $2::uuid",
	} {
		if !strings.Contains(tx.query, predicate) {
			t.Fatalf("demo cleanup is missing %q: %s", predicate, tx.query)
		}
	}
	if len(tx.args) != 2 || tx.args[0] != organizationID || tx.args[1] != createdID {
		t.Fatalf("demo cleanup did not scope/exclude the created row: %#v", tx.args)
	}
}

func TestLegacyDemoMetadataCannotDeleteTheJustCreatedProperty(t *testing.T) {
	created := Property{
		"is_demo":  false,
		"metadata": map[string]any{"is_demo": true},
	}
	if !shouldCleanupDemoPropertiesAfterCreate(created) {
		t.Fatal("legacy metadata must not override the canonical flag for deciding whether cleanup runs")
	}

	tx := &demoCleanupTx{}
	const createdID = "22222222-2222-4222-8222-222222222222"
	if err := (Repository{}).removeDemoProperties(
		context.Background(),
		tx,
		"11111111-1111-4111-8111-111111111111",
		createdID,
	); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(tx.query, "id <> $2::uuid") || len(tx.args) != 2 || tx.args[1] != createdID {
		t.Fatalf("newly-created row is not defensively excluded: query=%s args=%#v", tx.query, tx.args)
	}
}
