package leads

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// Exercise the actual inverse order: a child writer owns the activity while
// the Go DELETE owns its lead and waits in FK CASCADE. The writer must fail
// immediately, release the child, and let that same DELETE commit successfully.
func TestActivityMutationCannotDeadlockGoLeadDeleteAgainstPostgres(t *testing.T) {
	for _, legacy := range []bool{false, true} {
		for _, operation := range []string{"update", "delete"} {
			name := operation + "/managed"
			if legacy {
				name = operation + "/legacy"
			}
			t.Run(name, func(t *testing.T) {
				f := newQueuePostLockFixture(t)
				lead, activity := queueActivityLockSubject(t, f, legacy)
				warmQueueReentryBindingConnections(t, f)
				// Direct browser DML is revoked. Isolate the parent-lock protocol
				// with the privileged backend writer that still owns this path.
				writer := queueActivityWriter(t, f, false)
				defer writer.Rollback(f.ctx)
				var writerPID int32
				if err := writer.QueryRow(f.ctx, `select pg_backend_pid()`).Scan(&writerPID); err != nil {
					t.Fatal(err)
				}
				if _, err := writer.Exec(f.ctx, `select id from public.activities where id=$1::uuid for update`, activity); err != nil {
					t.Fatal(err)
				}
				request := httptest.NewRequest(http.MethodDelete, "/v1/leads/"+lead, nil)
				request.SetPathValue("id", lead)
				request = request.WithContext(tenant.ContextWithTenant(f.ctx, f.actor))
				response := httptest.NewRecorder()
				done := make(chan struct{})
				go func() { NewHandler(f.repo).Delete(response, request); close(done) }()
				waiting := false
				deadline := time.Now().Add(10 * time.Second)
				for time.Now().Before(deadline) {
					if err := f.db.Pool().QueryRow(f.ctx, `select exists(select 1 from pg_stat_activity
					 where datname=current_database() and wait_event_type='Lock' and $1::int=any(pg_blocking_pids(pid))
					 and query like '%delete from public.leads%')`, writerPID).Scan(&waiting); err != nil {
						t.Fatal(err)
					}
					if waiting {
						break
					}
					time.Sleep(20 * time.Millisecond)
				}
				if !waiting {
					_ = writer.Rollback(f.ctx)
					<-done
					t.Fatalf("real Go DELETE did not reach the child cascade wait: status=%d", response.Code)
				}
				_, mutationError := writer.Exec(f.ctx, queueActivityMutationSQL(operation), activity)
				_ = writer.Rollback(f.ctx)
				<-done
				queueActivityExpectBusy(t, mutationError)
				if response.Code != http.StatusNoContent {
					t.Fatalf("Go DELETE after typed child rollback: status=%d body=%s", response.Code, response.Body.String())
				}
				var correct bool
				if err := f.db.Pool().QueryRow(f.ctx, `select not exists(select 1 from public.leads where id=$1::uuid)
				 and not exists(select 1 from public.activities where lead_id=$1::uuid)
				 and exists(select 1 from public.audit_logs where organization_id=$2::uuid and entity_id=$1::text
				 and entity_type='lead' and action='delete')`, lead, f.org).Scan(&correct); err != nil || !correct {
					t.Fatalf("DELETE did not atomically remove its children and retain its audit: correct=%t error=%v", correct, err)
				}
			})
		}
	}
}

func TestActivityBusyMutationRollsBackAndCanRetryAgainstPostgres(t *testing.T) {
	for _, operation := range []string{"update", "delete"} {
		t.Run(operation, func(t *testing.T) {
			f := newQueuePostLockFixture(t)
			lead, activity := queueActivityLockSubject(t, f, false)
			before := queueReentryFingerprint(t, f, f.db.Pool())
			holder, err := f.db.Pool().Begin(f.ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer holder.Rollback(f.ctx)
			if _, err := holder.Exec(f.ctx, `select id from public.leads where id=$1::uuid for update`, lead); err != nil {
				t.Fatal(err)
			}
			writer := queueActivityWriter(t, f, false)
			defer writer.Rollback(f.ctx)
			_, mutationError := writer.Exec(f.ctx, queueActivityMutationSQL(operation), activity)
			queueActivityExpectBusy(t, mutationError)
			// A failed statement must abort the transaction, not return a silently
			// skipped/acknowledged write. The caller retries the whole transaction.
			_, aborted := writer.Exec(f.ctx, `select 1`)
			var postgresError *pgconn.PgError
			if !errors.As(aborted, &postgresError) || postgresError.Code != "25P02" {
				t.Fatalf("busy write did not abort its transaction: %v", aborted)
			}
			_ = writer.Rollback(f.ctx)
			if after := queueReentryFingerprint(t, f, f.db.Pool()); after != before {
				t.Fatal("busy activity changed business state, facts, history or receipts")
			}
			if err := holder.Rollback(f.ctx); err != nil {
				t.Fatal(err)
			}
			retry := queueActivityWriter(t, f, false)
			defer retry.Rollback(f.ctx)
			tag, err := retry.Exec(f.ctx, queueActivityMutationSQL(operation), activity)
			if err != nil || tag.RowsAffected() != 1 {
				t.Fatalf("same permitted non-pool mutation failed after release: changed=%d error=%v", tag.RowsAffected(), err)
			}
			if err := retry.Commit(f.ctx); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestActivityParentFenceCoversOldAndNewTenantAgainstPostgres(t *testing.T) {
	f := newQueuePostLockFixture(t)
	other := newQueuePostLockFixture(t)
	oldLead, activity := queueActivityLockSubject(t, f, true)
	for _, locked := range []struct{ label, id string }{{"old", oldLead}, {"new", other.lead}} {
		t.Run(locked.label, func(t *testing.T) {
			before, otherBefore := queueReentryFingerprint(t, f, f.db.Pool()), queueReentryFingerprint(t, other, other.db.Pool())
			holder, err := f.db.Pool().Begin(f.ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer holder.Rollback(f.ctx)
			if _, err := holder.Exec(f.ctx, `select id from public.leads where id=$1::uuid for update`, locked.id); err != nil {
				t.Fatal(err)
			}
			writer := queueActivityWriter(t, f, false)
			defer writer.Rollback(f.ctx)
			// Trusted-role fixture isolates parent locking from client RLS. The
			// forged child tenant must not hide either real OLD/NEW parent.
			_, mutationError := writer.Exec(f.ctx, `update public.activities set lead_id=$2::uuid,organization_id=$3::uuid where id=$1::uuid`, activity, other.lead, f.org)
			queueActivityExpectBusy(t, mutationError)
			_ = writer.Rollback(f.ctx)
			_ = holder.Rollback(f.ctx)
			if queueReentryFingerprint(t, f, f.db.Pool()) != before || queueReentryFingerprint(t, other, other.db.Pool()) != otherBefore {
				t.Fatal("failed cross-tenant relationship mutation left effects in either tenant")
			}
		})
	}
	client := queueActivityWriter(t, f, true)
	defer client.Rollback(f.ctx)
	tag, err := client.Exec(f.ctx, `update public.activities set lead_id=$2::uuid,organization_id=$3::uuid where id=$1::uuid`, activity, other.lead, other.org)
	var postgresError *pgconn.PgError
	if !(errors.As(err, &postgresError) && postgresError.Code == "42501") && !(err == nil && tag.RowsAffected() == 0) {
		t.Fatalf("existing RLS must continue to deny foreign-parent mutation: changed=%d error=%v", tag.RowsAffected(), err)
	}
}

func queueActivityWriter(t *testing.T, f queuePostLockFixture, authenticated bool) pgx.Tx {
	t.Helper()
	if authenticated {
		// Exercise the real authenticated Data API policies with a persisted
		// synthetic session, rather than bypassing them as the database owner.
		if _, err := f.db.Pool().Exec(f.ctx, `insert into auth.sessions(id,user_id,created_at,updated_at)
		 values($1::uuid,$1::uuid,now(),now()) on conflict(id) do nothing`, f.actor.UserID); err != nil {
			t.Fatal(err)
		}
	}
	tx, err := f.db.Pool().Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })
	if _, err := tx.Exec(f.ctx, `set local statement_timeout='3s'`); err != nil {
		t.Fatal(err)
	}
	if authenticated {
		if _, err := tx.Exec(f.ctx, `select set_config('request.jwt.claims',jsonb_build_object('sub',$1::text,'role','authenticated','session_id',$1::text)::text,true),set_config('request.jwt.claim.sub',$1::text,true)`, f.actor.UserID); err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(f.ctx, `set local role authenticated`); err != nil {
			t.Fatal(err)
		}
	}
	return tx
}

func queueActivityLockSubject(t *testing.T, f queuePostLockFixture, legacy bool) (string, string) {
	t.Helper()
	lead := f.lead
	if legacy {
		if err := f.db.Pool().QueryRow(f.ctx, `insert into public.leads(organization_id,name,source,assigned_user_id,metadata)
		 values($1::uuid,'Synthetic legacy activity lock','manual',$2::uuid,'{"distribution_deferred":true}') returning id::text`, f.org, f.actor.UserID).Scan(&lead); err != nil {
			t.Fatal(err)
		}
	}
	var activity string
	if err := f.db.Pool().QueryRow(f.ctx, `insert into public.activities(organization_id,lead_id,user_id,type,content,metadata)
	 values($1::uuid,$2::uuid,$3::uuid,'lock_probe','Synthetic original activity','{}') returning id::text`, f.org, lead, f.actor.UserID).Scan(&activity); err != nil {
		t.Fatal(err)
	}
	return lead, activity
}

func queueActivityMutationSQL(operation string) string {
	if operation == "delete" {
		return `delete from public.activities where id=$1::uuid`
	}
	return `update public.activities set content='Synthetic retried activity' where id=$1::uuid`
}

func queueActivityExpectBusy(t *testing.T, err error) {
	t.Helper()
	var postgresError *pgconn.PgError
	if !errors.As(err, &postgresError) || postgresError.Code != "55P03" || postgresError.Message != "queue_activity_lead_busy_retry" {
		t.Fatalf("activity must fail before waiting on the parent with the typed retry outcome: %v", err)
	}
}
