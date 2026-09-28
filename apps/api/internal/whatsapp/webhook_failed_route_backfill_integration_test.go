package whatsapp

import (
	"context"
	"encoding/json"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// Requires the disposable PG17 seed with 25 roots installed during PRELOAD
// and backfilled by ACTIVATE. No new webhook is delivered after the roots die.
func TestFailedRouteBackfillReconcilesWithoutNewWebhook(t *testing.T) {
	if os.Getenv("WHATSAPP_FAILED_ROUTE_BACKFILL_FIXTURE") != "1" {
		t.Skip("set WHATSAPP_FAILED_ROUTE_BACKFILL_FIXTURE=1 for disposable PG17 seed")
	}
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_TEST_DATABASE_URL"))
	target, err := url.Parse(databaseURL)
	if err != nil || (target.Hostname() != "localhost" && target.Hostname() != "127.0.0.1") {
		t.Fatal("backfill fixture requires a loopback test database URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 5 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer postgres.Close()
	repo := NewRepository(postgres, nil, StorageConfig{})
	for range 3 {
		if err := repo.reconcileFailedRouteCandidates(ctx, nil); err != nil {
			t.Fatalf("reconcile without new ingress: %v", err)
		}
	}
	var candidates, organizations, fences, raw, liveChildren, outcomes, messages int
	if err := postgres.Pool().QueryRow(ctx, `select
		(select count(*) from private.whatsapp_failed_route_candidates
		  where provider_message_id like 'backfill-root-%'),
		(select count(distinct organization_id) from private.whatsapp_failed_route_candidates
		  where provider_message_id like 'backfill-root-%'),
		(select count(*) from private.whatsapp_failed_route_epoch_fences f
		  join private.whatsapp_failed_route_candidates c on c.root_inbox_id=f.root_inbox_id
		  where c.provider_message_id like 'backfill-root-%' and f.state='held'),
		(select count(*) from private.whatsapp_failed_route_epoch_raw a
		  join private.whatsapp_failed_route_epoch_fences f on f.id=a.fence_id
		  join private.whatsapp_failed_route_candidates c on c.root_inbox_id=f.root_inbox_id
		  where c.provider_message_id like 'backfill-root-%'
		    and a.retained_until='infinity'::timestamptz
		    and a.payload_sha256=private.canonical_jsonb_sha256(a.original_inbox->'payload')),
		(select count(*) from public.whatsapp_webhook_inbox
		  where event_key like 'backfill-child-event-%' and status='pending'),
		(select count(*) from public.whatsapp_webhook_routing_outcomes
		  where provider_message_id like 'backfill-root-%'
		     or provider_message_id like 'backfill-child-%'),
		(select count(*) from public.whatsapp_messages
		  where provider_message_id like 'backfill-root-%'
		     or provider_message_id like 'backfill-child-%')`).Scan(
		&candidates, &organizations, &fences, &raw, &liveChildren, &outcomes, &messages,
	); err != nil {
		t.Fatal(err)
	}
	if candidates != 25 || organizations != 2 || fences != 25 || raw != 50 ||
		liveChildren != 25 || outcomes != 0 || messages != 0 {
		t.Fatalf("backfill result candidates/orgs/fences/raw/live/outcomes/messages = %d/%d/%d/%d/%d/%d/%d",
			candidates, organizations, fences, raw, liveChildren, outcomes, messages)
	}
	if held, _, err := repo.claimEvolutionWebhooksForLane(
		ctx, evolutionWebhookLaneLive, 30, ""); err != nil || len(held) != 0 {
		t.Fatalf("held children were claimable: count=%d err=%v", len(held), err)
	}

	// The next message on a proven current lead starts a fresh bound epoch and
	// is claimable immediately even while the old child remains HELD.
	var orgID, sessionID, routeKey, leadID string
	if err := postgres.Pool().QueryRow(ctx, `select c.organization_id::text,
		c.session_id::text,c.routing_key,f.lead_id_at_fence::text
		from private.whatsapp_failed_route_candidates c
		join private.whatsapp_failed_route_epoch_fences f on f.root_inbox_id=c.root_inbox_id
		where c.provider_message_id='backfill-root-1'`).Scan(
		&orgID, &sessionID, &routeKey, &leadID,
	); err != nil {
		t.Fatal(err)
	}
	phone := strings.TrimPrefix(routeKey, "phone:")
	var snapshotText string
	if err := postgres.Pool().QueryRow(ctx, `select private.capture_whatsapp_webhook_routing_snapshot(
		$1::uuid,$2::uuid,'backfill-fresh-1','backfill-fresh-event-1','live',
		$3,true,array[$4],$5,'organic',null,false,false,false,null,null,null)::text`,
		orgID, sessionID, routeKey, phone+"@s.whatsapp.net", phone,
	).Scan(&snapshotText); err != nil {
		t.Fatal(err)
	}
	var snapshot map[string]any
	if err := json.Unmarshal([]byte(snapshotText), &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot["state"] != "bound" || snapshot["current_lead_id"] != leadID ||
		snapshot["predecessor_provider_message_id"] != nil {
		t.Fatalf("fresh route did not bind to its current lead independently: %#v", snapshot)
	}
	payload, err := json.Marshal(map[string]any{
		"data": map[string]any{
			"Info":    map[string]any{"ID": "backfill-fresh-1"},
			"Message": map[string]any{"conversation": "New lead message"},
		},
		"__vimob_ingress": map[string]any{
			"routing_key":      routeKey,
			"routing_snapshot": map[string]any{"version": 1, "messages": []any{snapshot}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	var freshInboxID string
	if err := postgres.Pool().QueryRow(ctx, `insert into public.whatsapp_webhook_inbox
		(organization_id,session_id,event_key,event_type,payload,processing_lane)
		values ($1::uuid,$2::uuid,'backfill-fresh-event-1','message',$3::jsonb,'live')
		returning id::text`, orgID, sessionID, string(payload)).Scan(&freshInboxID); err != nil {
		t.Fatal(err)
	}
	claimed, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 30, "")
	if err != nil || len(claimed) != 1 || claimed[0].ID != freshInboxID {
		t.Fatalf("new lead message behind HELD old work was not claimable: count=%d err=%v", len(claimed), err)
	}
}
