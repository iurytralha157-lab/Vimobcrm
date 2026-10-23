package pipelines

import (
	"errors"
	"net"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// Uses the production repository/locks in a generated owned database. The
// parent fixture's opt-in, loopback/admin validation and cleanup remain required.
func TestStageUpdateRevisionPostgres(t *testing.T) {
	ctx, conn := openStageArchivePostgresFixtureWithPrefix(t, "vimob_pipeline_f04_")
	if _, err := conn.Exec(ctx, `alter table public.stages
	  add column name text not null default 'Synthetic stage', add column color text default '#123456',
	  add column stage_key text default 'synthetic', add column is_won boolean default false,
	  add column is_lost boolean default false, add column is_qualified boolean default false,
	  add column updated_at timestamptz not null default now()`); err != nil {
		t.Fatal(err)
	}
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	(stageArchivePostgresFixture{t: t, ctx: ctx, tx: tx}).seed()
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var ownedDatabase string
	if err := conn.QueryRow(ctx, `select current_database()`).Scan(&ownedDatabase); err != nil || !strings.HasPrefix(ownedDatabase, "vimob_pipeline_f04_") {
		t.Fatal("repository fixture requires the generated F04 database")
	}
	config := conn.Config()
	// pgx.Config.ConnString retains the originally parsed admin DSN even after
	// Database changes; construct a fresh URL and verify the pool before writes.
	poolURL := url.URL{Scheme: "postgres", User: url.User("postgres"), Host: net.JoinHostPort(config.Host, strconv.Itoa(int(config.Port))), Path: "/" + ownedDatabase, RawQuery: "sslmode=disable"}
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: poolURL.String(), MaxConns: 4, HealthTimeout: 2 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(database.Close) // Registered last: close pool before owned DB cleanup.
	var poolDatabase string
	if err := database.Pool().QueryRow(ctx, `select current_database()`).Scan(&poolDatabase); err != nil || poolDatabase != ownedDatabase {
		t.Fatal("repository pool must remain inside the generated owned F04 database")
	}
	repo := NewRepository(database)
	actor := tenant.Context{OrganizationID: stageArchiveFixtureID(1), UserID: stageArchiveFixtureID(10), MemberRole: "admin"}
	base := time.Date(2026, 10, 16, 12, 0, 0, 123456000, time.UTC)
	reset := func() {
		t.Helper()
		if _, err := conn.Exec(ctx, `update public.stages set name='Original',color='#123456',is_qualified=(id=$1),updated_at=$2`, stageArchiveFixtureID(201), base); err != nil {
			t.Fatal(err)
		}
	}
	t.Run("stale name and qualification cannot undo another manager", func(t *testing.T) {
		reset()
		if _, err := repo.UpdateStage(ctx, actor, stageArchiveFixtureID(202), updateStageInput{ExpectedUpdatedAt: &base, IsQualified: newPatchBool(true)}); err != nil {
			t.Fatal(err)
		}
		name := "Stale overwrite"
		if _, err := repo.UpdateStage(ctx, actor, stageArchiveFixtureID(201), updateStageInput{ExpectedUpdatedAt: &base, Name: patchString{Set: true, Value: &name}, IsQualified: newPatchBool(true)}); !errors.Is(err, ErrStagesChanged) {
			t.Fatalf("stale manager should conflict: %v", err)
		}
		var nameA string
		var qualifiedA, qualifiedB bool
		var revisionA time.Time
		if err := conn.QueryRow(ctx, `select a.name,a.is_qualified,b.is_qualified,a.updated_at from public.stages a join public.stages b on b.id=$2 where a.id=$1`, stageArchiveFixtureID(201), stageArchiveFixtureID(202)).Scan(&nameA, &qualifiedA, &qualifiedB, &revisionA); err != nil {
			t.Fatal(err)
		}
		if nameA != "Original" || qualifiedA || !qualifiedB {
			t.Fatalf("stale edit mutated qualification/name: %s %t %t", nameA, qualifiedA, qualifiedB)
		}
		name = "Fresh rename"
		updated, err := repo.UpdateStage(ctx, actor, stageArchiveFixtureID(201), updateStageInput{ExpectedUpdatedAt: &revisionA, Name: patchString{Set: true, Value: &name}})
		if err != nil || updated.Name != name || updated.IsQualified || updated.Color != "#123456" {
			t.Fatalf("fresh dirty-only patch failed: %+v %v", updated, err)
		}
	})
	t.Run("one microsecond and foreign tenant are rejected", func(t *testing.T) {
		reset()
		if _, err := conn.Exec(ctx, `update public.stages set updated_at=$1 where id=$2`, base.Add(time.Microsecond), stageArchiveFixtureID(201)); err != nil {
			t.Fatal(err)
		}
		name := "Never persisted"
		patch := updateStageInput{ExpectedUpdatedAt: &base, Name: patchString{Set: true, Value: &name}}
		if _, err := repo.UpdateStage(ctx, actor, stageArchiveFixtureID(201), patch); !errors.Is(err, ErrStagesChanged) {
			t.Fatalf("microsecond conflict lost: %v", err)
		}
		foreignActor := actor
		foreignActor.OrganizationID = stageArchiveFixtureID(2)
		if _, err := repo.UpdateStage(ctx, foreignActor, stageArchiveFixtureID(201), patch); !errors.Is(err, ErrStageNotFound) {
			t.Fatalf("foreign stage must be hidden: %v", err)
		}
	})
	t.Run("concurrent same-base renames have exactly one winner", func(t *testing.T) {
		reset()
		start, results := make(chan struct{}), make(chan error, 2)
		for _, name := range []string{"First manager", "Second manager"} {
			go func(name string) {
				<-start
				_, err := repo.UpdateStage(ctx, actor, stageArchiveFixtureID(201), updateStageInput{ExpectedUpdatedAt: &base, Name: patchString{Set: true, Value: &name}})
				results <- err
			}(name)
		}
		close(start)
		wins, conflicts := 0, 0
		for range 2 {
			err := <-results
			if err == nil {
				wins++
			} else if errors.Is(err, ErrStagesChanged) {
				conflicts++
			} else {
				t.Fatal(err)
			}
		}
		if wins != 1 || conflicts != 1 {
			t.Fatalf("concurrent results: wins=%d conflicts=%d", wins, conflicts)
		}
	})
}
