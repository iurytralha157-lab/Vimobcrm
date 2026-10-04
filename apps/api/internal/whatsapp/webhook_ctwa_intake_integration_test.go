package whatsapp

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestNativeCTWAWithCanonicalCampaignQueueIntegration(t *testing.T) {
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
		t.Fatalf("WHATSAPP_TEST_DATABASE_URL must use a disposable loopback database, got %q", target.Hostname())
	}
	if os.Getenv("WHATSAPP_TEST_ISOLATED") != "1" {
		t.Skip("WHATSAPP_TEST_ISOLATED=1 is required for the disposable CTWA fixture")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer postgres.Close()
	suffix := fmt.Sprintf("wa-ctwa-queue-%d", time.Now().UnixNano())
	var orgID, ownerID, memberID, sessionID, pipelineID, stageID, queueID string
	if err := postgres.Pool().QueryRow(ctx, `insert into public.organizations(name,slug) values($1,$1) returning id::text`, suffix).Scan(&orgID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from public.organizations where id=$1::uuid`, orgID)
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from auth.users where id in ($1::uuid,$2::uuid)`, ownerID, memberID)
	}()
	for _, userID := range []*string{&ownerID, &memberID} {
		if err := postgres.Pool().QueryRow(ctx, `select gen_random_uuid()::text`).Scan(userID); err != nil {
			t.Fatal(err)
		}
		if _, err := postgres.Pool().Exec(ctx, `insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values($1::uuid,'authenticated','authenticated',$2,'',now(),'{}'::jsonb,'{}'::jsonb,now(),now())`, *userID, *userID+"@example.invalid"); err != nil {
			t.Fatal(err)
		}
		if _, err := postgres.Pool().Exec(ctx, `insert into public.users(id,organization_id,name,email,role,is_active) values($1::uuid,$2::uuid,$3,$4,'user',true) on conflict(id) do update set organization_id=excluded.organization_id,name=excluded.name,email=excluded.email,role=excluded.role,is_active=excluded.is_active`, *userID, orgID, suffix, *userID+"@example.invalid"); err != nil {
			t.Fatal(err)
		}
		if _, err := postgres.Pool().Exec(ctx, `insert into public.organization_members(organization_id,user_id,role,is_active) values($1::uuid,$2::uuid,'user',true) on conflict(user_id,organization_id) do update set role=excluded.role,is_active=true,deleted_at=null`, orgID, *userID); err != nil {
			t.Fatal(err)
		}
	}
	if err := postgres.Pool().QueryRow(ctx, `insert into public.whatsapp_sessions(organization_id,instance_name,instance_id,owner_user_id,provider,status,is_active,advanced_settings) values($1::uuid,$2,$2,$3::uuid,'evolution_go','connected',true,'{"webhook_token":"native-secret"}'::jsonb) returning id::text`, orgID, suffix, ownerID).Scan(&sessionID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `insert into public.pipelines(organization_id,name,is_default,is_active,position) values($1::uuid,$2,true,true,0) returning id::text`, orgID, suffix+" Pipeline").Scan(&pipelineID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `insert into public.stages(organization_id,pipeline_id,name,stage_key,position,is_active) values($1::uuid,$2::uuid,$3,'new',0,true) returning id::text`, orgID, pipelineID, suffix+" Stage").Scan(&stageID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `insert into public.round_robins(organization_id,name,is_active,current_position,created_by,pipeline_id,target_pipeline_id,target_stage_id) values($1::uuid,$2,true,0,$3::uuid,$4::uuid,$4::uuid,$5::uuid) returning id::text`, orgID, suffix+" RR", ownerID, pipelineID, stageID).Scan(&queueID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `insert into public.round_robin_members(organization_id,round_robin_id,user_id,position,is_active) values($1::uuid,$2::uuid,$3::uuid,0,true)`, orgID, queueID, memberID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `insert into public.round_robin_rules(organization_id,round_robin_id,match_type,match_value,is_active,priority) values($1::uuid,$2::uuid,'campaign_contains','Lumy Penha',true,100)`, orgID, queueID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `insert into public.whatsapp_inbound_rules(organization_id,session_id,name,match_type,match_field,match_value,priority,is_active,target_round_robin_id,campaign_label) values($1::uuid,$2::uuid,$3,'equals','ad_id','120249512922100328',100,true,$4::uuid,'Campanha roteada')`, orgID, sessionID, suffix+" inbound", queueID); err != nil {
		t.Fatal(err)
	}
	repo := NewRepository(postgres, nil, StorageConfig{})
	event := pendingEvolutionWebhook{ID: "77777777-7777-4777-8777-777777777779", OrganizationID: orgID, SessionID: sessionID, EventType: "messages.upsert", Payload: readNativeFixture(t, "meta_ctwa_instagram.json"), ProcessingLane: evolutionWebhookLaneLive, CreatedAt: time.Now().UTC()}
	if handled, err := repo.processEvolutionWebhookNative(ctx, event); err != nil || !handled {
		t.Fatalf("canonical CTWA = handled:%v error:%v", handled, err)
	}
	var leadCount int
	var persistedQueueID string
	if err := postgres.Pool().QueryRow(ctx, `select count(*)::integer, coalesce(max(origin_round_robin_id::text),'') from public.leads where organization_id=$1::uuid and normalize_phone(phone)=normalize_phone('559491298288')`, orgID).Scan(&leadCount, &persistedQueueID); err != nil {
		t.Fatal(err)
	}
	if leadCount != 1 || persistedQueueID != queueID {
		t.Fatalf("canonical CTWA lead = count:%d queue:%s, want one lead in %s", leadCount, persistedQueueID, queueID)
	}
}
