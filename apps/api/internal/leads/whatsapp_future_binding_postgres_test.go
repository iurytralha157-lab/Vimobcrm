package leads

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestFutureOnlyWhatsAppLeadCreateAndReentryLocalPostgres(t *testing.T) {
	raw := os.Getenv("VIMOB_FUTURE_LINK_LEADS_TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("requires the verified local WhatsApp fixture")
	}
	target, err := url.Parse(raw)
	if err != nil || target.Scheme != "postgresql" || target.Hostname() != "127.0.0.1" ||
		target.Port() != "57924" || target.Path != "/vimob_whatsapp_clone" || target.RawQuery != "sslmode=disable" {
		t.Fatal("future-only write test requires the dedicated loopback WhatsApp fixture")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	db, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: raw, HealthTimeout: 5 * time.Second})
	if err != nil {
		t.Fatal("connect to the dedicated loopback WhatsApp fixture")
	}
	defer db.Close()
	var verified bool
	if err := db.Pool().QueryRow(ctx, `select exists(select 1 from vimob_ci_fixture.identity where marker='vimob-whatsapp-ci-v1')`).Scan(&verified); err != nil || !verified {
		t.Fatal("missing the fixture ownership marker")
	}

	name := fmt.Sprintf("future-link-leads-%d", time.Now().UnixNano())
	phone := fmt.Sprintf("55119%08d", time.Now().UnixNano()%100000000)
	var actor tenant.Context
	if err := db.Pool().QueryRow(ctx, `insert into public.organizations(name,slug,is_active) values($1,$1,true) returning id::text`, name).Scan(&actor.OrganizationID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		for _, statement := range []string{
			`delete from public.whatsapp_messages where organization_id=$1::uuid`,
			`delete from public.whatsapp_conversation_lead_bindings where organization_id=$1::uuid`,
			`delete from public.whatsapp_conversations where organization_id=$1::uuid`,
			`delete from public.whatsapp_sessions where organization_id=$1::uuid`,
			`delete from public.leads where organization_id=$1::uuid`,
			`update public.users set organization_id=null where organization_id=$1::uuid`,
			`delete from public.organizations where id=$1::uuid`,
		} {
			if _, err := db.Pool().Exec(cleanup, statement, actor.OrganizationID); err != nil {
				t.Errorf("clean synthetic future-link fixture: %v", err)
			}
		}
		for _, statement := range []string{`delete from public.users where id=$1::uuid`, `delete from auth.users where id=$1::uuid`} {
			if actor.UserID != "" {
				if _, err := db.Pool().Exec(cleanup, statement, actor.UserID); err != nil {
					t.Errorf("clean synthetic future-link actor: %v", err)
				}
			}
		}
	}()
	if err := db.Pool().QueryRow(ctx, `insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
		values(gen_random_uuid(),'authenticated','authenticated',$1,'',now(),'{}','{}') returning id::text`, name+"@example.invalid").Scan(&actor.UserID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool().Exec(ctx, `insert into public.users(id,organization_id,name,email,role,is_active)
		values($1::uuid,$2::uuid,$3,$4,'admin',true)
		on conflict(id) do update set organization_id=excluded.organization_id,role='admin',is_active=true`,
		actor.UserID, actor.OrganizationID, name, name+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool().Exec(ctx, `insert into public.organization_members(organization_id,user_id,role,is_active)
		values($1::uuid,$2::uuid,'admin',true)
		on conflict(organization_id,user_id) do update set role='admin',is_active=true`,
		actor.OrganizationID, actor.UserID); err != nil {
		t.Fatal(err)
	}
	actor.UserRole, actor.MemberRole, actor.EnabledModules = "admin", "admin", []string{"whatsapp"}

	newConversation := func(suffix string) string {
		t.Helper()
		var sessionID, conversationID string
		if err := db.Pool().QueryRow(ctx, `insert into public.whatsapp_sessions(organization_id,owner_user_id,instance_name,provider,status,is_active)
			values($1::uuid,$2::uuid,$3,'evolution_go','connected',true) returning id::text`, actor.OrganizationID, actor.UserID, name+suffix).Scan(&sessionID); err != nil {
			t.Fatal(err)
		}
		if err := db.Pool().QueryRow(ctx, `insert into public.whatsapp_conversations(organization_id,session_id,remote_jid,contact_phone,unlinked_retention_v1)
			values($1::uuid,$2::uuid,$3,$4,false) returning id::text`, actor.OrganizationID, sessionID, phone+"@s.whatsapp.net", phone).Scan(&conversationID); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Pool().Exec(ctx, `insert into public.whatsapp_messages
			(organization_id,session_id,conversation_id,message_id,provider_message_id,from_me,direction,capture_state,status)
			values($1::uuid,$2::uuid,$3::uuid,$4,$4,false,'inbound','suppressed','received')`,
			actor.OrganizationID, sessionID, conversationID, name+suffix+"-message"); err != nil {
			t.Fatal(err)
		}
		return conversationID
	}
	create := func(conversationID string, futureOnly bool) (CreateResult, error) {
		t.Helper()
		noDistribution := false
		request := CreateRequest{Name: "Synthetic future-only lead", Phone: phone, Source: "manual",
			AssignedUserID: actor.UserID, AutoDistribute: &noDistribution, ConversationID: conversationID,
			ExpectedPreviousLeadID: "unlinked", ConfirmHistoryLink: true, FutureOnly: futureOnly}
		input, err := request.Validate()
		if err != nil {
			t.Fatal(err)
		}
		return NewRepository(db, nil).Create(ctx, actor, input)
	}

	first := newConversation("-first")
	if _, err := create(first, false); !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("legacy create without prospective consent: %v", err)
	}
	const updateSession = `update public.whatsapp_sessions ws set status=$3
		from public.whatsapp_conversations wc where wc.id=$2::uuid and wc.organization_id=$1::uuid
		and ws.organization_id=wc.organization_id and ws.id=wc.session_id`
	if _, err := db.Pool().Exec(ctx, updateSession, actor.OrganizationID, first, "disconnected"); err != nil {
		t.Fatal(err)
	}
	if _, err := create(first, true); !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("future-only create with disconnected session: %v", err)
	}
	if _, err := db.Pool().Exec(ctx, updateSession, actor.OrganizationID, first, "connected"); err != nil {
		t.Fatal(err)
	}
	reconnect, err := db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer reconnect.Rollback(ctx)
	if _, err := reconnect.Exec(ctx, updateSession, actor.OrganizationID, first, "disconnected"); err != nil {
		t.Fatal(err)
	}
	if _, err := create(first, true); !errors.Is(err, ErrConversationBindingChanged) {
		t.Fatalf("future-only create while session is changing: %v", err)
	}
	if err := reconnect.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	created, err := create(first, true)
	if err != nil || created.Reentry || created.Lead.ID == "" {
		t.Fatalf("future-only create failed: reentry=%t error=%v", created.Reentry, err)
	}
	second := newConversation("-second")
	reentered, err := create(second, true)
	if err != nil || !reentered.Reentry || reentered.Lead.ID != created.Lead.ID {
		t.Fatalf("future-only reentry did not reuse the existing lead: reentry=%t error=%v", reentered.Reentry, err)
	}
	if _, err := create(second, true); !errors.Is(err, ErrConversationBindingChanged) {
		t.Fatalf("stale future-only consent on bound conversation: %v", err)
	}
	var bound, retained int
	if err := db.Pool().QueryRow(ctx, `select
		(select count(*) from public.whatsapp_conversations where organization_id=$1::uuid and lead_id=$2::uuid),
		(select count(*) from public.whatsapp_messages where organization_id=$1::uuid and lead_id is null and content is null and capture_state='suppressed')`,
		actor.OrganizationID, created.Lead.ID).Scan(&bound, &retained); err != nil || bound != 2 || retained != 2 {
		t.Fatalf("expected two bindings and two still-redacted transport rows: bound=%d retained=%d error=%v", bound, retained, err)
	}
}
