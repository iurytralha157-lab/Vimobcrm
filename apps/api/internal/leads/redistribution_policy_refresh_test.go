package leads

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// This transaction fake exercises only the repository control flow. It never
// creates a pool, reads environment settings, or connects to a database.
type policyRefreshTx struct {
	pgx.Tx
	settings         []byte
	domainBusy       bool
	queueBusy        bool
	leadBusy         bool
	lockedQueue      string
	lockedAttempt    int
	lockedMax        int
	lockedTimeout    int
	lockedWarning    int
	queries          []string
	executions       []policyRefreshExecution
	poolCheckPending bool
	poolCheckOrg     string
	poolCheckLead    string
}

type policyRefreshExecution struct {
	query string
	args  []any
}

type policyRefreshRow func(...any) error

func (row policyRefreshRow) Scan(destinations ...any) error { return row(destinations...) }

func (tx *policyRefreshTx) Query(_ context.Context, query string, _ ...any) (pgx.Rows, error) {
	tx.queries = append(tx.queries, query)
	return &policyRefreshRows{}, nil
}

func (tx *policyRefreshTx) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	tx.queries = append(tx.queries, query)
	return policyRefreshRow(func(destinations ...any) error {
		switch {
		case strings.Contains(query, "select private.queue_pool_read_access"):
			if !tx.poolCheckPending || len(args) != 3 || args[0] != tx.poolCheckOrg || args[1] != tx.poolCheckLead {
				return fmt.Errorf("policy pool check did not follow its exact tenant lead lock")
			}
			actor, ok := args[2].(*string)
			if !ok || actor != nil {
				return fmt.Errorf("policy pool mutation check must detect every audience")
			}
			tx.poolCheckPending = false
			*destinations[0].(**bool) = nil // Existing policy fixtures are legacy jobs.
		case strings.Contains(query, "pg_try_advisory_xact_lock"):
			*(destinations[0].(*bool)) = !tx.domainBusy
		case strings.Contains(query, "for no key update skip locked"):
			if tx.queueBusy {
				return pgx.ErrNoRows
			}
			*(destinations[0].(*string)) = "33333333-3333-4333-8333-333333333333"
		case strings.Contains(query, "select exists") && strings.Contains(query, "from public.round_robins"):
			*(destinations[0].(*bool)) = true
		case strings.Contains(query, "select exists") && strings.Contains(query, "from public.leads"):
			*(destinations[0].(*bool)) = true
		case strings.Contains(query, "from public.leads l"):
			if tx.leadBusy {
				return pgx.ErrNoRows
			}
			if tx.queueBusy {
				return &pgconn.PgError{Code: "40P01", Message: "intake holds the queue and waits for this lead"}
			}
			if len(args) != 2 || !strings.Contains(query, "for no key update of l") {
				return fmt.Errorf("policy fixture requires the tenant lead write lock")
			}
			tx.poolCheckPending = true
			tx.poolCheckOrg, tx.poolCheckLead = fmt.Sprint(args[0]), fmt.Sprint(args[1])
			for _, destination := range destinations {
				switch value := destination.(type) {
				case *string:
					*value = "fixture"
				case *pgtype.Text:
					*value = pgtype.Text{}
				case *[]byte:
					*value = []byte(`{}`)
				default:
					return fmt.Errorf("unexpected lead destination %T", destination)
				}
			}
		case strings.Contains(query, "from public.lead_redistribution_jobs"):
			*(destinations[0].(*string)) = "33333333-3333-4333-8333-333333333333"
			if tx.lockedQueue != "" {
				*(destinations[0].(*string)) = tx.lockedQueue
			}
			*(destinations[1].(*string)) = "44444444-4444-4444-8444-444444444444"
			*(destinations[2].(*int)) = tx.lockedAttempt
			*(destinations[3].(*int)) = tx.lockedMax
			*(destinations[4].(*int)) = tx.lockedTimeout
			*(destinations[5].(*int)) = tx.lockedWarning
			*(destinations[6].(*time.Time)) = time.Unix(1000, 0)
		case strings.Contains(query, "from public.round_robins") && len(destinations) == 2:
			*(destinations[0].(*bool)) = true
			*(destinations[1].(*[]byte)) = append([]byte(nil), tx.settings...)
		case strings.Contains(query, "from public.round_robins") && len(destinations) == 1:
			*(destinations[0].(*[]byte)) = append([]byte(nil), tx.settings...)
		default:
			return fmt.Errorf("unexpected policy query: %s", query)
		}
		return nil
	})
}

func (tx *policyRefreshTx) Exec(_ context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	tx.executions = append(tx.executions, policyRefreshExecution{query: query, args: append([]any(nil), args...)})
	return pgconn.NewCommandTag("UPDATE 1"), nil
}

type policyRefreshRows struct {
	pgx.Rows
	emitted bool
}

func (rows *policyRefreshRows) Next() bool {
	if rows.emitted {
		return false
	}
	rows.emitted = true
	return true
}
func (*policyRefreshRows) Close()     {}
func (*policyRefreshRows) Err() error { return nil }
func (*policyRefreshRows) Scan(destinations ...any) error {
	for index, value := range []string{
		"11111111-1111-4111-8111-111111111111",
		"22222222-2222-4222-8222-222222222222",
		"55555555-5555-4555-8555-555555555555",
		"33333333-3333-4333-8333-333333333333",
		"44444444-4444-4444-8444-444444444444",
	} {
		*(destinations[index].(*string)) = value
	}
	*(destinations[5].(*int)) = 9 // The unlocked list snapshot predates a re-entry reset.
	*(destinations[6].(*int)) = 10
	*(destinations[7].(*int)) = 20
	*(destinations[8].(*int)) = 5
	*(destinations[9].(*time.Time)) = time.Unix(1000, 0)
	*(destinations[10].(*string)) = "Fixture"
	*(destinations[11].(*[]byte)) = []byte(`{}`)
	return nil
}

func newPolicyRefreshTx() *policyRefreshTx {
	return &policyRefreshTx{
		settings:      []byte(`{"enable_redistribution":true,"redistribution_timeout_minutes":30,"redistribution_warning_minutes":0,"redistribution_max_attempts":5}`),
		lockedAttempt: 0, lockedMax: 10, lockedTimeout: 20, lockedWarning: 5,
	}
}

func TestRedistributionPolicyRefreshUsesLockedAttemptAfterReentryReset(t *testing.T) {
	tx := newPolicyRefreshTx()
	if err := (Repository{}).refreshPendingRedistributionPolicies(context.Background(), tx); err != nil {
		t.Fatal(err)
	}
	if len(tx.executions) != 1 {
		t.Fatalf("executions = %d, want one policy refresh", len(tx.executions))
	}
	update := tx.executions[0]
	if strings.Contains(update.query, "stopped_reason") || len(update.args) != 13 || update.args[3] != 5 {
		t.Fatalf("unlocked attempt snapshot stopped a newly reset job: %#v", update)
	}
	if update.args[4] != "22222222-2222-4222-8222-222222222222" || update.args[5] != "55555555-5555-4555-8555-555555555555" ||
		update.args[6] != "33333333-3333-4333-8333-333333333333" || update.args[7] != 0 || update.args[9] != "44444444-4444-4444-8444-444444444444" {
		t.Fatalf("policy compare-and-swap lacks the locked identity/counter: %#v", update.args)
	}
	if !strings.Contains(update.query, "coalesce(last_redistributed_at, enrolled_at)") || !strings.Contains(update.query, "warning_sent_at = null") {
		t.Fatalf("changed timing must retain elapsed inactivity and reset the old warning: %s", update.query)
	}
}

func TestRedistributionPolicyRefreshDoesNotRewriteAnEquivalentLockedPolicy(t *testing.T) {
	tx := newPolicyRefreshTx()
	tx.lockedMax, tx.lockedTimeout, tx.lockedWarning = 5, 30, 0
	if err := (Repository{}).refreshPendingRedistributionPolicies(context.Background(), tx); err != nil {
		t.Fatal(err)
	}
	if len(tx.executions) != 0 {
		t.Fatalf("equivalent locked policy reset a warning or wrote again: %#v", tx.executions)
	}
}

func TestRedistributionPolicyRefreshStopsDisabledQueueJobs(t *testing.T) {
	tx := newPolicyRefreshTx()
	tx.settings = []byte(`{"enable_redistribution":false}`)
	if err := (Repository{}).refreshPendingRedistributionPolicies(context.Background(), tx); err != nil {
		t.Fatal(err)
	}
	if len(tx.executions) != 1 || len(tx.executions[0].args) != 3 || tx.executions[0].args[1] != "stopped" || tx.executions[0].args[2] != "redistribution_disabled" {
		t.Fatalf("disabled redistribution was not stopped: %#v", tx.executions)
	}
}

func TestRedistributionPolicyRefreshQueriesExcludeInitialRetriesAndTerminalJobs(t *testing.T) {
	tx := newPolicyRefreshTx()
	if err := (Repository{}).refreshPendingRedistributionPolicies(context.Background(), tx); err != nil {
		t.Fatal(err)
	}
	checked := 0
	for _, query := range tx.queries {
		if !strings.Contains(query, "from public.lead_redistribution_jobs") {
			continue
		}
		checked++
		query = strings.ToLower(strings.Join(strings.Fields(query), " "))
		if !strings.Contains(query, "initial_distribution_pending") || !strings.Contains(query, "not in ('true','1','yes')") || !strings.Contains(query, "'pending'") || !strings.Contains(query, "'warning_sent'") {
			t.Fatalf("query can select initial retry or terminal jobs: %s", query)
		}
	}
	if checked != 2 {
		t.Fatalf("checked %d job queries, want snapshot and locked re-read", checked)
	}
}

func TestRedistributionPolicyRefreshDoesNotLockJobsOrLeadsWhenConfigurationIsBusy(t *testing.T) {
	tx := newPolicyRefreshTx()
	tx.domainBusy = true
	err := (Repository{}).refreshPendingRedistributionPolicies(context.Background(), tx)
	if !errors.Is(err, errRedistributionConfigurationBusy) {
		t.Fatalf("busy result = %v", err)
	}
	if len(tx.executions) != 0 || len(tx.queries) != 2 {
		t.Fatalf("busy configuration touched a lead/job: %#v, %#v", tx.queries, tx.executions)
	}
	for _, query := range tx.queries {
		// Discovery uses SKIP LOCKED in a separate short transaction, committed
		// before this configuration fence. No processing row lock may follow it.
		if (strings.Contains(query, "for update") && !strings.Contains(query, "for update of j skip locked")) || strings.Contains(query, "for no key update") || strings.Contains(query, "for share") {
			t.Fatalf("busy configuration took a row lock: %s", query)
		}
	}
}

func TestRedistributionPolicyRefreshSkipsAnIntakeLockedQueueBeforeTakingTheLead(t *testing.T) {
	tx := newPolicyRefreshTx()
	tx.queueBusy = true
	if err := (Repository{}).refreshPendingRedistributionPolicies(context.Background(), tx); err != nil {
		t.Fatalf("busy intake must remain free to finish instead of forming a lead/queue cycle: %v", err)
	}
	if len(tx.executions) != 0 {
		t.Fatalf("busy queue changed a pending job: %#v", tx.executions)
	}
	for _, query := range tx.queries {
		if strings.Contains(query, "from public.leads l") || strings.Contains(query, "status in ('pending','warning_sent')") {
			t.Fatalf("busy queue took a lead or job lock: %s", query)
		}
	}
}

func TestRedistributionPolicyRefreshRetriesAJobMovedToAnotherQueueWhileWaiting(t *testing.T) {
	tx := newPolicyRefreshTx()
	tx.lockedQueue = "66666666-6666-4666-8666-666666666666"
	if err := (Repository{}).refreshPendingRedistributionPolicies(context.Background(), tx); err != nil {
		t.Fatal(err)
	}
	if len(tx.executions) != 0 {
		t.Fatalf("a moved job must await its new queue lock on a later tick: %#v", tx.executions)
	}
}

func TestRedistributionPolicyRefreshSkipsLegacyWhatsAppLeadLockWithoutStoppingTheJob(t *testing.T) {
	tx := newPolicyRefreshTx()
	tx.leadBusy = true
	if err := (Repository{}).refreshPendingRedistributionPolicies(context.Background(), tx); err != nil {
		t.Fatal(err)
	}
	if len(tx.executions) != 0 {
		t.Fatalf("busy existing lead was stopped or changed: %#v", tx.executions)
	}
	for _, query := range tx.queries {
		if strings.Contains(query, "from public.leads l") && !strings.Contains(query, "for no key update of l skip locked") {
			t.Fatalf("the worker waited for a lead held by legacy WhatsApp intake: %s", query)
		}
	}
}
