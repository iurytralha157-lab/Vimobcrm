package whatsapp

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/whatsappbinding"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestWhatsAppAssignedOwnerAttendanceFencesFutureCapture(t *testing.T) {
	if os.Getenv("WHATSAPP_TEST_ISOLATED") != "1" {
		t.Skip("requires the verified full-schema disposable WhatsApp clone")
	}
	databaseURL := os.Getenv("WHATSAPP_TEST_DATABASE_URL")
	target, err := url.Parse(databaseURL)
	if err != nil || (target.Scheme != "postgres" && target.Scheme != "postgresql") ||
		(target.Hostname() != "127.0.0.1" && target.Hostname() != "localhost") {
		t.Fatal("expected an explicit disposable loopback PostgreSQL URL")
	}
	if socket := target.Query().Get("host"); socket != "" && socket != "/var/run/postgresql" {
		t.Fatal("unexpected PostgreSQL host override")
	}
	name := strings.TrimPrefix(target.Path, "/")
	if name != "vimob_admin_linked_full_2836" && name != "vimob_whatsapp_clone" && !strings.HasSuffix(name, "_test") {
		t.Fatal("expected a disposable WhatsApp database name")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)
	pool := postgres.Pool()
	var verified bool
	if err := pool.QueryRow(ctx, `select current_database()=$1 and
		(inet_server_addr() is null or inet_server_addr() <<= '127.0.0.0/8'::inet)`, name).Scan(&verified); err != nil || !verified {
		t.Fatalf("could not verify the disposable local database: %v", err)
	}
	f := createSessionConversationLockFixture(t, ctx, pool, "assigned-owner-attendance")
	t.Cleanup(func() { cleanupSessionConversationLockFixture(t, pool, f) })
	foreign := createSessionConversationLockFixture(t, ctx, pool, "foreign-assigned-owner")
	t.Cleanup(func() { cleanupSessionConversationLockFixture(t, pool, foreign) })
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()

	exec := func(t *testing.T, statement string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(ctx, statement, args...); err != nil {
			t.Fatal(err)
		}
	}
	var otherAssignee string
	if err := tx.QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&otherAssignee); err != nil {
		t.Fatal(err)
	}
	exec(t, `
		insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
		values ($1::uuid,'authenticated','authenticated',$2,'',now(),'{}','{}',now(),now());
		insert into public.users (id,organization_id,name,email,role,is_active)
		values ($1::uuid,$3::uuid,'Synthetic alternate assignee',$2,'user',true)
		on conflict (id) do update set organization_id=excluded.organization_id,role='user',is_active=true;
		insert into public.organization_members (organization_id,user_id,role,is_active)
		values ($3::uuid,$1::uuid,'user',true)
		on conflict (user_id,organization_id) do update set role='user',is_active=true,deleted_at=null
	`, otherAssignee, f.suffix+"-alternate@example.invalid", f.organizationID)

	assertEligibility := func(t *testing.T, actor tenant.Context, want bool) {
		t.Helper()
		got, err := whatsappbinding.StartAssignedOwnerAttendance(ctx, tx, actor, f.conversationID, f.sessionID, f.leadID)
		if err != nil || got != want {
			t.Fatalf("attendance eligibility=%v, want %v: %v", got, want, err)
		}
	}
	assertEligibility(t, foreign.tenant, false)
	exec(t, `update public.whatsapp_sessions set owner_user_id=$2::uuid where id=$1::uuid`, f.sessionID, otherAssignee)
	assertEligibility(t, f.tenant, false)
	exec(t, `update public.whatsapp_sessions set owner_user_id=$2::uuid where id=$1::uuid`, f.sessionID, f.userID)
	exec(t, `update public.leads set assigned_user_id=$2::uuid where id=$1::uuid`, f.leadID, otherAssignee)
	assertEligibility(t, f.tenant, false)
	otherActor := f.tenant
	otherActor.UserID = otherAssignee
	assertEligibility(t, otherActor, false)
	exec(t, `update public.leads set assigned_user_id=$2::uuid where id=$1::uuid`, f.leadID, f.userID)
	exec(t, `savepoint before_binding_end`)
	exec(t, `update public.whatsapp_conversation_lead_bindings set active_to=clock_timestamp()
		where organization_id=$1::uuid and conversation_id=$2::uuid and active_to is null`, f.organizationID, f.conversationID)
	assertEligibility(t, f.tenant, false)
	exec(t, `rollback to savepoint before_binding_end`)
	var count int
	if err := tx.QueryRow(ctx, `select count(*)::integer from public.whatsapp_attendance_entries
		where organization_id in ($1::uuid,$2::uuid)`, f.organizationID, foreign.organizationID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("ineligible route created %d attendance entries: %v", count, err)
	}

	nextIngress := func() int64 {
		t.Helper()
		var seq int64
		if err := tx.QueryRow(ctx, `select nextval('public.whatsapp_webhook_routing_ingress_sequence')`).Scan(&seq); err != nil {
			t.Fatal(err)
		}
		return seq
	}
	priorIngress := nextIngress()
	assertEligibility(t, f.tenant, true)
	type attendance struct {
		id, bindingID, source string
		joinedAt              time.Time
		cutoff                int64
		count                 int
	}
	readAttendance := func() attendance {
		t.Helper()
		var entry attendance
		if err := tx.QueryRow(ctx, `
			select id::text,binding_id::text,entry_source,joined_at,ingress_sequence_cutoff,count(*) over()::integer
			from public.whatsapp_attendance_entries
			where organization_id=$1::uuid and conversation_id=$2::uuid and session_id=$3::uuid
			and lead_id=$4::uuid and user_id=$5::uuid
		`, f.organizationID, f.conversationID, f.sessionID, f.leadID, f.userID).Scan(
			&entry.id, &entry.bindingID, &entry.source, &entry.joinedAt, &entry.cutoff, &entry.count); err != nil {
			t.Fatal(err)
		}
		return entry
	}
	first := readAttendance()
	if first.count != 1 || first.source != "manual" || first.cutoff < priorIngress {
		t.Fatalf("expected one manual attendance fenced through prior ingress, got %+v", first)
	}
	futureIngress := nextIngress()
	if futureIngress <= first.cutoff {
		t.Fatalf("next ingress %d did not advance after fence %d", futureIngress, first.cutoff)
	}
	assertEligibility(t, f.tenant, true)
	if retry := readAttendance(); retry != first {
		t.Fatalf("retry changed the original attendance fence: before=%+v after=%+v", first, retry)
	}

	before, after := first.joinedAt.Add(-time.Second), first.joinedAt.Add(time.Second)
	for _, check := range []struct {
		name, organizationID, sessionID string
		occurredAt, acceptedAt          time.Time
		sequence                        int64
		wantEntry                       string
	}{
		{"older provider event", f.organizationID, f.sessionID, before, after, futureIngress, ""},
		{"older durable acceptance", f.organizationID, f.sessionID, before, before, futureIngress, ""},
		{"ingress at cutoff", f.organizationID, f.sessionID, after, after, first.cutoff, ""},
		{"different connection", f.organizationID, foreign.sessionID, after, after, futureIngress, ""},
		{"different organization", foreign.organizationID, f.sessionID, after, after, futureIngress, ""},
		{"later exact route", f.organizationID, f.sessionID, after, after, futureIngress, first.id},
	} {
		t.Run(check.name, func(t *testing.T) {
			entryID, err := eventAttendanceEntry(ctx, tx, check.organizationID, f.conversationID, check.sessionID,
				f.leadID, first.bindingID, "synthetic-inbound", check.occurredAt, check.acceptedAt, check.sequence)
			if err != nil || entryID != check.wantEntry {
				t.Fatalf("attendance entry=%q, want %q: %v", entryID, check.wantEntry, err)
			}
		})
	}
}
