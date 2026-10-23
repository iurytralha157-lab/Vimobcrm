package managementintent

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const intentTestOrgA = "11111111-1111-4111-8111-111111111111"
const intentTestOrgB = "22222222-2222-4222-8222-222222222222"
const intentTestUser = "33333333-3333-4333-8333-333333333333"
const intentTestKey = "44444444-4444-4444-8444-444444444444"
const intentTestEntity = "55555555-5555-4555-8555-555555555555"

func TestCreationIntentNormalizesAttemptWithoutStoringPayload(t *testing.T) {
	payload := []byte(`{"name":"Synthetic Team"}`)
	tx := &intentTestTx{}
	reservation, err := Lookup(context.Background(), tx, intentTestOrgA, intentTestUser, "team", strings.ToUpper(intentTestKey), payload)
	if err != nil {
		t.Fatal(err)
	}
	if len(reservation.KeyHash) != 64 || len(reservation.RequestHash) != 64 || reservation.EntityID != "" {
		t.Fatalf("reservation = %#v", reservation)
	}
	if err := Record(context.Background(), tx, reservation, intentTestEntity); err != nil {
		t.Fatal(err)
	}
	if tx.recorded == nil || tx.recorded[0] != intentTestOrgA || tx.recorded[1] != intentTestUser || tx.recorded[5] != intentTestEntity {
		t.Fatalf("record = %#v", tx.recorded)
	}
	for _, argument := range tx.recorded {
		if value, ok := argument.(string); ok && strings.Contains(value, "Synthetic") {
			t.Fatal("raw payload escaped into intent storage")
		}
	}
}

func TestCreationIntentReplayAndPayloadConflictStayScopedToActorAndTenant(t *testing.T) {
	payload := []byte(`{"name":"Synthetic Team"}`)
	first, err := Lookup(context.Background(), &intentTestTx{}, intentTestOrgA, intentTestUser, "team", intentTestKey, payload)
	if err != nil {
		t.Fatal(err)
	}
	replayStore := &intentTestTx{recordedHash: first.RequestHash, entityID: intentTestEntity}
	replay, err := Lookup(context.Background(), replayStore, intentTestOrgA, intentTestUser, "team", intentTestKey, payload)
	if err != nil || replay.EntityID != intentTestEntity {
		t.Fatalf("replay = %#v, %v", replay, err)
	}
	if _, err := Lookup(context.Background(), replayStore, intentTestOrgA, intentTestUser, "team", intentTestKey, []byte(`{"name":"Another request"}`)); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed payload = %v", err)
	}
	otherTenant := &intentTestTx{}
	if _, err := Lookup(context.Background(), otherTenant, intentTestOrgB, intentTestUser, "team", intentTestKey, payload); err != nil {
		t.Fatal(err)
	}
	if replayStore.lockScope == otherTenant.lockScope {
		t.Fatal("different tenants shared the creation lock")
	}
}

func TestCreationIntentRejectsMalformedKeysBeforeDatabaseAccess(t *testing.T) {
	for _, key := range []string{"", "not-a-key", "44444444444444448444444444444444", "*"} {
		if _, err := Lookup(context.Background(), nil, intentTestOrgA, intentTestUser, "team", key, []byte(`{}`)); !errors.Is(err, ErrInvalidKey) {
			t.Fatalf("key %q error = %v", key, err)
		}
	}
}

type intentTestTx struct {
	pgx.Tx
	lockScope, recordedHash, entityID string
	recorded                          []any
}

func (tx *intentTestTx) Exec(_ context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	if strings.HasPrefix(strings.TrimSpace(query), "select") {
		tx.lockScope = args[0].(string)
	} else {
		tx.recorded = args
	}
	return pgconn.NewCommandTag("INSERT 1"), nil
}
func (tx *intentTestTx) QueryRow(context.Context, string, ...any) pgx.Row {
	return intentTestRow{hash: tx.recordedHash, entityID: tx.entityID}
}

type intentTestRow struct{ hash, entityID string }

func (row intentTestRow) Scan(dest ...any) error {
	if row.entityID == "" {
		return pgx.ErrNoRows
	}
	*dest[0].(*string) = row.hash
	*dest[1].(*string) = row.entityID
	return nil
}
