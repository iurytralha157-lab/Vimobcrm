package whatsapp

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

func TestLocalOutboxConversationOrderPlan(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	repo := NewRepository(db, nil, StorageConfig{})
	f := outboundHardeningFixture(t, ctx, db, repo, "outbox-order-plan")
	queueHardeningMessage(t, ctx, repo, f, sendMessageInput{Text: "Synthetic active head", ClientMessageID: f.suffix + "-head"})
	queueHardeningMessage(t, ctx, repo, f, sendMessageInput{Text: "Synthetic ordered successor", ClientMessageID: f.suffix + "-successor"})
	tx, err := db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `set local statement_timeout='8s';set local lock_timeout='2s';
		insert into public.whatsapp_messages(organization_id,session_id,conversation_id,lead_id,message_id,client_message_id,
		from_me,direction,status,capture_state,content)
		select $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5||'-history-'||n::text,$5||'-history-'||n::text,
		true,'outbound','sent','captured','Synthetic completed history' from generate_series(1,100) n;
		insert into public.whatsapp_outbox(organization_id,session_id,conversation_id,message_id,client_message_id,recipient_jid,message_type,payload,status)
		select organization_id,session_id,conversation_id,id,client_message_id,$6,'text',jsonb_build_object('action','send.text','body',jsonb_build_object('number',$6,'text','Synthetic completed history')),'sent'
		from public.whatsapp_messages where organization_id=$1::uuid and status='sent'`, f.organizationID, f.sessionID, f.conversationID, f.leadID, f.suffix, f.remoteJID); err != nil {
		t.Fatal(err)
	}
	for _, lane := range []whatsappOutboxLane{whatsappOutboxLaneFast, whatsappOutboxLaneMedia} {
		var encoded []byte
		// EXPLAIN without ANALYZE is read-only: it plans the real claim/update
		// statement without executing claims. All history fixture writes rollback.
		if err := tx.QueryRow(ctx, "explain (format json) "+whatsappOutboxClaimQueryForLane(lane), 20, "synthetic-plan-worker", "", "synthetic-plan-lease").Scan(&encoded); err != nil {
			t.Fatal(err)
		}
		var plan []struct {
			Plan map[string]any `json:"Plan"`
		}
		if err := json.Unmarshal(encoded, &plan); err != nil || len(plan) != 1 {
			t.Fatalf("claim explain: %v", err)
		}
		var summarize func(map[string]any, string)
		summarize = func(node map[string]any, indent string) {
			t.Logf("%s%s lane=%s index=%v estimatedRows=%v", indent, node["Node Type"], lane, node["Index Name"], node["Plan Rows"])
			if children, ok := node["Plans"].([]any); ok {
				for _, child := range children {
					summarize(child.(map[string]any), indent+"  ")
				}
			}
		}
		summarize(plan[0].Plan, "")
	}
	var currentIndexCount int
	if err := tx.QueryRow(ctx, `select count(*)::int from pg_index index
		join pg_class name on name.oid=index.indexrelid where index.indisvalid and index.indisready
		and name.relname in ('whatsapp_outbox_conversation_due_head_v2_idx','whatsapp_outbox_conversation_processing_idx')`).Scan(&currentIndexCount); err != nil {
		t.Fatal(err)
	}
	if currentIndexCount != 2 {
		t.Fatalf("order gates require ready exact partial indexes, count=%d", currentIndexCount)
	}
	t.Log("local EXPLAIN only: existing pending/retry and processing indexes ready; no production latency/scale claim")
}
