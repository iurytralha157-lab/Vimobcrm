package leads

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// Only SQL transport and commit/rollback are synthetic. The production kernel,
// authorization, scanners and replay decision execute unchanged, without a DB.
type cadenceCompletionStore struct {
	mu                       sync.Mutex
	task                     LeadTask
	activities               int
	pool                     *bool
	closed, required         bool
	failActivity             bool
	firstLocked, releaseLock chan struct{}
	lockSignalled            bool
}

type cadenceCompletionTx struct {
	pgx.Tx
	store    *cadenceCompletionStore
	locked   bool
	mutated  bool
	activity bool
	task     LeadTask
	queries  int
}

func (tx *cadenceCompletionTx) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	tx.queries++
	if strings.Contains(query, "for update of l") && !strings.Contains(query, "for update of lt") {
		tx.store.mu.Lock()
		tx.locked = true
		tx.task = tx.store.task
		if tx.store.firstLocked != nil && !tx.store.lockSignalled {
			tx.store.lockSignalled = true
			close(tx.store.firstLocked)
			<-tx.store.releaseLock
		}
		return historyScopeRow{scan: func(dest ...any) error {
			if len(args) != 2 || args[0] != moveRevisionOrg || args[1] != moveRevisionLead {
				return pgx.ErrNoRows
			}
			*dest[0].(*pgtype.Text) = pgtype.Text{String: routeCadenceActor, Valid: true}
			*dest[1].(*pgtype.Text) = pgtype.Text{}
			return nil
		}}
	}
	if !tx.locked {
		panic("cadence access must hold the lead lock first")
	}
	if strings.Contains(query, "select private.queue_pool_read_access") {
		return historyScopeRow{scan: func(dest ...any) error { *dest[0].(**bool) = tx.store.pool; return nil }}
	}
	if strings.Contains(query, "join public.cadence_enrollments") {
		if !strings.Contains(query, "for update of lt") || !strings.Contains(query, "sc.exited_at is null") || !strings.Contains(query, "l.deal_status = 'open'") {
			panic("cadence lifecycle guards changed")
		}
		return historyScopeRow{scan: func(dest ...any) error {
			if tx.store.closed || args[0] != moveRevisionOrg || args[1] != moveRevisionLead || args[2] != tx.task.ID {
				return pgx.ErrNoRows
			}
			*dest[0].(*string) = tx.task.ID
			status := "pending"
			if tx.task.IsDone != nil && *tx.task.IsDone {
				status = "completed"
			}
			*dest[1].(*string) = status
			*dest[2].(*bool) = tx.store.required
			*dest[3].(*pgtype.Text) = pgtype.Text{}
			return nil
		}}
	}
	if strings.Contains(query, "update public.lead_tasks") {
		if tx.task.IsDone != nil && *tx.task.IsDone {
			panic("completed task must never be overwritten")
		}
		tx.mutated = true
		done, now, actor := true, time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC), args[2].(string)
		tx.task.IsDone, tx.task.DoneAt, tx.task.DoneBy = &done, &now, &actor
		tx.task.Outcome, tx.task.OutcomeNotes = args[3].(*string), args[4].(*string)
		return cadenceCompletionRow{task: tx.task}
	}
	if strings.Contains(query, "from public.lead_tasks") && len(args) == 2 && args[0] == moveRevisionOrg && args[1] == tx.task.ID {
		return cadenceCompletionRow{task: tx.task}
	}
	panic("unexpected cadence query")
}

func (tx *cadenceCompletionTx) Exec(_ context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	if !tx.locked || !tx.mutated || !strings.Contains(query, "insert into public.activities") || args[0] != moveRevisionOrg || args[1] != moveRevisionLead {
		panic("activity must follow one authorized task update")
	}
	if tx.store.failActivity {
		return pgconn.CommandTag{}, errors.New("synthetic activity failure")
	}
	tx.activity = true
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}

func (tx *cadenceCompletionTx) Commit(context.Context) error {
	if tx.mutated {
		tx.store.task = tx.task
	}
	if tx.activity {
		tx.store.activities++
	}
	return tx.Rollback(context.Background())
}

func (tx *cadenceCompletionTx) Rollback(context.Context) error {
	if tx.locked {
		tx.locked = false
		tx.store.mu.Unlock()
	}
	return nil
}

type cadenceCompletionRow struct{ task LeadTask }

func (row cadenceCompletionRow) Scan(dest ...any) error {
	task := row.task
	*dest[0].(*string), *dest[1].(*string), *dest[2].(*int), *dest[4].(*string) = task.ID, task.LeadID, task.DayOffset, task.Title
	text := func(value *string) pgtype.Text {
		if value == nil {
			return pgtype.Text{}
		}
		return pgtype.Text{String: *value, Valid: true}
	}
	*dest[3].(*pgtype.Text), *dest[5].(*pgtype.Text) = text(task.Type), text(task.Description)
	*dest[6].(*pgtype.Timestamptz) = pgtype.Timestamptz{}
	*dest[7].(*pgtype.Bool) = pgtype.Bool{Bool: task.IsDone != nil && *task.IsDone, Valid: true}
	*dest[8].(*pgtype.Timestamptz) = pgtype.Timestamptz{}
	if task.DoneAt != nil {
		*dest[8].(*pgtype.Timestamptz) = pgtype.Timestamptz{Time: *task.DoneAt, Valid: true}
	}
	*dest[9].(*pgtype.Text), *dest[10].(*pgtype.Text), *dest[11].(*pgtype.Text) = text(task.DoneBy), text(task.Outcome), text(task.OutcomeNotes)
	*dest[12].(*time.Time) = task.CreatedAt
	return nil
}

const routeCadenceActor = "50000000-0000-4000-8000-000000000001"

func newCadenceCompletionStore() *cadenceCompletionStore {
	return &cadenceCompletionStore{task: LeadTask{ID: moveRevisionDestination, LeadID: moveRevisionLead, Title: "Synthetic task", CreatedAt: time.Date(2026, 10, 17, 11, 0, 0, 0, time.UTC)}}
}

func runCadenceCompletion(store *cadenceCompletionStore, actor tenant.Context, request CompleteCadenceTaskRequest) (LeadTask, bool, error) {
	tx := &cadenceCompletionTx{store: store}
	defer tx.Rollback(context.Background())
	task, changed, err := completeCadenceTaskTx(context.Background(), tx, actor, request)
	if err != nil {
		return LeadTask{}, false, err
	}
	return task, changed, tx.Commit(context.Background())
}

func TestCadenceConcurrentCompletionPreservesFirstResultAndDistinguishesReplay(t *testing.T) {
	for _, scenario := range []struct {
		name, outcome, notes string
		conflict             bool
	}{
		{"same request", "not_answered", "Original notes", false},
		{"different result", "scheduled", "Original notes", true},
		{"different notes", "not_answered", "Changed notes", true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			store := newCadenceCompletionStore()
			store.firstLocked = make(chan struct{})
			store.releaseLock = make(chan struct{})
			actor := moveRevisionActor()
			actor.UserID = routeCadenceActor
			firstOutcome, firstNotes := "not_answered", "Original notes"
			first := CompleteCadenceTaskRequest{LeadID: moveRevisionLead, TaskID: store.task.ID, Outcome: &firstOutcome, OutcomeNotes: &firstNotes}
			second := first
			second.Outcome = &scenario.outcome
			second.OutcomeNotes = &scenario.notes
			type result struct {
				task    LeadTask
				changed bool
				err     error
			}
			a, b := make(chan result, 1), make(chan result, 1)
			go func() {
				task, changed, err := runCadenceCompletion(store, actor, first)
				a <- result{task, changed, err}
			}()
			<-store.firstLocked
			go func() {
				other := actor
				other.UserID = "50000000-0000-4000-8000-000000000002"
				task, changed, err := runCadenceCompletion(store, other, second)
				b <- result{task, changed, err}
			}()
			close(store.releaseLock)
			original, replay := <-a, <-b
			if original.err != nil || !original.changed || (replay.err != nil) != scenario.conflict || replay.changed {
				t.Fatalf("completion decision: first error=%v changed=%v; second error=%v changed=%v", original.err, original.changed, replay.err, replay.changed)
			}
			if scenario.conflict && !errors.Is(replay.err, ErrCadenceCompletionConflict) {
				t.Fatal("different completion must return the stable conflict")
			}
			if store.activities != 1 || store.task.Outcome == nil || *store.task.Outcome != "not_answered" || store.task.OutcomeNotes == nil || *store.task.OutcomeNotes != "Original notes" || store.task.DoneBy == nil || *store.task.DoneBy != routeCadenceActor {
				t.Fatal("concurrent replay changed the canonical completion or duplicated its activity")
			}
			if !scenario.conflict && (replay.task.ID != store.task.ID || replay.task.DoneBy == nil || *replay.task.DoneBy != routeCadenceActor) {
				t.Fatal("equal replay must return the original canonical task")
			}
		})
	}
}

func TestCadenceCompletionReplayNormalizesOnlyOptionalWhitespace(t *testing.T) {
	value := func(s string) *string { return &s }
	for _, test := range []struct {
		name    string
		task    LeadTask
		request CompleteCadenceTaskRequest
		want    bool
	}{
		{"legacy empty", LeadTask{}, CompleteCadenceTaskRequest{}, true},
		{"empty versus nil", LeadTask{OutcomeNotes: value(" ")}, CompleteCadenceTaskRequest{}, true},
		{"trimmed replay", LeadTask{Outcome: value("done"), OutcomeNotes: value(" original ")}, CompleteCadenceTaskRequest{Outcome: value("done"), OutcomeNotes: value("original")}, true},
		{"new result", LeadTask{Outcome: value("answered")}, CompleteCadenceTaskRequest{Outcome: value("not_answered")}, false},
		{"new notes", LeadTask{OutcomeNotes: value("original")}, CompleteCadenceTaskRequest{OutcomeNotes: value("other")}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if sameCadenceCompletion(test.task, test.request) != test.want {
				t.Fatal("replay comparison changed the request intention")
			}
		})
	}
	response := httptest.NewRecorder()
	writeLeadError(response, httptest.NewRequest(http.MethodPost, "/v1/lead-tasks/complete-cadence", nil), fmt.Errorf("synthetic internal details: %w", ErrCadenceCompletionConflict))
	if response.Code != 409 || !strings.Contains(response.Body.String(), `"code":"lead_cadence_completion_conflict"`) || strings.Contains(response.Body.String(), "synthetic internal") {
		t.Fatal("completion conflict contract exposed details or lost its status/code")
	}
}

func TestCadenceCompletionRetainsAuthorizationLifecycleAndAtomicity(t *testing.T) {
	for _, name := range []string{"foreign organization", "denied operation", "pool lead", "closed cycle", "required outcome", "activity failure"} {
		t.Run(name, func(t *testing.T) {
			store := newCadenceCompletionStore()
			actor := moveRevisionActor()
			actor.UserID = routeCadenceActor
			outcome := "answered"
			request := CompleteCadenceTaskRequest{LeadID: moveRevisionLead, TaskID: store.task.ID, Outcome: &outcome}
			switch name {
			case "foreign organization":
				actor.OrganizationID = moveRevisionDestination
			case "denied operation":
				actor.MemberRole = "user"
			case "pool lead":
				pool := true
				store.pool = &pool
			case "closed cycle":
				store.closed = true
			case "required outcome":
				store.required = true
				request.Outcome = nil
			case "activity failure":
				store.failActivity = true
			}
			if _, _, err := runCadenceCompletion(store, actor, request); err == nil {
				t.Fatal("unsafe completion was accepted")
			}
			if store.activities != 0 || store.task.IsDone != nil || store.task.Outcome != nil {
				t.Fatal("rejected completion left a durable effect")
			}
		})
	}
}
