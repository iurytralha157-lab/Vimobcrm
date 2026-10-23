package admin

import (
	"context"
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type notificationResetFixture struct {
	ctx               context.Context
	repo              Repository
	actor             tenant.Context
	orgA, orgB, token string
}

func newNotificationResetFixture(t *testing.T) *notificationResetFixture {
	t.Helper()
	if os.Getenv("VIMOB_NOTIFICATION_RESET_TEST") != "LOCAL_WRITE_TEST" {
		t.Skip("requires the fresh synthetic notification-reset PostgreSQL runner")
	}
	root := os.Getenv("VIMOB_NOTIFICATION_RESET_TEST_ROOT")
	if !filepath.IsAbs(root) || filepath.Base(root) != "vimob-whatsapp-ci" {
		t.Fatal("explicit owned fixture root is required")
	}
	var manifest struct {
		Kind, Nonce, Root, Database string
		CreatedAt                   time.Time
		Actual                      struct{ SystemIdentifier, DataDirectory string }
	}
	raw, err := os.ReadFile(filepath.Join(root, "runtime.json"))
	if err != nil || json.Unmarshal(raw, &manifest) != nil || manifest.Kind != "vimob-whatsapp-ci-v1" ||
		filepath.Clean(manifest.Root) != filepath.Clean(root) || manifest.Database != "vimob_whatsapp_clone" ||
		len(manifest.Nonce) != 64 || time.Since(manifest.CreatedAt) < 0 || time.Since(manifest.CreatedAt) > time.Hour {
		t.Fatal("invalid or stale owned fixture manifest")
	}
	dsn := os.Getenv("VIMOB_NOTIFICATION_RESET_TEST_DATABASE_URL")
	u, err := url.Parse(dsn)
	if err != nil || u.User == nil || u.User.Username() != "postgres" ||
		(u.Scheme != "postgres" && u.Scheme != "postgresql") || u.Hostname() != "127.0.0.1" ||
		u.Port() != "57924" || u.Path != "/vimob_whatsapp_clone" || u.Fragment != "" || u.RawQuery != "sslmode=disable" {
		t.Fatal("only the owned loopback fixture is accepted; connection overrides are forbidden")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	t.Cleanup(cancel)
	db, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: dsn, MaxConns: 4, HealthTimeout: 2 * time.Second})
	if err != nil {
		t.Fatal("open owned PostgreSQL fixture:", err)
	}
	t.Cleanup(db.Close)
	var systemID, dataDirectory, database, address, port, listen, nonce, purpose string
	err = db.Pool().QueryRow(ctx, `select system_identifier::text,current_setting('data_directory'),current_database(),
	 host(inet_server_addr()),inet_server_port()::text,current_setting('listen_addresses'),
	 (select nonce from vimob_ci_fixture.identity where marker='vimob-whatsapp-ci-v1'),
	 (select purpose from vimob_ci_fixture.notification_reset_purpose where nonce=$1) from pg_control_system()`, manifest.Nonce).
		Scan(&systemID, &dataDirectory, &database, &address, &port, &listen, &nonce, &purpose)
	if err != nil || systemID != manifest.Actual.SystemIdentifier || filepath.Clean(dataDirectory) != filepath.Clean(manifest.Actual.DataDirectory) ||
		database != manifest.Database || address != "127.0.0.1" || port != "57924" || listen != "127.0.0.1" || nonce != manifest.Nonce || purpose != "synthetic-notification-reset-only" {
		t.Fatal("actual cluster does not match the owned synthetic fixture:", err)
	}
	f := &notificationResetFixture{ctx: ctx, repo: Repository{db: db}, actor: tenant.Context{IsSuperAdmin: true}}
	err = db.Pool().QueryRow(ctx, `insert into public.users default values returning id::text`).Scan(&f.actor.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Pool().QueryRow(ctx, `insert into public.organizations default values returning id::text`).Scan(&f.orgA); err != nil {
		t.Fatal(err)
	}
	if err := db.Pool().QueryRow(ctx, `insert into public.organizations default values returning id::text`).Scan(&f.orgB); err != nil {
		t.Fatal(err)
	}
	if err := db.Pool().QueryRow(ctx, `insert into public.push_tokens(organization_id,user_id) values($1::uuid,$2::uuid) returning id::text`, f.orgA, f.actor.UserID).Scan(&f.token); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
		_, err := db.Pool().Exec(cleanup, `delete from public.notifications where organization_id=any($1::uuid[]);
		 delete from public.whatsapp_outbox where organization_id=any($1::uuid[]);
		 delete from public.push_tokens where id=$2::uuid; delete from public.users where id=$3::uuid;
		 delete from public.organizations where id=any($1::uuid[])`, []string{f.orgA, f.orgB}, f.token, f.actor.UserID)
		if err != nil {
			t.Error("clean synthetic reset fixture:", err)
		}
	})
	return f
}

func (f *notificationResetFixture) job(t *testing.T, org, channel, status string, createdAt time.Time) (id, notification, lease string) {
	t.Helper()
	err := f.repo.db.Pool().QueryRow(f.ctx, `insert into public.notifications(organization_id,user_id,metadata,created_at)
	 values($1::uuid,$2::uuid,'{"dispatch":{"whatsapp":{"required":true}}}',$3) returning id::text`, org, f.actor.UserID, createdAt).Scan(&notification)
	if err != nil {
		t.Fatal(err)
	}
	err = f.repo.db.Pool().QueryRow(f.ctx, `insert into private.notification_deliveries
	 (notification_id,organization_id,user_id,channel,recipient_key,idempotency_key,status,created_at,expires_at,next_attempt_at,
	 lease_token,leased_by,lease_expires_at,dependency_key,blocked_at,terminal_at,push_token_id)
	 values($1::uuid,$2::uuid,$3::uuid,$4,'user:'||$3,'synthetic:'||$1,$5,$6::timestamptz,$6::timestamptz+interval '1 day',
	 case when $5 in ('queued','retry_wait') then now() end,
	 case when $5 in ('leased','sending') then gen_random_uuid() end,
	 case when $5 in ('leased','sending') then 'synthetic-worker' end,
	 case when $5 in ('leased','sending') then now()+interval '5 minutes' end,
	 case when $5='blocked_dependency' then 'whatsapp_disconnected' end,
	 case when $5='blocked_dependency' then now() end,
	 case when $5 in ('cancelled','delivered','dead_letter','permanent_failed') then now() end,
	 case when $4='push' then $7::uuid end) returning id::text,coalesce(lease_token::text,'')`,
		notification, org, f.actor.UserID, channel, status, createdAt, f.token).Scan(&id, &lease)
	if err != nil {
		t.Fatal(err)
	}
	return
}

func (f *notificationResetFixture) status(t *testing.T, id string) string {
	t.Helper()
	var status string
	if err := f.repo.db.Pool().QueryRow(f.ctx, `select status from private.notification_deliveries where id=$1::uuid`, id).Scan(&status); err != nil {
		t.Fatal(err)
	}
	return status
}

func resetRequest(preview WhatsAppNotificationResetPreview) ResetWhatsAppNotificationsRequest {
	return ResetWhatsAppNotificationsRequest{Scope: preview.Scope, OrganizationID: preview.OrganizationID,
		CutoffAt: preview.CutoffAt.Format(time.RFC3339Nano), Reason: "Synthetic reset test", Confirmation: "RESETAR"}
}

func TestLocalWhatsAppNotificationResetScopeCutoffAndDurability(t *testing.T) {
	f := newNotificationResetFixture(t)
	old := time.Now().Add(-time.Minute)
	ids := make(map[string]string)
	var materializedNotification, oldLease string
	for _, status := range []string{"queued", "retry_wait", "blocked_dependency", "leased", "sending", "accepted", "delivered", "cancelled", "dead_letter", "permanent_failed"} {
		id, note, lease := f.job(t, f.orgA, "whatsapp", status, old)
		ids[status] = id
		if status == "queued" {
			materializedNotification = note
		}
		if status == "leased" {
			oldLease = lease
		}
	}
	foreign, _, _ := f.job(t, f.orgB, "whatsapp", "queued", old)
	push, _, _ := f.job(t, f.orgA, "push", "queued", old)
	email, _, _ := f.job(t, f.orgA, "email", "queued", old)
	if _, err := f.repo.db.Pool().Exec(f.ctx, `insert into public.whatsapp_outbox(organization_id,status) values($1::uuid,'queued')`, f.orgA); err != nil {
		t.Fatal(err)
	}
	preview, err := f.repo.PreviewWhatsAppNotificationReset(f.ctx, f.actor, "organization", f.orgA)
	if err != nil || preview.PendingCount != 4 || preview.InFlightCount != 2 {
		t.Fatalf("preview %#v: %v", preview, err)
	}
	newJob, _, _ := f.job(t, f.orgA, "whatsapp", "queued", preview.CutoffAt.Add(time.Microsecond))
	var before string
	if err := f.repo.db.Pool().QueryRow(f.ctx, `select jsonb_agg(to_jsonb(n) order by id)::text from public.notifications n where organization_id=any($1::uuid[])`, []string{f.orgA, f.orgB}).Scan(&before); err != nil {
		t.Fatal(err)
	}
	result, err := f.repo.ResetWhatsAppNotifications(f.ctx, f.actor, resetRequest(preview))
	if err != nil || result.CancelledCount != 4 || result.InFlightCount != 2 {
		t.Fatalf("reset %#v: %v", result, err)
	}
	for _, state := range []string{"queued", "retry_wait", "blocked_dependency", "leased"} {
		if f.status(t, ids[state]) != "cancelled" {
			t.Errorf("%s was not cancelled", state)
		}
	}
	for _, state := range []string{"sending", "accepted", "delivered", "cancelled", "dead_letter", "permanent_failed"} {
		if f.status(t, ids[state]) != state {
			t.Errorf("%s was modified", state)
		}
	}
	for _, id := range []string{foreign, push, email, newJob} {
		if f.status(t, id) != "queued" {
			t.Error("foreign, other-channel or post-cutoff work changed")
		}
	}
	var audit, cleaned int
	if err := f.repo.db.Pool().QueryRow(f.ctx, `select count(*),count(*) filter(where d.lease_token is null and d.lease_expires_at is null and d.leased_by is null
	 and d.dependency_key is null and d.blocked_at is null and d.next_attempt_at is null and d.terminal_at is not null)
	 from private.notification_delivery_attempts a join private.notification_deliveries d on d.id=a.delivery_id
	 where d.organization_id=$1::uuid and a.event_type='sweep' and a.outcome='cancelled'
	 and a.metadata->>'requested_by'=$2 and a.metadata->>'reason'='Synthetic reset test'`, f.orgA, f.actor.UserID).Scan(&audit, &cleaned); err != nil {
		t.Fatal(err)
	}
	if audit != 4 || cleaned != 4 {
		t.Fatalf("audit=%d cleaned=%d", audit, cleaned)
	}
	var started bool
	var unblocked, inserted int
	var receipt string
	if err := f.repo.db.Pool().QueryRow(f.ctx, `select private.start_notification_delivery($1::uuid,$2::uuid,'synthetic')`, ids["leased"], oldLease).Scan(&started); err != nil || started {
		t.Fatalf("cancelled lease started=%v: %v", started, err)
	}
	if err := f.repo.db.Pool().QueryRow(f.ctx, `select private.unblock_notification_deliveries($1::uuid,'whatsapp_disconnected','whatsapp')`, f.orgA).Scan(&unblocked); err != nil || unblocked != 0 {
		t.Fatalf("reconnect revived jobs=%d: %v", unblocked, err)
	}
	if err := f.repo.db.Pool().QueryRow(f.ctx, `select private.materialize_notification_deliveries($1::uuid,false)`, materializedNotification).Scan(&inserted); err != nil || inserted != 0 {
		t.Fatalf("rematerialized jobs=%d: %v", inserted, err)
	}
	if err := f.repo.db.Pool().QueryRow(f.ctx, `select private.apply_notification_delivery_receipt($1::uuid,'whatsapp','synthetic','synthetic-message','failed',false,false,now())->>'outcome'`, materializedNotification).Scan(&receipt); err != nil || receipt != "stale" {
		t.Fatalf("cancelled receipt=%s: %v", receipt, err)
	}
	if f.status(t, ids["queued"]) != "cancelled" {
		t.Fatal("rematerialization or receipt revived reset work")
	}
	var after string
	var human int
	if err := f.repo.db.Pool().QueryRow(f.ctx, `select jsonb_agg(to_jsonb(n) order by id)::text from public.notifications n where organization_id=any($1::uuid[])`, []string{f.orgA, f.orgB}).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if err := f.repo.db.Pool().QueryRow(f.ctx, `select count(*) from public.whatsapp_outbox where organization_id=$1::uuid and status='queued'`, f.orgA).Scan(&human); err != nil {
		t.Fatal(err)
	}
	if before != after || human != 1 {
		t.Fatal("notification inbox or human outbox changed")
	}
	preview, err = f.repo.PreviewWhatsAppNotificationReset(f.ctx, f.actor, "all", "")
	if err != nil || preview.PendingCount != 2 {
		t.Fatalf("global preview %#v: %v", preview, err)
	}
	result, err = f.repo.ResetWhatsAppNotifications(f.ctx, f.actor, resetRequest(preview))
	if err != nil || result.CancelledCount != 2 || f.status(t, foreign) != "cancelled" || f.status(t, newJob) != "cancelled" {
		t.Fatalf("global reset %#v: %v", result, err)
	}
	result, err = f.repo.ResetWhatsAppNotifications(f.ctx, f.actor, resetRequest(preview))
	if err != nil || result.CancelledCount != 0 {
		t.Fatalf("repeat must be idempotent %#v: %v", result, err)
	}
}

func TestLocalWhatsAppNotificationResetWaitsForSendAndPreservesIt(t *testing.T) {
	f := newNotificationResetFixture(t)
	id, _, lease := f.job(t, f.orgA, "whatsapp", "leased", time.Now().Add(-time.Minute))
	preview, err := f.repo.PreviewWhatsAppNotificationReset(f.ctx, f.actor, "organization", f.orgA)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := f.repo.db.Pool().Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(f.ctx)
	var started bool
	if err := tx.QueryRow(f.ctx, `select private.start_notification_delivery($1::uuid,$2::uuid,'synthetic')`, id, lease).Scan(&started); err != nil || !started {
		t.Fatalf("synthetic start=%v: %v", started, err)
	}
	type outcome struct {
		result WhatsAppNotificationResetResult
		err    error
	}
	done := make(chan outcome, 1)
	go func() {
		result, err := f.repo.ResetWhatsAppNotifications(f.ctx, f.actor, resetRequest(preview))
		done <- outcome{result, err}
	}()
	deadline := time.Now().Add(time.Second)
	observed := false
	for time.Now().Before(deadline) {
		var waiting bool
		if err := f.repo.db.Pool().QueryRow(f.ctx, `select exists(select 1 from pg_stat_activity where pid<>pg_backend_pid()
		 and wait_event_type='Lock' and query like '%with candidates as materialized%')`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			observed = true
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if !observed {
		t.Fatal("reset never reached the held row lock")
	}
	if err := tx.Commit(f.ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-done:
		if got.err != nil || got.result.CancelledCount != 0 || got.result.InFlightCount != 1 || f.status(t, id) != "sending" {
			t.Fatalf("racing reset %#v: %v", got.result, got.err)
		}
	case <-f.ctx.Done():
		t.Fatal("reset did not finish after send committed")
	}
}

func TestLocalWhatsAppNotificationResetAuditFailureRollsBack(t *testing.T) {
	f := newNotificationResetFixture(t)
	id, _, _ := f.job(t, f.orgA, "whatsapp", "queued", time.Now().Add(-time.Minute))
	preview, err := f.repo.PreviewWhatsAppNotificationReset(f.ctx, f.actor, "organization", f.orgA)
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.repo.db.Pool().Exec(f.ctx, `create function vimob_ci_fixture.reject_reset_audit() returns trigger language plpgsql as $body$
	 begin if new.metadata->>'reason'='Reject synthetic audit' then raise exception 'synthetic audit failure';end if;return new;end $body$;
	 create trigger reject_reset_audit before insert on private.notification_delivery_attempts for each row execute function vimob_ci_fixture.reject_reset_audit()`)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := f.repo.db.Pool().Exec(context.Background(), `drop trigger reject_reset_audit on private.notification_delivery_attempts;drop function vimob_ci_fixture.reject_reset_audit()`); err != nil {
			t.Error(err)
		}
	})
	request := resetRequest(preview)
	request.Reason = "Reject synthetic audit"
	_, err = f.repo.ResetWhatsAppNotifications(f.ctx, f.actor, request)
	if err == nil || !strings.Contains(err.Error(), "synthetic audit failure") || f.status(t, id) != "queued" {
		t.Fatalf("audit failure did not roll back row: %v", err)
	}
	var audits int
	if err := f.repo.db.Pool().QueryRow(f.ctx, `select count(*) from private.notification_delivery_attempts where delivery_id=$1::uuid`, id).Scan(&audits); err != nil || audits != 0 {
		t.Fatalf("partial audit=%d: %v", audits, err)
	}
}
