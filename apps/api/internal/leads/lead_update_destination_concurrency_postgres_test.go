package leads

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// These are mandatory when the local fixture is opted in: each cycle runs the
// real Update and proves it does not wait for a new parent/stage after owning the
// lead. The synthetic trigger models a destination changed by automation after
// the ordinary destination resolver; it installs no production migration.
func TestLeadUpdateDestinationLocksLocalPostgres(t *testing.T) {
	f := newLeadUpdateDestinationFixture(t)
	for index, table := range []string{"pipelines", "stages"} {
		t.Run(table+" writer waiting for lead does not form a cycle", func(t *testing.T) {
			ctx, cancel := context.WithTimeout(f.ctx, 10*time.Second)
			defer cancel()
			id, revision := f.seed(t, 750+index)
			before := f.state(t, id)
			barrier, err := f.db.Pool().Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer barrier.Rollback(ctx)
			var barrierPID uint32
			if err := barrier.QueryRow(ctx, `select pg_backend_pid()`).Scan(&barrierPID); err != nil {
				t.Fatal(err)
			}
			if _, err := barrier.Exec(ctx, `select pg_advisory_xact_lock(710201)`); err != nil {
				t.Fatal(err)
			}
			updateOut := make(chan error, 1)
			go func() {
				_, err := f.repo.Update(ctx, f.actor, id, updateInput{ExpectedUpdatedAt: &revision, PipelineID: patchString{Set: true}, Feedback: patchString{Set: true, Value: stringPointer("Must roll back")}, MetadataSet: true, Metadata: map[string]any{"_fixture_wait": true, "_fixture_target": map[string]any{"pipeline": f.otherPipeline, "stage": f.otherStage}}})
				updateOut <- err
			}()
			waitLeadUpdateDestinationLock(t, ctx, f.conn, `select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%update public.leads%' and $1::int=any(pg_blocking_pids(pid)))`, barrierPID)

			writer, err := f.db.Pool().Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer writer.Rollback(ctx)
			var writerPID uint32
			if err := writer.QueryRow(ctx, `select pg_backend_pid()`).Scan(&writerPID); err != nil {
				t.Fatal(err)
			}
			target := f.otherPipeline
			if table == "stages" {
				target = f.otherStage
			}
			if _, err := writer.Exec(ctx, "select id from public."+table+" where id=$1 for no key update", target); err != nil {
				t.Fatal(err)
			}
			writerOut := make(chan error, 1)
			go func() {
				_, err := writer.Exec(ctx, `select id from public.leads where id=$1 for update`, id)
				if err == nil {
					_, err = writer.Exec(ctx, "update public."+table+" set is_active=false where id=$1", target)
				}
				if err == nil {
					err = writer.Commit(ctx)
				}
				writerOut <- err
			}()
			waitLeadUpdateDestinationLock(t, ctx, f.conn, `select exists(select 1 from pg_stat_activity where datname=current_database() and pid=$1::int and wait_event_type='Lock' and query like '%public.leads%' and cardinality(pg_blocking_pids(pid))>0)`, writerPID)
			started := time.Now()
			if err := barrier.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			select {
			case err := <-updateOut:
				if !errors.Is(err, ErrLeadDestinationBusy) {
					t.Fatalf("destination guard must fail fast, not deadlock/timeout/commit: %v", err)
				}
			case <-ctx.Done():
				t.Fatal("Update waited for the structure writer that already waits for its lead")
			}
			if elapsed := time.Since(started); elapsed > 2*time.Second {
				t.Fatalf("NOWAIT destination rejection took %s", elapsed)
			}
			select {
			case err := <-writerOut:
				if err != nil {
					t.Fatalf("rollback failed to release lead for structure writer: %v", err)
				}
			case <-ctx.Done():
				t.Fatal("structure writer did not finish after rejected Update rolled back")
			}
			if after := f.state(t, id); after != before {
				t.Fatal("busy destination committed lead/profile/history/notification/audit changes")
			}
			f.exec(t, "update public."+table+" set is_active=true where id=$1", target)
		})
	}
	t.Run("successful final guard fences parent and stage until commit", func(t *testing.T) {
		id, _ := f.seed(t, 752)
		tx, err := f.db.Pool().Begin(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(f.ctx)
		if _, err := tx.Exec(f.ctx, `select id from public.leads where id=$1 for update`, id); err != nil {
			t.Fatal(err)
		}
		if err := validatePersistedLeadUpdateDestination(f.ctx, tx, f.org, id, updateInput{StageID: patchString{Set: true, Value: &f.open}}); err != nil {
			t.Fatal(err)
		}
		for index, table := range []string{"pipelines", "stages"} {
			other, err := f.db.Pool().Begin(f.ctx)
			if err != nil {
				t.Fatal(err)
			}
			target := []string{f.pipeline, f.open}[index]
			_, err = other.Exec(f.ctx, "select id from public."+table+" where id=$1 for no key update nowait", target)
			other.Rollback(f.ctx)
			var postgresError *pgconn.PgError
			if !errors.As(err, &postgresError) || postgresError.Code != "55P03" {
				t.Fatalf("successful guard did not fence %s: %v", table, err)
			}
		}
		if err := tx.Commit(f.ctx); err != nil {
			t.Fatal(err)
		}
	})
}

func waitLeadUpdateDestinationLock(t *testing.T, ctx context.Context, conn *pgx.Conn, query string, arg any) {
	t.Helper()
	deadline := time.NewTimer(3 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		var waiting bool
		if err := conn.QueryRow(ctx, query, arg).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			return
		}
		select {
		case <-deadline.C:
			t.Fatal("expected lock interleaving was not observed")
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-ticker.C:
		}
	}
}
