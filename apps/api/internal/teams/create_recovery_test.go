package teams

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/managementintent"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestCreationRecoveryAfterSelfLeadershipPreservesCreationGate(t *testing.T) {
	for _, role := range []string{"manager", "user"} {
		t.Run(role, func(t *testing.T) {
			actor := tenant.Context{OrganizationID: transactionTestOrganizationID, UserID: transactionTestUserID, MemberRole: role, IsTeamLeader: true, LedTeamIDs: []string{transactionTestTeamID}, Permissions: []string{permissions.TeamManage, permissions.TeamView}}
			if canManageTeams(actor) {
				t.Fatal("leader gained permission to create a new team")
			}
			tx := &creationRecoveryTestTx{recorded: true}
			repo := Repository{beginMutationTx: func(context.Context) (pgx.Tx, error) { return tx, nil }}
			result, err := repo.Create(context.Background(), actor, recoveryRequest())
			if err != nil || result.ID != transactionTestTeamID || tx.commitCalls != 1 || containsSQL(tx.execSQL, "insert into public.teams") {
				t.Fatalf("recovery failed or recreated entity: %#v %v sql=%v", result, err, tx.execSQL)
			}
			tx = &creationRecoveryTestTx{}
			_, err = repo.Create(context.Background(), actor, recoveryRequest())
			if !errors.Is(err, tenant.ErrOrganizationAccessDenied) || tx.commitCalls != 0 || containsSQL(tx.execSQL, "insert into public.teams") {
				t.Fatalf("a new request bypassed creation scope: %v %v", err, tx.execSQL)
			}
		})
	}
}

func TestCreationRecoveryRequiresCurrentResultScopeAndUnchangedRequest(t *testing.T) {
	actor := tenant.Context{OrganizationID: transactionTestOrganizationID, UserID: transactionTestUserID, MemberRole: "manager", IsTeamLeader: true, Permissions: []string{permissions.TeamManage, permissions.TeamView}}
	for _, scenario := range []string{"different led team", "different tenant", "different actor", "payload conflict", "deleted result"} {
		t.Run(scenario, func(t *testing.T) {
			current := actor
			current.LedTeamIDs = []string{transactionTestTeamID}
			request := recoveryRequest()
			tx := &creationRecoveryTestTx{recorded: true}
			want := tenant.ErrOrganizationAccessDenied
			switch scenario {
			case "different led team":
				current.LedTeamIDs = []string{"44444444-4444-4444-8444-444444444444"}
			case "different tenant":
				current.OrganizationID = "44444444-4444-4444-8444-444444444444"
			case "different actor":
				current.UserID = "44444444-4444-4444-8444-444444444444"
			case "payload conflict":
				request.Name = "Another request"
				want = managementintent.ErrConflict
			case "deleted result":
				tx.deleted = true
				want = managementintent.ErrResultUnavailable
			}
			repo := Repository{beginMutationTx: func(context.Context) (pgx.Tx, error) { return tx, nil }}
			_, err := repo.Create(context.Background(), current, request)
			if !errors.Is(err, want) || tx.commitCalls != 0 || containsSQL(tx.execSQL, "insert into public.teams") {
				t.Fatalf("expected safe refusal %v, got %v; writes=%v", want, err, tx.execSQL)
			}
		})
	}
	actor.LedTeamIDs = []string{transactionTestTeamID}
	actor.Permissions = []string{permissions.TeamView}
	repo := Repository{beginMutationTx: func(context.Context) (pgx.Tx, error) { t.Fatal("revoked TeamManage opened lookup"); return nil, nil }}
	_, err := repo.Create(context.Background(), actor, recoveryRequest())
	if !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("revoked permission recovered result: %v", err)
	}
}

func recoveryRequest() CreateTeamRequest {
	return CreateTeamRequest{Name: "Equipe", Members: []TeamMemberInput{}, IdempotencyKey: "44444444-4444-4444-8444-444444444444"}
}

type creationRecoveryTestTx struct {
	teamMutationTestTx
	recorded, deleted bool
}

func (tx *creationRecoveryTestTx) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	if strings.Contains(sql, "from private.crm_management_create_requests") {
		if !tx.recorded || args[0] != transactionTestOrganizationID || args[1] != transactionTestUserID {
			return teamMutationErrorRow{err: pgx.ErrNoRows}
		}
		digest := sha256.Sum256([]byte(`{"Name":"Equipe","Members":[],"LogoURL":null,"IsActive":true}`))
		return teamCreationIntentRow{hash: hex.EncodeToString(digest[:])}
	}
	if strings.Contains(sql, "from public.teams t") {
		if tx.deleted {
			return teamMutationErrorRow{err: pgx.ErrNoRows}
		}
		return recoveredTeamRow{}
	}
	return tx.teamMutationTestTx.QueryRow(ctx, sql, args...)
}

type recoveredTeamRow struct{}

func (recoveredTeamRow) Scan(dest ...any) error {
	*(dest[0].(*string)) = transactionTestTeamID
	*(dest[1].(*string)) = "Equipe"
	*(dest[2].(*string)) = transactionTestOrganizationID
	*(dest[3].(*string)) = "2026-10-13T00:00:00Z"
	*(dest[4].(*int64)) = 1
	*(dest[5].(*bool)) = true
	for _, out := range dest[6:] {
		*(out.(*pgtype.Text)) = pgtype.Text{}
	}
	return nil
}
