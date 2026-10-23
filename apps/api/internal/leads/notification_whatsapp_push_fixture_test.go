package leads

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type whatsappPushFixture struct {
	ctx                                                                                           context.Context
	repo                                                                                          Repository
	organizationID, firstID, nextID, leadID, sessionID, firstTokenID, nextTokenID, notificationID string
}

func newWhatsAppPushDispatchFixture(t *testing.T, withoutInitialDevice ...bool) *whatsappPushFixture {
	t.Helper()
	if os.Getenv("VIMOB_RUN_WHATSAPP_PUSH_DB_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("requires explicit disposable push fixture opt-in")
	}
	target, err := url.Parse(strings.TrimSpace(os.Getenv("WHATSAPP_PUSH_TEST_DATABASE_URL")))
	if err != nil || target.User == nil || target.User.Username() != "postgres" ||
		target.Hostname() != "127.0.0.1" || target.Port() != "57922" ||
		target.Path != "/vimob_whatsapp_clone" ||
		os.Getenv("VIMOB_WHATSAPP_TEST_TARGET_VERIFIED") != "vimob-wa-test-ready-20261011" {
		t.Fatal("requires the label-verified disposable 127.0.0.1:57922/vimob_whatsapp_clone")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 70*time.Second)
	t.Cleanup(cancel)
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: target.String(), MaxConns: 3, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(database.Close)
	pool := database.Pool()
	var organizationID, ownerID, firstID, nextID, sessionID, leadID, conversationID, firstTokenID, nextTokenID string
	if err := pool.QueryRow(ctx, `select gen_random_uuid()::text,gen_random_uuid()::text,gen_random_uuid()::text,
		gen_random_uuid()::text,gen_random_uuid()::text,gen_random_uuid()::text,gen_random_uuid()::text,
		gen_random_uuid()::text,gen_random_uuid()::text`).Scan(&organizationID, &ownerID, &firstID, &nextID,
		&sessionID, &leadID, &conversationID, &firstTokenID, &nextTokenID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupContext, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		if _, err := pool.Exec(cleanupContext, `update public.users set organization_id=null where organization_id=$1::uuid;
			delete from public.organizations where id=$1::uuid;
			delete from public.users where id=any($2::uuid[]);delete from auth.users where id=any($2::uuid[])`,
			organizationID, []string{ownerID, firstID, nextID}); err != nil {
			t.Errorf("cleanup disposable push fixture: %v", err)
		}
	})
	fixtureSQL := `
		insert into public.organizations(id,name,is_active) values($1::uuid,'Push provider-start fixture',true);
		insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
		select id,'authenticated','authenticated','push-fence-'||id::text||'@example.test','',now(),'{}','{}',now(),now()
		from unnest(array[$2::uuid,$3::uuid,$4::uuid]) id;
		insert into public.users(id,organization_id,name,email,role,is_active)
		select id,$1::uuid,'Push fixture','push-fence-'||id::text||'@example.test',case when id=$2::uuid then 'admin' else 'user' end,true
		from unnest(array[$2::uuid,$3::uuid,$4::uuid]) id on conflict(id) do update
		set organization_id=excluded.organization_id,name=excluded.name,email=excluded.email,role=excluded.role,is_active=true;
		insert into public.organization_members(organization_id,user_id,role,is_active)
		select $1::uuid,id,case when id=$2::uuid then 'admin' else 'user' end,true
		from unnest(array[$2::uuid,$3::uuid,$4::uuid]) id on conflict(user_id,organization_id) do update set role=excluded.role,is_active=true,deleted_at=null;
		insert into public.whatsapp_sessions(id,organization_id,owner_user_id,instance_name,provider,status,is_active)
		values($5::uuid,$1::uuid,$2::uuid,'push-fence-'||$5,'evolution_go','connected',true);
		insert into public.leads(id,organization_id,assigned_user_id,name,source) values($6::uuid,$1::uuid,$3::uuid,'Synthetic push lead','manual');
		insert into public.whatsapp_conversations(id,organization_id,session_id,remote_jid,is_group)
		values($7::uuid,$1::uuid,$5::uuid,'5511998880001@s.whatsapp.net',false);
		select public.activate_whatsapp_conversation_lead_binding($1::uuid,$7::uuid,$6::uuid,null);
		insert into public.whatsapp_session_access(organization_id,session_id,user_id,granted_by,can_view,can_read,can_send,only_leads_access,access_mode,grant_scope)
		select $1::uuid,$5::uuid,id,$2::uuid,true,true,true,true,'assigned_leads_only','organization' from unnest(array[$3::uuid,$4::uuid]) id;
		insert into public.whatsapp_attendance_entries(organization_id,conversation_id,session_id,lead_id,binding_id,user_id,actor_name_snapshot,joined_at,ingress_sequence_cutoff)
		select $1::uuid,$7::uuid,$5::uuid,$6::uuid,binding.id,actor.id,'Push fixture',clock_timestamp()-interval '2 minutes',0
		from public.whatsapp_conversation_lead_bindings binding cross join unnest(array[$3::uuid,$4::uuid]) actor(id)
		where binding.conversation_id=$7::uuid and binding.active_to is null;
		insert into public.push_tokens(id,organization_id,user_id,token,platform,is_active)
		values($8::uuid,$1::uuid,$3::uuid,'fake-first-'||$8,'android',true),($9::uuid,$1::uuid,$4::uuid,'fake-next-'||$9,'android',true);
		insert into public.whatsapp_webhook_routing_snapshots(organization_id,session_id,provider_message_id,inbox_event_key,processing_lane,routing_key,binding_eligible,target_mode,snapshot)
		select $1::uuid,$5::uuid,'push-fence-message','push-fence-message','live','push-fence-route',true,'snapshot',jsonb_build_object(
		'conversation_id',$7::uuid,'active_binding_id',id,'current_lead_id',$6::uuid,'event_lead_id',$6::uuid,'state','bound','context_kind','organic')
		from public.whatsapp_conversation_lead_bindings where conversation_id=$7::uuid and active_to is null;
		insert into public.whatsapp_webhook_inbox(organization_id,session_id,event_key,event_type,payload,processing_lane,provider_occurred_at,created_at)
		select $1::uuid,$5::uuid,'push-fence-message','messages.upsert',
		jsonb_build_object('__vimob_ingress',jsonb_build_object('routing_snapshot',jsonb_build_object('version',1,'messages',
		jsonb_build_array(route.snapshot||jsonb_build_object('version',1,'organization_id',route.organization_id,'session_id',route.session_id,
		'provider_message_id',route.provider_message_id,'inbox_event_key',route.inbox_event_key,'processing_epoch',route.processing_epoch,'ingress_sequence',route.ingress_sequence))))),
		'live',clock_timestamp()-interval '10 seconds',clock_timestamp() from public.whatsapp_webhook_routing_snapshots route
		where route.organization_id=$1::uuid and route.session_id=$5::uuid and route.provider_message_id='push-fence-message';
		insert into public.whatsapp_messages(organization_id,conversation_id,session_id,lead_id,provider_message_id,message_id,from_me,direction,message_type,status,capture_state,sent_at)
		values($1::uuid,$7::uuid,$5::uuid,$6::uuid,'push-fence-message','push-fence-message',false,'inbound','text','received','captured',clock_timestamp()-interval '10 seconds');
	`
	if len(withoutInitialDevice) > 0 && withoutInitialDevice[0] {
		fixtureSQL = strings.Replace(fixtureSQL, "'fake-first-'||$8,'android',true)", "'fake-first-'||$8,'android',false)", 1)
	}
	fixtureSQL = strings.ReplaceAll(fixtureSQL, "'push-fence-message'", "'push-fence-message-'||$5")
	_, err = pool.Exec(ctx, fixtureSQL, organizationID, ownerID, firstID, nextID, sessionID, leadID, conversationID, firstTokenID, nextTokenID)
	if err != nil {
		t.Fatal(err)
	}

	f := &whatsappPushFixture{ctx: ctx, repo: Repository{db: database}, organizationID: organizationID,
		firstID: firstID, nextID: nextID, leadID: leadID, sessionID: sessionID, firstTokenID: firstTokenID, nextTokenID: nextTokenID}
	if err := pool.QueryRow(ctx, `select id::text from public.notifications
 where organization_id=$1::uuid and metadata->>'event_key'='whatsapp_inbound_attendant'`, organizationID).Scan(&f.notificationID); err != nil {
		t.Fatal(err)
	}
	return f
}

func (f *whatsappPushFixture) exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := f.repo.db.Pool().Exec(f.ctx, sql, args...); err != nil {
		t.Fatal(err)
	}
}
func (f *whatsappPushFixture) transfer(t *testing.T) {
	f.exec(t, `update public.leads set assigned_user_id=$2::uuid where id=$1::uuid`, f.leadID, f.nextID)
}
func (f *whatsappPushFixture) dispatch(t *testing.T) bool {
	t.Helper()
	processed, err := f.repo.processOneNormalizedNotificationDelivery(f.ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	return processed
}
func (f *whatsappPushFixture) notification(t *testing.T) pendingNotification {
	t.Helper()
	n, err := f.repo.loadNormalizedPendingNotification(f.ctx, normalizedNotificationDelivery{NotificationID: f.notificationID, OrganizationID: f.organizationID, UserID: f.firstID})
	if err != nil {
		t.Fatal(err)
	}
	return n
}
func (f *whatsappPushFixture) assertUnstarted(t *testing.T) {
	t.Helper()
	var attempts int
	var started bool
	if err := f.repo.db.Pool().QueryRow(f.ctx, `select
 coalesce((select sum(attempt_count)::int from private.notification_deliveries where organization_id=$1::uuid),0),
 exists(select 1 from public.notifications where organization_id=$1::uuid and metadata->>'whatsapp_inbound_provider_started'='true')`, f.organizationID).Scan(&attempts, &started); err != nil {
		t.Fatal(err)
	}
	if attempts != 0 || started {
		t.Fatalf("zero HTTP marked provider-started: attempts=%d legacy=%v", attempts, started)
	}
}
func (f *whatsappPushFixture) assertRedirected(t *testing.T) {
	t.Helper()
	var count int
	var state string
	var sameExpiry bool
	if err := f.repo.db.Pool().QueryRow(f.ctx, `select
 (select count(*)::int from public.notifications where organization_id=$1::uuid and user_id=$2::uuid and metadata->>'event_key'='whatsapp_inbound_attendant'),
 (select status from private.notification_deliveries where notification_id=$3::uuid limit 1),
 (select min(expires_at)=max(expires_at) from private.notification_deliveries where organization_id=$1::uuid)`, f.organizationID, f.nextID, f.notificationID).Scan(&count, &state, &sameExpiry); err != nil {
		t.Fatal(err)
	}
	if count != 1 || state != "cancelled" || !sameExpiry {
		t.Fatalf("wrong reroute: new=%d old=%s originalExpiry=%v", count, state, sameExpiry)
	}
	f.assertUnstarted(t)
}

type whatsappLocalPushTransport func(*http.Request) (*http.Response, error)

func (f whatsappLocalPushTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func (f *whatsappPushFixture) fakeHTTP(t *testing.T, expectedRecipient string, onRequest func()) *atomic.Int32 {
	t.Helper()
	requests := &atomic.Int32{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.Method != "POST" || r.URL.Path != "/fcm/send" {
			t.Errorf("unexpected fake HTTP %s %s", r.Method, r.URL.Path)
		}
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Error(err)
		}
		if body["to"] != expectedRecipient {
			t.Errorf("wrong recipient %v want %s", body["to"], expectedRecipient)
		}
		if strings.Contains(string(raw), "Synthetic push lead") || strings.Contains(string(raw), "Push fixture") {
			t.Error("push exposed lead/actor content")
		}
		if onRequest != nil {
			onRequest()
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"success":1,"failure":0,"results":[{"message_id":"synthetic-only"}]}`)
	}))
	t.Cleanup(server.Close)
	loopback, _ := url.Parse(server.URL)
	f.repo.notificationPush = &notificationPushClient{fcmServerKey: "synthetic-fixture-only",
		httpClient: &http.Client{Timeout: 4 * time.Second, Transport: whatsappLocalPushTransport(func(r *http.Request) (*http.Response, error) {
			if r.URL.Scheme != "https" || r.URL.Host != "fcm.googleapis.com" {
				t.Errorf("external HTTP denied: %s", r.URL.Host)
				return nil, context.Canceled
			}
			clone := r.Clone(r.Context())
			u := *r.URL
			u.Scheme = loopback.Scheme
			u.Host = loopback.Host
			clone.URL = &u
			return http.DefaultTransport.RoundTrip(clone)
		})}}
	return requests
}
