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

type feedbackFixtureLead struct {
	owner, feedback string
	pool            *bool
}
type feedbackFixtureReceipt struct {
	receipt LeadFeedbackReceipt
	digest  string
}
type feedbackFixture struct {
	mu                                                  sync.Mutex
	leads                                               map[string]feedbackFixtureLead
	receipts                                            map[string]feedbackFixtureReceipt
	activities                                          map[string]string
	updates, audits, sequence                           int
	failAt                                              string
	missingTable, lostCommit, commitFailure, zeroUpdate bool
}
type feedbackFixtureTx struct {
	pgx.Tx
	f                         *feedbackFixture
	locked                    bool
	leads                     map[string]feedbackFixtureLead
	receipts                  map[string]feedbackFixtureReceipt
	activities                map[string]string
	leadKey                   string
	updates, audits, sequence int
}

func cloneFeedbackMap[T any](source map[string]T) map[string]T {
	target := make(map[string]T, len(source))
	for key, value := range source {
		target[key] = value
	}
	return target
}
func feedbackReceiptKey(args []any) string {
	return args[0].(string) + ":" + args[1].(string) + ":" + args[2].(string)
}
func (f *feedbackFixture) begin(ctx context.Context) (pgx.Tx, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return &feedbackFixtureTx{f: f}, nil
}
func (tx *feedbackFixtureTx) QueryRow(ctx context.Context, query string, args ...any) pgx.Row {
	if strings.Contains(query, "for no key update of l") {
		tx.f.mu.Lock()
		tx.locked = true
		tx.leads, tx.receipts, tx.activities = cloneFeedbackMap(tx.f.leads), cloneFeedbackMap(tx.f.receipts), cloneFeedbackMap(tx.f.activities)
		tx.sequence = tx.f.sequence
		tx.leadKey = args[0].(string) + ":" + args[1].(string)
		return historyScopeRow{scan: func(dest ...any) error {
			if err := ctx.Err(); err != nil {
				return err
			}
			lead, ok := tx.leads[tx.leadKey]
			if !ok {
				return pgx.ErrNoRows
			}
			*dest[0].(*string) = args[1].(string)
			*dest[2].(*string) = "Synthetic lead"
			*dest[8].(*string) = "open"
			for _, i := range []int{1, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13} {
				*dest[i].(*pgtype.Text) = pgtype.Text{}
			}
			*dest[4].(*pgtype.Text) = pgtype.Text{String: lead.owner, Valid: lead.owner != ""}
			*dest[5].(*pgtype.Text) = pgtype.Text{String: moveRevisionDestination, Valid: true}
			*dest[6].(*pgtype.Text) = pgtype.Text{String: moveRevisionStage, Valid: true}
			raw, _ := json.Marshal(map[string]any{"feedback": lead.feedback})
			*dest[14].(*[]byte) = raw
			return nil
		}}
	}
	if !tx.locked {
		panic("feedback query preceded the lead lock")
	}
	return historyScopeRow{scan: func(dest ...any) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		switch {
		case strings.Contains(query, "select private.queue_pool_read_access"):
			if args[0].(string)+":"+args[1].(string) != tx.leadKey {
				panic("pool scope changed")
			}
			*dest[0].(**bool) = tx.leads[tx.leadKey].pool
		case strings.Contains(query, "from private.lead_feedback_command_receipts"):
			row, found := tx.receipts[feedbackReceiptKey(args)]
			if !found {
				return pgx.ErrNoRows
			}
			*dest[0].(*string), *dest[1].(*string) = row.digest, row.receipt.LeadID
			*dest[2].(*pgtype.Text) = pgtype.Text{String: row.receipt.ActivityID, Valid: row.receipt.ActivityID != ""}
			*dest[3].(*pgtype.Timestamptz) = pgtype.Timestamptz{Time: row.receipt.RecordedAt, Valid: !row.receipt.RecordedAt.IsZero()}
		case strings.Contains(query, "insert into public.activities"):
			if tx.f.failAt == "activity" {
				return errors.New("synthetic activity error")
			}
			if tx.updates != 1 || args[0].(string)+":"+args[1].(string) != tx.leadKey || !strings.Contains(query, `"kind":"feedback","origin":"lead_update"`) {
				panic("activity lost feedback shape or scope")
			}
			tx.sequence++
			id := fmt.Sprintf("60000000-0000-4000-8000-%012d", tx.sequence)
			tx.activities[id] = args[3].(string)
			*dest[0].(*string) = id
			*dest[1].(*time.Time) = time.Date(2026, 10, 17, 12, 0, tx.sequence, 0, time.UTC)
		default:
			panic("unexpected feedback row query")
		}
		return nil
	}}
}

func (tx *feedbackFixtureTx) Exec(ctx context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	if err := ctx.Err(); err != nil {
		return pgconn.CommandTag{}, err
	}
	if !tx.locked {
		panic("feedback write preceded authorization")
	}
	switch {
	case strings.Contains(query, "insert into private.lead_feedback_command_receipts"):
		if tx.f.missingTable {
			return pgconn.CommandTag{}, &pgconn.PgError{Code: "42P01", Message: "synthetic table unavailable"}
		}
		key := feedbackReceiptKey(args)
		if _, found := tx.receipts[key]; found {
			return pgconn.NewCommandTag("INSERT 0 0"), nil
		}
		tx.receipts[key] = feedbackFixtureReceipt{receipt: LeadFeedbackReceipt{CommandID: args[2].(string), LeadID: args[3].(string)}, digest: args[4].(string)}
		return pgconn.NewCommandTag("INSERT 0 1"), nil
	case strings.Contains(query, "update public.leads"):
		if tx.f.failAt == "lead" {
			return pgconn.CommandTag{}, errors.New("synthetic lead error")
		}
		if tx.f.zeroUpdate {
			return pgconn.NewCommandTag("UPDATE 0"), nil
		}
		if args[0].(string)+":"+args[1].(string) != tx.leadKey {
			panic("feedback update crossed lead scope")
		}
		lead := tx.leads[tx.leadKey]
		lead.feedback = args[2].(string)
		tx.leads[tx.leadKey] = lead
		tx.updates++
	case strings.Contains(query, "insert into public.audit_logs"):
		if tx.f.failAt == "audit" {
			return pgconn.CommandTag{}, errors.New("synthetic audit error")
		}
		tx.audits++
	case strings.Contains(query, "update private.lead_feedback_command_receipts"):
		if tx.f.failAt == "receipt" {
			return pgconn.NewCommandTag("UPDATE 0"), nil
		}
		key := feedbackReceiptKey(args)
		row := tx.receipts[key]
		if row.digest != args[3].(string) || row.receipt.ActivityID != "" {
			return pgconn.NewCommandTag("UPDATE 0"), nil
		}
		row.receipt.ActivityID, row.receipt.RecordedAt = args[4].(string), args[5].(time.Time)
		tx.receipts[key] = row
	default:
		panic("unexpected feedback write")
	}
	return pgconn.NewCommandTag("UPDATE 1"), nil
}

func (tx *feedbackFixtureTx) Commit(context.Context) error {
	if tx.f.commitFailure {
		return errors.New("synthetic commit rollback")
	}
	tx.f.leads, tx.f.receipts, tx.f.activities = tx.leads, tx.receipts, tx.activities
	tx.f.updates += tx.updates
	tx.f.audits += tx.audits
	tx.f.sequence = tx.sequence
	lost := tx.f.lostCommit
	tx.f.lostCommit = false
	_ = tx.Rollback(context.Background())
	if lost {
		return errors.New("synthetic commit response lost")
	}
	return nil
}
func (tx *feedbackFixtureTx) Rollback(context.Context) error {
	if tx.locked {
		tx.locked = false
		tx.f.mu.Unlock()
	}
	return nil
}

func newFeedbackFixture() (*feedbackFixture, tenant.Context) {
	actor := tenant.Context{OrganizationID: attachmentTestOrg, UserID: attachmentTestActor, MemberRole: "user", Permissions: []string{permissions.LeadOperate, permissions.LeadViewOwn}}
	f := &feedbackFixture{leads: map[string]feedbackFixtureLead{attachmentTestOrg + ":" + attachmentTestLead: {owner: actor.UserID}}, receipts: map[string]feedbackFixtureReceipt{}, activities: map[string]string{}}
	return f, actor
}
func submitFeedback(t *testing.T, f *feedbackFixture, actor tenant.Context, lead, key, content string) (leadFeedbackResult, error) {
	t.Helper()
	input, err := (LeadFeedbackRequest{CommandID: key, Content: content}).Validate()
	if err != nil {
		t.Fatal("synthetic feedback input invalid")
	}
	return (Repository{}).recordFeedbackWithBegin(context.Background(), actor, lead, input, f.begin)
}
