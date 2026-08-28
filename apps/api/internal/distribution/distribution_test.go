package distribution

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

type queryCall struct {
	sql  string
	args []any
}

type stubQueryer struct {
	call    queryCall
	payload []byte
	err     error
}

func (stub *stubQueryer) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	stub.call = queryCall{sql: sql, args: args}
	return stubRow{payload: stub.payload, err: stub.err}
}

type stubRow struct {
	payload []byte
	err     error
}

func (row stubRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	target, ok := dest[0].(*[]byte)
	if !ok {
		return errors.New("unexpected scan target")
	}
	*target = append((*target)[:0], row.payload...)
	return nil
}

func TestDistributeUsesCanonicalFunctionWithAllArguments(t *testing.T) {
	t.Parallel()

	queueID := "d7000000-0000-4000-8000-000000000001"
	source := "site"
	occurredAt := time.Date(2026, time.July, 28, 18, 0, 0, 0, time.UTC)
	stub := &stubQueryer{payload: []byte(`{
		"success": true,
		"reason": "assigned",
		"lead_id": "d9000000-0000-4000-8000-000000000001",
		"assigned_user_id": "d2000000-0000-4000-8000-000000000001",
		"round_robin_id": "d7000000-0000-4000-8000-000000000001",
		"distribution_event_id": "de000000-0000-4000-8000-000000000001"
	}`)}

	result, err := Distribute(context.Background(), stub, Request{
		OrganizationID:   "d1000000-0000-4000-8000-000000000001",
		LeadID:           "d9000000-0000-4000-8000-000000000001",
		IdempotencyKey:   "site:submission-1",
		RoundRobinID:     &queueID,
		PreserveAssignee: true,
		Source:           &source,
		OccurredAt:       occurredAt,
	})
	if err != nil {
		t.Fatalf("Distribute() error = %v", err)
	}
	if !result.Success || result.Reason != "assigned" || result.AssignedUserID == nil {
		t.Fatalf("unexpected result: %#v", result)
	}
	if !strings.Contains(stub.call.sql, "private.distribute_lead(") {
		t.Fatalf("query does not use canonical function: %s", stub.call.sql)
	}
	if len(stub.call.args) != 7 {
		t.Fatalf("argument count = %d, want 7", len(stub.call.args))
	}
	if stub.call.args[2] != "site:submission-1" ||
		stub.call.args[3] != queueID ||
		stub.call.args[4] != true ||
		stub.call.args[5] != source ||
		stub.call.args[6] != occurredAt {
		t.Fatalf("unexpected arguments: %#v", stub.call.args)
	}
}

func TestDistributeSupportsPoolStyleCallWithoutOptionalValues(t *testing.T) {
	t.Parallel()

	stub := &stubQueryer{payload: []byte(`{
		"success": false,
		"reason": "no_matching_queue",
		"lead_id": "d9000000-0000-4000-8000-000000000002"
	}`)}
	startedAt := time.Now().UTC()
	result, err := Distribute(context.Background(), stub, Request{
		OrganizationID:   "d1000000-0000-4000-8000-000000000001",
		LeadID:           "d9000000-0000-4000-8000-000000000002",
		IdempotencyKey:   "webhook:event-2",
		PreserveAssignee: true,
	})
	if err != nil {
		t.Fatalf("Distribute() error = %v", err)
	}
	if result.Reason != "no_matching_queue" {
		t.Fatalf("reason = %q", result.Reason)
	}
	if stub.call.args[3] != nil || stub.call.args[5] != nil {
		t.Fatalf("optional values were not passed as NULL: %#v", stub.call.args)
	}
	callTime, ok := stub.call.args[6].(time.Time)
	if !ok || callTime.Before(startedAt) || callTime.Location() != time.UTC {
		t.Fatalf("generated occurrence time = %#v", stub.call.args[6])
	}
}

func TestDistributeRejectsInvalidRequest(t *testing.T) {
	t.Parallel()

	_, err := Distribute(context.Background(), &stubQueryer{}, Request{})
	if !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("error = %v, want ErrInvalidRequest", err)
	}
}

func TestDistributePropagatesDatabaseAndDecodeErrors(t *testing.T) {
	t.Parallel()

	request := Request{
		OrganizationID: "d1000000-0000-4000-8000-000000000001",
		LeadID:         "d9000000-0000-4000-8000-000000000001",
		IdempotencyKey: "meta:leadgen-1",
	}
	databaseError := errors.New("database unavailable")
	if _, err := Distribute(context.Background(), &stubQueryer{err: databaseError}, request); !errors.Is(err, databaseError) {
		t.Fatalf("database error = %v", err)
	}
	if _, err := Distribute(context.Background(), &stubQueryer{payload: []byte(`not-json`)}, request); err == nil {
		t.Fatal("expected JSON decoding error")
	}
	if _, err := Distribute(
		context.Background(),
		&stubQueryer{payload: []byte(`{"success":false,"reason":"lead_not_found"}`)},
		request,
	); !errors.Is(err, ErrRejected) {
		t.Fatalf("rejected result error = %v, want ErrRejected", err)
	}
	if _, err := Distribute(
		context.Background(),
		&stubQueryer{payload: []byte(`{"success":false,"reason":"unexpected"}`)},
		request,
	); !errors.Is(err, ErrInvalidResult) {
		t.Fatalf("unknown result error = %v, want ErrInvalidResult", err)
	}
}

func TestStableKeyIsDeterministicBoundedAndPartSafe(t *testing.T) {
	t.Parallel()

	longProviderID := strings.Repeat("provider-controlled-id:", 1000)
	first := StableKey("whatsapp-native", "session-1", longProviderID)
	second := StableKey("whatsapp-native", "session-1", longProviderID)
	ambiguousA := StableKey("whatsapp-native", "a:b", "c")
	ambiguousB := StableKey("whatsapp-native", "a", "b:c")

	if first != second {
		t.Fatalf("StableKey() is not deterministic: %q != %q", first, second)
	}
	if len(first) > 200 {
		t.Fatalf("StableKey() length = %d, want <= 200", len(first))
	}
	if ambiguousA == ambiguousB {
		t.Fatalf("StableKey() conflated distinct part boundaries: %q", ambiguousA)
	}
}
