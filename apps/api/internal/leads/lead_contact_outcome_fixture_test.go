package leads

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const contactOutcomeOrg = "10000000-0000-4000-8000-000000000001"
const contactOutcomeActor = "20000000-0000-4000-8000-000000000001"
const contactOutcomeLead = "30000000-0000-4000-8000-000000000001"
const contactOutcomeCommand = "40000000-0000-4000-8000-000000000001"
const contactOutcomeOther = "50000000-0000-4000-8000-000000000002"

type contactOutcomeFixtureLead struct {
	owner, team string
	pool        *bool
}
type contactOutcomeFixtureReceipt struct {
	receipt LeadContactOutcomeReceipt
	digest  string
}
type contactOutcomeFixtureActivity struct {
	org, lead, actor, channel, content string
	metadata                           map[string]any
}
type contactOutcomeFixture struct {
	mu                  sync.Mutex
	leads               map[string]contactOutcomeFixtureLead
	receipts            map[string]contactOutcomeFixtureReceipt
	activities          map[string]contactOutcomeFixtureActivity
	sequence            int
	failAt, storageCode string
	lostCommit          bool
	cancelAfterLock     context.CancelFunc
}
type contactOutcomeFixtureTx struct {
	pgx.Tx
	f           *contactOutcomeFixture
	locked      bool
	leadKey     string
	poolRead    bool
	claimed     bool
	readReceipt bool
	leads       map[string]contactOutcomeFixtureLead
	receipts    map[string]contactOutcomeFixtureReceipt
	activities  map[string]contactOutcomeFixtureActivity
	sequence    int
}

func cloneContactOutcomeMap[T any](source map[string]T) map[string]T {
	target := make(map[string]T, len(source))
	for key, value := range source {
		target[key] = value
	}
	return target
}
func contactOutcomeReceiptKey(args []any) string {
	return args[0].(string) + ":" + args[1].(string) + ":" + args[2].(string)
}
func (f *contactOutcomeFixture) begin(ctx context.Context) (pgx.Tx, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if f.failAt == "begin" {
		return nil, errors.New("synthetic begin failure")
	}
	return &contactOutcomeFixtureTx{f: f}, nil
}

func (tx *contactOutcomeFixtureTx) QueryRow(ctx context.Context, query string, args ...any) pgx.Row {
	if strings.Contains(query, "for update of l") {
		tx.f.mu.Lock()
		tx.locked = true
		tx.leadKey = args[0].(string) + ":" + args[1].(string)
		tx.leads, tx.receipts = cloneContactOutcomeMap(tx.f.leads), cloneContactOutcomeMap(tx.f.receipts)
		tx.activities, tx.sequence = cloneContactOutcomeMap(tx.f.activities), tx.f.sequence
		return historyScopeRow{scan: func(dest ...any) error {
			if err := ctx.Err(); err != nil {
				return err
			}
			if tx.f.failAt == "lock" {
				return errors.New("synthetic lock failure")
			}
			lead, found := tx.leads[tx.leadKey]
			if !found {
				return pgx.ErrNoRows
			}
			*dest[0].(*pgtype.Text) = pgtype.Text{String: lead.owner, Valid: lead.owner != ""}
			*dest[1].(*pgtype.Text) = pgtype.Text{String: lead.team, Valid: lead.team != ""}
			if tx.f.cancelAfterLock != nil {
				tx.f.cancelAfterLock()
			}
			return nil
		}}
	}
	if !tx.locked {
		panic("contact outcome query preceded the lead lock")
	}
	return historyScopeRow{scan: func(dest ...any) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		switch {
		case strings.Contains(query, "select private.queue_pool_read_access"):
			if tx.poolRead || args[0].(string)+":"+args[1].(string) != tx.leadKey {
				panic("pool scope/order changed")
			}
			if actor, ok := args[2].(*string); !ok || actor != nil {
				panic("pool write guard must detect every pool")
			}
			tx.poolRead = true
			if tx.f.failAt == "pool" {
				return errors.New("synthetic pool failure")
			}
			*dest[0].(**bool) = tx.leads[tx.leadKey].pool
		case strings.Contains(query, "from private.lead_contact_outcome_command_receipts"):
			if !tx.claimed || !strings.Contains(query, "for update") {
				panic("receipt must be claimed and locked")
			}
			if tx.f.failAt == "read receipt" {
				return pgx.ErrNoRows
			}
			stored, found := tx.receipts[contactOutcomeReceiptKey(args)]
			if !found {
				return pgx.ErrNoRows
			}
			tx.readReceipt = true
			*dest[0].(*string), *dest[1].(*string), *dest[2].(*string) = stored.digest, stored.receipt.LeadID, stored.receipt.Channel
			*dest[3].(*pgtype.Text) = pgtype.Text{String: stored.receipt.ActivityID, Valid: stored.receipt.ActivityID != ""}
			*dest[4].(*pgtype.Timestamptz) = pgtype.Timestamptz{Time: stored.receipt.RecordedAt, Valid: !stored.receipt.RecordedAt.IsZero()}
		case strings.Contains(query, "insert into public.activities"):
			if !tx.readReceipt || args[0].(string)+":"+args[1].(string) != tx.leadKey {
				panic("unguarded or foreign activity")
			}
			if tx.f.failAt == "activity" {
				return errors.New("synthetic activity failure")
			}
			metadata := map[string]any{}
			if err := json.Unmarshal([]byte(args[5].(string)), &metadata); err != nil {
				panic(err)
			}
			if len(metadata) != 3 || metadata["channel"] != args[3] || metadata["outcome"] == nil || metadata["notes"] == nil {
				panic("activity contract changed")
			}
			tx.sequence++
			id := fmt.Sprintf("60000000-0000-4000-8000-%012d", tx.sequence)
			tx.activities[id] = contactOutcomeFixtureActivity{args[0].(string), args[1].(string), args[2].(string), args[3].(string), args[4].(string), metadata}
			if tx.f.failAt == "invalid activity" {
				id = "not-an-activity-id"
			}
			*dest[0].(*string) = id
			*dest[1].(*time.Time) = time.Date(2026, 10, 20, 12, 0, tx.sequence, 123456000, time.UTC)
		default:
			panic("unexpected contact outcome row query")
		}
		return nil
	}}
}

func (tx *contactOutcomeFixtureTx) Exec(ctx context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	if err := ctx.Err(); err != nil {
		return pgconn.CommandTag{}, err
	}
	if !tx.locked || !tx.poolRead {
		panic("receipt write preceded fresh authorization")
	}
	switch {
	case strings.Contains(query, "insert into private.lead_contact_outcome_command_receipts"):
		if tx.f.storageCode != "" {
			return pgconn.CommandTag{}, &pgconn.PgError{Code: tx.f.storageCode, Message: "synthetic SQL detail"}
		}
		if tx.f.failAt == "claim" {
			return pgconn.CommandTag{}, errors.New("synthetic claim failure")
		}
		if args[0].(string)+":"+args[3].(string) != tx.leadKey {
			panic("receipt crossed tenant or lead")
		}
		tx.claimed = true
		key := contactOutcomeReceiptKey(args)
		if _, found := tx.receipts[key]; found {
			return pgconn.NewCommandTag("INSERT 0 0"), nil
		}
		tx.receipts[key] = contactOutcomeFixtureReceipt{LeadContactOutcomeReceipt{CommandID: args[2].(string), LeadID: args[3].(string), Channel: args[4].(string)}, args[5].(string)}
		return pgconn.NewCommandTag("INSERT 0 1"), nil
	case strings.Contains(query, "update private.lead_contact_outcome_command_receipts"):
		if !tx.readReceipt {
			panic("completion preceded receipt lock")
		}
		if tx.f.failAt == "complete" {
			return pgconn.NewCommandTag("UPDATE 0"), nil
		}
		if tx.f.failAt == "complete storage" {
			return pgconn.CommandTag{}, &pgconn.PgError{Code: "42501"}
		}
		key := contactOutcomeReceiptKey(args)
		stored := tx.receipts[key]
		if stored.digest != args[3] || stored.receipt.Channel != args[4] || stored.receipt.ActivityID != "" || !stored.receipt.RecordedAt.IsZero() {
			return pgconn.NewCommandTag("UPDATE 0"), nil
		}
		stored.receipt.ActivityID, stored.receipt.RecordedAt = args[5].(string), args[6].(time.Time)
		tx.receipts[key] = stored
		return pgconn.NewCommandTag("UPDATE 1"), nil
	default:
		panic("unexpected contact outcome write: no lead, audit, cadence or legacy fallback writes are permitted")
	}
}

func (tx *contactOutcomeFixtureTx) Commit(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if tx.f.failAt == "commit" {
		return errors.New("synthetic commit failure")
	}
	tx.f.receipts, tx.f.activities, tx.f.sequence = tx.receipts, tx.activities, tx.sequence
	lost := tx.f.lostCommit
	tx.f.lostCommit = false
	_ = tx.Rollback(context.Background())
	if lost {
		return errors.New("synthetic commit response lost")
	}
	return nil
}
func (tx *contactOutcomeFixtureTx) Rollback(context.Context) error {
	if tx.locked {
		tx.locked = false
		tx.f.mu.Unlock()
	}
	return nil
}

func newContactOutcomeFixture() (*contactOutcomeFixture, tenant.Context) {
	actor := tenant.Context{OrganizationID: contactOutcomeOrg, UserID: contactOutcomeActor, MemberRole: "user", Permissions: []string{permissions.LeadOperate, permissions.LeadViewOwn}}
	return &contactOutcomeFixture{leads: map[string]contactOutcomeFixtureLead{contactOutcomeOrg + ":" + contactOutcomeLead: {owner: actor.UserID}}, receipts: map[string]contactOutcomeFixtureReceipt{}, activities: map[string]contactOutcomeFixtureActivity{}}, actor
}
func contactOutcomeRequest() LeadContactOutcomeRequest {
	return LeadContactOutcomeRequest{contactOutcomeCommand, "call", "answered", "Synthetic notes"}
}
func submitContactOutcome(t *testing.T, f *contactOutcomeFixture, actor tenant.Context, leadID string, request LeadContactOutcomeRequest) (LeadContactOutcomeReceipt, error) {
	t.Helper()
	input, err := request.Validate()
	if err != nil {
		t.Fatal("invalid synthetic outcome request", err)
	}
	return (Repository{}).recordContactOutcomeWithBegin(context.Background(), actor, leadID, input, f.begin)
}
