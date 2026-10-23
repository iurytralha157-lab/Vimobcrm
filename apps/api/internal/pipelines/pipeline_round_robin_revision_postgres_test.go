package pipelines

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

// Reuses the explicit loopback/postgres-only random owned Pipeline fixture.
// It does not read DATABASE_URL, production configuration or applied migrations.
func TestPipelineRoundRobinRevisionLocalPostgres(t *testing.T) {
	f := openPipelineRevisionFixture(t)
	f.exec(`alter table public.round_robins add column deleted_at timestamptz;
alter table public.pipelines add constraint fixture_default_queue foreign key(default_round_robin_id) references public.round_robins(id) on delete set null;
insert into public.round_robins(id,organization_id,is_active,deleted_at) values
($1,$6,true,null),($2,$6,true,null),($3,$7,true,null),($4,$6,false,null),($5,$6,true,now());`, stageArchiveFixtureID(801), stageArchiveFixtureID(802), stageArchiveFixtureID(803), stageArchiveFixtureID(804), stageArchiveFixtureID(805), f.actor.OrganizationID, stageArchiveFixtureID(2))
	id, first, second := stageArchiveFixtureID(101), stageArchiveFixtureID(801), stageArchiveFixtureID(802)
	set := func(revision string, queue *string) (Pipeline, error) {
		return f.repo.SetDefaultRoundRobin(f.ctx, f.actor, id, setPipelineRoundRobinInput{ExpectedRevision: revision, RoundRobinID: queue})
	}
	t.Run("binding clearing and no-op consume original aggregate revision", func(t *testing.T) {
		before := pipelineRevisionGet(t, f, 101)
		bound, err := set(before.Revision, &first)
		if err != nil || bound.DefaultRoundRobinID != first || bound.Revision == before.Revision || !bound.UpdatedAt.After(before.UpdatedAt) {
			t.Fatalf("bind=%+v error=%v", bound, err)
		}
		if _, err := set(before.Revision, nil); !errors.Is(err, ErrPipelineChanged) {
			t.Fatalf("stale clear=%v", err)
		}
		if got := pipelineRevisionGet(t, f, 101); got.DefaultRoundRobinID != first || got.Revision != bound.Revision {
			t.Fatal("stale confirmation overwrote winner")
		}
		boundAgain, err := set(bound.Revision, &first)
		if err != nil || boundAgain.Revision == bound.Revision || !boundAgain.UpdatedAt.After(bound.UpdatedAt) {
			t.Fatalf("no-op revision=%+v error=%v", boundAgain, err)
		}
		cleared, err := set(boundAgain.Revision, nil)
		if err != nil || cleared.DefaultRoundRobinID != "" || cleared.Revision == boundAgain.Revision {
			t.Fatalf("clear=%+v error=%v", cleared, err)
		}
	})
	t.Run("child-only change invalidates original queue confirmation", func(t *testing.T) {
		before := pipelineRevisionGet(t, f, 101)
		f.exec(`update public.stages set name=name||' changed' where id=$1`, stageArchiveFixtureID(202))
		if _, err := set(before.Revision, &first); !errors.Is(err, ErrPipelineChanged) {
			t.Fatalf("stage-only stale revision=%v", err)
		}
	})
	t.Run("two managers acknowledge exactly one fallback", func(t *testing.T) {
		before := pipelineRevisionGet(t, f, 101)
		start := make(chan struct{})
		out := make(chan error, 2)
		for _, queue := range []string{first, second} {
			go func() { <-start; _, err := set(before.Revision, &queue); out <- err }()
		}
		close(start)
		wins, stale := 0, 0
		for range 2 {
			err := <-out
			if err == nil {
				wins++
			} else if errors.Is(err, ErrPipelineChanged) {
				stale++
			} else {
				t.Fatal(err)
			}
		}
		if wins != 1 || stale != 1 {
			t.Fatalf("wins=%d stale=%d", wins, stale)
		}
	})
	t.Run("foreign inactive deleted and missing queues reject without mutation", func(t *testing.T) {
		for _, queue := range []string{stageArchiveFixtureID(803), stageArchiveFixtureID(804), stageArchiveFixtureID(805), stageArchiveFixtureID(806)} {
			before := pipelineRevisionGet(t, f, 101)
			_, err := set(before.Revision, &queue)
			if !errors.Is(err, ErrInvalidReference) {
				t.Fatalf("invalid queue=%v", err)
			}
			if got := pipelineRevisionGet(t, f, 101); got.Revision != before.Revision || got.DefaultRoundRobinID != before.DefaultRoundRobinID {
				t.Fatal("invalid reference changed pipeline")
			}
			response := httptest.NewRecorder()
			writePipelineError(response, httptest.NewRequest(http.MethodPatch, "/", nil), err)
			if response.Code != 400 || strings.Contains(response.Body.String(), queue) {
				t.Fatal("invalid reference disclosed queue identity")
			}
		}
	})
	t.Run("queue SHARE prevents concurrent tombstone until transaction ends", func(t *testing.T) {
		tx, err := f.db.Pool().Begin(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(f.ctx)
		if err := lockPipelineRoundRobinReference(f.ctx, tx, f.actor.OrganizationID, first); err != nil {
			t.Fatal(err)
		}
		other, err := f.db.Pool().Begin(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer other.Rollback(f.ctx)
		_, err = other.Exec(f.ctx, `select id from public.round_robins where id=$1 for no key update nowait`, first)
		var pg *pgconn.PgError
		if !errors.As(err, &pg) || pg.Code != "55P03" {
			t.Fatalf("queue state not protected: %v", err)
		}
		if err := other.Rollback(f.ctx); err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(f.ctx); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("queue deletion waiting on pipeline does not deadlock fallback CAS", func(t *testing.T) {
		f.exec(`update public.pipelines set default_round_robin_id=$2 where id=$1`, id, first)
		before := pipelineRevisionGet(t, f, 101)
		barrier, err := f.conn.Begin(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer barrier.Rollback(f.ctx)
		if _, err := barrier.Exec(f.ctx, `select id from public.stages where id=$1 for update`, stageArchiveFixtureID(202)); err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(f.ctx, 10*time.Second)
		defer cancel()
		cas := make(chan error, 1)
		go func() {
			_, err := f.repo.SetDefaultRoundRobin(ctx, f.actor, id, setPipelineRoundRobinInput{ExpectedRevision: before.Revision, RoundRobinID: &first})
			cas <- err
		}()
		waitPipelineFixtureLock(t, ctx, barrier, `wait_event_type='Lock' and query like '%order by id for no key update%'`)
		deleter, err := f.db.Pool().Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer deleter.Rollback(f.ctx)
		if _, err := deleter.Exec(ctx, `select id from public.round_robins where id=$1 for update`, first); err != nil {
			t.Fatal(err)
		}
		cleared := make(chan error, 1)
		go func() {
			_, err := deleter.Exec(ctx, `update public.pipelines set default_round_robin_id=null where organization_id=$1 and default_round_robin_id=$2`, f.actor.OrganizationID, first)
			cleared <- err
		}()
		waitPipelineFixtureLock(t, ctx, barrier, `wait_event_type='Lock' and query like '%update public.pipelines set default_round_robin_id=null%'`)
		if err := barrier.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		if err := <-cas; !errors.Is(err, ErrRoundRobinBusy) {
			t.Fatalf("CAS did not release parent on busy queue: %v", err)
		}
		if err := <-cleared; err != nil {
			t.Fatalf("queue deletion failed or deadlocked: %v", err)
		}
		// The delete-side update is still uncommitted. The CAS must have left
		// the original parent fields and aggregate revision entirely untouched.
		if got := pipelineRevisionGet(t, f, 101); got.Revision != before.Revision || got.DefaultRoundRobinID != first {
			t.Fatal("busy CAS changed pipeline before queue deletion committed")
		}
		if err := deleter.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		if got := pipelineRevisionGet(t, f, 101); got.DefaultRoundRobinID != "" {
			t.Fatal("queue deletion did not finish its parent cleanup")
		}
	})
}
