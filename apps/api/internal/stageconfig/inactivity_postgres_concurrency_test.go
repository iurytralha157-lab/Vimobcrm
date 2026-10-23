package stageconfig

import (
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

func testInactivityPostgresScanFairness(f inactivityPostgresFixture) {
	f.seed(true, InactivityClockLastInteraction, InactivityIncludeOverdue)
	f.exec(`update public.leads set assigned_user_id=null`)
	f.cycle()
	f.exec(`update public.leads set assigned_user_id=$1::uuid; update private.stage_inactivity_jobs set next_attempt_at=now()`, inactivityFixtureID(401))
	for offset := range 6 {
		f.exec(`insert into public.stages(id,organization_id,pipeline_id) values($1,$2,$3);
 insert into public.stage_automations(id,organization_id,stage_id) values($4,$2,$1);
 insert into private.stage_inactivity_policies(automation_id,organization_id,stage_id,activation_epoch,revision,clock,start_mode,activated_at,automation_updated_at,duration_days,is_enabled,next_scan_at)
 select id,organization_id,stage_id,$5::uuid,1,'stage_entry','include_overdue',now(),updated_at,1,true,now()-interval '1 hour' from public.stage_automations where id=$4::uuid`, inactivityFixtureID(1000+offset), inactivityFixtureID(1), inactivityFixtureID(101), inactivityFixtureID(2000+offset), inactivityFixtureID(3000+offset))
	}
	blocked, err := f.db.Pool().Begin(f.ctx)
	if err != nil {
		f.t.Fatal(err)
	}
	defer rollbackInactivityTransaction(blocked)
	if _, err := blocked.Exec(f.ctx, `select 1 from public.stages where id>= $1::uuid for update`, inactivityFixtureID(1000)); err != nil {
		f.t.Fatal(err)
	}
	result, err := f.repo.ProcessStageInactivityOnce(f.ctx)
	if err == nil || result.Notified != 1 {
		f.t.Fatalf("busy scans consumed the delivery window: %#v, %v", result, err)
	}
	if f.count(`select count(*) from private.stage_inactivity_policies where next_scan_at>now()+interval '1 minute'`) == 0 {
		f.t.Fatal("failed scan scheduling did not yield to other policies")
	}
}

func testInactivityPostgresSlowFailures(f inactivityPostgresFixture) {
	f.seed(true, InactivityClockLastInteraction, InactivityIncludeOverdue)
	f.exec(`insert into public.leads(id,organization_id,stage_id,pipeline_id,stage_entered_at,assigned_user_id)
 values($1,$2,$3,$4,now()-interval '9 days',$5)`, inactivityFixtureID(503), inactivityFixtureID(1), inactivityFixtureID(201), inactivityFixtureID(101), inactivityFixtureID(401))
	f.exec(`create function public.slow_synthetic_notification() returns trigger language plpgsql as $$ begin perform pg_sleep(3); raise exception 'synthetic slow failure'; end $$; create trigger slow_synthetic before insert on public.notifications for each row execute function public.slow_synthetic_notification()`)
	defer f.exec(`drop trigger slow_synthetic on public.notifications; drop function public.slow_synthetic_notification()`)
	result := f.cycle()
	if result.Failed != 2 || f.count(`select count(*) from private.stage_inactivity_jobs where attempts=1 and status='pending'`) != 2 {
		f.t.Fatalf("a later slow failure erased the earlier committed attempt: %#v", result)
	}
	if f.count(`select count(*) from public.notifications`) != 0 {
		f.t.Fatal("a timed-out notification escaped its transaction")
	}
}

func testInactivityPostgresScanLockScope(f inactivityPostgresFixture) {
	f.seed(true, InactivityClockLastInteraction, InactivityIncludeOverdue)
	f.exec(`insert into public.leads(id,organization_id,stage_id,pipeline_id,stage_entered_at,assigned_user_id)
 values($1,$2,$3,$4,now()-interval '9 days',$5)`, inactivityFixtureID(503), inactivityFixtureID(1), inactivityFixtureID(201), inactivityFixtureID(101), inactivityFixtureID(401))
	const barrierKey = int64(860421729)
	f.exec(`create function public.pause_synthetic_notification() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(860421729); return new; end $$; create trigger pause_synthetic before insert on public.notifications for each row execute function public.pause_synthetic_notification()`)
	defer f.exec(`drop trigger pause_synthetic on public.notifications; drop function public.pause_synthetic_notification()`)
	barrier, err := f.db.Pool().Begin(f.ctx)
	if err != nil {
		f.t.Fatal(err)
	}
	defer rollbackInactivityTransaction(barrier)
	if _, err := barrier.Exec(f.ctx, `select pg_advisory_xact_lock($1)`, barrierKey); err != nil {
		f.t.Fatal(err)
	}
	type completedCycle struct {
		result StageInactivityCycleResult
		err    error
	}
	completed := make(chan completedCycle, 1)
	go func() {
		result, err := f.repo.ProcessStageInactivityOnce(f.ctx)
		completed <- completedCycle{result, err}
	}()
	defer func() {
		rollbackInactivityTransaction(barrier)
		select {
		case <-completed:
		case <-time.After(10 * time.Second):
			f.t.Error("bounded notification worker did not finish during fixture cleanup")
		}
	}()
	deadline := time.Now().Add(10 * time.Second)
	for f.count(`select count(*) from pg_locks where locktype='advisory' and granted=false and objid=$1`, barrierKey) == 0 {
		select {
		case result := <-completed:
			completed <- result
			f.t.Fatalf("notification did not reach its synthetic barrier: %v", result.err)
		default:
		}
		if time.Now().After(deadline) {
			f.t.Fatal("synthetic notification barrier was not observed")
		}
		time.Sleep(10 * time.Millisecond)
	}
	// The target lead remains locked for the canonical notification snapshot.
	target, err := f.db.Pool().Begin(f.ctx)
	if err != nil {
		f.t.Fatal(err)
	}
	_, err = target.Exec(f.ctx, `select 1 from public.leads where id=$1::uuid for update nowait`, inactivityFixtureID(501))
	rollbackInactivityTransaction(target)
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "55P03" {
		f.t.Fatalf("target lead lost its canonical snapshot lock: %v", err)
	}
	// Another lead already scanned is free while notification insertion waits.
	other, err := f.db.Pool().Begin(f.ctx)
	if err != nil {
		f.t.Fatal(err)
	}
	defer rollbackInactivityTransaction(other)
	if _, err := other.Exec(f.ctx, `select 1 from public.leads where id=$1::uuid for update nowait`, inactivityFixtureID(503)); err != nil {
		f.t.Fatalf("scan locks survived into notification processing: %v", err)
	}
	if _, err := other.Exec(f.ctx, `update public.leads set assigned_user_id=$2::uuid where id=$1::uuid`, inactivityFixtureID(503), inactivityFixtureID(402)); err != nil {
		f.t.Fatal(err)
	}
	if err := other.Commit(f.ctx); err != nil {
		f.t.Fatal(err)
	}
	rollbackInactivityTransaction(barrier)
	result := <-completed
	completed <- result // Let the cleanup drain the single bounded result.
	if result.err != nil || result.result.Notified != 2 {
		f.t.Fatalf("notification resumes after barrier: %#v, %v", result.result, result.err)
	}
}
