package stageconfig

import (
	"errors"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestStageInactivityRejectsUnsafeDatabaseTargets(t *testing.T) {
	for _, dsn := range []string{"", "postgres://postgres@remote.example/postgres", "postgres://postgres@127.0.0.1/customer", "postgres://customer@127.0.0.1/postgres", "postgres://postgres@127.0.0.1/postgres?host=remote.example"} {
		if _, err := inactivityTestConfig(dsn); err == nil {
			t.Fatalf("unsafe fixture target accepted: %q", dsn)
		}
	}
}

func TestStageInactivityFixtureURLActuallySelectsRandomDatabase(t *testing.T) {
	const original = "postgres://postgres@127.0.0.1:58022/postgres?sslmode=disable"
	const ownDatabase = "vimob_stage_inactivity_test_aabbccddeeff"
	config, err := pgx.ParseConfig(original)
	if err != nil {
		t.Fatal(err)
	}
	config.Database = ownDatabase
	preserved, err := pgx.ParseConfig(config.ConnString())
	if err != nil || preserved.Database != "postgres" {
		t.Fatal("fixture regression setup must reproduce the preserved original ConnString")
	}
	dsn, err := inactivityFixtureDatabaseURL(original, ownDatabase)
	if err != nil {
		t.Fatal(err)
	}
	actual, err := pgx.ParseConfig(dsn)
	if err != nil || actual.Database != ownDatabase {
		t.Fatal("generated pool URL did not select its owned random database")
	}
	if _, err := inactivityFixtureDatabaseURL(original, "postgres"); err == nil {
		t.Fatal("admin database was accepted as a fixture destination")
	}
}

func TestStageInactivityPostgres(t *testing.T) {
	fixture := openInactivityPostgresFixture(t)
	for _, test := range []struct {
		name string
		run  func(inactivityPostgresFixture)
	}{
		{"legacy rules remain inactive", func(f inactivityPostgresFixture) {
			f.seed(false, "", "")
			f.cycle()
			f.fact(1, 501, 1, false, false, "1 minute")
			if f.count(`select count(*) from private.stage_inactivity_jobs`) != 0 || f.count(`select count(*) from public.lead_action_facts`) != 0 {
				f.t.Fatal("legacy rule acquired jobs or new fact coverage without explicit policy")
			}
		}},
		{"in-app delivery is durable and idempotent", func(f inactivityPostgresFixture) {
			f.seed(true, InactivityClockLastInteraction, InactivityIncludeOverdue)
			if result := f.cycle(); result.Notified != 1 {
				f.t.Fatalf("first cycle = %#v", result)
			}
			f.scanNow()
			if result := f.cycle(); result.Enqueued+result.Notified != 0 {
				f.t.Fatalf("same episode was repeated: %#v", result)
			}
			if f.count(`select count(*) from public.notifications where channel='in_app' and not metadata ? 'dispatch'`) != 1 {
				f.t.Fatal("candidate must only create one in-app notification")
			}
			if f.count(`select count(*) from private.notification_deliveries`) != 0 || f.count(`select count(*) from private.whatsapp_inbound_push_waiting`) != 0 {
				f.t.Fatal("real normalized producers created an external intent for the in-app candidate")
			}
			// A positive control proves the real delivery trigger is installed,
			// not simply absent from this synthetic database.
			f.exec(`insert into public.notifications(organization_id,user_id,title,metadata)
 values ($1,$2,'Synthetic positive control','{"dispatch":{"email":{"required":true}}}')`, inactivityFixtureID(1), inactivityFixtureID(401))
			if f.count(`select count(*) from private.notification_deliveries where channel='email'`) != 1 {
				f.t.Fatal("normalized delivery positive control did not execute")
			}
		}},
		{"future human facts cover leads outside attention", func(f inactivityPostgresFixture) {
			f.seed(true, InactivityClockLastInteraction, InactivityIncludeOverdue)
			f.fact(1, 501, 1, false, false, "1 minute")
			f.fact(1, 501, 1, false, false, "1 minute")
			if f.count(`select count(*) from public.lead_action_facts`) != 1 || f.cycle().Notified != 0 {
				f.t.Fatal("future human work must persist once and postpone the alert")
			}
		}},
		{"qualifying inbound replies reset interaction clock", func(f inactivityPostgresFixture) {
			f.seed(true, InactivityClockLastInteraction, InactivityIncludeOverdue)
			f.fact(1, 501, 1, true, false, "1 minute")
			if f.cycle().Notified != 0 {
				f.t.Fatal("a qualifying customer reply was ignored")
			}
		}},
		{"automated work does not reset interaction clock", func(f inactivityPostgresFixture) {
			f.seed(true, InactivityClockLastInteraction, InactivityIncludeOverdue)
			f.fact(1, 501, 1, false, true, "1 minute")
			if f.cycle().Notified != 1 {
				f.t.Fatal("automation falsely postponed inactivity")
			}
		}},
		{"stage clock ignores interactions and does not expand facts", func(f inactivityPostgresFixture) {
			f.seed(true, InactivityClockStageEntry, InactivityIncludeOverdue)
			f.fact(1, 501, 1, false, false, "1 minute")
			if f.count(`select count(*) from public.lead_action_facts`) != 0 || f.cycle().Notified != 1 {
				f.t.Fatal("stage-entry policy changed activity classification or clock")
			}
			if f.count(`select count(*) from public.notifications where title='Prazo da etapa atingido'`) != 1 {
				f.t.Fatal("stage-entry alert falsely claimed absence of interaction")
			}
		}},
		{"activation starts a fresh clock", func(f inactivityPostgresFixture) {
			f.seed(true, InactivityClockLastInteraction, InactivityStartAtActivation)
			f.exec(`update private.stage_inactivity_policies set activated_at=now()`)
			if f.cycle().Notified != 0 {
				f.t.Fatal("explicit fresh activation alerted the historical backlog immediately")
			}
		}},
		{"new entries scope skips historical pages and still reaches new entries", func(f inactivityPostgresFixture) {
			f.seed(true, InactivityClockLastInteraction, InactivityNewStageEntries)
			f.exec(`insert into public.leads(id,organization_id,stage_id,pipeline_id,stage_entered_at,assigned_user_id)
 select ('00000000-0000-4000-8000-'||lpad(id::text,12,'0'))::uuid,$1::uuid,$2::uuid,$3::uuid,now()-interval '10 days',$4::uuid
 from generate_series(503,602) id`, inactivityFixtureID(1), inactivityFixtureID(201), inactivityFixtureID(101), inactivityFixtureID(401))
			f.exec(`insert into public.leads(id,organization_id,stage_id,pipeline_id,stage_entered_at,assigned_user_id)
 values ($1,$2,$3,$4,now()-interval '2 days',$5)`, inactivityFixtureID(801), inactivityFixtureID(1), inactivityFixtureID(201), inactivityFixtureID(101), inactivityFixtureID(401))
			if result := f.cycle(); result.Scanned != inactivityLeadBatch || result.Enqueued != 0 {
				f.t.Fatalf("historical page did not advance without jobs: %#v", result)
			}
			f.scanNow()
			if result := f.cycle(); result.Enqueued != 1 || result.Notified != 1 {
				f.t.Fatalf("new entry was missed after skipping historical page: %#v", result)
			}
			if f.count(`select count(*) from private.stage_inactivity_jobs where lead_id=$1::uuid`, inactivityFixtureID(801)) != 1 {
				f.t.Fatal("new scope enrolled a lead already in the column")
			}
		}},
		{"tenant and fact scope are enforced", func(f inactivityPostgresFixture) {
			f.seed(true, InactivityClockLastInteraction, InactivityIncludeOverdue)
			f.exec(`insert into public.lead_action_facts(organization_id,lead_id,occurred_at,qualifies_stage_inactivity) values ($1,$2,now(),true)`, inactivityFixtureID(2), inactivityFixtureID(501))
			if f.cycle().Notified != 1 || f.count(`select count(*) from public.notifications where organization_id=$1::uuid`, inactivityFixtureID(2)) != 0 {
				f.t.Fatal("a foreign tenant fact reset another lead or received an alert")
			}
		}},
		{"source revision invalidates pending work", func(f inactivityPostgresFixture) {
			f.seed(true, InactivityClockLastInteraction, InactivityIncludeOverdue)
			f.exec(`update public.leads set assigned_user_id=null`)
			f.cycle()
			f.exec(`update public.stage_automations set updated_at=updated_at+interval '1 microsecond'; update private.stage_inactivity_jobs set next_attempt_at=now()`)
			if f.cycle().Cancelled != 1 {
				f.t.Fatal("outdated automation configuration executed")
			}
		}},
		{"ordinary edits do not repeat a notified episode", func(f inactivityPostgresFixture) {
			f.seed(true, InactivityClockLastInteraction, InactivityIncludeOverdue)
			f.cycle()
			f.exec(`update private.stage_inactivity_policies set revision=revision+1,alert_message='Mensagem revisada',next_scan_at=now()`)
			f.cycle()
			if f.count(`select count(*) from public.notifications`) != 1 {
				f.t.Fatal("a message edit repeated an already-notified episode")
			}
		}},
		{"pending revision is refreshed without losing its episode", func(f inactivityPostgresFixture) {
			f.seed(true, InactivityClockLastInteraction, InactivityIncludeOverdue)
			f.exec(`update public.leads set assigned_user_id=null`)
			f.cycle()
			f.exec(`update private.stage_inactivity_policies set revision=revision+1,next_scan_at=now(); update public.leads set assigned_user_id=$1::uuid`, inactivityFixtureID(401))
			if f.cycle().Notified != 1 || f.count(`select count(*) from private.stage_inactivity_jobs where policy_revision=2`) != 1 {
				f.t.Fatal("pending work did not reconcile the exact new revision")
			}
		}},
		{"missing recipient waits without consuming attempts", func(f inactivityPostgresFixture) {
			f.seed(true, InactivityClockLastInteraction, InactivityIncludeOverdue)
			f.exec(`update public.organization_members set is_active=false`)
			if f.cycle().Waiting != 1 || f.count(`select count(*) from private.stage_inactivity_jobs where attempts=0 and status='pending'`) != 1 {
				f.t.Fatal("inactive recipients must wait without a delivery or error attempt")
			}
			f.exec(`update public.organization_members set is_active=true,membership_generation=2; update private.stage_inactivity_jobs set next_attempt_at=now()`)
			if f.cycle().Notified != 1 || f.count(`select count(*) from public.notifications where metadata->>'membership_generation'='2'`) != 1 {
				f.t.Fatal("current membership generation was not revalidated")
			}
		}},
		{"assignment is resolved immediately before notification", func(f inactivityPostgresFixture) {
			f.seed(true, InactivityClockLastInteraction, InactivityIncludeOverdue)
			f.exec(`update public.leads set assigned_user_id=null`)
			f.cycle()
			f.exec(`update public.leads set assigned_user_id=$1::uuid where id=$2::uuid; update private.stage_inactivity_jobs set next_attempt_at=now()`, inactivityFixtureID(402), inactivityFixtureID(501))
			f.cycle()
			if f.count(`select count(*) from public.notifications where user_id=$1::uuid`, inactivityFixtureID(402)) != 1 {
				f.t.Fatal("the old/unassigned recipient was reused")
			}
		}},
		{"reopening in the same column renews the clock", func(f inactivityPostgresFixture) {
			f.seed(true, InactivityClockLastInteraction, InactivityIncludeOverdue)
			f.exec(`update public.leads set assigned_user_id=null`)
			f.cycle()
			f.exec(`update public.leads set deal_status='won' where id=$1::uuid; update public.leads set deal_status='open',assigned_user_id=$2::uuid where id=$1::uuid; update private.stage_inactivity_jobs set next_attempt_at=now(); update private.stage_inactivity_policies set next_scan_at=now()`, inactivityFixtureID(501), inactivityFixtureID(401))
			result := f.cycle()
			if result.Notified != 0 || result.Cancelled != 1 || f.count(`select count(*) from private.stage_inactivity_jobs`) != 2 {
				f.t.Fatalf("reopening reused stale clock/work: %#v", result)
			}
		}},
		{"late human interaction cancels the scanned job", func(f inactivityPostgresFixture) {
			f.seed(true, InactivityClockLastInteraction, InactivityIncludeOverdue)
			f.exec(`update public.leads set assigned_user_id=null`)
			f.cycle()
			f.fact(1, 501, 1, false, false, "1 minute")
			f.exec(`update public.leads set assigned_user_id=$1::uuid; update private.stage_inactivity_jobs set next_attempt_at=now()`, inactivityFixtureID(401))
			if f.cycle().Cancelled != 1 || f.count(`select count(*) from public.notifications`) != 0 {
				f.t.Fatal("an interaction after scanning failed the final canonical check")
			}
		}},
		{"suppressed historical leads produce no scope or job", func(f inactivityPostgresFixture) {
			f.seed(true, InactivityClockLastInteraction, InactivityIncludeOverdue)
			f.exec(`truncate public.leads cascade; insert into public.leads(id,organization_id,stage_id,pipeline_id,stage_entered_at,assigned_user_id,operational_effects_suppressed)
 values($1,$2,$3,$4,now()-interval '10 days',$5,true)`, inactivityFixtureID(501), inactivityFixtureID(1), inactivityFixtureID(201), inactivityFixtureID(101), inactivityFixtureID(401))
			f.fact(1, 501, 1, false, false, "1 minute")
			f.cycle()
			if f.count(`select count(*) from private.stage_inactivity_lead_scopes`) != 0 || f.count(`select count(*) from private.stage_inactivity_jobs`) != 0 || f.count(`select count(*) from public.lead_action_facts`) != 0 {
				f.t.Fatal("silent historical import produced operational inactivity effects")
			}
		}},
		{"suppression added after scanning cancels pending work", func(f inactivityPostgresFixture) {
			f.seed(true, InactivityClockLastInteraction, InactivityIncludeOverdue)
			f.exec(`update public.leads set assigned_user_id=null`)
			f.cycle()
			f.exec(`update public.leads set operational_effects_suppressed=true; update private.stage_inactivity_jobs set next_attempt_at=now()`)
			if f.cycle().Cancelled != 1 || f.count(`select count(*) from public.notifications`) != 0 {
				f.t.Fatal("suppressed lead retained executable pending work")
			}
		}},
		{"historical import capability suppresses capture", func(f inactivityPostgresFixture) {
			f.seed(true, InactivityClockLastInteraction, InactivityIncludeOverdue)
			f.exec(`truncate public.leads cascade; create or replace function private.historical_import_effects_suppressed() returns boolean language sql as $$ select true $$`)
			defer f.exec(`create or replace function private.historical_import_effects_suppressed() returns boolean language sql as $$ select false $$`)
			f.exec(`insert into public.leads(id,organization_id,stage_id,pipeline_id,stage_entered_at) values($1,$2,$3,$4,now()-interval '10 days')`, inactivityFixtureID(501), inactivityFixtureID(1), inactivityFixtureID(201), inactivityFixtureID(101))
			f.fact(1, 501, 1, false, false, "1 minute")
			if f.count(`select count(*) from private.stage_inactivity_lead_scopes`) != 0 || f.count(`select count(*) from public.lead_action_facts`) != 0 {
				f.t.Fatal("capture ignored the canonical import capability helper")
			}
		}},
		{"on-enter automations cannot acquire inactivity policy effects", func(f inactivityPostgresFixture) {
			f.seed(true, InactivityClockLastInteraction, InactivityIncludeOverdue)
			f.exec(`truncate public.leads cascade; update public.stage_automations set trigger_type='on_enter'; insert into public.leads(id,organization_id,stage_id,pipeline_id,stage_entered_at) values($1,$2,$3,$4,now()-interval '10 days')`, inactivityFixtureID(501), inactivityFixtureID(1), inactivityFixtureID(201), inactivityFixtureID(101))
			f.fact(1, 501, 1, false, false, "1 minute")
			f.cycle()
			if f.count(`select count(*) from private.stage_inactivity_lead_scopes`) != 0 || f.count(`select count(*) from private.stage_inactivity_jobs`) != 0 || f.count(`select count(*) from public.lead_action_facts`) != 0 {
				f.t.Fatal("an on-enter rule executed as inactivity")
			}
		}},
		{"reopening while disabled preserves a new scope", func(f inactivityPostgresFixture) {
			f.seed(true, InactivityClockLastInteraction, InactivityIncludeOverdue)
			f.exec(`update public.leads set assigned_user_id=null`)
			f.cycle()
			f.exec(`update private.stage_inactivity_policies set is_enabled=false; update public.leads set deal_status='lost' where id=$1::uuid; update public.leads set deal_status='open',assigned_user_id=$2::uuid where id=$1::uuid; update private.stage_inactivity_policies set is_enabled=true,activation_epoch=gen_random_uuid(),next_scan_at=now(); update private.stage_inactivity_jobs set next_attempt_at=now()`, inactivityFixtureID(501), inactivityFixtureID(401))
			if f.cycle().Notified != 0 || f.count(`select count(*) from private.stage_inactivity_lead_scopes where started_at>now()-interval '1 minute'`) != 1 {
				f.t.Fatal("disabled-period reopen recovered the old historical clock")
			}
		}},
		{"coverage fence bounds partially enrolled history", func(f inactivityPostgresFixture) {
			f.seed(true, InactivityClockLastInteraction, InactivityIncludeOverdue)
			f.exec(`update private.stage_inactivity_policies set interaction_coverage_from=now()`)
			if f.cycle().Notified != 0 || f.count(`select count(*) from private.stage_inactivity_jobs where baseline_at>now()-interval '1 minute'`) != 1 {
				f.t.Fatal("missing historical facts were treated as complete history")
			}
		}},
		{"archived stages cancel pending work", func(f inactivityPostgresFixture) {
			f.seed(true, InactivityClockLastInteraction, InactivityIncludeOverdue)
			f.exec(`update public.leads set assigned_user_id=null`)
			f.cycle()
			f.exec(`update public.stages set is_active=false; update private.stage_inactivity_jobs set next_attempt_at=now()`)
			if f.cycle().Cancelled != 1 {
				f.t.Fatal("archived stage continued a pending alert")
			}
		}},
		{"delivery failure reaches bounded durable destination", testInactivityPostgresRetry},
		{"busy recipient waits without consuming attempts", testInactivityPostgresBusyRecipient},
		{"lead deletion and cascade cannot invert job locks", testInactivityPostgresDeleteLockOrder},
		{"user removal and lead transfer do not invert recipient locks", testInactivityPostgresUserRemovalLockOrder},
		{"two slow failures retain independent durable attempts", testInactivityPostgresSlowFailures},
		{"scan locks are released before notification insertion", testInactivityPostgresScanLockScope},
		{"busy scans cannot starve pending notification jobs", testInactivityPostgresScanFairness},
		{"multiple replicas produce one alert", testInactivityPostgresReplicas},
		{"private tables deny browser roles", testInactivityPostgresPrivateAccess},
		{"missing or wrong index blocks business row work", testInactivityPostgresReadiness},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixture.t = t
			fixture.reset()
			test.run(fixture)
		})
	}
}

func testInactivityPostgresReadiness(f inactivityPostgresFixture) {
	f.seed(true, InactivityClockLastInteraction, InactivityIncludeOverdue)
	f.exec(`drop index public.idx_leads_simple_stage_inactivity_scan`)
	defer f.exec(inactivityFixtureSource(f, "../cutovers/20261013_prepare_simple_stage_inactivity_index.sql"))
	if _, err := f.repo.ProcessStageInactivityOnce(f.ctx); !errors.Is(err, ErrInactivityRuntimeNotReady) {
		f.t.Fatalf("missing index did not fail closed: %v", err)
	}
	f.exec(`create index idx_leads_simple_stage_inactivity_scan on public.leads(organization_id,id) where deal_status='open'`)
	if _, err := f.repo.ProcessStageInactivityOnce(f.ctx); !errors.Is(err, ErrInactivityRuntimeNotReady) {
		f.t.Fatalf("same-named wrong index was accepted: %v", err)
	}
	f.exec(`drop index public.idx_leads_simple_stage_inactivity_scan`)
	if f.count(`select count(*) from private.stage_inactivity_jobs`) != 0 {
		f.t.Fatal("a missing readiness gate allowed business row work")
	}
}

func testInactivityPostgresBusyRecipient(f inactivityPostgresFixture) {
	f.seed(true, InactivityClockLastInteraction, InactivityIncludeOverdue)
	lock, err := f.db.Pool().Begin(f.ctx)
	if err != nil {
		f.t.Fatal(err)
	}
	defer rollbackInactivityTransaction(lock)
	if _, err := lock.Exec(f.ctx, `select 1 from public.organization_members where organization_id=$1::uuid and user_id=$2::uuid for update`, inactivityFixtureID(1), inactivityFixtureID(401)); err != nil {
		f.t.Fatal(err)
	}
	result := f.cycle()
	if result.Waiting != 1 || result.Failed != 0 || f.count(`select count(*) from private.stage_inactivity_jobs where attempts=0 and status='pending' and error_code='recipient_unavailable'`) != 1 {
		f.t.Fatalf("busy recipient consumed an error attempt instead of waiting: %#v", result)
	}
}

func testInactivityPostgresRetry(f inactivityPostgresFixture) {
	f.seed(true, InactivityClockLastInteraction, InactivityIncludeOverdue)
	f.exec(`create function public.fail_synthetic_notification() returns trigger language plpgsql as $$ begin raise exception 'synthetic delivery failure'; end $$; create trigger fail_synthetic before insert on public.notifications for each row execute function public.fail_synthetic_notification()`)
	defer f.exec(`drop trigger fail_synthetic on public.notifications; drop function public.fail_synthetic_notification()`)
	for attempt := 1; attempt <= inactivityMaximumAttempts; attempt++ {
		f.exec(`update private.stage_inactivity_jobs set next_attempt_at=now()`)
		f.cycle()
		if f.count(`select count(*) from private.stage_inactivity_jobs where attempts=$1`, attempt) != 1 {
			f.t.Fatalf("attempt %d did not persist after savepoint rollback", attempt)
		}
	}
	if f.count(`select count(*) from private.stage_inactivity_jobs where status='dead' and error_code='database_error'`) != 1 || f.count(`select count(*) from public.notifications`) != 0 {
		f.t.Fatal("terminal retry state or transactional rollback is incorrect")
	}
	f.exec(`update private.stage_inactivity_policies set revision=revision+1,next_scan_at=now()`)
	f.cycle()
	if f.count(`select count(*) from private.stage_inactivity_jobs where status='dead'`) != 1 {
		f.t.Fatal("periodic scanning silently redrove terminal failure")
	}
}

func testInactivityPostgresReplicas(f inactivityPostgresFixture) {
	f.seed(true, InactivityClockLastInteraction, InactivityIncludeOverdue)
	var workers sync.WaitGroup
	failed := make(chan error, 3)
	for range 3 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			_, err := f.repo.ProcessStageInactivityOnce(f.ctx)
			failed <- err
		}()
	}
	workers.Wait()
	close(failed)
	for err := range failed {
		if err != nil {
			f.t.Fatalf("replica cycle: %v", err)
		}
	}
	if f.count(`select count(*) from public.notifications`) != 1 || f.count(`select count(*) from private.stage_inactivity_jobs`) != 1 {
		f.t.Fatal("multiple replicas duplicated an episode")
	}
}

func testInactivityPostgresPrivateAccess(f inactivityPostgresFixture) {
	f.exec(`grant usage on schema private to anon,authenticated`)
	for _, role := range []string{"anon", "authenticated"} {
		tx, err := f.db.Pool().Begin(f.ctx)
		if err != nil {
			f.t.Fatal(err)
		}
		if _, err := tx.Exec(f.ctx, "set local role "+role); err != nil {
			rollbackInactivityTransaction(tx)
			f.t.Fatal(err)
		}
		_, err = tx.Exec(f.ctx, `select * from private.stage_inactivity_policies`)
		rollbackInactivityTransaction(tx)
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "42501" {
			f.t.Fatalf("browser role %s could access private policy: %v", role, err)
		}
	}
}
