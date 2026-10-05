package whatsapp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type nativeTimestampFixture struct {
	db        *dbpkg.Postgres
	repo      Repository
	orgID     string
	ownerID   string
	sessionID string
	instance  string
}

func setupNativeTimestampFixture(t *testing.T) nativeTimestampFixture {
	t.Helper()
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	if target.Scheme != "postgres" && target.Scheme != "postgresql" {
		t.Fatal("WHATSAPP_TEST_DATABASE_URL must be a PostgreSQL URL")
	}
	switch strings.ToLower(target.Hostname()) {
	case "localhost", "127.0.0.1", "::1":
	default:
		t.Fatalf("WHATSAPP_TEST_DATABASE_URL must point to a disposable loopback database, got %q", target.Hostname())
	}
	if os.Getenv("WHATSAPP_TEST_ISOLATED") != "1" {
		t.Skip("WHATSAPP_TEST_ISOLATED=1 is required for the disposable timestamp fixture")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)
	instance := fmt.Sprintf("wa-timestamp-%d", time.Now().UnixNano())
	var orgID, ownerID, memberID, sessionID, pipelineID, stageID, queueID string
	if err := postgres.Pool().QueryRow(ctx, `insert into public.organizations(name,slug) values($1,$1) returning id::text`, instance).Scan(&orgID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		// Keep the local fixture from becoming eligible work in later tests.
		// Messages must go before sessions. A round robin cannot be hard-deleted
		// while its organization exists, so clear its fixture creator before
		// deleting users; the organization cascade then removes the queue.
		for _, statement := range []string{
			`delete from public.whatsapp_webhook_inbox where organization_id=$1::uuid`,
			`delete from public.whatsapp_messages where organization_id=$1::uuid`,
			`delete from public.whatsapp_conversations where organization_id=$1::uuid`,
			`delete from public.whatsapp_sessions where organization_id=$1::uuid`,
			`update public.round_robins set created_by=null where organization_id=$1::uuid`,
			`delete from public.users where organization_id=$1::uuid`,
			`delete from public.organizations where id=$1::uuid`,
		} {
			if _, err := postgres.Pool().Exec(cleanupCtx, statement, orgID); err != nil {
				t.Errorf("clean local timestamp fixture: %v", err)
			}
		}
		if _, err := postgres.Pool().Exec(cleanupCtx, `delete from auth.users where id in ($1::uuid,$2::uuid)`, ownerID, memberID); err != nil {
			t.Errorf("clean local timestamp users: %v", err)
		}
	})
	for _, userID := range []*string{&ownerID, &memberID} {
		if err := postgres.Pool().QueryRow(ctx, `select gen_random_uuid()::text`).Scan(userID); err != nil {
			t.Fatal(err)
		}
		if _, err := postgres.Pool().Exec(ctx, `insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values($1::uuid,'authenticated','authenticated',$2,'',now(),'{}'::jsonb,'{}'::jsonb,now(),now())`, *userID, *userID+"@example.invalid"); err != nil {
			t.Fatal(err)
		}
		if _, err := postgres.Pool().Exec(ctx, `insert into public.users(id,organization_id,name,email,role,is_active) values($1::uuid,$2::uuid,$3,$4,'user',true) on conflict(id) do update set organization_id=excluded.organization_id,name=excluded.name,email=excluded.email,role=excluded.role,is_active=excluded.is_active`, *userID, orgID, instance, *userID+"@example.invalid"); err != nil {
			t.Fatal(err)
		}
		if _, err := postgres.Pool().Exec(ctx, `insert into public.organization_members(organization_id,user_id,role,is_active) values($1::uuid,$2::uuid,'user',true) on conflict(user_id,organization_id) do update set role=excluded.role,is_active=true,deleted_at=null`, orgID, *userID); err != nil {
			t.Fatal(err)
		}
	}
	if err := postgres.Pool().QueryRow(ctx, `insert into public.whatsapp_sessions(organization_id,instance_name,instance_id,owner_user_id,provider,status,is_active,advanced_settings) values($1::uuid,$2,$2,$3::uuid,'evolution_go','connected',true,'{"token":"native-secret","webhook_token":"native-secret"}'::jsonb) returning id::text`, orgID, instance, ownerID).Scan(&sessionID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `insert into public.pipelines(organization_id,name,is_default,is_active,position) values($1::uuid,$2,true,true,0) returning id::text`, orgID, instance+" Pipeline").Scan(&pipelineID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `insert into public.stages(organization_id,pipeline_id,name,stage_key,position,is_active) values($1::uuid,$2::uuid,$3,'new',0,true) returning id::text`, orgID, pipelineID, instance+" Stage").Scan(&stageID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `insert into public.round_robins(organization_id,name,is_active,current_position,created_by,pipeline_id,target_pipeline_id,target_stage_id) values($1::uuid,$2,true,0,$3::uuid,$4::uuid,$4::uuid,$5::uuid) returning id::text`, orgID, instance+" RR", ownerID, pipelineID, stageID).Scan(&queueID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `insert into public.round_robin_members(organization_id,round_robin_id,user_id,position,is_active) values($1::uuid,$2::uuid,$3::uuid,0,true)`, orgID, queueID, memberID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `insert into public.round_robin_rules(organization_id,round_robin_id,match_type,match_value,is_active,priority) values($1::uuid,$2::uuid,'campaign_contains','Lumy Penha',true,100)`, orgID, queueID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `insert into public.whatsapp_inbound_rules(organization_id,session_id,name,match_type,match_field,match_value,priority,is_active,target_round_robin_id,campaign_label) values($1::uuid,$2::uuid,$3,'equals','ad_id','120249512922100328',100,true,$4::uuid,'Campanha roteada')`, orgID, sessionID, instance+" inbound", queueID); err != nil {
		t.Fatal(err)
	}
	var cutoffAt time.Time
	if err := postgres.Pool().QueryRow(ctx, `select private.activate_whatsapp_webhook_session_cutover($1::uuid)`, sessionID).Scan(&cutoffAt); err != nil {
		t.Fatal(err)
	}
	// Keep the documented second-resolution provider timestamp newer than the
	// cutover without waiting on wall time. This changes only the local fixture.
	if _, err := postgres.Pool().Exec(ctx, `update private.whatsapp_webhook_session_cutovers set cutoff_at=now()-interval '1 minute' where session_id=$1::uuid`, sessionID); err != nil {
		t.Fatal(err)
	}
	repo := NewRepository(postgres, nil, StorageConfig{})
	repo.functions.webhookProcessorMode = webhookProcessorNative
	repo.functions.webhookRolloutSessionIDs = []string{sessionID}
	repo.functions.inboundRecordingSessionIDs = []string{sessionID}
	return nativeTimestampFixture{db: postgres, repo: repo, orgID: orgID, ownerID: ownerID, sessionID: sessionID, instance: instance}
}

func (fixture nativeTimestampFixture) accept(t *testing.T, payload map[string]any) pendingEvolutionWebhook {
	return fixture.acceptWithStatus(t, payload, "pending")
}

func (fixture nativeTimestampFixture) acceptWithStatus(t *testing.T, payload map[string]any, wantStatus string) pendingEvolutionWebhook {
	t.Helper()
	payload["instanceToken"] = "native-secret"
	payload["instanceId"] = fixture.instance
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	envelope, err := parseEvolutionWebhookEnvelope(
		url.Values{"session_id": {fixture.sessionID}, "instance_id": {fixture.instance}},
		http.Header{}, body,
	)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	receipt, err := fixture.repo.AcceptEvolutionWebhook(ctx, envelope)
	if err != nil || receipt.Status != wantStatus {
		t.Fatalf("webhook ACK = %+v, error = %v", receipt, err)
	}
	var item pendingEvolutionWebhook
	item.OrganizationID = fixture.orgID
	item.SessionID = fixture.sessionID
	if err := fixture.db.Pool().QueryRow(ctx, `
		select id::text, event_type, payload, processing_lane, created_at
		from public.whatsapp_webhook_inbox where id=$1::uuid
	`, receipt.ID).Scan(&item.ID, &item.EventType, &item.Payload, &item.ProcessingLane, &item.CreatedAt); err != nil {
		t.Fatal(err)
	}
	return item
}

func (fixture nativeTimestampFixture) dispatch(t *testing.T, item pendingEvolutionWebhook) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	if err := fixture.repo.dispatchEvolutionWebhook(ctx, item); err != nil {
		t.Fatalf("native webhook dispatch: %v", err)
	}
}

func TestNativeDocumentedButtonClickRecordsVisibleNonleadText(t *testing.T) {
	fixture := setupNativeTimestampFixture(t)
	const phone = "5511999993333"
	const messageID = "provider-buttonclick-documented-1"
	const choice = "Suporte Técnico"
	item := fixture.accept(t, map[string]any{
		"event": "ButtonClick",
		"data": map[string]any{
			"buttonId": "suporte", "buttonText": choice,
			"type": "native_flow_response", "phone": phone,
			"jid": phone + "@s.whatsapp.net", "chat": phone + "@s.whatsapp.net",
			"messageId": messageID, "fromMe": false,
			"timestamp": time.Now().Add(-2 * time.Second).Unix(),
		},
	})
	fixture.dispatch(t, item)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var conversationID, captureState, content string
	var messageLeadID string
	if err := fixture.db.Pool().QueryRow(ctx, `
		select conversation_id::text, capture_state, coalesce(content,''), coalesce(lead_id::text,'')
		from public.whatsapp_messages
		where organization_id=$1::uuid and session_id=$2::uuid and provider_message_id=$3
	`, fixture.orgID, fixture.sessionID, messageID).Scan(&conversationID, &captureState, &content, &messageLeadID); err != nil {
		t.Fatal(err)
	}
	if captureState != "recorded" || content != choice || messageLeadID != "" {
		t.Fatalf("ButtonClick stored state=%q content=%q lead=%q", captureState, content, messageLeadID)
	}
	page, err := fixture.repo.ListMessages(ctx, tenant.Context{
		OrganizationID: fixture.orgID, UserID: fixture.ownerID,
		MemberRole: "user", Permissions: []string{permissions.LeadViewOwn},
	}, conversationID, MessageFilter{Limit: 50, ExpectedLeadID: unlinkedConversationLeadSnapshot})
	if err != nil || len(page.Messages) != 1 || pointerValue(page.Messages[0].Content) != choice {
		t.Fatalf("owner's visible ButtonClick history = %#v, error = %v", page.Messages, err)
	}
}

func TestNativeTimestamplessCTWACannotCreateLeadOrEffects(t *testing.T) {
	fixture := setupNativeTimestampFixture(t)
	payload := decodeNativeFixture(t, "meta_ctwa_instagram.json")
	message := mapFromAny(mapFromAny(payload["data"])["message"])
	info := mapFromAny(message["Info"])
	key := mapFromAny(message["key"])
	const phone = "559491298299"
	const providerID = "provider-meta-ctwa-no-time-1"
	delete(info, "Timestamp")
	info["ID"] = providerID
	info["Chat"] = phone + "@s.whatsapp.net"
	info["SenderPN"] = phone + "@s.whatsapp.net"
	key["id"] = providerID
	key["remoteJid"] = phone + "@s.whatsapp.net"
	parsed := extractNativeEvolutionMessages(payload)
	if len(parsed) != 1 || !parsed[0].ProviderTimestampMissing || !parsed[0].IsCTWAAd {
		t.Fatalf("timestamp-less CTWA fixture was not classified as intended: %#v", parsed)
	}
	item := fixture.acceptWithStatus(t, payload, "processed")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var leadsAtACK int
	if err := fixture.db.Pool().QueryRow(ctx, `
		select count(*)::integer from public.leads
		where organization_id=$1::uuid and normalize_phone(phone)=normalize_phone($2)
	`, fixture.orgID, phone).Scan(&leadsAtACK); err != nil {
		t.Fatal(err)
	}
	if leadsAtACK != 0 {
		t.Fatalf("timestamp-less CTWA created %d leads during durable ACK", leadsAtACK)
	}
	if evolutionWebhookTechnicalIgnoreReason(item) != "" {
		// The persisted receipt is intentionally redacted, so its reason is read
		// from the inbox column below rather than reconstructed from payload.
		t.Fatal("ignored CTWA receipt still exposes a classifiable provider payload")
	}
	var ignoredReason, payloadText string
	if err := fixture.db.Pool().QueryRow(ctx, `
		select coalesce(ignored_reason,''), payload::text
		from public.whatsapp_webhook_inbox where id=$1::uuid
	`, item.ID).Scan(&ignoredReason, &payloadText); err != nil {
		t.Fatal(err)
	}
	if ignoredReason != "ctwa_provider_timestamp_missing" || strings.Contains(payloadText, providerID) || strings.Contains(payloadText, phone) {
		t.Fatalf("timestamp-less CTWA receipt reason=%q payload=%q", ignoredReason, payloadText)
	}
	// An older inbox row with the original body must also be a no-effect
	// dispatch if a previous API replica accepted it before this ingress guard.
	legacyPayload, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	legacyItem := item
	legacyItem.Payload = legacyPayload
	if reason := evolutionWebhookTechnicalIgnoreReason(legacyItem); reason != "ctwa_provider_timestamp_missing" {
		t.Fatalf("older CTWA receipt ignore reason = %q", reason)
	}
	fixture.dispatch(t, legacyItem)
	var leads, messages, inboundLogs int
	if err := fixture.db.Pool().QueryRow(ctx, `
		select
		  (select count(*)::integer from public.leads where organization_id=$1::uuid and normalize_phone(phone)=normalize_phone($2)),
		  (select count(*)::integer from public.whatsapp_messages where organization_id=$1::uuid and session_id=$3::uuid and provider_message_id=$4),
		  (select count(*)::integer from public.whatsapp_inbound_logs where organization_id=$1::uuid and session_id=$3::uuid and match_details->>'message_id'=$4)
	`, fixture.orgID, phone, fixture.sessionID, providerID).Scan(&leads, &messages, &inboundLogs); err != nil {
		t.Fatal(err)
	}
	if leads != 0 || messages != 0 || inboundLogs != 0 {
		t.Fatalf("timestamp-less CTWA created effects: leads=%d messages=%d inbound_logs=%d", leads, messages, inboundLogs)
	}
}
