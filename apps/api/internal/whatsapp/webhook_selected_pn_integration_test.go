package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestSelectedLIDPNRouteRejectsDifferentPhysicalPN(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	f := newWebhookDependencyFixture(t, ctx, db, "selected-pn")
	const lid = "777777777@lid"
	const otherPN = "5511988881111@s.whatsapp.net"
	if _, err := db.Pool().Exec(ctx, `insert into public.whatsapp_contact_identity_aliases
	 (organization_id,session_id,alias_jid,canonical_jid) values($1::uuid,$2::uuid,$3,$4)`, f.organizationID, f.sessionID, lid, f.remoteJID); err != nil {
		t.Fatal(err)
	}
	tx, err := db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var snapshot string
	err = tx.QueryRow(ctx, `select private.capture_whatsapp_webhook_routing_snapshot_v2(
	 $1::uuid,$2::uuid,$3,$3,'live','phone:5511988881111',true,$4::text[],'5511988881111','organic',null,
	 false,false,false,null,null,null,1)::text`, f.organizationID, f.sessionID, f.suffix+"-conflict", []string{lid, otherPN}).Scan(&snapshot)
	rollbackWebhookTx(tx)
	var pgerr *pgconn.PgError
	if !errorsAsPNGuard(err, &pgerr) {
		t.Fatalf("opaque primary LID hid explicit PN mismatch: err=%v snapshot=%s", err, snapshot)
	}
	var count int
	if err := db.Pool().QueryRow(ctx, `select count(*) from public.whatsapp_webhook_routing_snapshots where organization_id=$1::uuid`, f.organizationID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("selected-route conflict retained provenance=%d/%v", count, err)
	}
	if _, err := db.Pool().Exec(ctx, `select private.capture_whatsapp_webhook_routing_snapshot_v2(
	 $1::uuid,$2::uuid,$3,$3,'live','phone:valid',true,$4::text[],$5,'organic',null,
	 false,false,false,null,null,null,1)`, f.organizationID, f.sessionID, f.suffix+"-valid", []string{lid, f.remoteJID}, "+"+normalizeDigits(f.remoteJID)); err != nil {
		t.Fatalf("valid LID+PN route denied: %v", err)
	}
}

func TestSelectedPNQuarantineKeepsValidSiblingAndFencedEdgeProof(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	f := newWebhookDependencyFixture(t, ctx, db, "selected-pn-mixed")
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		for _, query := range []string{`delete from public.whatsapp_inbound_logs where organization_id=$1::uuid`,
			`delete from private.realtime_events where organization_id=$1::uuid`,
			`delete from private.notification_deliveries where organization_id=$1::uuid`,
			`delete from public.notifications where organization_id=$1::uuid`,
			`delete from public.whatsapp_messages where organization_id=$1::uuid`} {
			if _, err := db.Pool().Exec(cleanup, query, f.organizationID); err != nil {
				t.Error(err)
			}
		}
	})
	repo := NewRepository(db, nil, StorageConfig{})
	repo.functions.webhookProcessorMode = webhookProcessorNative
	repo.functions.webhookRolloutSessionIDs = []string{f.sessionID}
	const lid = "888888888@lid"
	if _, err := db.Pool().Exec(ctx, `delete from private.whatsapp_webhook_session_cutovers where session_id=$1::uuid;
	 update public.whatsapp_sessions set advanced_settings='{"token":"synthetic-selected-pn","webhook_token":"synthetic-selected-hook"}'::jsonb where id=$1::uuid`, f.sessionID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.JoinConversationAttendance(ctx, f.tenant, f.conversationID, attendanceInput{ExpectedLeadID: f.leadID, SendSessionID: f.sessionID}); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool().Exec(ctx, `insert into public.whatsapp_contact_identity_aliases
	 (organization_id,session_id,alias_jid,canonical_jid) values($1::uuid,$2::uuid,$3,$4)`, f.organizationID, f.sessionID, lid, f.remoteJID); err != nil {
		t.Fatal(err)
	}
	badID, goodID := f.suffix+"-quarantined", f.suffix+"-valid"
	payload, _ := json.Marshal(map[string]any{"event": "message", "data": map[string]any{"messages": []any{
		map[string]any{"Info": map[string]any{"ID": badID, "Chat": lid, "SenderPN": "5511988881111@s.whatsapp.net", "Timestamp": time.Now().UTC().Format(time.RFC3339Nano)}, "Message": map[string]any{"conversation": "must not attach B"}},
		map[string]any{"Info": map[string]any{"ID": goodID, "Chat": f.remoteJID, "SenderPN": f.remoteJID, "Timestamp": time.Now().UTC().Format(time.RFC3339Nano)}, "Message": map[string]any{"conversation": "valid selected sibling"}},
	}}, "__vimob_ingress": map[string]any{"identity_quarantine_reason": whatsappPNRouteConflictReason, "identity_quarantined_provider_message_ids": []string{goodID}}})
	receipt, err := repo.AcceptEvolutionWebhook(ctx, evolutionWebhookEnvelope{SessionID: f.sessionID, InstanceToken: "synthetic-selected-pn", WebhookHeaderTokens: []string{"synthetic-selected-hook"}, EventType: "message", Payload: payload, ReceivedAt: time.Now().UTC()})
	if err != nil {
		t.Fatal(err)
	}
	items, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
	if err != nil || len(items) != 1 || items[0].ID != receipt.ID {
		t.Fatalf("quarantine head claim=%d/%v", len(items), err)
	}
	item := items[0]
	if err := repo.verifyWebhookPNRouteQuarantine(ctx, item); err != nil {
		t.Fatal(err)
	}
	decoded, _ := decodeNativeEvolutionPayload(item.Payload)
	if ids := nativeWebhookQuarantinedIDs(decoded); len(ids) != 1 || ids[0] != badID {
		t.Fatalf("raw provider spoof survived canonical admission: %v", ids)
	}
	metadata := mapFromAny(decoded[evolutionWebhookRoutingMetaKey])
	metadata["identity_quarantined_provider_message_ids"] = []string{goodID}
	forged := item
	forged.Payload, _ = json.Marshal(decoded)
	if err := repo.verifyWebhookPNRouteQuarantine(ctx, forged); err == nil {
		t.Fatal("in-memory forged IDs borrowed the durable ignored-event proof")
	}
	var execution string
	if err := db.Pool().QueryRow(ctx, `select public.reserve_whatsapp_webhook_edge_execution($1::uuid,$2::uuid,$3::uuid,$4)::text`, f.organizationID, f.sessionID, item.ID, whatsappWebhookWorkerID).Scan(&execution); err != nil || execution == "" {
		t.Fatalf("reserve real Edge fence=%s/%v", execution, err)
	}
	var started bool
	if err := db.Pool().QueryRow(ctx, `select public.start_whatsapp_webhook_edge_execution($1::uuid,$2::uuid,$3::uuid,$4::uuid)`, f.organizationID, f.sessionID, item.ID, execution).Scan(&started); err != nil || !started {
		t.Fatalf("start real Edge fence=%v/%v", started, err)
	}
	var canonicalIDs []byte
	if err := db.Pool().QueryRow(ctx, `select public.read_whatsapp_webhook_pn_route_quarantine($1::uuid,$2::uuid,$3::uuid,$4::uuid)`, f.organizationID, f.sessionID, item.ID, execution).Scan(&canonicalIDs); err != nil || string(canonicalIDs) != `["`+badID+`"]` {
		t.Fatalf("canonical Edge proof=%s/%v", canonicalIDs, err)
	}
	serviceTx, err := db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := serviceTx.Exec(ctx, "set local role service_role"); err != nil {
		t.Fatal(err)
	}
	if err := serviceTx.QueryRow(ctx, `select public.read_whatsapp_webhook_pn_route_quarantine($1::uuid,$2::uuid,$3::uuid,$4::uuid)`, f.organizationID, f.sessionID, item.ID, execution).Scan(&canonicalIDs); err != nil || string(canonicalIDs) != `["`+badID+`"]` {
		t.Fatalf("service-only canonical Edge proof=%s/%v", canonicalIDs, err)
	}
	rollbackWebhookTx(serviceTx)
	for _, role := range []string{"anon", "authenticated"} {
		tx, err := db.Pool().Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, "set local role "+role); err != nil {
			t.Fatal(err)
		}
		_, err = tx.Exec(ctx, `select public.read_whatsapp_webhook_pn_route_quarantine($1::uuid,$2::uuid,$3::uuid,$4::uuid)`, f.organizationID, f.sessionID, item.ID, execution)
		rollbackWebhookTx(tx)
		var denied *pgconn.PgError
		if !errors.As(err, &denied) || denied.Code != "42501" {
			t.Fatalf("%s service-only quarantine ACL denial=%v", role, err)
		}
	}
	for _, args := range [][]any{
		{"00000000-0000-4000-8000-000000000001", f.sessionID, item.ID, execution},
		{f.organizationID, f.sessionID, item.ID, "00000000-0000-4000-8000-000000000002"},
	} {
		var denied []byte
		if err := db.Pool().QueryRow(ctx, `select public.read_whatsapp_webhook_pn_route_quarantine($1::uuid,$2::uuid,$3::uuid,$4::uuid)`, args...).Scan(&denied); err != nil || denied != nil {
			t.Fatalf("wrong org/stale lease read IDs=%s/%v", denied, err)
		}
	}
	var finished bool
	if err := db.Pool().QueryRow(ctx, `select public.finish_whatsapp_webhook_edge_execution($1::uuid,$2::uuid,$3::uuid,$4::uuid)`, f.organizationID, f.sessionID, item.ID, execution).Scan(&finished); err != nil || !finished {
		t.Fatalf("finish Edge proof fixture=%v/%v", finished, err)
	}
	if err := repo.processClaimedEvolutionWebhook(ctx, item); err != nil {
		t.Fatal(err)
	}
	items, _, err = repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
	if err != nil || len(items) != 1 {
		t.Fatalf("valid sibling was blocked=%d/%v", len(items), err)
	}
	if err := repo.processClaimedEvolutionWebhook(ctx, items[0]); err != nil {
		t.Fatal(err)
	}
	var bad, good, snapshots, outcomes, processed int
	if err := db.Pool().QueryRow(ctx, `select
	 (select count(*) from public.whatsapp_messages where organization_id=$1::uuid and provider_message_id=$2),
	 (select count(*) from public.whatsapp_messages where organization_id=$1::uuid and provider_message_id=$3 and capture_state='captured' and lead_id=$4::uuid),
	 (select count(*) from public.whatsapp_webhook_routing_snapshots where organization_id=$1::uuid),
	 (select count(*) from public.whatsapp_webhook_routing_outcomes where organization_id=$1::uuid),
	 (select count(*) from public.whatsapp_webhook_inbox where organization_id=$1::uuid and status='processed')`, f.organizationID, badID, goodID, f.leadID).Scan(&bad, &good, &snapshots, &outcomes, &processed); err != nil {
		t.Fatal(err)
	}
	if bad != 0 || good != 1 || snapshots != 1 || outcomes != 1 || processed != 2 {
		t.Fatalf("selected conflict poisoned sibling/history: %d/%d/%d/%d/%d", bad, good, snapshots, outcomes, processed)
	}
}
