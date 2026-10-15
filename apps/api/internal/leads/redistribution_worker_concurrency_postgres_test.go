package leads

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
)

func TestHotfixPostgresFullWorkerReplicasDoNotDuplicateTransfer(t *testing.T) {
	ctx, repo := hotfixPostgres(t)
	q := newHotfixQueue(t, ctx, repo, 3)
	jobID := addHotfixWorkerJob(t, ctx, repo, q, -30)
	start := make(chan struct{})
	results := make(chan error, 8)
	var workers sync.WaitGroup
	for n := 0; n < 8; n++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			results <- repo.ProcessLeadRedistribution(ctx)
		}()
	}
	close(start)
	workers.Wait()
	close(results)
	for err := range results {
		if err != nil {
			t.Fatal(err)
		}
	}
	assertHotfixWorkerTransfer(t, ctx, repo, q, jobID, true)
	probe, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer probe.Rollback(ctx)
	var acquired bool
	if err := probe.QueryRow(ctx, `select pg_try_advisory_xact_lock($1::integer,hashtext($2::text))`, leadRedistributionLockKey, jobID).Scan(&acquired); err != nil || !acquired {
		t.Fatalf("transaction advisory lock leaked: acquired=%t err=%v", acquired, err)
	}
}

func TestHotfixPostgresFullWorkerRetriesRollbackWithoutDuplicateEffects(t *testing.T) {
	for _, code := range []string{"40001", "40P01"} {
		t.Run(code, func(t *testing.T) {
			ctx, repo := hotfixPostgres(t)
			q := newHotfixQueue(t, ctx, repo, 3)
			jobID := addHotfixWorkerJob(t, ctx, repo, q, -30)
			sequence := "hotfix_retry_" + strings.ReplaceAll(hotfixUUID(t), "-", "")
			if _, err := repo.db.Pool().Exec(ctx, fmt.Sprintf(`create sequence private.%s`, sequence)); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				_, _ = repo.db.Pool().Exec(context.Background(), fmt.Sprintf(`drop sequence if exists private.%s`, sequence))
			})
			hotfixWorkerTrigger(t, ctx, repo, "round_robin_logs", fmt.Sprintf(`if new.lead_id='%s'::uuid and new.reason='auto_redistribution' and nextval('private.%s')=1 then raise exception 'synthetic retry' using errcode='%s'; end if;`, q.lead, sequence, code))
			if err := repo.ProcessLeadRedistribution(ctx); err != nil {
				t.Fatal(err)
			}
			assertHotfixWorkerTransfer(t, ctx, repo, q, jobID, true)
			var attempts int
			if err := repo.db.Pool().QueryRow(ctx, fmt.Sprintf(`select last_value from private.%s`, sequence)).Scan(&attempts); err != nil || attempts != 2 {
				t.Fatalf("attempts=%d err=%v", attempts, err)
			}
		})
	}
}

func TestHotfixPostgresFullWorkerWarningsAndHumanActivityRemainProtected(t *testing.T) {
	ctx, repo := hotfixPostgres(t)
	warning := newHotfixQueue(t, ctx, repo, 3)
	warningJob := addHotfixWorkerJob(t, ctx, repo, warning, 120)
	human := newHotfixQueue(t, ctx, repo, 3)
	humanJob := addHotfixWorkerJob(t, ctx, repo, human, -10)
	_, err := repo.db.Pool().Exec(ctx, `update public.lead_redistribution_jobs set warning_due_at=now()-interval '1 minute' where id=$1;
		insert into public.lead_action_facts(organization_id,lead_id,actor_user_id,action_type,source_type,source_id,occurred_at,is_automated,is_inbound)
		values($2,$3,$4,'call','activity','synthetic-human-call',now(),false,false)`, warningJob, human.org, human.lead, human.users[0])
	if err != nil {
		t.Fatal(err)
	}
	for n := 0; n < 2; n++ {
		if err := repo.ProcessLeadRedistribution(ctx); err != nil {
			t.Fatal(err)
		}
	}
	var status, reason string
	var notices, attempts, count int
	err = repo.db.Pool().QueryRow(ctx, `select j.status,j.attempt_count,l.redistribution_count,
		(select count(*) from public.notifications n where n.lead_id=l.id)
		from public.lead_redistribution_jobs j join public.leads l on l.id=j.lead_id where j.id=$1`, warningJob).Scan(&status, &attempts, &count, &notices)
	if err != nil || status != "warning_sent" || attempts != 0 || count != 0 || notices != 1 {
		t.Fatalf("warning status=%s attempts=%d count=%d notices=%d err=%v", status, attempts, count, notices, err)
	}
	err = repo.db.Pool().QueryRow(ctx, `select status,stopped_reason from public.lead_redistribution_jobs where id=$1`, humanJob).Scan(&status, &reason)
	if err != nil || status != "stopped" || reason != "human_action" {
		t.Fatalf("human action status=%s reason=%s err=%v", status, reason, err)
	}
	assertHotfixWorkerTransfer(t, ctx, repo, human, humanJob, false)
}

func TestHotfixPostgresFullWorkerBusyLeadDoesNotBlockOtherQueue(t *testing.T) {
	ctx, repo := hotfixPostgres(t)
	busy := newHotfixQueue(t, ctx, repo, 3)
	other := newHotfixQueue(t, ctx, repo, 3)
	busyJob := addHotfixWorkerJob(t, ctx, repo, busy, -20)
	otherJob := addHotfixWorkerJob(t, ctx, repo, other, -10)
	manual, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer manual.Rollback(ctx)
	if _, err := repo.getLeadSnapshotForUpdate(ctx, manual, busy.org, busy.lead); err != nil {
		t.Fatal(err)
	}
	if err := repo.ProcessLeadRedistribution(ctx); err == nil || !strings.Contains(err.Error(), "55P03") {
		t.Fatalf("expected bounded lock wait for busy lead: %v", err)
	}
	assertHotfixWorkerTransfer(t, ctx, repo, busy, busyJob, false)
	assertHotfixWorkerTransfer(t, ctx, repo, other, otherJob, true)
	if err := manual.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	// Technical failures now persist a separate cooldown. Expire only that
	// clock; the original business deadline and attempt remain unchanged.
	if _, err := repo.db.Pool().Exec(ctx, `update public.lead_redistribution_jobs set redistribution_retry_at=clock_timestamp()-interval '1 second' where id=$1`, busyJob); err != nil {
		t.Fatal(err)
	}
	if err := repo.ProcessLeadRedistribution(ctx); err != nil {
		t.Fatal(err)
	}
	assertHotfixWorkerTransfer(t, ctx, repo, busy, busyJob, true)
	assertHotfixWorkerTransfer(t, ctx, repo, other, otherJob, true)
}

func TestHotfixPostgresFullWorkerConfiguredLimitStopsFurtherTransfers(t *testing.T) {
	ctx, repo := hotfixPostgres(t)
	q := newHotfixQueue(t, ctx, repo, 3)
	jobID := addHotfixWorkerJob(t, ctx, repo, q, -10)
	if _, err := repo.db.Pool().Exec(ctx, `update public.lead_redistribution_jobs set max_attempts=1 where id=$1`, jobID); err != nil {
		t.Fatal(err)
	}
	for n := 0; n < 2; n++ {
		if err := repo.ProcessLeadRedistribution(ctx); err != nil {
			t.Fatal(err)
		}
	}
	assertHotfixWorkerTransfer(t, ctx, repo, q, jobID, true)
	var status, reason string
	if err := repo.db.Pool().QueryRow(ctx, `select status,stopped_reason from public.lead_redistribution_jobs where id=$1`, jobID).Scan(&status, &reason); err != nil || status != "max_attempts_reached" || reason != "max_attempts_reached" {
		t.Fatalf("status=%s reason=%s err=%v", status, reason, err)
	}
}
