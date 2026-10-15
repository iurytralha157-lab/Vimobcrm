package leads

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
)

func fairnessJobs(t *testing.T, ctx context.Context, repo Repository, count int, warning bool) (hotfixQueue, []string, []hotfixQueue) {
	t.Helper()
	q := newHotfixQueue(t, ctx, repo, 3)
	jobs, leads := []string{}, []hotfixQueue{}
	for n := 0; n < count; n++ {
		lead := q
		if n > 0 {
			lead = addHotfixWorkerLead(t, ctx, repo, q)
		}
		job := addHotfixWorkerJob(t, ctx, repo, lead, -100000+n)
		if warning {
			if _, err := repo.db.Pool().Exec(ctx, `update public.lead_redistribution_jobs set due_at=now()+interval '1 day',warning_due_at=now()+($2::integer*interval '1 second') where id=$1`, job, -100000+n); err != nil {
				t.Fatal(err)
			}
		}
		jobs, leads = append(jobs, job), append(leads, lead)
	}
	return q, jobs, leads
}

func fairnessFailure(t *testing.T, ctx context.Context, repo Repository, org string, warning bool) {
	t.Helper()
	table, predicate := "round_robin_logs", "new.reason='auto_redistribution'"
	if warning {
		table, predicate = "notifications", "new.title='Lead quase redistribuido'"
	}
	hotfixWorkerTrigger(t, ctx, repo, table, fmt.Sprintf(`if new.organization_id='%s'::uuid and %s then raise exception 'synthetic fairness failure' using errcode='23514'; end if;`, org, predicate))
}

func fairnessBusinessDigest(t *testing.T, ctx context.Context, repo Repository, org string) string {
	t.Helper()
	var digest string
	if err := repo.db.Pool().QueryRow(ctx, `select md5(string_agg((to_jsonb(j)-'warning_retry_at'-'redistribution_retry_at')::text,'' order by id)) from public.lead_redistribution_jobs j where organization_id=$1`, org).Scan(&digest); err != nil {
		t.Fatal(err)
	}
	return digest
}

func TestHotfixPostgresFairnessFiftyFailuresDoNotStarveNextBatch(t *testing.T) {
	for _, warning := range []bool{false, true} {
		t.Run(fmt.Sprintf("warning_%t", warning), func(t *testing.T) {
			ctx, repo := hotfixPostgres(t)
			bad, _, _ := fairnessJobs(t, ctx, repo, 50, warning)
			before := fairnessBusinessDigest(t, ctx, repo, bad.org)
			fairnessFailure(t, ctx, repo, bad.org, warning)
			healthy, jobs, leads := fairnessJobs(t, ctx, repo, 1, warning)
			if _, err := repo.db.Pool().Exec(ctx, `update public.lead_redistribution_jobs set due_at=case when $2 then due_at else now()-interval '1 hour' end,warning_due_at=case when $2 then now()-interval '1 hour' else warning_due_at end where id=$1`, jobs[0], warning); err != nil {
				t.Fatal(err)
			}
			if err := repo.ProcessLeadRedistribution(ctx); err == nil || !strings.Contains(err.Error(), "synthetic fairness failure") {
				t.Fatalf("first bounded batch must report failures: %v", err)
			}
			if fairnessBusinessDigest(t, ctx, repo, bad.org) != before {
				t.Fatal("technical failures changed business job fields")
			}
			var healthyNotices int
			if err := repo.db.Pool().QueryRow(ctx, `select count(*) from public.notifications where organization_id=$1`, healthy.org).Scan(&healthyNotices); err != nil || healthyNotices != 0 {
				t.Fatalf("first batch exceeded its 50-job limit: notices=%d err=%v", healthyNotices, err)
			}
			// A new repository/connection pool represents a process restart. The
			// already-expired retry clock must still rank behind older healthy work.
			column := "redistribution_retry_at"
			if warning {
				column = "warning_retry_at"
			}
			if _, err := repo.db.Pool().Exec(ctx, `update public.lead_redistribution_jobs set `+column+`=clock_timestamp()-interval '1 second' where organization_id=$1`, bad.org); err != nil {
				t.Fatal(err)
			}
			_, restarted := hotfixPostgres(t)
			_ = restarted.ProcessLeadRedistribution(ctx)
			if warning {
				var status string
				if err := repo.db.Pool().QueryRow(ctx, `select status from public.lead_redistribution_jobs where id=$1`, jobs[0]).Scan(&status); err != nil || status != "warning_sent" {
					t.Fatalf("healthy warning starved: %s %v", status, err)
				}
			} else {
				assertHotfixWorkerTransfer(t, ctx, repo, leads[0], jobs[0], true)
			}
		})
	}
}

func TestHotfixPostgresFairnessDeepBacklogAndEightReplicas(t *testing.T) {
	for _, replicas := range []int{1, 8} {
		t.Run(fmt.Sprintf("replicas_%d", replicas), func(t *testing.T) {
			ctx, repo := hotfixPostgres(t)
			bad, _, _ := fairnessJobs(t, ctx, repo, 151, false)
			fairnessFailure(t, ctx, repo, bad.org, false)
			_, healthyJobs, healthyLeads := fairnessJobs(t, ctx, repo, 1, false)
			if _, err := repo.db.Pool().Exec(ctx, `update public.lead_redistribution_jobs set due_at=now()-interval '1 hour' where id=$1`, healthyJobs[0]); err != nil {
				t.Fatal(err)
			}
			for tick := 0; tick < 4; tick++ {
				var workers sync.WaitGroup
				start := make(chan struct{})
				for n := 0; n < replicas; n++ {
					workers.Add(1)
					go func() { defer workers.Done(); <-start; _ = repo.ProcessLeadRedistribution(ctx) }()
				}
				close(start)
				workers.Wait()
				if replicas == 1 && tick < 3 {
					assertHotfixWorkerTransfer(t, ctx, repo, healthyLeads[0], healthyJobs[0], false)
				}
			}
			assertHotfixWorkerTransfer(t, ctx, repo, healthyLeads[0], healthyJobs[0], true)
			var attempted, notices int
			if err := repo.db.Pool().QueryRow(ctx, `select sum(attempt_count),(select count(*) from public.notifications where organization_id=$1) from public.lead_redistribution_jobs where organization_id=$1`, bad.org).Scan(&attempted, &notices); err != nil || attempted != 0 || notices != 0 {
				t.Fatalf("failed jobs leaked business effects: attempts=%d notices=%d err=%v", attempted, notices, err)
			}
		})
	}
}

func TestHotfixPostgresFairnessFiftyLockedRowsDoNotHideHealthyLead(t *testing.T) {
	ctx, repo := hotfixPostgres(t)
	bad, _, _ := fairnessJobs(t, ctx, repo, 50, false)
	_, jobs, leads := fairnessJobs(t, ctx, repo, 1, false)
	if _, err := repo.db.Pool().Exec(ctx, `update public.lead_redistribution_jobs set due_at=now()-interval '1 hour' where id=$1`, jobs[0]); err != nil {
		t.Fatal(err)
	}
	locker, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer locker.Rollback(ctx)
	if _, err := locker.Exec(ctx, `select id from public.lead_redistribution_jobs where organization_id=$1 for update`, bad.org); err != nil {
		t.Fatal(err)
	}
	if err := repo.ProcessLeadRedistribution(ctx); err != nil {
		t.Fatal(err)
	}
	assertHotfixWorkerTransfer(t, ctx, repo, leads[0], jobs[0], true)
}
