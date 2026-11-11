package whatsapp

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

func TestNativeMixedReceiptAdvancesKnownAndDropsUnresolvedTarget(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	f := newWebhookDependencyFixture(t, ctx, db, "partial-receipt")
	repo := NewRepository(db, nil, StorageConfig{})
	if _, err := repo.JoinConversationAttendance(ctx, f.tenant, f.conversationID,
		attendanceInput{ExpectedLeadID: f.leadID, SendSessionID: f.sessionID}); err != nil {
		t.Fatal(err)
	}
	known := createConfirmedReceiptFixture(t, ctx, repo, f, f.suffix+"-known")
	futureClient := f.suffix + "-future"
	futureID := deterministicProviderMessageID(futureClient)
	item := pendingEvolutionWebhook{OrganizationID: f.organizationID, SessionID: f.sessionID, EventType: "receipt"}
	receipts := []nativeEvolutionStatus{{MessageIDs: []string{known, futureID}, Status: "read", OccurredAt: time.Now().UTC()}}
	// Regra de produto (11/11/2026): recibo sem alvo nao bloqueia nem fica em
	// retry. Os alvos conhecidos sao confirmados e o restante e descartado.
	if err := repo.processNativeEvolutionStatuses(ctx, item, receipts); err != nil {
		t.Fatalf("mixed receipt with unresolved target must be dropped, not retried: %v", err)
	}
	assertReceiptFixtureState(t, ctx, repo, f, known, "read")
	if id := createConfirmedReceiptFixture(t, ctx, repo, f, futureClient); id != futureID {
		t.Fatalf("future identity=%s", id)
	}
	if err := repo.processNativeEvolutionStatuses(ctx, item, receipts); err != nil {
		t.Fatal(err)
	}
	assertReceiptFixtureState(t, ctx, repo, f, known, "read")
	assertReceiptFixtureState(t, ctx, repo, f, futureID, "read")
	if err := repo.processNativeEvolutionStatuses(ctx, item, receipts); err != nil {
		t.Fatalf("receipt replay: %v", err)
	}
	assertReceiptFixtureState(t, ctx, repo, f, known, "read")
}

func TestNativeIsolatedReceiptUnknownTenantTargetDropsWithoutRepeatingKnown(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	f := newWebhookDependencyFixture(t, ctx, db, "receipt-never")
	foreign := newWebhookDependencyFixture(t, ctx, db, "receipt-foreign")
	repo := NewRepository(db, nil, StorageConfig{})
	for _, fixture := range []sessionConversationLockFixture{f, foreign} {
		if _, err := repo.JoinConversationAttendance(ctx, fixture.tenant, fixture.conversationID,
			attendanceInput{ExpectedLeadID: fixture.leadID, SendSessionID: fixture.sessionID}); err != nil {
			t.Fatal(err)
		}
	}
	known := createConfirmedReceiptFixture(t, ctx, repo, f, f.suffix+"-known")
	foreignID := createConfirmedReceiptFixture(t, ctx, repo, foreign, foreign.suffix+"-foreign-target")
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_sessions set advanced_settings='{"token":"synthetic-receipt","webhook_token":"synthetic-receipt-hook"}'::jsonb where id=$1::uuid`, f.sessionID); err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(map[string]any{"event": "receipt", "data": map[string]any{
		"MessageIDs": []string{known, foreignID}, "Chat": f.remoteJID, "status": "read", "timestamp": time.Now().UTC().Format(time.RFC3339Nano)}})
	receipt, err := repo.AcceptEvolutionWebhook(ctx, evolutionWebhookEnvelope{SessionID: f.sessionID, InstanceToken: "synthetic-receipt",
		WebhookHeaderTokens: []string{"synthetic-receipt-hook"}, EventType: "receipt", Payload: payload, ReceivedAt: time.Now().UTC()})
	if err != nil {
		t.Fatal(err)
	}
	var unknownID string
	if err := db.Pool().QueryRow(ctx, `select id::text from public.whatsapp_webhook_inbox
		where organization_id=$1::uuid and session_id=$2::uuid
		and payload #>> '{__vimob_ingress,receipt_effect,target_hash}'=$3`,
		f.organizationID, f.sessionID, receiptIdentityHash(foreignID)).Scan(&unknownID); err != nil {
		t.Fatal(err)
	}
	knownItems, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
	if err != nil || len(knownItems) != 1 || knownItems[0].ID != receipt.ID {
		t.Fatalf("known receipt claim=%d/%v", len(knownItems), err)
	}
	if err := repo.processClaimedEvolutionWebhook(ctx, knownItems[0]); err != nil {
		t.Fatal(err)
	}
	// Regra de produto (11/11/2026): o recibo cujo alvo pertence a outra
	// organizacao e descartado na primeira tentativa, sem repetir o irmao
	// conhecido e sem tocar o alvo estrangeiro.
	items, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
	if err != nil || len(items) != 1 || items[0].ID != unknownID {
		t.Fatalf("unresolved receipt claim=%d/%v", len(items), err)
	}
	if err := repo.processClaimedEvolutionWebhook(ctx, items[0]); err != nil {
		t.Fatal(err)
	}
	assertReceiptFixtureState(t, ctx, repo, f, known, "read")
	assertReceiptFixtureState(t, ctx, repo, foreign, foreignID, "sent")
	var status string
	var attempts int
	if err := db.Pool().QueryRow(ctx, `select status,attempts from public.whatsapp_webhook_inbox where id=$1::uuid`, unknownID).Scan(&status, &attempts); err != nil {
		t.Fatal(err)
	}
	if status != "processed" || attempts != 1 {
		t.Fatalf("unresolved receipt must be dropped once, not retried: %s/%d", status, attempts)
	}
	if err := db.Pool().QueryRow(ctx, `select status,attempts from public.whatsapp_webhook_inbox where id=$1::uuid`, receipt.ID).Scan(&status, &attempts); err != nil {
		t.Fatal(err)
	}
	if status != "processed" || attempts != 1 {
		t.Fatalf("known sibling was reprocessed with absent target: %s/%d", status, attempts)
	}
}

func createConfirmedReceiptFixture(t *testing.T, ctx context.Context, repo Repository, f sessionConversationLockFixture, client string) string {
	t.Helper()
	response, err := repo.SendMessage(ctx, f.tenant, f.conversationID, sendMessageInput{
		Text: "synthetic receipt target", ClientMessageID: client, ExpectedLeadID: f.leadID, SendSessionID: f.sessionID})
	if err != nil {
		t.Fatal(err)
	}
	provider := deterministicProviderMessageID(client)
	// This fixture models a previously confirmed provider send. It does not
	// invoke any external provider and is explicitly scoped to synthetic rows.
	if _, err := repo.db.Pool().Exec(ctx, `update public.whatsapp_outbox set status='sent',sent_at=now(),provider_message_id=$4
		where organization_id=$1::uuid and client_message_id=$2;
		update public.whatsapp_messages set status='sent',provider_message_id=$4,message_id=$4 where organization_id=$1::uuid and id=$3::uuid`,
		f.organizationID, client, response.Message.ID, provider); err != nil {
		t.Fatal(err)
	}
	return provider
}

func assertReceiptFixtureState(t *testing.T, ctx context.Context, repo Repository, f sessionConversationLockFixture, id, want string) {
	t.Helper()
	var message, outbox string
	if err := repo.db.Pool().QueryRow(ctx, `select message.status,outbox.status
		from public.whatsapp_messages message join public.whatsapp_outbox outbox on outbox.message_id=message.id
		where message.organization_id=$1::uuid and message.provider_message_id=$2`, f.organizationID, id).Scan(&message, &outbox); err != nil {
		t.Fatal(err)
	}
	if message != want || outbox != want {
		t.Fatalf("known receipt rolled back: message=%s/outbox=%s, want=%s", message, outbox, want)
	}
}
