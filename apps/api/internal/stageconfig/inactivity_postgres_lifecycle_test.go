package stageconfig

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

func prepareInactivityWaitingJob(f inactivityPostgresFixture) {
	f.seed(true, InactivityClockLastInteraction, InactivityIncludeOverdue)
	f.exec(`update public.leads set assigned_user_id=null`)
	f.cycle()
	f.exec(`update public.leads set assigned_user_id=$1::uuid;
 update private.stage_inactivity_jobs set next_attempt_at=now()`, inactivityFixtureID(401))
}

func testInactivityPostgresDeleteLockOrder(f inactivityPostgresFixture) {
	prepareInactivityWaitingJob(f)
	reproduceInactivityOldDeleteDeadlock(f)
	deleting, err := f.db.Pool().Begin(f.ctx)
	if err != nil {
		f.t.Fatal(err)
	}
	defer rollbackInactivityTransaction(deleting)
	if _, err := deleting.Exec(f.ctx, `select 1 from public.leads where id=$1::uuid for update`, inactivityFixtureID(501)); err != nil {
		f.t.Fatal(err)
	}
	result := f.cycle()
	if result.Notified+result.Failed+result.Waiting != 0 {
		f.t.Fatalf("a deleting lead acquired a child job: %#v", result)
	}
	// The deleter can lock and cascade the child without waiting for a worker
	// that owns the child and waits for this already-locked parent.
	if _, err := deleting.Exec(f.ctx, `select 1 from private.stage_inactivity_jobs where lead_id=$1::uuid for update nowait`, inactivityFixtureID(501)); err != nil {
		f.t.Fatalf("worker retained a child job while skipping its lead: %v", err)
	}
	if _, err := deleting.Exec(f.ctx, `delete from public.leads where id=$1::uuid`, inactivityFixtureID(501)); err != nil {
		f.t.Fatalf("lead deletion cascade failed: %v", err)
	}
	if err := deleting.Commit(f.ctx); err != nil {
		f.t.Fatal(err)
	}
	if f.count(`select count(*) from private.stage_inactivity_jobs`) != 0 || f.count(`select count(*) from public.notifications`) != 0 {
		f.t.Fatal("deleted lead retained pending work or received a notification")
	}
}

// The exact old child->parent order reproduces the cycle against the real
// candidate FK. Both test transactions roll back; the fixed worker is then
// exercised against the same parent->child deletion order above.
func reproduceInactivityOldDeleteDeadlock(f inactivityPostgresFixture) {
	ctx, cancel := context.WithTimeout(f.ctx, 15*time.Second)
	defer cancel()
	deleting, err := f.db.Pool().Begin(ctx)
	if err != nil {
		f.t.Fatal(err)
	}
	defer rollbackInactivityTransaction(deleting)
	legacy, err := f.db.Pool().Begin(ctx)
	if err != nil {
		f.t.Fatal(err)
	}
	defer rollbackInactivityTransaction(legacy)
	if _, err := deleting.Exec(ctx, `set local deadlock_timeout='100ms'; set local statement_timeout='8s'; select 1 from public.leads where id=$1::uuid for update`, inactivityFixtureID(501)); err != nil {
		f.t.Fatal(err)
	}
	if _, err := legacy.Exec(ctx, `set local deadlock_timeout='100ms'; set local statement_timeout='8s'; select 1 from private.stage_inactivity_jobs where lead_id=$1::uuid for update`, inactivityFixtureID(501)); err != nil {
		f.t.Fatal(err)
	}
	var workerPID int
	if err := legacy.QueryRow(ctx, `select pg_backend_pid()`).Scan(&workerPID); err != nil {
		f.t.Fatal(err)
	}
	completed := make(chan error, 1)
	go func() {
		_, err := legacy.Exec(ctx, `select 1 from public.leads where id=$1::uuid for update`, inactivityFixtureID(501))
		completed <- err
	}()
	deadline := time.Now().Add(5 * time.Second)
	for f.count(`select count(*) from pg_locks where pid=$1 and granted=false`, workerPID) == 0 {
		if time.Now().After(deadline) {
			cancel()
			<-completed
			f.t.Fatal("old lock order did not reach its parent wait")
		}
		time.Sleep(10 * time.Millisecond)
	}
	_, deleteErr := deleting.Exec(ctx, `delete from public.leads where id=$1::uuid`, inactivityFixtureID(501))
	rollbackInactivityTransaction(deleting)
	workerErr := <-completed
	rollbackInactivityTransaction(legacy)
	var deletePG, workerPG *pgconn.PgError
	deleteDeadlock := errors.As(deleteErr, &deletePG) && deletePG.Code == "40P01"
	workerDeadlock := errors.As(workerErr, &workerPG) && workerPG.Code == "40P01"
	if !deleteDeadlock && !workerDeadlock {
		f.t.Fatalf("old child->parent order did not reproduce its FK deadlock: delete=%v worker=%v", deleteErr, workerErr)
	}
}

func testInactivityPostgresUserRemovalLockOrder(f inactivityPostgresFixture) {
	prepareInactivityWaitingJob(f)
	removing, err := f.db.Pool().Begin(f.ctx)
	if err != nil {
		f.t.Fatal(err)
	}
	defer rollbackInactivityTransaction(removing)
	// Same account->membership->assigned lead order as organization removal.
	if _, err := removing.Exec(f.ctx, `select 1 from public.users where id=$1::uuid for update;
 select 1 from public.organization_members where organization_id=$2::uuid and user_id=$1::uuid for update`, inactivityFixtureID(401), inactivityFixtureID(1)); err != nil {
		f.t.Fatal(err)
	}
	result := f.cycle()
	if result.Waiting != 1 || result.Failed+result.Notified != 0 || f.count(`select count(*) from private.stage_inactivity_jobs where attempts=0 and status='pending'`) != 1 {
		f.t.Fatalf("busy recipient removal did not defer safely: %#v", result)
	}
	if _, err := removing.Exec(f.ctx, `select 1 from public.leads where id=$1::uuid for update nowait;
 update public.leads set assigned_user_id=$2::uuid where id=$1::uuid;
 update public.organization_members set is_active=false,deleted_at=now() where organization_id=$3::uuid and user_id=$4::uuid`, inactivityFixtureID(501), inactivityFixtureID(402), inactivityFixtureID(1), inactivityFixtureID(401)); err != nil {
		f.t.Fatalf("member removal could not finish its lead transfer: %v", err)
	}
	if err := removing.Commit(f.ctx); err != nil {
		f.t.Fatal(err)
	}
	f.exec(`update private.stage_inactivity_jobs set next_attempt_at=now()`)
	if f.cycle().Notified != 1 || f.count(`select count(*) from public.notifications where user_id=$1::uuid`, inactivityFixtureID(402)) != 1 {
		f.t.Fatal("retry did not resolve the current assignee after removal")
	}
}
