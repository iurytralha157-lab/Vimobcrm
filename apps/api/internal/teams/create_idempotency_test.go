package teams

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/managementintent"
)

func TestTeamCreateRequiresKeyBeforeOpeningTransaction(t *testing.T) {
	repo := Repository{beginMutationTx: func(context.Context) (pgx.Tx, error) { t.Fatal("missing key opened transaction"); return nil, nil }}
	_, err := repo.Create(context.Background(), availabilityTestActor(), CreateTeamRequest{Name: "Equipe", Members: []TeamMemberInput{}})
	if !errors.Is(err, managementintent.ErrInvalidKey) {
		t.Fatalf("error=%v", err)
	}
}

func TestTeamCreationDeletedReplayCannotRecreateEntity(t *testing.T) {
	canonical := []byte(`{"Name":"Equipe","Members":[],"LogoURL":null,"IsActive":true}`)
	digest := sha256.Sum256(canonical)
	tx := &teamCreationReplayTestTx{requestHash: hex.EncodeToString(digest[:])}
	repo := Repository{beginMutationTx: func(context.Context) (pgx.Tx, error) { return tx, nil }}
	_, err := repo.Create(context.Background(), availabilityTestActor(), CreateTeamRequest{Name: "Equipe", Members: []TeamMemberInput{}, IdempotencyKey: "44444444-4444-4444-8444-444444444444"})
	if !errors.Is(err, managementintent.ErrResultUnavailable) {
		t.Fatalf("error=%v", err)
	}
	if containsSQL(tx.execSQL, "insert into public.teams") || tx.commitCalls != 0 || tx.rollbackCalls != 1 {
		t.Fatalf("replay wrote a new entity: sql=%v commits=%d rollback=%d", tx.execSQL, tx.commitCalls, tx.rollbackCalls)
	}
}

type teamCreationReplayTestTx struct {
	teamMutationTestTx
	requestHash string
}

func (tx *teamCreationReplayTestTx) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	if strings.Contains(sql, "from private.crm_management_create_requests") {
		return teamCreationIntentRow{hash: tx.requestHash}
	}
	if strings.Contains(sql, "from public.teams t") {
		return teamMutationErrorRow{err: pgx.ErrNoRows}
	}
	return tx.teamMutationTestTx.QueryRow(ctx, sql, args...)
}

type teamCreationIntentRow struct{ hash string }

func (row teamCreationIntentRow) Scan(dest ...any) error {
	if len(dest) != 2 {
		return errors.New("unexpected creation intent scan")
	}
	*(dest[0].(*string)) = row.hash
	*(dest[1].(*string)) = transactionTestTeamID
	return nil
}
