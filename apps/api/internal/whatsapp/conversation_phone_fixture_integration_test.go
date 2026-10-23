package whatsapp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Build a prospective owner-only history and promote it through the actual
// consent RPC. No captured state/retention flags are fabricated for this proof.
func promotePhoneHistoryFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool, repo Repository, f sessionConversationLockFixture, path string) string {
	t.Helper()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `delete from public.whatsapp_attendance_entries where conversation_id=$1::uuid;
		delete from public.whatsapp_conversations where id=$1::uuid;
		insert into public.whatsapp_conversations(id,organization_id,session_id,remote_jid,contact_phone,contact_name)
		values($1::uuid,$2::uuid,$3::uuid,$4,$5,'Synthetic prospective phone history')`, f.conversationID, f.organizationID, f.sessionID, f.remoteJID, f.phone); err != nil {
		t.Fatal(err)
	}
	var id string
	if err := tx.QueryRow(ctx, `insert into public.whatsapp_messages(organization_id,session_id,conversation_id,message_id,provider_message_id,content,from_me,direction,status,capture_state,message_type,media_status,media_storage_path)
		values($1::uuid,$2::uuid,$3::uuid,$4,$4,'Synthetic promoted phone history',false,'inbound','received','unlinked_ephemeral','document','ready',$5) returning id::text`, f.organizationID, f.sessionID, f.conversationID, f.suffix+"-promoted-media", path).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := confirmUnlinkedHistoryBinding(ctx, tx, f.organizationID, f.conversationID, f.leadID, f.tenant.UserID, "manual_link"); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.JoinConversationAttendance(ctx, f.tenant, f.conversationID, attendanceInput{ExpectedLeadID: f.leadID, SendSessionID: f.sessionID}); err != nil {
		t.Fatal(err)
	}
	return id
}

func enablePhoneNativeFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool, repo *Repository, f sessionConversationLockFixture) {
	t.Helper()
	if _, err := pool.Exec(ctx, `update public.whatsapp_sessions set advanced_settings='{"token":"synthetic-instance-secret","webhook_token":"synthetic-webhook-secret"}' where id=$1::uuid;
		insert into private.whatsapp_webhook_session_cutovers(session_id,active_epoch,cutover_at) values($1::uuid,1,clock_timestamp())`, f.sessionID); err != nil {
		t.Fatal(err)
	}
	repo.functions.webhookProcessorMode = webhookProcessorNative
	repo.functions.webhookRolloutSessionIDs = []string{f.sessionID}
}

func processPhoneNativeText(t *testing.T, ctx context.Context, pool *pgxpool.Pool, repo Repository, f sessionConversationLockFixture, suffix string) string {
	t.Helper()
	id := f.suffix + suffix
	data, err := json.Marshal(map[string]any{"event": "messages.upsert", "instanceId": f.suffix, "instanceToken": "synthetic-instance-secret", "data": map[string]any{"messages": []any{map[string]any{
		"Info":    map[string]any{"ID": id, "Chat": f.remoteJID, "SenderPN": f.remoteJID, "IsFromMe": false, "Timestamp": time.Now().UTC().Format(time.RFC3339Nano), "PushName": "Synthetic original phone"},
		"Message": map[string]any{"conversation": "Synthetic phone callback " + suffix}}}}})
	if err != nil {
		t.Fatal(err)
	}
	envelope, err := parseEvolutionWebhookEnvelope(url.Values{"session_id": {f.sessionID}, "instance_id": {f.suffix}}, http.Header{"X-Webhook-Token": []string{"synthetic-webhook-secret"}}, data)
	if err != nil {
		t.Fatal(err)
	}
	receipt, err := repo.AcceptEvolutionWebhook(ctx, envelope)
	if err != nil {
		t.Fatal(err)
	}
	items, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
	if err != nil || len(items) != 1 || items[0].ID != receipt.ID {
		t.Fatalf("phone callback admission: %+v %v", items, err)
	}
	if err := repo.processClaimedEvolutionWebhook(ctx, items[0]); err != nil {
		t.Fatal(err)
	}
	return id
}

func logPromotedPhoneMedia(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id, phase string) {
	t.Helper()
	var capture string
	var lead, body, path *string
	var scrubbed bool
	if err := pool.QueryRow(ctx, `select capture_state,lead_id::text,content,media_storage_path,unlinked_retention_scrubbed_at is not null from public.whatsapp_messages where id=$1::uuid`, id).Scan(&capture, &lead, &body, &path, &scrubbed); err != nil {
		t.Fatal(err)
	}
	t.Logf("promoted fixture %s capture=%s lead=%v content=%v path=%v scrubbed=%t", phase, capture, pointerValue(lead), pointerValue(body), pointerValue(path), scrubbed)
}
