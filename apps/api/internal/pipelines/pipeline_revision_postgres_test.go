package pipelines

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func openPipelineRevisionFixture(t *testing.T) stageDeletePostgresFixture {
	f := openStageDeletePostgresFixture(t)
	f.exec(`alter table public.pipelines add column name text not null default 'Pipeline',
 add column updated_at timestamptz not null default now(),add column default_round_robin_id uuid,add column pool_enabled_at timestamptz;
 create table public.organizations(id uuid primary key);
 insert into public.organizations values($1),($2);
 alter table public.pipelines add constraint fixture_pipeline_org foreign key(organization_id) references public.organizations(id);
 alter table public.stages add constraint fixture_stage_org foreign key(organization_id) references public.organizations(id);
 alter table public.stages alter column id set default gen_random_uuid();
 alter table public.pipelines alter column id set default gen_random_uuid();
 alter table public.stages add constraint fixture_parent foreign key(pipeline_id) references public.pipelines(id) on delete cascade;
 update public.pipelines set pool_enabled_at='2026-10-16T12:00:00.123456Z';`, stageArchiveFixtureID(1), stageArchiveFixtureID(2))
	f.reset()
	return f
}

func pipelineRevisionGet(t *testing.T, f stageDeletePostgresFixture, id int) Pipeline {
	t.Helper()
	p, err := f.repo.Get(f.ctx, f.actor, stageArchiveFixtureID(id))
	if err != nil {
		t.Fatal(err)
	}
	if err := validatePipelineRevision(p.Revision); err != nil {
		t.Fatalf("invalid API revision: %v", err)
	}
	return p
}

func TestPipelineAggregateRevisionLocalPostgres(t *testing.T) {
	f := openPipelineRevisionFixture(t)
	id := stageArchiveFixtureID(101)
	name := "Changed"
	patch := func(revision string) error {
		_, err := f.repo.Update(f.ctx, f.actor, id, updatePipelineInput{ExpectedRevision: revision, Name: patchString{Set: true, Value: &name}})
		return err
	}
	t.Run("same snapshot list and get and timezone", func(t *testing.T) {
		p := pipelineRevisionGet(t, f, 101)
		all, err := f.repo.List(f.ctx, f.actor)
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, listed := range all {
			if listed.ID == id {
				found = true
				if listed.Revision != p.Revision {
					t.Fatal("list/get diverged")
				}
			}
		}
		if !found {
			t.Fatal("pipeline missing")
		}
		tx, err := f.db.Pool().Begin(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(f.ctx)
		if _, err := tx.Exec(f.ctx, `set local timezone='America/Sao_Paulo'`); err != nil {
			t.Fatal(err)
		}
		if err := lockPipelineRevision(f.ctx, tx, f.actor.OrganizationID, id, p.Revision); err != nil {
			t.Fatalf("timezone changed token: %v", err)
		}
	})
	t.Run("every structural mutation invalidates stale edit and delete", func(t *testing.T) {
		for _, mutation := range []struct{ name, sql string }{
			{"one microsecond", `update public.stages set updated_at=updated_at+interval '1 microsecond' where id=$1`},
			{"metadata without parent clock", `update public.stages set name=name||'x' where id=$1`},
			{"archive", `update public.stages set is_active=not is_active where id=$1`},
			{"native flags", `update public.stages set is_won=not is_won where id=$1`},
			{"add", `insert into public.stages(id,organization_id,pipeline_id,position) select '00000000-0000-4000-8000-000000000299',organization_id,pipeline_id,900 from public.stages where id=$1`},
			{"remove", `delete from public.stages where id=$1`},
		} {
			t.Run(mutation.name, func(t *testing.T) {
				f.exec(`delete from public.stages where id='00000000-0000-4000-8000-000000000299'`)
				f.reset()
				before := pipelineRevisionGet(t, f, 101)
				f.exec(mutation.sql, stageArchiveFixtureID(202))
				after := pipelineRevisionGet(t, f, 101)
				if after.Revision == before.Revision || !after.UpdatedAt.Equal(before.UpdatedAt) {
					t.Fatal("aggregate did not fence child-only mutation")
				}
				if err := patch(before.Revision); !errors.Is(err, ErrPipelineChanged) {
					t.Fatalf("stale edit=%v", err)
				}
				if err := f.repo.Delete(f.ctx, f.actor, id, deletePipelineInput{ExpectedRevision: before.Revision}); !errors.Is(err, ErrPipelineChanged) {
					t.Fatalf("stale delete=%v", err)
				}
			})
		}
	})
	t.Run("actual stage writer reorder and creation invalidate token", func(t *testing.T) {
		f.reset()
		before := pipelineRevisionGet(t, f, 101)
		stageName := "Stage edit"
		if _, err := f.repo.UpdateStage(f.ctx, f.actor, stageArchiveFixtureID(202), updateStageInput{ExpectedUpdatedAt: &f.base, Name: patchString{Set: true, Value: &stageName}}); err != nil {
			t.Fatal(err)
		}
		if err := patch(before.Revision); !errors.Is(err, ErrPipelineChanged) {
			t.Fatal(err)
		}
		before = pipelineRevisionGet(t, f, 101)
		stages, err := f.repo.ListStages(f.ctx, f.actor, id)
		if err != nil {
			t.Fatal(err)
		}
		items := []stageOrderItem{}
		for i := len(stages) - 1; i >= 0; i-- {
			stage := stages[i]
			if !stage.IsActive {
				continue
			}
			revision := stage.UpdatedAt
			items = append(items, stageOrderItem{ID: stage.ID, Name: stage.Name, Color: stage.Color, StageKey: stage.StageKey, Position: len(items), ExpectedUpdatedAt: &revision})
		}
		if _, err := f.repo.ReorderStages(f.ctx, f.actor, id, reorderStagesInput{Stages: items}); err != nil {
			t.Fatal(err)
		}
		if err := patch(before.Revision); !errors.Is(err, ErrPipelineChanged) {
			t.Fatal(err)
		}
		before = pipelineRevisionGet(t, f, 101)
		if _, err := f.repo.CreateStage(f.ctx, f.actor, id, createStageInput{Name: "Fresh", Color: "#123456"}); err != nil {
			t.Fatal(err)
		}
		if err := patch(before.Revision); !errors.Is(err, ErrPipelineChanged) {
			t.Fatal(err)
		}
	})
	t.Run("future parent no-op consumes revision and exact microsecond", func(t *testing.T) {
		f.exec(`update public.pipelines set name='Changed',updated_at=$1 where id=$2`, f.base, id)
		before := pipelineRevisionGet(t, f, 101)
		if err := patch(before.Revision); err != nil {
			t.Fatal(err)
		}
		after := pipelineRevisionGet(t, f, 101)
		if after.Revision == before.Revision || after.UpdatedAt.Sub(before.UpdatedAt) != time.Microsecond {
			t.Fatalf("no-op did not consume exact revision: %s→%s", before.UpdatedAt, after.UpdatedAt)
		}
		if err := patch(before.Revision); !errors.Is(err, ErrPipelineChanged) {
			t.Fatal(err)
		}
	})
	t.Run("two managers have one winner", func(t *testing.T) {
		before := pipelineRevisionGet(t, f, 101)
		start := make(chan struct{})
		out := make(chan error, 2)
		var wg sync.WaitGroup
		for range 2 {
			wg.Add(1)
			go func() { defer wg.Done(); <-start; out <- patch(before.Revision) }()
		}
		close(start)
		wg.Wait()
		close(out)
		win, stale := 0, 0
		for err := range out {
			if err == nil {
				win++
			} else if errors.Is(err, ErrPipelineChanged) {
				stale++
			} else {
				t.Fatal(err)
			}
		}
		if win != 1 || stale != 1 {
			t.Fatalf("wins=%d stale=%d", win, stale)
		}
	})
	t.Run("routing and replacement default writers consume revisions", func(t *testing.T) {
		before := pipelineRevisionGet(t, f, 101)
		updated, err := f.repo.SetDefaultRoundRobin(f.ctx, f.actor, id, setPipelineRoundRobinInput{ExpectedRevision: before.Revision})
		if err != nil || updated.Revision == before.Revision || updated.UpdatedAt.Sub(before.UpdatedAt) != time.Microsecond {
			t.Fatalf("RR no-op failed revision fence: %+v %v", updated, err)
		}
		before = updated
		inactive := pipelineRevisionGet(t, f, 104)
		if err := f.repo.Delete(f.ctx, f.actor, inactive.ID, deletePipelineInput{ExpectedRevision: inactive.Revision}); err != nil {
			t.Fatal(err)
		}
		updated = pipelineRevisionGet(t, f, 101)
		if !updated.IsDefault || updated.Revision == before.Revision || updated.UpdatedAt.Sub(before.UpdatedAt) != time.Microsecond {
			t.Fatalf("replacement default did not consume revision: %+v", updated)
		}
	})
	t.Run("new pipeline returns revision and changes prior default token", func(t *testing.T) {
		before := pipelineRevisionGet(t, f, 101)
		created, err := f.repo.Create(f.ctx, f.actor, createPipelineInput{Name: "New default", IsDefault: true})
		if err != nil {
			t.Fatal(err)
		}
		if err := validatePipelineRevision(created.Revision); err != nil || !created.IsDefault {
			t.Fatalf("created pipeline response=%+v err=%v", created, err)
		}
		after := pipelineRevisionGet(t, f, 101)
		if after.IsDefault || after.Revision == before.Revision || after.UpdatedAt.Sub(before.UpdatedAt) != time.Microsecond {
			t.Fatal("new default did not invalidate previous default")
		}
	})
	t.Run("two simultaneous deletions remove only one selected pipeline", func(t *testing.T) {
		p := pipelineRevisionGet(t, f, 103)
		start := make(chan struct{})
		out := make(chan error, 2)
		for range 2 {
			go func() {
				<-start
				out <- f.repo.Delete(f.ctx, f.actor, p.ID, deletePipelineInput{ExpectedRevision: p.Revision})
			}()
		}
		close(start)
		win, missing := 0, 0
		for range 2 {
			err := <-out
			if err == nil {
				win++
			} else if errors.Is(err, ErrPipelineNotFound) {
				missing++
			} else {
				t.Fatal(err)
			}
		}
		if win != 1 || missing != 1 {
			t.Fatalf("delete wins=%d missing=%d", win, missing)
		}
	})
	t.Run("concurrent default creation stays serialized", func(t *testing.T) {
		start := make(chan struct{})
		out := make(chan error, 2)
		for range 2 {
			go func() {
				<-start
				_, err := f.repo.Create(f.ctx, f.actor, createPipelineInput{Name: "Concurrent default", IsDefault: true})
				out <- err
			}()
		}
		close(start)
		for range 2 {
			if err := <-out; err != nil {
				t.Fatal(err)
			}
		}
		if f.count(`select count(*) from public.pipelines where organization_id=$1 and is_active and is_default`, f.actor.OrganizationID) != 1 {
			t.Fatal("concurrent creators lost single default invariant")
		}
	})
	t.Run("notfound tenant and permission fences", func(t *testing.T) {
		before := pipelineRevisionGet(t, f, 101)
		other := f.actor
		other.OrganizationID = stageArchiveFixtureID(2)
		if _, err := f.repo.Update(f.ctx, other, id, updatePipelineInput{ExpectedRevision: before.Revision, Name: patchString{Set: true, Value: &name}}); !errors.Is(err, ErrPipelineNotFound) {
			t.Fatal(err)
		}
		if err := f.repo.Delete(f.ctx, other, id, deletePipelineInput{ExpectedRevision: before.Revision}); !errors.Is(err, ErrPipelineNotFound) {
			t.Fatal(err)
		}
		other = f.actor
		other.MemberRole = "broker"
		if err := f.repo.Delete(f.ctx, other, id, deletePipelineInput{ExpectedRevision: before.Revision}); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
			t.Fatal(err)
		}
		if err := f.repo.Delete(f.ctx, f.actor, stageArchiveFixtureID(999), deletePipelineInput{ExpectedRevision: before.Revision}); !errors.Is(err, ErrPipelineNotFound) {
			t.Fatal(err)
		}
	})
	t.Run("fresh deletion keeps dependency and lead guards", func(t *testing.T) {
		p := pipelineRevisionGet(t, f, 102)
		f.exec(`insert into public.leads values($1,$2,$3,$4)`, stageArchiveFixtureID(301), f.actor.OrganizationID, stageArchiveFixtureID(203), p.ID)
		if err := f.repo.Delete(f.ctx, f.actor, p.ID, deletePipelineInput{ExpectedRevision: p.Revision}); !errors.Is(err, ErrHasLeads) {
			t.Fatal(err)
		}
		f.exec(`truncate public.leads;insert into public.cadence_templates(id,organization_id,stage_id,pipeline_id) values($1,$2,$3,$4)`, stageArchiveFixtureID(302), f.actor.OrganizationID, stageArchiveFixtureID(203), p.ID)
		if err := f.repo.Delete(f.ctx, f.actor, p.ID, deletePipelineInput{ExpectedRevision: p.Revision}); !errors.Is(err, ErrHasDependencies) {
			t.Fatal(err)
		}
		f.exec(`truncate public.cadence_templates`)
		if err := f.repo.Delete(f.ctx, f.actor, p.ID, deletePipelineInput{ExpectedRevision: p.Revision}); err != nil {
			t.Fatal(err)
		}
		if f.count(`select count(*) from public.pipelines where id=$1`, p.ID) != 0 || f.count(`select count(*) from public.pipelines where organization_id=$1`, stageArchiveFixtureID(2)) != 1 {
			t.Fatal("fresh delete crossed tenant or failed")
		}
	})
}

// An uncommitted child edit holds its real row lock. The CAS transaction must
// wait, then read the committed version, rather than compare its old snapshot.
func TestPipelineRevisionWaitsForCommittedStageEditLocalPostgres(t *testing.T) {
	f := openPipelineRevisionFixture(t)
	id := stageArchiveFixtureID(101)
	before := pipelineRevisionGet(t, f, 101)
	tx, err := f.conn.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(f.ctx)
	if _, err := tx.Exec(f.ctx, `update public.stages set name='Concurrent' where id=$1`, stageArchiveFixtureID(202)); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(f.ctx, 5*time.Second)
	defer cancel()
	out := make(chan error, 1)
	go func() { out <- f.repo.Delete(ctx, f.actor, id, deletePipelineInput{ExpectedRevision: before.Revision}) }()
	// Observe the real blocking edge, without sleeping or racing a timer.
	for {
		var waiting bool
		if _, err := tx.Exec(ctx, `select pg_stat_clear_snapshot()`); err != nil {
			t.Fatal(err)
		}
		if err := tx.QueryRow(ctx, `select exists(select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock' and query like '%order by id for no key update%')`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		select {
		case err := <-out:
			t.Fatalf("CAS completed before child commit: %v", err)
		default:
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-out; !errors.Is(err, ErrPipelineChanged) {
		t.Fatalf("post-wait stale delete=%v", err)
	}
	if pipelineRevisionGet(t, f, 101).Revision == before.Revision {
		t.Fatal("committed child edit did not change revision")
	}
}
