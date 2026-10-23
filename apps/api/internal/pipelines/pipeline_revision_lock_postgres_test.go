package pipelines

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// A test-only advisory barrier pauses the real CreateStage INSERT after its
// parent lock and before its FK checks. CAS must serialize without taking an
// organization lock that prevents that earlier writer's FK KEY SHARE check.
func TestPipelineRevisionAndStageCreationLockOrderLocalPostgres(t *testing.T) {
	f := openPipelineRevisionFixture(t)
	before := pipelineRevisionGet(t, f, 101)
	f.exec(`create function public.fixture_stage_insert_gate() returns trigger language plpgsql as $$
 begin perform pg_advisory_xact_lock(710016);return new;end $$;
 create trigger fixture_stage_insert_gate before insert on public.stages for each row execute function public.fixture_stage_insert_gate();`)
	gate, err := f.conn.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer gate.Rollback(f.ctx)
	if _, err := gate.Exec(f.ctx, `select pg_advisory_xact_lock(710016)`); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(f.ctx, 10*time.Second)
	defer cancel()
	created := make(chan error, 1)
	go func() {
		_, err := f.repo.CreateStage(ctx, f.actor, before.ID, createStageInput{Name: "Concurrent child", Color: "#123456"})
		created <- err
	}()
	waitPipelineFixtureLock(t, ctx, gate, `wait_event_type='Lock' and wait_event='advisory' and query like '%insert into public.stages%'`)
	changed := make(chan error, 1)
	go func() {
		name := "Obsolete confirmation"
		_, err := f.repo.Update(ctx, f.actor, before.ID, updatePipelineInput{ExpectedRevision: before.Revision, Name: patchString{Set: true, Value: &name}})
		changed <- err
	}()
	waitPipelineFixtureLock(t, ctx, gate, `wait_event_type='Lock' and query like '%from public.pipelines%' and query like '%for update%'`)
	if err := gate.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-created; err != nil {
		t.Fatalf("real stage creation failed or deadlocked: %v", err)
	}
	if err := <-changed; !errors.Is(err, ErrPipelineChanged) {
		t.Fatalf("post-create obsolete CAS=%v", err)
	}
	if f.count(`select count(*) from public.stages where pipeline_id=$1 and name='Concurrent child'`, before.ID) != 1 {
		t.Fatal("concurrent stage was lost")
	}
}

func waitPipelineFixtureLock(t *testing.T, ctx context.Context, tx pgx.Tx, condition string) {
	t.Helper()
	for {
		// Clear PostgreSQL's statistics snapshot inside the barrier transaction.
		if _, err := tx.Exec(ctx, `select pg_stat_clear_snapshot()`); err != nil {
			t.Fatal(err)
		}
		var waiting bool
		if err := tx.QueryRow(ctx, `select exists(select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and `+condition+`)`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			return
		}
	}
}

// This uses the same source-stage FOR UPDATE followed by target_stage_id FK
// write as stageconfig, without importing that domain's private request DTO.
// IDs ensure CAS has acquired target 201 before waiting for source 202.
func TestPipelineRevisionAndAutomationTargetFKLockOrderLocalPostgres(t *testing.T) {
	f := openPipelineRevisionFixture(t)
	f.exec(`alter table public.stage_automations add constraint fixture_automation_source foreign key(stage_id) references public.stages(id),
 add constraint fixture_automation_target foreign key(target_stage_id) references public.stages(id);`)
	before := pipelineRevisionGet(t, f, 101)
	source, err := f.conn.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer source.Rollback(f.ctx)
	if _, err := source.Exec(f.ctx, `select id from public.stages where id=$1 for update`, stageArchiveFixtureID(202)); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(f.ctx, 10*time.Second)
	defer cancel()
	out := make(chan error, 1)
	go func() {
		out <- f.repo.Delete(ctx, f.actor, before.ID, deletePipelineInput{ExpectedRevision: before.Revision})
	}()
	waitPipelineFixtureLock(t, ctx, source, `wait_event_type='Lock' and query like '%order by id for no key update%'`)
	if _, err := source.Exec(ctx, `insert into public.stage_automations(organization_id,stage_id,target_stage_id) values($1,$2,$3)`,
		f.actor.OrganizationID, stageArchiveFixtureID(202), stageArchiveFixtureID(201)); err != nil {
		t.Fatalf("automation FK write failed or deadlocked: %v", err)
	}
	if err := source.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-out; !errors.Is(err, ErrHasDependencies) {
		t.Fatalf("fresh CAS did not preserve newly committed automation dependency: %v", err)
	}
	if f.count(`select count(*) from public.stage_automations where stage_id=$1 and target_stage_id=$2`, stageArchiveFixtureID(202), stageArchiveFixtureID(201)) != 1 {
		t.Fatal("automation source/target dependency lost")
	}
	if f.count(`select count(*) from public.pipelines where id=$1`, before.ID) != 1 {
		t.Fatal("pipeline deleted despite dependency")
	}
}
