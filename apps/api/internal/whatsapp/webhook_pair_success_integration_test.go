package whatsapp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestPairSuccessConnectedSessionNeverCreatesLeadMessage(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}
	target, err := url.Parse(databaseURL)
	if err != nil || (target.Hostname() != "localhost" && target.Hostname() != "127.0.0.1") {
		t.Fatal("WHATSAPP_TEST_DATABASE_URL must be a loopback URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 5 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)
	suffix := fmt.Sprintf("pair-success-%d", time.Now().UnixNano())
	var orgID, userID, sessionID string
	if err := postgres.Pool().QueryRow(ctx, `insert into public.organizations(name,slug) values ($1,$1) returning id::text`, suffix).Scan(&orgID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from public.whatsapp_webhook_inbox where organization_id=$1::uuid`, orgID)
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from public.whatsapp_webhook_routing_snapshots where organization_id=$1::uuid`, orgID)
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from public.whatsapp_sessions where organization_id=$1::uuid`, orgID)
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from public.organizations where id=$1::uuid`, orgID)
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from auth.users where id=$1::uuid`, userID)
	})
	if err := postgres.Pool().QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `insert into auth.users
		(id,aud,role,email,encrypted_password,confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
		values ($1::uuid,'authenticated','authenticated',$2,'',now(),'{}'::jsonb,'{}'::jsonb,now(),now())`, userID, suffix+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `insert into public.users
		(id,organization_id,name,email,is_active) values ($1::uuid,$2::uuid,$3,$4,true)`,
		userID, orgID, suffix, suffix+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `insert into public.whatsapp_sessions
		(organization_id,instance_name,instance_id,owner_user_id,provider,status,is_active,phone_number,advanced_settings)
		values ($1::uuid,$2,$2,$3::uuid,'evolution_go','connected',true,'5511999990000',
		'{"webhook_token":"fixture-webhook","token":"fixture-provider"}'::jsonb)
		returning id::text`, orgID, suffix, userID).Scan(&sessionID); err != nil {
		t.Fatal(err)
	}
	repo := NewRepository(postgres, nil, StorageConfig{})
	payload := pairSuccessFixture(t, false)
	payload["instanceId"] = suffix
	payload["instanceName"] = suffix
	// The signed event has a different jid from the already connected session.
	// The stale control must not replace that identity or create any lead row.
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	receipt, err := repo.AcceptEvolutionWebhook(ctx, evolutionWebhookEnvelope{
		SessionID: sessionID, InstanceID: suffix, EventType: "pairsuccess",
		InstanceToken: "fixture-provider", WebhookHeaderTokens: []string{"fixture-webhook"},
		EventKey: suffix + ":inline", Payload: encoded, ReceivedAt: time.Now().UTC(),
	})
	if err != nil || receipt.Status != "processed" || !receipt.Inline {
		t.Fatalf("PairSuccess inline receipt=%+v err=%v", receipt, err)
	}
	backlogPayload := pairSuccessFixture(t, true)
	backlogPayload["instanceId"] = suffix
	backlogPayload["instanceName"] = suffix
	encoded, err = json.Marshal(backlogPayload)
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.dispatchEvolutionWebhook(ctx, pendingEvolutionWebhook{
		ID: suffix + ":backlog", OrganizationID: orgID, SessionID: sessionID,
		EventType: "pairsuccess", Payload: encoded,
	}); err != nil {
		t.Fatalf("PairSuccess backlog dispatch: %v", err)
	}
	var phone string
	var inboxCount, routeCount, leadCount int
	if err := postgres.Pool().QueryRow(ctx, `select phone_number from public.whatsapp_sessions where id=$1::uuid`, sessionID).Scan(&phone); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `select count(*) from public.whatsapp_webhook_inbox where organization_id=$1::uuid`, orgID).Scan(&inboxCount); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `select count(*) from public.whatsapp_webhook_routing_snapshots where organization_id=$1::uuid`, orgID).Scan(&routeCount); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `select count(*) from public.leads where organization_id=$1::uuid`, orgID).Scan(&leadCount); err != nil {
		t.Fatal(err)
	}
	if phone != "5511999990000" || inboxCount != 0 || routeCount != 0 || leadCount != 0 {
		t.Fatalf("PairSuccess mutated state: phone_match=%v inbox=%d routes=%d leads=%d",
			phone == "5511999990000", inboxCount, routeCount, leadCount)
	}
}
