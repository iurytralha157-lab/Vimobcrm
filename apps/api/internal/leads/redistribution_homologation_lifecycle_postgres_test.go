package leads

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"testing"
	"time"
)

func waitWorkerPostgres(t *testing.T, ctx context.Context, repo Repository, budget time.Duration, query string, args ...any) {
	t.Helper()
	deadline := time.Now().Add(budget)
	for time.Now().Before(deadline) {
		var ready bool
		if err := repo.db.Pool().QueryRow(ctx, query, args...).Scan(&ready); err != nil {
			t.Fatal(err)
		}
		if ready {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("required PostgreSQL lifecycle state was not observed")
}

func TestMainQueuePostgresWorkerStopDuringTransferRollsBackAndReleasesLocks(t *testing.T) {
	ctx, repo := workerHomologationPostgres(t)
	q := newHotfixQueue(t, ctx, repo, 3)
	jobID := addHotfixWorkerJob(t, ctx, repo, q, -10)
	const barrier = int64(87642032)
	blocker, err := repo.db.Pool().Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer blocker.Release()
	if _, err := blocker.Exec(ctx, `select pg_advisory_lock($1)`, barrier); err != nil {
		t.Fatal(err)
	}
	defer blocker.Exec(context.Background(), `select pg_advisory_unlock($1)`, barrier)
	hotfixWorkerTrigger(t, ctx, repo, "round_robin_logs", fmt.Sprintf(`if new.lead_id='%s'::uuid and new.reason='auto_redistribution' then perform pg_advisory_xact_lock(%d); end if;`, q.lead, barrier))
	before := fairnessBusinessDigest(t, ctx, repo, q.org)
	workerCtx, stop := context.WithCancel(ctx)
	defer stop()
	repo.StartRedistributionWorker(workerCtx, slog.New(slog.NewTextHandler(io.Discard, nil)))
	// Observe an actual database wait in the production worker, after its
	// ordinary five-second startup delay. A timer alone is insufficient proof.
	waitWorkerPostgres(t, ctx, repo, 10*time.Second, `select exists(select 1 from pg_stat_activity where datname=current_database()
		and pid<>pg_backend_pid() and wait_event='advisory' and query like '%insert into public.round_robin_logs%')`)
	stoppedAt := time.Now()
	stop()
	waitWorkerPostgres(t, ctx, repo, 5*time.Second, `select not exists(select 1 from pg_stat_activity where datname=current_database()
		and application_name='vimob-main-queue-worker-go' and pid<>pg_backend_pid() and state in ('active','idle in transaction'))`)
	if elapsed := time.Since(stoppedAt); elapsed > 5*time.Second {
		t.Fatalf("worker cleanup exceeded its bounded shutdown window: %s", elapsed)
	}
	if after := fairnessBusinessDigest(t, ctx, repo, q.org); after != before {
		t.Fatal("shutdown consumed a business attempt or changed the job deadline")
	}
	assertHotfixWorkerTransfer(t, ctx, repo, q, jobID, false)
	probe, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackRedistributionTransaction(ctx, probe)
	var unlocked bool
	if err := probe.QueryRow(ctx, `select pg_try_advisory_xact_lock($1::integer,hashtext($2::text))`, leadRedistributionLockKey, jobID).Scan(&unlocked); err != nil || !unlocked {
		t.Fatalf("worker job advisory lock survived cancellation: unlocked=%t err=%v", unlocked, err)
	}
	t.Logf("real worker shutdown cleanup observed after %s", time.Since(stoppedAt))
}

func TestMainQueuePostgresManagedCancellationRollsBackBatchAndReleasesItsLock(t *testing.T) {
	ctx, repo := workerHomologationPostgres(t)
	q := managedWorkerQueue(t, ctx, repo)
	const barrier = int64(87642033)
	blocker, err := repo.db.Pool().Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer blocker.Release()
	if _, err := blocker.Exec(ctx, `select pg_advisory_lock($1)`, barrier); err != nil {
		t.Fatal(err)
	}
	defer blocker.Exec(context.Background(), `select pg_advisory_unlock($1)`, barrier)
	hotfixWorkerTrigger(t, ctx, repo, "notifications", fmt.Sprintf(`if new.lead_id='%s'::uuid then perform pg_advisory_xact_lock(%d); end if;`, q.lead, barrier))
	before := managedBusinessDigest(t, ctx, repo, q)
	workerCtx, stop := context.WithCancel(ctx)
	result := make(chan error, 1)
	go func() { _, err := repo.processManagedQueueBatch(workerCtx); result <- err }()
	waitWorkerPostgres(t, ctx, repo, 5*time.Second, `select exists(select 1 from pg_stat_activity where datname=current_database()
		and pid<>pg_backend_pid() and wait_event='advisory' and query like '%private.process_queue_runtime_batch%')`)
	stop()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("managed batch cancellation must propagate: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("managed batch did not stop within its cleanup bound")
	}
	if after := managedBusinessDigest(t, ctx, repo, q); after != before {
		t.Fatal("cancelled managed batch changed ownership, deadline, visits, budget or outbox")
	}
	// A cancelled pgx connection can close before the server has finished its
	// cancel/EOF cleanup. Require the actual advisory lock to disappear within
	// the same bounded shutdown window before opening a competing transaction.
	waitWorkerPostgres(t, ctx, repo, 5*time.Second, `select not exists(select 1 from pg_locks where locktype='advisory'
		and database=(select oid from pg_database where datname=current_database())
		and objsubid=1 and classid=((hashtextextended('lead_queue_runtime_worker',0)>>32)&4294967295)::oid
		and objid=(hashtextextended('lead_queue_runtime_worker',0)&4294967295)::oid)`)
	probe, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackRedistributionTransaction(ctx, probe)
	var unlocked bool
	if err := probe.QueryRow(ctx, `select pg_try_advisory_xact_lock(hashtextextended('lead_queue_runtime_worker',0))`).Scan(&unlocked); err != nil || !unlocked {
		t.Fatalf("managed batch advisory lock survived cancellation: unlocked=%t err=%v", unlocked, err)
	}
}

func TestMainQueuePostgresWorkerCommitsBeforeManualLeadWaitCanFormDeadlock(t *testing.T) {
	ctx, repo := workerHomologationPostgres(t)
	first := newHotfixQueue(t, ctx, repo, 3)
	second := addHotfixWorkerLead(t, ctx, repo, first)
	other := newHotfixQueue(t, ctx, repo, 3)
	firstJob := addHotfixWorkerJob(t, ctx, repo, first, -30)
	secondJob := addHotfixWorkerJob(t, ctx, repo, second, -20)
	otherJob := addHotfixWorkerJob(t, ctx, repo, other, -10)
	const barrier = int64(87642034)
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
	go func() { workerResult <- repo.processLegacyLeadRedistribution(ctx) }()
	waitWorkerPostgres(t, ctx, repo, 5*time.Second, `select exists(select 1 from pg_stat_activity where datname=current_database()
		and wait_event='advisory' and query like '%insert into public.activities%')`)
	manualResult := make(chan error, 1)
	go func() {
		result, err := repo.RedistributeRoundRobin(ctx, hotfixAdmin(second), second.lead, false)
		if err == nil && !result.Success {
			err = fmt.Errorf("manual redistribution rejected: %s", result.Error)
		}
		manualResult <- err
	}()
	// Actual manual Go code owns lead B and waits for the queue held by A.
	// A single batch transaction used to retain A while reaching for B.
	waitWorkerPostgres(t, ctx, repo, 5*time.Second, `select exists(select 1 from pg_stat_activity where datname=current_database()
		and wait_event_type='Lock' and query like '%update public.round_robins%')`)
	if _, err := blocker.Exec(ctx, `select pg_advisory_unlock($1)`, barrier); err != nil {
		t.Fatal(err)
	}
	if err := <-workerResult; err != nil {
		t.Fatalf("worker failed during real manual lock overlap: %v", err)
	}
	if err := <-manualResult; err != nil {
		t.Fatalf("manual redistribution failed during real worker overlap: %v", err)
	}
	assertHotfixWorkerTransfer(t, ctx, repo, first, firstJob, true)
	assertHotfixWorkerTransfer(t, ctx, repo, other, otherJob, true)
	var status, reason string
	if err := repo.db.Pool().QueryRow(ctx, `select status,coalesce(stopped_reason,'') from public.lead_redistribution_jobs where id=$1`, secondJob).Scan(&status, &reason); err != nil {
		t.Fatal(err)
	}
	// B can be skipped while manual work still owns it. The next tick must
	// observe that manual owner, without reusing the stale discovery snapshot.
	if status == "pending" {
		if err := repo.processLegacyLeadRedistribution(ctx); err != nil {
			t.Fatal(err)
		}
		if err := repo.db.Pool().QueryRow(ctx, `select status,coalesce(stopped_reason,'') from public.lead_redistribution_jobs where id=$1`, secondJob).Scan(&status, &reason); err != nil {
			t.Fatal(err)
		}
	}
	if status != "stopped" || reason != "assignee_changed" {
		t.Fatalf("worker reused a stale owner after manual transfer: status=%s reason=%s", status, reason)
	}
}
