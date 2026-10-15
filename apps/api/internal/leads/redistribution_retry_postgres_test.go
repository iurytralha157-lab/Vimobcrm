package leads

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestHotfixPostgresRetryCASDoesNotDelayReplacementJob(t *testing.T) {
	ctx, repo := hotfixPostgres(t)
	q := newHotfixQueue(t, ctx, repo, 3)
	id := addHotfixWorkerJob(t, ctx, repo, q, -10)
	job, err := repo.reloadRedistributionJob(ctx, repo.db.Pool(), redistributionJob{ID: id, OrganizationID: q.org, LeadID: q.lead})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.db.Pool().Exec(ctx, `update public.lead_redistribution_jobs set timeout_minutes=11,metadata='{"replacement":true}' where id=$1`, id); err != nil {
		t.Fatal(err)
	}
	if err := repo.deferFailedRedistributionJob(ctx, job, job.RowVersion, false); err != nil {
		t.Fatal(err)
	}
	var delayed bool
	if err := repo.db.Pool().QueryRow(ctx, `select redistribution_retry_at is not null or warning_retry_at is not null from public.lead_redistribution_jobs where id=$1`, id).Scan(&delayed); err != nil || delayed {
		t.Fatalf("stale CAS delayed replacement job: delayed=%t err=%v", delayed, err)
	}
	if err := repo.ProcessLeadRedistribution(ctx); err != nil {
		t.Fatal(err)
	}
	assertHotfixWorkerTransfer(t, ctx, repo, q, id, true)
}

func TestHotfixPostgresRetryCannotOverwriteBusyExecutor(t *testing.T) {
	ctx, repo := hotfixPostgres(t)
	q := newHotfixQueue(t, ctx, repo, 3)
	id := addHotfixWorkerJob(t, ctx, repo, q, -10)
	job, err := repo.reloadRedistributionJob(ctx, repo.db.Pool(), redistributionJob{ID: id, OrganizationID: q.org, LeadID: q.lead})
	if err != nil {
		t.Fatal(err)
	}
	owner, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer owner.Rollback(ctx)
	if _, err := owner.Exec(ctx, `select pg_advisory_xact_lock($1::integer,hashtext($2::text))`, leadRedistributionLockKey, id); err != nil {
		t.Fatal(err)
	}
	if err := repo.deferFailedRedistributionJob(ctx, job, job.RowVersion, false); err == nil || !strings.Contains(err.Error(), "another executor owns") {
		t.Fatalf("busy retry persistence must be explicit: %v", err)
	}
	var clear bool
	if err := repo.db.Pool().QueryRow(ctx, `select redistribution_retry_at is null from public.lead_redistribution_jobs where id=$1`, id).Scan(&clear); err != nil || !clear {
		t.Fatalf("busy job was delayed without ownership: clear=%t err=%v", clear, err)
	}
}

func TestHotfixPostgresBusinessReactivationClearsOldTechnicalClocks(t *testing.T) {
	ctx, repo := hotfixPostgres(t)
	q := newHotfixQueue(t, ctx, repo, 3)
	id := addHotfixWorkerJob(t, ctx, repo, q, -10)
	reset := func() {
		t.Helper()
		if _, err := repo.db.Pool().Exec(ctx, `update public.lead_redistribution_jobs set status='pending',warning_retry_at=now()+interval '1 minute',redistribution_retry_at=now()+interval '1 minute' where id=$1`, id); err != nil {
			t.Fatal(err)
		}
	}
	assertClear := func() {
		t.Helper()
		var clear bool
		if err := repo.db.Pool().QueryRow(ctx, `select warning_retry_at is null and redistribution_retry_at is null from public.lead_redistribution_jobs where id=$1`, id).Scan(&clear); err != nil || !clear {
			t.Fatalf("business reactivation retained prior failure cooldown: clear=%t err=%v", clear, err)
		}
	}
	reset()
	if ok, err := repo.accelerateRedistributionJob(ctx, repo.db.Pool(), q.org, q.lead, id); err != nil || !ok {
		t.Fatalf("accelerate: %t %v", ok, err)
	}
	assertClear()
	reset()
	if err := repo.deferRedistributionJobUntilAvailability(ctx, repo.db.Pool(), id, time.Now().UTC().Add(time.Hour), 10, 2); err != nil {
		t.Fatal(err)
	}
	assertClear()
	reset()
	if err := repo.reopenManagedWhatsAppInitialDistribution(ctx, repo.db.Pool(), id, time.Now().UTC(), 1, []byte(`{"success":false}`)); err != nil {
		t.Fatal(err)
	}
	assertClear()
	reset()
	if err := repo.finishRedistributionJob(ctx, repo.db.Pool(), id, "stopped", "human_action"); err != nil {
		t.Fatal(err)
	}
	assertClear()
}

func TestHotfixPostgresWarningRetryDoesNotPostponeDueTransfer(t *testing.T) {
	ctx, repo := hotfixPostgres(t)
	q := newHotfixQueue(t, ctx, repo, 3)
	id := addHotfixWorkerJob(t, ctx, repo, q, 600)
	_, err := repo.db.Pool().Exec(ctx, `update public.lead_redistribution_jobs set due_at=clock_timestamp()+interval '1 second',warning_due_at=now()-interval '1 minute' where id=$1`, id)
	if err != nil {
		t.Fatal(err)
	}
	fairnessFailure(t, ctx, repo, q.org, true)
	before := fairnessBusinessDigest(t, ctx, repo, q.org)
	if err := repo.ProcessLeadRedistribution(ctx); err == nil {
		t.Fatal("warning failure was not reported")
	}
	if fairnessBusinessDigest(t, ctx, repo, q.org) != before {
		t.Fatal("warning failure changed a business field")
	}
	var onlyWarning bool
	if err := repo.db.Pool().QueryRow(ctx, `select warning_retry_at>now() and redistribution_retry_at is null from public.lead_redistribution_jobs where id=$1`, id).Scan(&onlyWarning); err != nil || !onlyWarning {
		t.Fatalf("phase clocks not isolated: onlyWarning=%t err=%v", onlyWarning, err)
	}
	// Let the business deadline expire naturally. Updating it would invoke the
	// reactivation guard and erase the warning clock, hiding a phase-filter bug.
	deadline, due := time.Now().Add(2*time.Second), false
	for time.Now().Before(deadline) {
		if err := repo.db.Pool().QueryRow(ctx, `select due_at<=clock_timestamp() and warning_retry_at>clock_timestamp() from public.lead_redistribution_jobs where id=$1`, id).Scan(&due); err != nil {
			t.Fatal(err)
		}
		if due {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !due {
		t.Fatal("business deadline did not expire while the warning retry remained in the future")
	}
	if err := repo.ProcessLeadRedistribution(ctx); err != nil {
		t.Fatal(err)
	}
	assertHotfixWorkerTransfer(t, ctx, repo, q, id, true)
	var cleared bool
	if err := repo.db.Pool().QueryRow(ctx, `select warning_retry_at is null and redistribution_retry_at is null from public.lead_redistribution_jobs where id=$1`, id).Scan(&cleared); err != nil || !cleared {
		t.Fatalf("new round retained old cooldown: cleared=%t err=%v", cleared, err)
	}
}

func TestHotfixPostgresRetryPersistenceFailureIsReportedAndAtomic(t *testing.T) {
	ctx, repo := hotfixPostgres(t)
	q := newHotfixQueue(t, ctx, repo, 3)
	id := addHotfixWorkerJob(t, ctx, repo, q, -10)
	fairnessFailure(t, ctx, repo, q.org, false)
	name := "hotfix_retry_fail_" + strings.ReplaceAll(hotfixUUID(t), "-", "")
	_, err := repo.db.Pool().Exec(ctx, fmt.Sprintf(`create function private.%s() returns trigger language plpgsql as $$begin
		if new.id='%s'::uuid and new.redistribution_retry_at is distinct from old.redistribution_retry_at then raise exception 'synthetic retry persistence failure' using errcode='23514'; end if; return new; end$$;
		create trigger %s before update on public.lead_redistribution_jobs for each row execute function private.%s()`, name, id, name, name))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = repo.db.Pool().Exec(ctx, fmt.Sprintf(`drop trigger if exists %s on public.lead_redistribution_jobs; drop function if exists private.%s()`, name, name))
	})
	err = repo.ProcessLeadRedistribution(ctx)
	if err == nil || !strings.Contains(err.Error(), "synthetic fairness failure") || !strings.Contains(err.Error(), "synthetic retry persistence failure") {
		t.Fatalf("both business rollback and persistence errors must be reported: %v", err)
	}
	assertHotfixWorkerTransfer(t, ctx, repo, q, id, false)
	var clear bool
	if err := repo.db.Pool().QueryRow(ctx, `select redistribution_retry_at is null from public.lead_redistribution_jobs where id=$1`, id).Scan(&clear); err != nil || !clear {
		t.Fatalf("failed persistence left a false durable claim: clear=%t err=%v", clear, err)
	}
}
