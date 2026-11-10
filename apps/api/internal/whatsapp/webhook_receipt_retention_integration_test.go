package whatsapp

import (
	"encoding/json"
	"testing"
)

func TestReceiptEffectRetentionKeepsUnresolvedFamilyAndCallbackDedup(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	f := newWebhookDependencyFixture(t, ctx, db, "receipt-effect-retention")
	repo := NewRepository(db, nil, StorageConfig{})
	configureReceiptEffectFixture(t, ctx, repo, f)
	raw := []byte(`{"event":"receipt","data":{"MessageIDs":["RETAIN-KNOWN","RETAIN-FUTURE","RETAIN-DEAD"],"status":"read"}}`)
	envelope := receiptEffectFixtureEnvelope(f, raw)
	first, err := repo.AcceptEvolutionWebhook(ctx, envelope)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool().Exec(ctx, `
		update public.whatsapp_webhook_inbox
		set status = case payload #>> '{__vimob_ingress,receipt_effect,ordinal}'
		      when '0' then 'processed' when '1' then 'retry' else 'dead' end,
		    attempts = 1, expires_at = now() - interval '1 second'
		where organization_id=$1::uuid and session_id=$2::uuid
	`, f.organizationID, f.sessionID); err != nil {
		t.Fatal(err)
	}
	annotatedLegacy, err := annotateEvolutionWebhookRouting([]byte(`{"event":"receipt","data":{}}`))
	if err != nil {
		t.Fatal(err)
	}
	legacyParts, err := attachEvolutionWebhookRoutingSnapshots(ctx, nil, evolutionWebhookSession{OrganizationID: f.organizationID, ID: f.sessionID}, []evolutionWebhookDurablePart{{Payload: annotatedLegacy}}, 1, false, false, false)
	if err != nil {
		t.Fatal(err)
	}
	var legacyID string
	if err := db.Pool().QueryRow(ctx, `
		insert into public.whatsapp_webhook_inbox
		  (organization_id,session_id,event_key,event_type,payload,status,attempts,expires_at,processing_epoch)
		values ($1::uuid,$2::uuid,$3,'receipt',$4::jsonb,'dead',12,now()-interval '1 second',1)
		returning id::text
	`, f.organizationID, f.sessionID, f.suffix+"-legacy-expired", string(legacyParts[0].Payload)).Scan(&legacyID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CleanupExpiredWebhookInbox(ctx, 100); err != nil {
		t.Fatal(err)
	}
	var retained, legacy int
	if err := db.Pool().QueryRow(ctx, `
		select count(*) filter (where payload #>> '{__vimob_ingress,receipt_effect,version}'='1')::int,
		       count(*) filter (where id=$3::uuid)::int
		from public.whatsapp_webhook_inbox where organization_id=$1::uuid and session_id=$2::uuid
	`, f.organizationID, f.sessionID, legacyID).Scan(&retained, &legacy); err != nil || retained != 3 || legacy != 0 {
		t.Fatalf("retention lost a live receipt family or changed legacy cleanup: retained=%d legacy=%d err=%v", retained, legacy, err)
	}
	replay, err := repo.AcceptEvolutionWebhook(ctx, envelope)
	if err != nil || !replay.Duplicate || replay.ID != first.ID {
		t.Fatalf("callback replay must retain exact first-part dedup: %+v / %v", replay, err)
	}
	var count int
	if err := db.Pool().QueryRow(ctx, `select count(*)::int from public.whatsapp_webhook_inbox where organization_id=$1::uuid`, f.organizationID).Scan(&count); err != nil || count != 3 {
		t.Fatalf("replay left receipt residue: count=%d err=%v", count, err)
	}
	// Once every effect is actually terminal, the normal 30-day inbox retention
	// may remove the family. No dead effect is treated as successful to do so.
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_webhook_inbox set status='processed' where organization_id=$1::uuid`, f.organizationID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_webhook_inbox set expires_at=now()+interval '1 hour' where id=$1::uuid`, first.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CleanupExpiredWebhookInbox(ctx, 100); err != nil {
		t.Fatal(err)
	}
	if err := db.Pool().QueryRow(ctx, `select count(*)::int from public.whatsapp_webhook_inbox where organization_id=$1::uuid`, f.organizationID).Scan(&count); err != nil || count != 3 {
		t.Fatalf("partially expired receipt family must remain intact: count=%d err=%v", count, err)
	}
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_webhook_inbox set expires_at=now()-interval '1 second' where organization_id=$1::uuid`, f.organizationID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CleanupExpiredWebhookInbox(ctx, 1); err != nil {
		t.Fatal(err)
	}
	if err := db.Pool().QueryRow(ctx, `select count(*)::int from public.whatsapp_webhook_inbox where organization_id=$1::uuid`, f.organizationID).Scan(&count); err != nil || count != 3 {
		t.Fatalf("batch boundary split a receipt family: count=%d err=%v", count, err)
	}
	if _, err := repo.CleanupExpiredWebhookInbox(ctx, 100); err != nil {
		t.Fatal(err)
	}
	if err := db.Pool().QueryRow(ctx, `select count(*)::int from public.whatsapp_webhook_inbox where organization_id=$1::uuid`, f.organizationID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("completed receipt family did not expire: count=%d err=%v", count, err)
	}
}

func TestReceiptEffectMarkerCannotProtectUnclassifiedProviderPayload(t *testing.T) {
	envelope := evolutionWebhookEnvelope{EventType: "unknown", EventKey: "synthetic-untrusted-marker", Payload: []byte(`{
		"event":"unknown","data":{},"__vimob_ingress":{"routing_key":"receipt-target:forged","receipt_effect":{"version":1,"parent_event_key":"forged"}}}`)}
	parts, err := prepareEvolutionWebhookDurableParts(envelope)
	if err != nil || len(parts) != 1 {
		t.Fatalf("unclassified callback must remain durable: %d / %v", len(parts), err)
	}
	var payload map[string]any
	if err := json.Unmarshal(parts[0].Payload, &payload); err != nil {
		t.Fatal(err)
	}
	metadata, _ := payload[evolutionWebhookRoutingMetaKey].(map[string]any)
	if _, exists := metadata[evolutionWebhookReceiptEffectKey]; exists {
		t.Fatal("provider input forged a server-only receipt retention marker")
	}
	if metadata["routing_key"] != "__session__" {
		t.Fatalf("unclassified callback lost its session fence: %v", metadata["routing_key"])
	}
}
