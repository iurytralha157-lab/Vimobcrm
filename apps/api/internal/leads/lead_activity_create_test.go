package leads

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type activityCreateFixture struct {
	pgx.Tx
	org, lead, owner, team                  string
	beginErr, lockErr, insertErr, commitErr error
	poolErr                                 error
	poolAccess                              *bool
	locked                                  bool
	locks, inserts, commits, rollbacks      int
	poolReads                               int
	cancelAfterLock                         context.CancelFunc
	hydratedMetadata                        string
}

func (fixture *activityCreateFixture) begin(ctx context.Context) (pgx.Tx, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if fixture.beginErr != nil {
		return nil, fixture.beginErr
	}
	return fixture, nil
}

func (fixture *activityCreateFixture) QueryRow(ctx context.Context, query string, args ...any) pgx.Row {
	return historyScopeRow{scan: func(dest ...any) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if strings.Contains(query, "select private.queue_pool_read_access") {
			if !fixture.locked || fixture.locks != 1 || fixture.poolReads != 0 || len(args) != 3 || args[0] != fixture.org || args[1] != fixture.lead {
				return errors.New("pool authorization must follow the exact tenant lead lock once")
			}
			actor, ok := args[2].(*string)
			if !ok || actor != nil {
				return errors.New("pool mutation check must detect the pool independently of the caller audience")
			}
			fixture.poolReads++
			if fixture.poolErr != nil {
				return fixture.poolErr
			}
			*dest[0].(**bool) = fixture.poolAccess
			return nil
		}
		if strings.Contains(query, "for update of l") {
			if fixture.lockErr != nil {
				return fixture.lockErr
			}
			if args[0] != fixture.org || args[1] != fixture.lead {
				return pgx.ErrNoRows
			}
			fixture.locked = true
			fixture.locks++
			*dest[0].(*pgtype.Text) = pgtype.Text{String: fixture.owner, Valid: true}
			*dest[1].(*pgtype.Text) = pgtype.Text{String: fixture.team, Valid: fixture.team != ""}
			if fixture.cancelAfterLock != nil {
				fixture.cancelAfterLock()
			}
			return nil
		}
		if !strings.Contains(query, "insert into public.activities") || !fixture.locked || fixture.poolReads != 1 {
			return errors.New("activity insertion was not guarded by the lead lock")
		}
		if args[0] != fixture.org || args[1] != fixture.lead {
			return errors.New("activity crossed tenant or lead")
		}
		if fixture.insertErr != nil {
			return fixture.insertErr
		}
		fixture.inserts++
		*dest[0].(*string) = "44444444-4444-4444-8444-444444444444"
		*dest[1].(*string) = fixture.org
		*dest[2].(*string) = fixture.lead
		*dest[3].(*pgtype.Text) = pgtype.Text{String: args[2].(string), Valid: true}
		*dest[4].(*string) = args[3].(string)
		if content := args[4].(*string); content != nil {
			*dest[5].(*pgtype.Text) = pgtype.Text{String: *content, Valid: true}
		}
		*dest[6].(*string) = args[5].(string)
		if fixture.hydratedMetadata != "" {
			*dest[6].(*string) = fixture.hydratedMetadata
		}
		*dest[7].(*time.Time) = time.Date(2026, 10, 13, 12, 0, 0, 123456000, time.UTC)
		*dest[8].(*pgtype.Text) = pgtype.Text{String: args[2].(string), Valid: true}
		*dest[9].(*pgtype.Text) = pgtype.Text{String: "Synthetic actor", Valid: true}
		*dest[10].(*pgtype.Text) = pgtype.Text{String: fixture.lead, Valid: true}
		*dest[11].(*pgtype.Text) = pgtype.Text{String: "Synthetic lead", Valid: true}
		return nil
	}}
}

func (fixture *activityCreateFixture) Commit(ctx context.Context) error {
	fixture.commits++
	if err := ctx.Err(); err != nil {
		return err
	}
	return fixture.commitErr
}

func (fixture *activityCreateFixture) Rollback(context.Context) error {
	fixture.rollbacks++
	fixture.locked = false
	return nil
}

func newActivityCreateFixture() (*activityCreateFixture, tenant.Context, activityCreateInput) {
	actor := tenant.Context{OrganizationID: historyPageTestOrg, UserID: historyPageTestOtherOrg, Permissions: []string{permissions.LeadViewOwn, permissions.LeadOperate}}
	content := "Documento anexado: Contrato.pdf"
	input := activityCreateInput{LeadID: historyPageTestLead, Type: "note", Content: &content, Metadata: map[string]any{}}
	return &activityCreateFixture{org: actor.OrganizationID, lead: input.LeadID, owner: actor.UserID}, actor, input
}

func TestCreateActivityTransactionRejectsTransferForeignOrganizationAndMissingOperate(t *testing.T) {
	for _, scenario := range []string{"transfer before lock", "foreign organization", "without operate"} {
		t.Run(scenario, func(t *testing.T) {
			fixture, actor, input := newActivityCreateFixture()
			want := tenant.ErrOrganizationAccessDenied
			switch scenario {
			case "transfer before lock":
				fixture.owner = historyPageTestOrg
			case "foreign organization":
				actor.OrganizationID = historyPageTestOtherOrg
				want = ErrLeadNotFound
			case "without operate":
				actor.Permissions = []string{permissions.LeadViewOwn}
			}
			activity, err := createActivityWithTransaction(context.Background(), fixture.begin, actor, input)
			if !errors.Is(err, want) || activity.ID != "" || fixture.inserts != 0 || fixture.commits != 0 || fixture.rollbacks != 1 {
				t.Fatalf("denied activity was inserted or hydrated: err=%v activity=%+v fixture=%+v", err, activity, fixture)
			}
		})
	}
}

func TestCreateActivityTransactionAllowsCurrentlyLedBrokerUnderAnotherTeam(t *testing.T) {
	fixture, actor, input := newActivityCreateFixture()
	fixture.owner, fixture.team = "broker", "former-team"
	actor.Permissions = []string{permissions.LeadViewTeam, permissions.LeadOperate}
	actor.LedTeamIDs = []string{"current-team"}
	actor.LedUserIDs = []string{fixture.owner}

	activity, err := createActivityWithTransaction(context.Background(), fixture.begin, actor, input)
	if err != nil || activity.ID == "" || fixture.locks != 1 || fixture.poolReads != 1 || fixture.inserts != 1 || fixture.commits != 1 {
		t.Fatalf("currently led broker's activity did not commit in the guarded transaction: %v", err)
	}
}

func TestCreateActivityTransactionPreservesHydratedResponseAndRedaction(t *testing.T) {
	fixture, actor, input := newActivityCreateFixture()
	// Legacy server projections remain readable/redacted; incoming manual
	// metadata no longer has authority to claim attachment/provenance fields.
	fixture.hydratedMetadata = `{"file_name":"Contrato.pdf","file_url":"https://private.invalid/legacy","note":"preserved"}`
	activity, err := createActivityWithTransaction(context.Background(), fixture.begin, actor, input)
	if err != nil || fixture.locks != 1 || fixture.poolReads != 1 || fixture.inserts != 1 || fixture.commits != 1 || fixture.rollbacks != 1 {
		t.Fatalf("activity did not complete inside one locked transaction: %v %+v", err, fixture)
	}
	if activity.Type != input.Type || activity.Content == nil || *activity.Content != *input.Content || activity.OrganizationID != actor.OrganizationID || activity.LeadID != input.LeadID || activity.User == nil || activity.User.ID != actor.UserID || activity.Lead == nil || activity.Lead.ID != input.LeadID {
		t.Fatalf("activity response changed: %+v", activity)
	}
	if activity.CreatedAt.Nanosecond() != 123456000 || activity.Metadata["file_url"] != nil || activity.Metadata["file_name"] != "Contrato.pdf" || activity.Metadata["note"] != "preserved" {
		t.Fatalf("timestamp or metadata projection changed: %+v", activity)
	}
}

func TestCreateActivityTransactionReturnsNoSuccessOnCommitFailure(t *testing.T) {
	fixture, actor, input := newActivityCreateFixture()
	fixture.commitErr = errors.New("synthetic commit failure")
	activity, err := createActivityWithTransaction(context.Background(), fixture.begin, actor, input)
	if !errors.Is(err, fixture.commitErr) || activity.ID != "" || fixture.commits != 1 || fixture.rollbacks != 1 || fixture.locked {
		t.Fatalf("commit failure returned a successful activity: err=%v activity=%+v fixture=%+v", err, activity, fixture)
	}
}

func TestCreateActivityTransactionRollsBackFailuresAndCancellation(t *testing.T) {
	for _, scenario := range []string{"begin", "lock", "pool lookup", "insert", "cancel after lock"} {
		t.Run(scenario, func(t *testing.T) {
			fixture, actor, input := newActivityCreateFixture()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			failure := errors.New("synthetic " + scenario + " failure")
			switch scenario {
			case "begin":
				fixture.beginErr = failure
			case "lock":
				fixture.lockErr = failure
			case "pool lookup":
				fixture.poolErr = failure
			case "insert":
				fixture.insertErr = failure
			case "cancel after lock":
				fixture.cancelAfterLock = cancel
				failure = context.Canceled
			}
			activity, err := createActivityWithTransaction(ctx, fixture.begin, actor, input)
			wantRollback := 1
			if scenario == "begin" {
				wantRollback = 0
			}
			if !errors.Is(err, failure) || activity.ID != "" || fixture.commits != 0 || fixture.rollbacks != wantRollback || fixture.locked {
				t.Fatalf("failed/cancelled activity escaped its transaction: %v %+v %+v", err, activity, fixture)
			}
		})
	}
}

func TestCreateActivityTransactionRequiresClaimForVisibleAndHiddenPools(t *testing.T) {
	for _, access := range []bool{false, true} {
		fixture, actor, input := newActivityCreateFixture()
		fixture.poolAccess = &access
		activity, err := createActivityWithTransaction(context.Background(), fixture.begin, actor, input)
		if !errors.Is(err, ErrQueuePoolConflict) || activity.ID != "" || fixture.locks != 1 || fixture.poolReads != 1 || fixture.inserts != 0 || fixture.commits != 0 || fixture.rollbacks != 1 || fixture.locked {
			t.Fatalf("pool activity bypassed claim: access=%t error=%v fixture=%+v", access, err, fixture)
		}
	}
}
