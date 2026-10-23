package leads

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

func managedWorkerQueue(t *testing.T, ctx context.Context, repo Repository) workerHomologationQueue {
	t.Helper()
	q := newHotfixQueue(t, ctx, repo, 3)
	days := make([]map[string]any, 7)
	for day := range days {
		days[day] = map[string]any{"day_of_week": day, "is_active": true, "is_all_day": true, "start_time": nil, "end_time": nil}
	}
	schedule, err := json.Marshal(map[string]any{"version": 1, "timezone": "UTC", "days": days})
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.db.Pool().Exec(ctx, `update public.round_robins set settings=settings||jsonb_build_object('operating_schedule',$2::jsonb) where id=$1;
		select private.queue_runtime_enroll($3,$4,$1,clock_timestamp());
		update private.queue_lead_runtime set due_at=clock_timestamp()-interval '1 second',next_action_at=clock_timestamp()-interval '1 second'
		where organization_id=$3 and lead_id=$4`, q.queue, string(schedule), q.org, q.lead)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = repo.db.Pool().Exec(cleanup, `update private.queue_lead_runtime set next_action_at=null where organization_id=$1`, q.org)
	})
	return q
}

func managedBusinessDigest(t *testing.T, ctx context.Context, repo Repository, q workerHomologationQueue) string {
	t.Helper()
	var digest string
	err := repo.db.Pool().QueryRow(ctx, `select jsonb_build_object('owner',l.assigned_user_id,'assignedAt',l.assigned_at,
		'due',r.due_at,'episode',r.episode_id,'round',r.round_number,'budget',r.assignment_count,
		'visits',(select count(*) from private.queue_round_visits where organization_id=$1 and lead_id=$2),
		'logs',(select count(*) from public.round_robin_logs where organization_id=$1 and lead_id=$2),
		'notifications',(select count(*) from public.notifications where organization_id=$1 and lead_id=$2))::text
		from public.leads l join private.queue_lead_runtime r on r.organization_id=l.organization_id and r.lead_id=l.id
		where l.organization_id=$1 and l.id=$2`, q.org, q.lead).Scan(&digest)
	if err != nil {
		t.Fatal(err)
	}
	return digest
}

func TestMainQueuePostgresManagedFailureDoesNotBlockLegacyAndRetryPreservesBudget(t *testing.T) {
	ctx, repo := workerHomologationPostgres(t)
	managed := managedWorkerQueue(t, ctx, repo)
	legacy := newHotfixQueue(t, ctx, repo, 3)
	legacyJob := addHotfixWorkerJob(t, ctx, repo, legacy, -10)
	trigger := hotfixWorkerTrigger(t, ctx, repo, "notifications", fmt.Sprintf(`if new.lead_id='%s'::uuid then raise exception 'synthetic managed notification failure' using errcode='23514'; end if;`, managed.lead))
	before := managedBusinessDigest(t, ctx, repo, managed)
	if err := repo.ProcessLeadRedistribution(ctx); err == nil || !strings.Contains(err.Error(), "queue runtime deferred 1 failed item") {
		t.Fatalf("managed item failure must be reported: %v", err)
	}
	if after := managedBusinessDigest(t, ctx, repo, managed); after != before {
		t.Fatalf("managed failure changed ownership, deadline, visits, budget or outbox: before=%s after=%s", before, after)
	}
	assertHotfixWorkerTransfer(t, ctx, repo, legacy, legacyJob, true)
	var cooling bool
	if err := repo.db.Pool().QueryRow(ctx, `select retry_count=1 and next_action_at>clock_timestamp() and due_at<clock_timestamp() and quarantined_at is null
		from private.queue_lead_runtime where organization_id=$1 and lead_id=$2`, managed.org, managed.lead).Scan(&cooling); err != nil || !cooling {
		t.Fatalf("technical backoff must remain separate from the expired business deadline: cooling=%t err=%v", cooling, err)
	}
	if _, err := repo.db.Pool().Exec(ctx, fmt.Sprintf(`drop trigger %s on public.notifications`, trigger)); err != nil {
		t.Fatal(err)
	}
	// Only the synthetic technical-ready clock is expired. The unchanged
	// business deadline and budget are the inputs to the real next worker call.
	if _, err := repo.db.Pool().Exec(ctx, `update private.queue_lead_runtime set next_action_at=clock_timestamp()-interval '1 second' where organization_id=$1 and lead_id=$2`, managed.org, managed.lead); err != nil {
		t.Fatal(err)
	}
	if err := repo.ProcessLeadRedistribution(ctx); err != nil {
		t.Fatal(err)
	}
	var correct bool
	err := repo.db.Pool().QueryRow(ctx, `select l.assigned_user_id=$3 and r.assignment_count=1 and r.retry_count=0 and r.last_error_code is null
		and (select count(*) from private.queue_round_visits where organization_id=$1 and lead_id=$2)=2
		from public.leads l join private.queue_lead_runtime r on r.organization_id=l.organization_id and r.lead_id=l.id
		where l.organization_id=$1 and l.id=$2`, managed.org, managed.lead, managed.users[1]).Scan(&correct)
	if err != nil || !correct {
		t.Fatalf("managed retry did not make exactly one durable transfer: correct=%t err=%v", correct, err)
	}
	assertHotfixWorkerTransfer(t, ctx, repo, legacy, legacyJob, true)
}

func TestMainQueuePostgresManagedAndLegacyReplicasDoNotDuplicateAssignments(t *testing.T) {
	ctx, repo := workerHomologationPostgres(t)
	managed := managedWorkerQueue(t, ctx, repo)
	legacy := newHotfixQueue(t, ctx, repo, 3)
	job := addHotfixWorkerJob(t, ctx, repo, legacy, -10)
	start := make(chan struct{})
	results := make(chan error, 2)
	var workers sync.WaitGroup
	for n := 0; n < 2; n++ {
		workers.Add(1)
		go func() { defer workers.Done(); <-start; results <- repo.ProcessLeadRedistribution(ctx) }()
	}
	close(start)
	workers.Wait()
	close(results)
	for err := range results {
		if err != nil {
			t.Fatal(err)
		}
	}
	assertHotfixWorkerTransfer(t, ctx, repo, legacy, job, true)
	var count, logs, notices int
	var owner string
	err := repo.db.Pool().QueryRow(ctx, `select r.assignment_count,l.assigned_user_id::text,
		(select count(*) from public.round_robin_logs where organization_id=$1 and lead_id=$2),
		(select count(*) from public.notifications where organization_id=$1 and lead_id=$2)
		from private.queue_lead_runtime r join public.leads l on l.organization_id=r.organization_id and l.id=r.lead_id
		where r.organization_id=$1 and r.lead_id=$2`, managed.org, managed.lead).Scan(&count, &owner, &logs, &notices)
	if err != nil || count != 1 || owner != managed.users[1] || logs != 1 || notices != 2 {
		t.Fatalf("managed replicas duplicated or lost an assignment: count=%d owner=%s logs=%d notices=%d err=%v", count, owner, logs, notices, err)
	}
}

func TestMainQueuePostgresManagedModestBacklogDrainsAcrossBatchBoundary(t *testing.T) {
	ctx, repo := workerHomologationPostgres(t)
	q := managedWorkerQueue(t, ctx, repo)
	const leads = 64
	_, err := repo.db.Pool().Exec(ctx, `insert into public.leads(id,organization_id,origin_round_robin_id,pipeline_id,stage_id,assigned_user_id,assigned_at)
		select gen_random_uuid(),$1,$2,$3,$4,$5,clock_timestamp() from generate_series(1,$6::integer);
		select private.queue_runtime_enroll(organization_id,id,$2,clock_timestamp()) from public.leads where organization_id=$1 and id<>$7;
		update private.queue_lead_runtime set due_at=clock_timestamp()-interval '1 second',next_action_at=clock_timestamp()-interval '1 second'
		where organization_id=$1`, q.org, q.queue, q.pipeline, q.stage, q.users[0], leads-1, q.lead)
	if err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	if err := repo.ProcessLeadRedistribution(ctx); err != nil {
		t.Fatal(err)
	}
	elapsed := time.Since(started)
	var assigned, visits, logs, notices, retries int
	err = repo.db.Pool().QueryRow(ctx, `select
		(select count(*) from private.queue_lead_runtime where organization_id=$1 and assignment_count=1 and state='auto_assigned'),
		(select count(*) from private.queue_round_visits where organization_id=$1),
		(select count(*) from public.round_robin_logs where organization_id=$1),
		(select count(*) from public.notifications where organization_id=$1),
		(select coalesce(sum(retry_count),0) from private.queue_lead_runtime where organization_id=$1)`, q.org).Scan(&assigned, &visits, &logs, &notices, &retries)
	if err != nil || assigned != leads || visits != 2*leads || logs != leads || notices != 2*leads || retries != 0 {
		t.Fatalf("bounded backlog lost or duplicated effects: assigned=%d visits=%d logs=%d notices=%d retries=%d err=%v", assigned, visits, logs, notices, retries, err)
	}
	t.Logf("local PostgreSQL 64-lead synthetic backlog drained in %s, through batches of at most %d; this is not a production SLA or a 5k-user capacity test", elapsed, leadRedistributionBatchLimit)
}
