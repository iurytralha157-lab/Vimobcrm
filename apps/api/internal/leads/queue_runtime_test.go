package leads

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/realtime"
)

type queueRuntimeBatchTx struct {
	pgx.Tx
	raw              []byte
	locked           bool
	committed        bool
	commitErr        error
	batchQueryCalled bool
}

func (tx *queueRuntimeBatchTx) QueryRow(_ context.Context, query string, _ ...any) pgx.Row {
	if strings.Contains(query, "pg_try_advisory_xact_lock") {
		return redistributionBoolRow{value: tx.locked}
	}
	tx.batchQueryCalled = true
	return redistributionJSONRow{value: tx.raw}
}

func (tx *queueRuntimeBatchTx) Commit(context.Context) error {
	if tx.commitErr == nil {
		tx.committed = true
	}
	return tx.commitErr
}

func (*queueRuntimeBatchTx) Rollback(context.Context) error { return nil }

type queueRuntimePublisher struct {
	tx     *queueRuntimeBatchTx
	events []realtime.Event
}

func (publisher *queueRuntimePublisher) Publish(event realtime.Event) {
	if !publisher.tx.committed {
		panic("invalidation before commit")
	}
	publisher.events = append(publisher.events, event)
}

func TestQueuePoolBatchCommitsSuccessfulItemsBeforeReportingIndividualFailure(t *testing.T) {
	tx := &queueRuntimeBatchTx{locked: true, raw: []byte(`{"processed":1,"failed":1,"changed":[{"organizationId":"11111111-1111-4111-8111-111111111111","leadId":"22222222-2222-4222-8222-222222222222"}]}`)}
	publisher := &queueRuntimePublisher{tx: tx}
	count, err := (Repository{queueRuntimePublisher: publisher}).processManagedQueueBatchInTx(context.Background(), tx)
	if count != 1 || err == nil || !tx.committed || len(publisher.events) != 1 {
		t.Fatalf("one failed item rolled back good progress/invalidation: count=%d err=%v committed=%t events=%d", count, err, tx.committed, len(publisher.events))
	}
}

func TestQueuePoolBatchDoesNotPublishOnRollbackOrProcessWhenAnotherReplicaOwnsIt(t *testing.T) {
	for _, testCase := range []struct {
		name string
		tx   *queueRuntimeBatchTx
	}{
		{"busy replica", &queueRuntimeBatchTx{locked: false}},
		{"commit failed", &queueRuntimeBatchTx{locked: true, raw: []byte(`{"processed":1}`), commitErr: errors.New("synthetic commit failure")}},
		{"invalid result", &queueRuntimeBatchTx{locked: true, raw: []byte(`{"processed":-1}`)}},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			publisher := &queueRuntimePublisher{tx: testCase.tx}
			_, _ = (Repository{queueRuntimePublisher: publisher}).processManagedQueueBatchInTx(context.Background(), testCase.tx)
			if testCase.tx.committed || len(publisher.events) != 0 || (!testCase.tx.locked && testCase.tx.batchQueryCalled) {
				t.Fatalf("non-committed/busy batch produced effects: %#v events=%d", testCase.tx, len(publisher.events))
			}
		})
	}
}

func TestQueuePoolBatchRequiresValidProgressAndTenantScopedInvalidations(t *testing.T) {
	for _, raw := range []string{`null`, `{}`, `{"processed":1.5}`, `{"processed":0,"failed":-1}`, `{"processed":0,"changed":[{"leadId":"22222222-2222-4222-8222-222222222222"}]}`} {
		if _, err := decodeManagedQueueBatchOutcome([]byte(raw)); err == nil {
			t.Fatalf("invalid acknowledgement accepted: %s", raw)
		}
	}
}
