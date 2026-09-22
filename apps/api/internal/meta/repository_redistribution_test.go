package meta

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

type metaRedistributionExecCall struct {
	sql  string
	args []any
}

type metaRedistributionExecutorStub struct {
	calls []metaRedistributionExecCall
	err   error
}

func (stub *metaRedistributionExecutorStub) Exec(_ context.Context, sql string, arguments ...any) (pgconn.CommandTag, error) {
	stub.calls = append(stub.calls, metaRedistributionExecCall{sql: sql, args: append([]any(nil), arguments...)})
	return pgconn.NewCommandTag("INSERT 0 1"), stub.err
}

func TestMetaNoAvailableMembersEnqueuesDurableInitialDistribution(t *testing.T) {
	t.Parallel()

	queueID := "11111111-1111-4111-8111-111111111111"
	executor := &metaRedistributionExecutorStub{}
	err := (Repository{}).insertLeadRedistributionJob(
		context.Background(),
		executor,
		"22222222-2222-4222-8222-222222222222",
		"33333333-3333-4333-8333-333333333333",
		resolvedDestination{RoundRobinID: &queueID},
		leadgenChange{LeadgenID: "leadgen-1", FormID: "form-1", PageID: "page-1"},
		"no_available_members",
	)
	if err != nil {
		t.Fatalf("enqueue Meta initial distribution: %v", err)
	}
	if len(executor.calls) != 1 {
		t.Fatalf("exec calls = %d, want 1 durable job", len(executor.calls))
	}

	call := executor.calls[0]
	normalizedSQL := strings.Join(strings.Fields(call.sql), " ")
	for _, fragment := range []string{
		"insert into public.lead_redistribution_jobs",
		"original_assigned_user_id, current_assigned_user_id",
		"null, null",
		"now(), now(), null",
		"on conflict do nothing",
	} {
		if !strings.Contains(normalizedSQL, fragment) {
			t.Fatalf("initial distribution SQL is missing %q: %s", fragment, normalizedSQL)
		}
	}
	if len(call.args) != 7 {
		t.Fatalf("initial distribution args = %#v, want 7", call.args)
	}
	if call.args[2] != queueID || call.args[3] != 10 || call.args[4] != 20 || call.args[5] != 5 {
		t.Fatalf("initial distribution queue/settings args = %#v", call.args)
	}

	var metadata map[string]any
	if err := json.Unmarshal([]byte(call.args[6].(string)), &metadata); err != nil {
		t.Fatalf("decode initial distribution metadata: %v", err)
	}
	if metadata["source"] != "meta_lead_ads" || metadata["initial_distribution_pending"] != true || metadata["allow_assigned_redistribution"] != false {
		t.Fatalf("initial distribution metadata = %#v", metadata)
	}
	if metadata["leadgen_id"] != "leadgen-1" || metadata["form_id"] != "form-1" || metadata["page_id"] != "page-1" {
		t.Fatalf("provider identity metadata = %#v", metadata)
	}
}

func TestMetaUnassignedNonAvailabilityOutcomeDoesNotEnqueueRetry(t *testing.T) {
	t.Parallel()

	queueID := "11111111-1111-4111-8111-111111111111"
	executor := &metaRedistributionExecutorStub{}
	err := (Repository{}).insertLeadRedistributionJob(
		context.Background(),
		executor,
		"22222222-2222-4222-8222-222222222222",
		"33333333-3333-4333-8333-333333333333",
		resolvedDestination{RoundRobinID: &queueID},
		leadgenChange{},
		"no_matching_queue",
	)
	if err != nil {
		t.Fatalf("skip unrelated outcome: %v", err)
	}
	if len(executor.calls) != 0 {
		t.Fatalf("unrelated unassigned outcome created a retry: %#v", executor.calls)
	}
}

func TestMetaAssignedLeadKeepsPostAssignmentRedistributionEnrollment(t *testing.T) {
	t.Parallel()

	queueID := "11111111-1111-4111-8111-111111111111"
	assigneeID := "22222222-2222-4222-8222-222222222222"
	executor := &metaRedistributionExecutorStub{}
	err := (Repository{}).insertLeadRedistributionJob(
		context.Background(),
		executor,
		"33333333-3333-4333-8333-333333333333",
		"44444444-4444-4444-8444-444444444444",
		resolvedDestination{
			RoundRobinID:   &queueID,
			AssignedUserID: &assigneeID,
			RedistributionSettings: map[string]any{
				"enable_redistribution":          true,
				"redistribution_timeout_minutes": 30,
				"redistribution_warning_minutes": 5,
				"redistribution_max_attempts":    2,
			},
		},
		leadgenChange{LeadgenID: "leadgen-1"},
		"assigned",
	)
	if err != nil {
		t.Fatalf("enroll assigned Meta lead: %v", err)
	}
	if len(executor.calls) != 1 {
		t.Fatalf("exec calls = %d, want assigned redistribution job", len(executor.calls))
	}
	call := executor.calls[0]
	if len(call.args) != 8 || call.args[3] != assigneeID || call.args[4] != 2 || call.args[5] != 30 || call.args[6] != 5 {
		t.Fatalf("assigned redistribution args = %#v", call.args)
	}
	if !strings.Contains(strings.Join(strings.Fields(call.sql), " "), "$4::uuid, $4::uuid") {
		t.Fatalf("assigned redistribution must retain original/current assignee: %s", call.sql)
	}
}

func TestMetaRedistributionInsertPropagatesDatabaseFailure(t *testing.T) {
	t.Parallel()

	wantErr := errors.New("insert failed")
	queueID := "11111111-1111-4111-8111-111111111111"
	executor := &metaRedistributionExecutorStub{err: wantErr}
	err := (Repository{}).insertLeadRedistributionJob(
		context.Background(),
		executor,
		"22222222-2222-4222-8222-222222222222",
		"33333333-3333-4333-8333-333333333333",
		resolvedDestination{RoundRobinID: &queueID},
		leadgenChange{},
		"no_available_members",
	)
	if !errors.Is(err, wantErr) {
		t.Fatalf("error = %v, want %v", err, wantErr)
	}
}
