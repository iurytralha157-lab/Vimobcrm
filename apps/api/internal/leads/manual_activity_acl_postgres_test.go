package leads

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

// This opt-in fixture requires the final manual-activity ACL migration. The
// ordinary unit run does not connect to PostgreSQL or enable its opt-in.
func TestManualActivityDirectBrowserDMLDeniedAgainstPostgres(t *testing.T) {
	f := newQueuePostLockFixture(t)
	lead, activity := queueActivityLockSubject(t, f, true)
	var closed bool
	if err := f.db.Pool().QueryRow(f.ctx, `select
		not exists(select 1 from unnest(array['INSERT','UPDATE','DELETE']) privilege
		  where has_table_privilege('authenticated','public.activities',privilege))
		and not exists(select 1 from pg_attribute attribute
		  where attribute.attrelid='public.activities'::regclass and attribute.attnum>0 and not attribute.attisdropped
		  and (has_column_privilege('authenticated',attribute.attrelid,attribute.attnum,'INSERT')
		    or has_column_privilege('authenticated',attribute.attrelid,attribute.attnum,'UPDATE')))`).Scan(&closed); err != nil || !closed {
		t.Fatalf("manual-activity DML ACL migration is required: closed=%t error=%v", closed, err)
	}
	before := queueReentryFingerprint(t, f, f.db.Pool())
	holder, err := f.db.Pool().Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer holder.Rollback(f.ctx)
	if _, err := holder.Exec(f.ctx, `select id from public.leads where id=$1::uuid for update`, lead); err != nil {
		t.Fatal(err)
	}
	for _, operation := range []string{"insert", "update", "delete"} {
		t.Run(operation, func(t *testing.T) {
			writer := queueActivityWriter(t, f, true)
			defer writer.Rollback(f.ctx)
			ctx, cancel := context.WithTimeout(f.ctx, time.Second)
			defer cancel()
			var mutationError error
			if operation == "insert" {
				_, mutationError = writer.Exec(ctx, `insert into public.activities(organization_id,lead_id,user_id,type,content,metadata)
				  values($1::uuid,$2::uuid,$3::uuid,'status_change','Synthetic forged status','{"origin":"system"}')`, f.org, lead, f.actor.UserID)
			} else {
				_, mutationError = writer.Exec(ctx, queueActivityMutationSQL(operation), activity)
			}
			var databaseError *pgconn.PgError
			if !errors.As(mutationError, &databaseError) || databaseError.Code != "42501" {
				t.Fatalf("direct client DML must fail before locked-parent triggers: %v", mutationError)
			}
			_ = writer.Rollback(f.ctx)
			if queueReentryFingerprint(t, f, f.db.Pool()) != before {
				t.Fatal("denied direct DML changed lead/activity/facts state")
			}
		})
	}
}
