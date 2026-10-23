package leads

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// The sender is a closure only: this test never reaches HTTP, FCM, APNs or a
// browser push subscription. The second connection exercises real row locks.
func TestWhatsAppPushCommitsProviderStartBeforeSenderAndTransfer(t *testing.T) {
	if os.Getenv("VIMOB_RUN_WHATSAPP_PUSH_DB_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("set VIMOB_RUN_WHATSAPP_PUSH_DB_TESTS=LOCAL_WRITE_TEST for the disposable fixture")
	}
	target, err := url.Parse(strings.TrimSpace(os.Getenv("WHATSAPP_PUSH_TEST_DATABASE_URL")))
	if err != nil || target.User == nil || target.User.Username() != "postgres" ||
		(target.Hostname() != "127.0.0.1" && target.Hostname() != "localhost") ||
		(target.Path != "/vimob_whatsapp_clone" && target.Path != "/vimob_whatsapp_test") {
		t.Fatal("push fixture requires a disposable loopback vimob_whatsapp_clone/test database")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 40*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: target.String(), MaxConns: 3, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	pool := database.Pool()
	var organizationID, ownerID, firstID, nextID, sessionID, leadID, conversationID, firstTokenID, nextTokenID string
	if err := pool.QueryRow(ctx, `select gen_random_uuid()::text,gen_random_uuid()::text,gen_random_uuid()::text,
		gen_random_uuid()::text,gen_random_uuid()::text,gen_random_uuid()::text,gen_random_uuid()::text,
		gen_random_uuid()::text,gen_random_uuid()::text`).Scan(&organizationID, &ownerID, &firstID, &nextID,
		&sessionID, &leadID, &conversationID, &firstTokenID, &nextTokenID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanupContext, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		if _, err := pool.Exec(cleanupContext, `update public.users set organization_id=null where organization_id=$1::uuid;
			delete from public.organizations where id=$1::uuid;
			delete from public.users where id=any($2::uuid[]);delete from auth.users where id=any($2::uuid[])`,
			organizationID, []string{ownerID, firstID, nextID}); err != nil {
			t.Errorf("cleanup disposable push fixture: %v", err)
		}
	}()
	_, err = pool.Exec(ctx, `
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
	`, organizationID, ownerID, firstID, nextID, sessionID, leadID, conversationID, firstTokenID, nextTokenID)
	if err != nil {
		t.Fatal(err)
	}
	var delivery normalizedNotificationDelivery
	err = pool.QueryRow(ctx, `update private.notification_deliveries set status='leased',lease_token=gen_random_uuid(),
		leased_by='push-fence-fixture',lease_expires_at=now()+interval '1 minute',next_attempt_at=null
		where organization_id=$1::uuid and push_token_id=$2::uuid returning id::text,notification_id::text,
		organization_id::text,user_id::text,channel,lease_token::text`, organizationID, firstTokenID).Scan(
		&delivery.ID, &delivery.NotificationID, &delivery.OrganizationID, &delivery.UserID, &delivery.Channel, &delivery.LeaseToken)
	if err != nil {
		t.Fatal(err)
	}
	repo := Repository{db: database}
	notification, err := repo.loadNormalizedPendingNotification(ctx, delivery)
	if err != nil {
		t.Fatal(err)
	}
	transferConnection, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer transferConnection.Release()
	sent := false
	preflight := repo.fenceNormalizedWhatsAppInboundPush(ctx, delivery, notification, func(pgx.Tx) normalizedNotificationPreflight {
		return normalizedNotificationPreflight{
			Provider: "fake_push", Send: func(sendContext context.Context) DispatchChannelResult {
				sent = true
				if deadline, ok := sendContext.Deadline(); !ok || time.Until(deadline) > whatsappInboundPushTimeout {
					t.Fatal("sender did not receive a bounded push context")
				}
				transferContext, transferCancel := context.WithTimeout(sendContext, 2*time.Second)
				defer transferCancel()
				var started bool
				if err := transferConnection.QueryRow(transferContext, `select status='sending' and attempt_count=1
				from private.notification_deliveries where id=$1::uuid`, delivery.ID).Scan(&started); err != nil || !started {
					t.Fatalf("provider marker was not committed before sender: %t %v", started, err)
				}
				if _, err := transferConnection.Exec(transferContext, `update public.leads set assigned_user_id=$2::uuid where id=$1::uuid`, leadID, nextID); err != nil {
					t.Fatalf("sender retained authorization locks during transfer: %v", err)
				}
				var outcome string
				if err := transferConnection.QueryRow(transferContext, `select private.prepare_whatsapp_inbound_attendant_push($1::uuid)`, notification.ID).Scan(&outcome); err != nil || outcome != "revoked" {
					t.Fatalf("provider-started alert redirected after transfer: %q %v", outcome, err)
				}
				return DispatchChannelResult{Enabled: true, Attempted: true, OK: true, Provider: "fake_push", Sent: 1}
			},
		}
	})
	if preflight.Release != nil {
		defer preflight.Release()
	}
	if preflight.Failure != nil || preflight.Finalized || preflight.Start == nil || preflight.Send == nil {
		t.Fatalf("initial current attendant was not ready: %+v", preflight)
	}
	if sent {
		t.Fatal("preflight invoked the sender")
	}
	if err := preflight.Start(ctx); err != nil {
		t.Fatal(err)
	}
	if result := preflight.Send(ctx); !result.OK || !sent {
		t.Fatalf("fake sender did not execute: %+v", result)
	}
	var count int
	if err := transferConnection.QueryRow(ctx, `select count(*) from public.notifications where organization_id=$1::uuid
		and metadata->>'event_key'='whatsapp_inbound_attendant'`, organizationID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("started alert emitted a duplicate for new attendant: %d %v", count, err)
	}
}
