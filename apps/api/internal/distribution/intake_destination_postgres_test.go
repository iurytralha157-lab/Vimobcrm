package distribution

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

func intakeDestinationPostgresConfig(dsn string) (*pgx.ConnConfig, error) {
	invalid := errors.New("intake destination tests require explicit disposable loopback postgres/postgres")
	u, err := url.Parse(dsn)
	local := func(host string) bool { return host == "127.0.0.1" || host == "localhost" || host == "::1" }
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.User == nil || u.User.Username() != "postgres" || u.Path != "/postgres" || !local(u.Hostname()) {
		return nil, invalid
	}
	c, err := pgx.ParseConfig(dsn)
	if err != nil || c.User != "postgres" || c.Database != "postgres" || !local(c.Host) {
		return nil, invalid
	}
	for _, fallback := range c.Fallbacks {
		if !local(fallback.Host) {
			return nil, invalid
		}
	}
	return c, nil
}

func openIntakeDestinationPostgres(t *testing.T) (context.Context, *pgxpool.Pool, *pgx.Conn) {
	t.Helper()
	if os.Getenv("VIMOB_RUN_INTAKE_DESTINATION_DB_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("opt in to the owned disposable intake destination database")
	}
	dsn := strings.TrimSpace(os.Getenv("INTAKE_DESTINATION_TEST_DATABASE_URL"))
	config, err := intakeDestinationPostgresConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Minute)
	t.Cleanup(cancel)
	admin, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		t.Fatal("connect explicitly selected local postgres")
	}
	var database, role string
	if err := admin.QueryRow(ctx, "select current_database(),current_user").Scan(&database, &role); err != nil || database != "postgres" || role != "postgres" {
		admin.Close(ctx)
		t.Fatal("effective local admin scope mismatch")
	}
	var suffix [6]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		admin.Close(ctx)
		t.Fatal(err)
	}
	name := "vimob_intake_destination_" + hex.EncodeToString(suffix[:])
	quoted := pgx.Identifier{name}.Sanitize()
	if _, err := admin.Exec(ctx, "create database "+quoted); err != nil {
		admin.Close(ctx)
		t.Fatal(err)
	}
	var pool *pgxpool.Pool
	var conn *pgx.Conn
	t.Cleanup(func() {
		cleanup, done := context.WithTimeout(context.Background(), 30*time.Second)
		defer done()
		if pool != nil {
			pool.Close()
		}
		if conn != nil {
			conn.Close(cleanup)
		}
		if _, err := admin.Exec(cleanup, "drop database "+quoted); err != nil {
			t.Errorf("drop owned fixture: %v", err)
		}
		admin.Close(cleanup)
	})
	ownedURL, _ := url.Parse(dsn)
	ownedURL.Path = "/" + name
	ownedConfig, err := pgx.ParseConfig(ownedURL.String())
	if err != nil || ownedConfig.Database != name || ownedConfig.Host != config.Host || ownedConfig.User != config.User {
		t.Fatal("owned database scope drift")
	}
	conn, err = pgx.ConnectConfig(ctx, ownedConfig)
	if err != nil {
		t.Fatal(err)
	}
	pool, err = pgxpool.New(ctx, ownedURL.String())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(ctx, `create table public.pipelines(id uuid primary key,organization_id uuid not null,is_active boolean default true);
create table public.stages(id uuid primary key,organization_id uuid not null,pipeline_id uuid references public.pipelines(id),is_active boolean default true);
create table public.leads(id uuid primary key,organization_id uuid not null,pipeline_id uuid references public.pipelines(id),stage_id uuid references public.stages(id));
create table public.lead_entry_events(lead_id uuid);create table public.notifications(lead_id uuid);
insert into public.pipelines(id,organization_id) values('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111'),('55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111');
insert into public.stages(id,organization_id,pipeline_id) values('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333');`); err != nil {
		t.Fatal(err)
	}
	return ctx, pool, conn
}

func TestIntakeDestinationPostgresRejectsUnsafeTarget(t *testing.T) {
	for _, dsn := range []string{"", "postgres://postgres@example.test/postgres", "postgres://other@127.0.0.1/postgres", "postgres://postgres@127.0.0.1/shared", "postgres://postgres@127.0.0.1/postgres?host=example.test", "postgres://postgres@127.0.0.1/postgres?dbname=shared"} {
		if _, err := intakeDestinationPostgresConfig(dsn); err == nil {
			t.Fatal("unsafe target accepted before connect")
		}
	}
}

func TestIntakeDestinationLocalPostgres(t *testing.T) {
	ctx, pool, conn := openIntakeDestinationPostgres(t)
	org, pipeline, stage, empty := "11111111-1111-4111-8111-111111111111", "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444", "55555555-5555-4555-8555-555555555555"
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := conn.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	t.Run("effective invalid intake rolls back lead entries and notifications", func(t *testing.T) {
		for _, scenario := range []struct {
			name            string
			pipeline, stage any
			valid           bool
		}{
			{"empty selected pipeline", empty, nil, false}, {"missing parent", nil, stage, false}, {"wrong parent stage", empty, stage, false}, {"intentionally unscoped", nil, nil, true}, {"valid selected destination", pipeline, stage, true},
		} {
			t.Run(scenario.name, func(t *testing.T) {
				tx, err := pool.Begin(ctx)
				if err != nil {
					t.Fatal(err)
				}
				defer tx.Rollback(ctx)
				var lead string
				if err := tx.QueryRow(ctx, `insert into public.leads values(gen_random_uuid(),$1,$2,$3) returning id::text`, org, scenario.pipeline, scenario.stage).Scan(&lead); err != nil {
					t.Fatal(err)
				}
				if _, err := tx.Exec(ctx, `insert into public.lead_entry_events values($1)`, lead); err != nil {
					t.Fatal(err)
				}
				if _, err := tx.Exec(ctx, `insert into public.notifications values($1)`, lead); err != nil {
					t.Fatal(err)
				}
				err = ValidatePersistedIntakeDestination(ctx, tx, org, lead)
				if (err == nil) != scenario.valid {
					t.Fatalf("destination guard=%v", err)
				}
				if !scenario.valid && !errors.Is(err, ErrIntakeDestinationUnavailable) {
					t.Fatal(err)
				}
				if scenario.valid {
					if err := tx.Commit(ctx); err != nil {
						t.Fatal(err)
					}
				} else {
					if err := tx.Rollback(ctx); err != nil {
						t.Fatal(err)
					}
				}
				for _, table := range []string{"leads", "lead_entry_events", "notifications"} {
					key := "lead_id"
					if table == "leads" {
						key = "id"
					}
					var count int
					if err := conn.QueryRow(ctx, "select count(*) from public."+table+" where "+key+"=$1::uuid", lead).Scan(&count); err != nil {
						t.Fatal(err)
					}
					if (count == 1) != scenario.valid {
						t.Fatalf("partial committed %s=%d", table, count)
					}
				}
			})
		}
	})
	t.Run("foreign inactive and wrong parent references are rejected", func(t *testing.T) {
		for _, target := range []struct{ org, pipeline, stage string }{{"22222222-2222-4222-8222-222222222222", pipeline, stage}, {org, empty, stage}} {
			if err := LockIntakePipelineDestination(ctx, pool, target.org, &target.pipeline, &target.stage); !errors.Is(err, ErrIntakeDestinationUnavailable) {
				t.Fatalf("scope bypass=%v", err)
			}
		}
		exec("update public.stages set is_active=false where id=$1", stage)
		if err := LockIntakePipelineDestination(ctx, pool, org, &pipeline, &stage); !errors.Is(err, ErrIntakeDestinationUnavailable) {
			t.Fatal(err)
		}
		exec("update public.stages set is_active=true where id=$1", stage)
		exec("update public.pipelines set is_active=false where id=$1", pipeline)
		if err := LockIntakePipelineDestination(ctx, pool, org, &pipeline, &stage); !errors.Is(err, ErrIntakeDestinationUnavailable) {
			t.Fatal(err)
		}
		exec("update public.pipelines set is_active=true where id=$1", pipeline)
	})
	t.Run("guard keeps parent and stage active until commit", func(t *testing.T) {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(ctx)
		if err := LockIntakePipelineDestination(ctx, tx, org, &pipeline, &stage); err != nil {
			t.Fatal(err)
		}
		for _, table := range []string{"pipelines", "stages"} {
			other, err := pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			id := pipeline
			if table == "stages" {
				id = stage
			}
			_, err = other.Exec(ctx, "select id from public."+table+" where id=$1 for no key update nowait", id)
			var pg *pgconn.PgError
			if !errors.As(err, &pg) || pg.Code != "55P03" {
				t.Fatalf("archive lock not fenced: %v", err)
			}
			other.Rollback(ctx)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		exec("update public.stages set is_active=false where id=$1", stage)
		exec("update public.stages set is_active=true where id=$1", stage)
	})
	t.Run("archive committed while guard waits is rechecked", func(t *testing.T) {
		archiver, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer archiver.Rollback(ctx)
		if _, err := archiver.Exec(ctx, "update public.stages set is_active=false where id=$1", stage); err != nil {
			t.Fatal(err)
		}
		operation, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		out := make(chan error, 1)
		go func() {
			tx, err := pool.Begin(operation)
			if err == nil {
				defer tx.Rollback(operation)
				err = LockIntakePipelineDestination(operation, tx, org, &pipeline, &stage)
			}
			out <- err
		}()
		waitIntakeDestinationLock(t, operation, conn, "%public.stages%")
		if err := archiver.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		if err := <-out; !errors.Is(err, ErrIntakeDestinationUnavailable) {
			t.Fatalf("obsolete active stage accepted: %v", err)
		}
		exec("update public.stages set is_active=true where id=$1", stage)
	})
	t.Run("deleted stage committed while guard waits is rechecked", func(t *testing.T) {
		deletedStage := "66666666-6666-4666-8666-666666666666"
		exec("insert into public.stages(id,organization_id,pipeline_id) values($1,$2,$3)", deletedStage, org, pipeline)
		deleter, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer deleter.Rollback(ctx)
		if _, err := deleter.Exec(ctx, "delete from public.stages where id=$1", deletedStage); err != nil {
			t.Fatal(err)
		}
		operation, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		out := make(chan error, 1)
		go func() {
			tx, err := pool.Begin(operation)
			if err == nil {
				defer tx.Rollback(operation)
				err = LockIntakePipelineDestination(operation, tx, org, &pipeline, &deletedStage)
			}
			out <- err
		}()
		waitIntakeDestinationLock(t, operation, conn, "%public.stages%")
		if err := deleter.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		if err := <-out; !errors.Is(err, ErrIntakeDestinationUnavailable) {
			t.Fatalf("deleted stage accepted: %v", err)
		}
	})
	t.Run("post insert trigger destination is checked and rolled back", func(t *testing.T) {
		exec(`create function public.fixture_empty_intake_stage() returns trigger language plpgsql as $$
begin if current_setting('fixture.empty_intake_stage',true)='yes' then new.stage_id:=null;end if;return new;end $$;
create trigger fixture_empty_intake_stage before insert on public.leads for each row execute function public.fixture_empty_intake_stage();`)
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(ctx)
		if _, err := tx.Exec(ctx, `select set_config('fixture.empty_intake_stage','yes',true)`); err != nil {
			t.Fatal(err)
		}
		var lead string
		if err := tx.QueryRow(ctx, `insert into public.leads values(gen_random_uuid(),$1,$2,$3) returning id::text`, org, pipeline, stage).Scan(&lead); err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, `insert into public.lead_entry_events values($1)`, lead); err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, `insert into public.notifications values($1)`, lead); err != nil {
			t.Fatal(err)
		}
		if err := ValidatePersistedIntakeDestination(ctx, tx, org, lead); !errors.Is(err, ErrIntakeDestinationUnavailable) {
			t.Fatalf("trigger destination bypass=%v", err)
		}
		if err := tx.Rollback(ctx); err != nil {
			t.Fatal(err)
		}
		var count int
		if err := conn.QueryRow(ctx, `select (select count(*) from public.leads where id=$1)+(select count(*) from public.lead_entry_events where lead_id=$1)+(select count(*) from public.notifications where lead_id=$1)`, lead).Scan(&count); err != nil || count != 0 {
			t.Fatalf("trigger rejection left partial effects: count=%d error=%v", count, err)
		}
	})
	t.Run("post FK final guard and parent writer do not deadlock", func(t *testing.T) {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(ctx)
		if _, err := tx.Exec(ctx, `insert into public.leads values(gen_random_uuid(),$1,$2,$3)`, org, pipeline, stage); err != nil {
			t.Fatal(err)
		}
		operation, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		out := make(chan error, 1)
		go func() {
			other, err := pool.Begin(operation)
			if err == nil {
				defer other.Rollback(operation)
				_, err = other.Exec(operation, "select id from public.pipelines where id=$1 for update", pipeline)
			}
			out <- err
		}()
		waitIntakeDestinationLock(t, operation, conn, "%public.pipelines%")
		if err := LockIntakePipelineDestination(operation, tx, org, &pipeline, &stage); err != nil {
			t.Fatalf("final FK guard deadlocked: %v", err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		if err := <-out; err != nil {
			t.Fatal(err)
		}
	})
}

func waitIntakeDestinationLock(t *testing.T, ctx context.Context, conn *pgx.Conn, pattern string) {
	t.Helper()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		var waiting bool
		if err := conn.QueryRow(ctx, `select exists(select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock' and query like $1)`, pattern).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-ticker.C:
		}
	}
}
