package pipelines

import (
	"context"
	"errors"
	"net"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type stageDeletePostgresFixture struct {
	t     *testing.T
	ctx   context.Context
	conn  *pgx.Conn
	db    *dbpkg.Postgres
	repo  Repository
	actor tenant.Context
	base  time.Time
}

func openStageDeletePostgresFixture(t *testing.T) stageDeletePostgresFixture {
	t.Helper()
	ctx, conn := openStageArchivePostgresFixtureWithPrefix(t, "vimob_pipeline_f04_")
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	(stageArchivePostgresFixture{t: t, ctx: ctx, tx: tx}).seed()
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(ctx, `alter table public.stages add column name text not null default 'Original',add column color text default '#123456',
 add column stage_key text default 'synthetic',add column is_won boolean default false,add column is_lost boolean default false,
 add column is_qualified boolean default false,add column updated_at timestamptz not null default now();
 create unique index synthetic_stage_position on public.stages(pipeline_id,position);
 alter table public.cadence_templates add column pipeline_id uuid;
 alter table public.lead_attention_policies add column pipeline_id uuid;
 create table public.leads(id uuid primary key,organization_id uuid not null,stage_id uuid references public.stages(id),pipeline_id uuid);
 create table public.lead_entry_events(organization_id uuid,pipeline_id uuid,stage_id uuid);
 create table public.lead_attention_instances(organization_id uuid,pipeline_id uuid,stage_id uuid);
 create table public.pipeline_sla_settings(pipeline_id uuid,stage_id uuid);
 create table public.team_pipelines(pipeline_id uuid);
 create table public.stage_automations(organization_id uuid,stage_id uuid,target_stage_id uuid);
 create table public.stage_operational_configs(stage_id uuid);`); err != nil {
		t.Fatal(err)
	}
	var ownedDatabase string
	if err := conn.QueryRow(ctx, `select current_database()`).Scan(&ownedDatabase); err != nil || !strings.HasPrefix(ownedDatabase, "vimob_pipeline_f04_") {
		t.Fatal("delete fixture did not select its owned disposable database")
	}
	config := conn.Config()
	poolURL := url.URL{Scheme: "postgres", User: url.User("postgres"), Host: net.JoinHostPort(config.Host, strconv.Itoa(int(config.Port))), Path: "/" + ownedDatabase, RawQuery: "sslmode=disable"}
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: poolURL.String(), MaxConns: 4, HealthTimeout: 2 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(database.Close)
	var actualDatabase string
	if err := database.Pool().QueryRow(ctx, `select current_database()`).Scan(&actualDatabase); err != nil || actualDatabase != ownedDatabase {
		t.Fatal("delete repository pool escaped the owned database")
	}
	return stageDeletePostgresFixture{t: t, ctx: ctx, conn: conn, db: database, repo: NewRepository(database),
		actor: tenant.Context{OrganizationID: stageArchiveFixtureID(1), UserID: stageArchiveFixtureID(10), MemberRole: "admin"},
		base:  time.Date(2100, 1, 1, 0, 0, 0, 123456000, time.UTC)}
}

func (f stageDeletePostgresFixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.conn.Exec(f.ctx, sql, append([]any{pgx.QueryExecModeSimpleProtocol}, args...)...); err != nil {
		f.t.Fatal(err)
	}
}

func (f stageDeletePostgresFixture) count(sql string, args ...any) int {
	f.t.Helper()
	var count int
	if err := f.conn.QueryRow(f.ctx, sql, args...).Scan(&count); err != nil {
		f.t.Fatal(err)
	}
	return count
}

func (f stageDeletePostgresFixture) reset() {
	f.t.Helper()
	f.exec(`truncate public.leads,public.lead_stage_history,public.lead_stage_cycles,public.cadence_templates,
 public.lead_attention_policies,public.lead_entry_events,public.lead_attention_instances,public.pipeline_sla_settings,
 public.team_pipelines,public.stage_automations,public.stage_operational_configs,public.automations,
 public.automation_nodes,public.automation_flow_versions,public.automation_executions;
 insert into public.stages(id,organization_id,pipeline_id,position) values($1,$2,$3,9999) on conflict(id) do nothing;
 update public.stages set position=position+100000 where pipeline_id=$3;
 update public.stages set position=case id when $4 then 1 when $1 then 2 else 0 end where pipeline_id=$3;
 update public.stages set name='Original',is_qualified=false,updated_at=$5`, stageArchiveFixtureID(202), stageArchiveFixtureID(1), stageArchiveFixtureID(101), stageArchiveFixtureID(201), f.base)
}

func TestStageDeleteRevisionLocalPostgres(t *testing.T) {
	f := openStageDeletePostgresFixture(t)
	stageID := stageArchiveFixtureID(202)
	old := deleteStageInput{ExpectedUpdatedAt: f.base}
	t.Run("edit advances future revision and invalidates deletion", func(t *testing.T) {
		f.t = t
		f.reset()
		name := "Current manager name"
		edited, err := f.repo.UpdateStage(f.ctx, f.actor, stageID, updateStageInput{ExpectedUpdatedAt: &f.base, Name: patchString{Set: true, Value: &name}})
		if err != nil || edited.UpdatedAt.Sub(f.base) != time.Microsecond {
			t.Fatalf("edit revision=%s err=%v", edited.UpdatedAt, err)
		}
		if err := f.repo.DeleteStage(f.ctx, f.actor, stageID, old); !errors.Is(err, ErrStagesChanged) {
			t.Fatalf("stale delete=%v", err)
		}
		if f.count(`select count(*) from public.stages where id=$1 and name=$2 and updated_at=$3`, stageID, name, edited.UpdatedAt) != 1 {
			t.Fatal("stale delete removed or changed the current name")
		}
		if err := f.repo.DeleteStage(f.ctx, f.actor, stageID, deleteStageInput{ExpectedUpdatedAt: edited.UpdatedAt}); err != nil {
			t.Fatal(err)
		}
		if f.count(`select count(*) from public.stages where id=$1`, stageID) != 0 || f.count(`select count(*) from public.stages where organization_id=$1`, stageArchiveFixtureID(2)) != 1 {
			t.Fatal("fresh deletion did not remove only the selected tenant stage")
		}
	})
	t.Run("reorder advances existing and omitted archived stages", func(t *testing.T) {
		f.t = t
		f.reset()
		stages, err := f.repo.ReorderStages(f.ctx, f.actor, stageArchiveFixtureID(101), reorderStagesInput{Stages: []stageOrderItem{
			{ID: stageID, Name: "Second", Color: "#123456", StageKey: "second", Position: 0, ExpectedUpdatedAt: &f.base},
			{ID: stageArchiveFixtureID(201), Name: "First", Color: "#123456", StageKey: "first", Position: 1, ExpectedUpdatedAt: &f.base},
		}})
		if err != nil || len(stages) != 3 {
			t.Fatalf("reorder count=%d err=%v", len(stages), err)
		}
		if f.count(`select count(*) from public.stages where pipeline_id=$1 and updated_at=$2`, stageArchiveFixtureID(101), f.base.Add(time.Microsecond)) != 3 {
			t.Fatal("reorder did not advance both requested stages and the omitted archived stage")
		}
		if err := f.repo.DeleteStage(f.ctx, f.actor, stageID, old); !errors.Is(err, ErrStagesChanged) {
			t.Fatalf("stale delete after reorder=%v", err)
		}
	})
	t.Run("qualification advances the former qualified stage", func(t *testing.T) {
		f.t = t
		f.reset()
		f.exec(`update public.stages set is_qualified=true where id=$1`, stageID)
		if _, err := f.repo.UpdateStage(f.ctx, f.actor, stageArchiveFixtureID(201), updateStageInput{ExpectedUpdatedAt: &f.base, IsQualified: newPatchBool(true)}); err != nil {
			t.Fatal(err)
		}
		if f.count(`select count(*) from public.stages where id=$1 and is_qualified=false and updated_at=$2`, stageID, f.base.Add(time.Microsecond)) != 1 {
			t.Fatal("qualification did not invalidate the old sibling revision")
		}
		if err := f.repo.DeleteStage(f.ctx, f.actor, stageID, old); !errors.Is(err, ErrStagesChanged) {
			t.Fatalf("stale delete after qualification=%v", err)
		}
	})
	t.Run("missing exact-microsecond foreign and forbidden requests preserve rows", func(t *testing.T) {
		f.t = t
		f.reset()
		for _, revision := range []time.Time{{}, f.base.Add(time.Microsecond), f.base.Add(-time.Microsecond)} {
			if err := f.repo.DeleteStage(f.ctx, f.actor, stageID, deleteStageInput{ExpectedUpdatedAt: revision}); !errors.Is(err, ErrStagesChanged) {
				t.Fatalf("missing/mismatch delete=%v", err)
			}
		}
		foreign := f.actor
		foreign.OrganizationID = stageArchiveFixtureID(2)
		if err := f.repo.DeleteStage(f.ctx, foreign, stageID, old); !errors.Is(err, ErrStageNotFound) {
			t.Fatalf("foreign stage=%v", err)
		}
		if err := f.repo.DeleteStage(f.ctx, f.actor, stageArchiveFixtureID(999), old); !errors.Is(err, ErrStageNotFound) {
			t.Fatalf("missing stage=%v", err)
		}
		broker := f.actor
		broker.MemberRole = "broker"
		if err := f.repo.DeleteStage(f.ctx, broker, stageID, old); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
			t.Fatalf("forbidden actor=%v", err)
		}
		if f.count(`select count(*) from public.stages`) != 6 {
			t.Fatal("rejected deletion removed a stage")
		}
	})
	t.Run("fresh revision still enforces leads and dependencies", func(t *testing.T) {
		f.t = t
		f.reset()
		f.exec(`insert into public.leads values($1,$2,$3,$4)`, stageArchiveFixtureID(501), f.actor.OrganizationID, stageID, stageArchiveFixtureID(101))
		if err := f.repo.DeleteStage(f.ctx, f.actor, stageID, old); !errors.Is(err, ErrHasLeads) {
			t.Fatalf("lead guard=%v", err)
		}
		f.exec(`delete from public.leads; insert into public.cadence_templates(id,organization_id,stage_id) values($1,$2,$3)`, stageArchiveFixtureID(601), f.actor.OrganizationID, stageID)
		if err := f.repo.DeleteStage(f.ctx, f.actor, stageID, old); !errors.Is(err, ErrHasDependencies) {
			t.Fatalf("dependency guard=%v", err)
		}
		if f.count(`select count(*) from public.stages where id=$1`, stageID) != 1 || f.count(`select count(*) from public.cadence_templates`) != 1 {
			t.Fatal("blocked deletion changed the stage or its dependency")
		}
	})
	t.Run("concurrent deletes sharing a revision have one winner", func(t *testing.T) {
		f.t = t
		f.reset()
		start, results := make(chan struct{}), make(chan error, 2)
		for range 2 {
			go func() {
				<-start
				results <- f.repo.DeleteStage(f.ctx, f.actor, stageID, old)
			}()
		}
		close(start)
		wins, absent := 0, 0
		for range 2 {
			err := <-results
			if err == nil {
				wins++
			} else if errors.Is(err, ErrStageNotFound) {
				absent++
			} else {
				t.Fatal(err)
			}
		}
		if wins != 1 || absent != 1 || f.count(`select count(*) from public.stages where id=$1`, stageID) != 0 {
			t.Fatalf("concurrent deletes wins=%d missing=%d", wins, absent)
		}
	})
}
