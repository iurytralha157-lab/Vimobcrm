package leads

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"
)

func addHotfixWorkerLead(t *testing.T, ctx context.Context, repo Repository, q hotfixQueue) hotfixQueue {
	t.Helper()
	q.lead = hotfixUUID(t)
	_, err := repo.db.Pool().Exec(ctx, `insert into public.leads(id,organization_id,origin_round_robin_id,pipeline_id,stage_id,assigned_user_id,assigned_at)
		values($1,$2,$3,$4,$5,$6,now()-interval '1 day')`, q.lead, q.org, q.queue, q.pipeline, q.stage, q.users[0])
	if err != nil {
		t.Fatal(err)
	}
	return q
}

func addHotfixWorkerJob(t *testing.T, ctx context.Context, repo Repository, q hotfixQueue, dueOffset int) string {
	t.Helper()
	id := hotfixUUID(t)
	_, err := repo.db.Pool().Exec(ctx, `insert into public.lead_redistribution_jobs
		(id,organization_id,lead_id,round_robin_id,current_assigned_user_id,status,attempt_count,max_attempts,timeout_minutes,warning_minutes,enrolled_at,due_at,metadata)
		values($1,$2,$3,$4,$5,'pending',0,4,10,2,now()-interval '1 day',now()+($6::integer*interval '1 second'),'{}')`, id, q.org, q.lead, q.queue, q.users[0], dueOffset)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = repo.db.Pool().Exec(cleanupCtx, `delete from public.lead_redistribution_jobs where organization_id=$1 and id=$2`, q.org, id)
	})
	return id
}

func assertHotfixWorkerTransfer(t *testing.T, ctx context.Context, repo Repository, q hotfixQueue, jobID string, transferred bool) {
	t.Helper()
	var owner, jobOwner string
	var attempts, count, logs, notices, activities int
	err := repo.db.Pool().QueryRow(ctx, `select l.assigned_user_id::text,j.current_assigned_user_id::text,j.attempt_count,l.redistribution_count,
		(select count(*) from public.round_robin_logs where lead_id=l.id and reason='auto_redistribution'),
		(select count(*) from public.notifications where lead_id=l.id),
		(select count(*) from public.activities where lead_id=l.id and type='lead_auto_redistributed')
		from public.leads l join public.lead_redistribution_jobs j on j.lead_id=l.id and j.organization_id=l.organization_id
		where l.id=$1 and j.id=$2`, q.lead, jobID).Scan(&owner, &jobOwner, &attempts, &count, &logs, &notices, &activities)
	if err != nil {
		t.Fatal(err)
	}
	want, n := q.users[0], 0
	if transferred {
		want, n = q.users[1], 1
	}
	if owner != want || jobOwner != want || attempts != n || count != n || logs != n || notices != 2*n || activities != n {
		t.Fatalf("owner=%s jobOwner=%s attempts=%d count=%d logs=%d notices=%d activities=%d; expected transfer=%t", owner, jobOwner, attempts, count, logs, notices, activities, transferred)
	}
}

func hotfixWorkerTrigger(t *testing.T, ctx context.Context, repo Repository, table, body string) string {
	t.Helper()
	name := "hotfix_worker_" + strings.ReplaceAll(hotfixUUID(t), "-", "")
	_, err := repo.db.Pool().Exec(ctx, fmt.Sprintf(`create function private.%s() returns trigger language plpgsql as $function$ begin %s return new; end $function$;
		create trigger %s before insert on public.%s for each row execute function private.%s()`, name, body, name, table, name))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = repo.db.Pool().Exec(cleanupCtx, fmt.Sprintf(`drop trigger if exists %s on public.%s; drop function if exists private.%s()`, name, table, name))
	})
	return name
}

func waitHotfixPostgres(t *testing.T, ctx context.Context, repo Repository, query string, args ...any) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		var ready bool
		if err := repo.db.Pool().QueryRow(ctx, query, args...).Scan(&ready); err != nil {
			t.Fatal(err)
		}
		if ready {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("PostgreSQL did not reach the required lock state")
}

func TestHotfixPostgresWorkerCommitsBeforeWaitingForNextLead(t *testing.T) {
	ctx, repo := hotfixPostgres(t)
	first := newHotfixQueue(t, ctx, repo, 3)
	second := addHotfixWorkerLead(t, ctx, repo, first)
	other := newHotfixQueue(t, ctx, repo, 3)
	firstJob := addHotfixWorkerJob(t, ctx, repo, first, -30)
	secondJob := addHotfixWorkerJob(t, ctx, repo, second, -20)
	otherJob := addHotfixWorkerJob(t, ctx, repo, other, -10)
	const barrier = int64(81726391)
	blocker, err := repo.db.Pool().Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer blocker.Release()
	if _, err := blocker.Exec(ctx, `select pg_advisory_lock($1)`, barrier); err != nil {
		t.Fatal(err)
	}
	defer blocker.Exec(context.Background(), `select pg_advisory_unlock($1)`, barrier)
	hotfixWorkerTrigger(t, ctx, repo, "activities", fmt.Sprintf(`if new.lead_id='%s'::uuid and new.type='lead_auto_redistributed' then perform pg_advisory_xact_lock(%d); end if;`, first.lead, barrier))
	workerResult := make(chan error, 1)
	go func() { workerResult <- repo.ProcessLeadRedistribution(ctx) }()
	waitHotfixPostgres(t, ctx, repo, `select exists(select 1 from pg_stat_activity where wait_event='advisory' and query like '%%insert into public.activities%%' and query like '%%' || $1::text || '%%')`, first.lead)
	manualResult := make(chan error, 1)
	go func() {
		result, err := repo.RedistributeRoundRobin(ctx, hotfixAdmin(second), second.lead, false)
		if err == nil && !result.Success {
			err = fmt.Errorf("manual redistribution rejected: %s", result.Error)
		}
		manualResult <- err
	}()
	// The real manual API method owns lead B and waits for queue Q, while the
	// worker owns Q for A. Old batch transactions then tried to lock B too.
	waitHotfixPostgres(t, ctx, repo, `select exists(select 1 from pg_stat_activity where wait_event_type='Lock' and query like '%%update public.round_robins%%' and query like '%%' || $1::text || '%%')`, first.queue)
	if _, err := blocker.Exec(ctx, `select pg_advisory_unlock($1)`, barrier); err != nil {
		t.Fatal(err)
	}
	if err := <-workerResult; err != nil {
		t.Fatalf("full worker failed: %v", err)
	}
	if err := <-manualResult; err != nil {
		t.Fatalf("real manual redistribution failed: %v", err)
	}
	assertHotfixWorkerTransfer(t, ctx, repo, first, firstJob, true)
	assertHotfixWorkerTransfer(t, ctx, repo, other, otherJob, true)
	var status, reason string
	err = repo.db.Pool().QueryRow(ctx, `select status,stopped_reason from public.lead_redistribution_jobs where id=$1`, secondJob).Scan(&status, &reason)
	if err != nil || status != "stopped" || reason != "assignee_changed" {
		t.Fatalf("manual owner must survive worker revalidation: status=%s reason=%s err=%v", status, reason, err)
	}
}

func TestHotfixPostgresWorkerFailureRollsBackOnlyItsJob(t *testing.T) {
	ctx, repo := hotfixPostgres(t)
	first := newHotfixQueue(t, ctx, repo, 3)
	failed := addHotfixWorkerLead(t, ctx, repo, first)
	other := newHotfixQueue(t, ctx, repo, 3)
	firstJob := addHotfixWorkerJob(t, ctx, repo, first, -30)
	failedJob := addHotfixWorkerJob(t, ctx, repo, failed, -20)
	otherJob := addHotfixWorkerJob(t, ctx, repo, other, -10)
	hotfixWorkerTrigger(t, ctx, repo, "round_robin_logs", fmt.Sprintf(`if new.lead_id='%s'::uuid and new.reason='auto_redistribution' then raise exception 'synthetic second-job failure' using errcode='23514'; end if;`, failed.lead))
	if err := repo.ProcessLeadRedistribution(ctx); err == nil || !strings.Contains(err.Error(), "synthetic second-job failure") {
		t.Fatalf("worker must report isolated failure: %v", err)
	}
	assertHotfixWorkerTransfer(t, ctx, repo, first, firstJob, true)
	assertHotfixWorkerTransfer(t, ctx, repo, failed, failedJob, false)
	assertHotfixWorkerTransfer(t, ctx, repo, other, otherJob, true)
}
