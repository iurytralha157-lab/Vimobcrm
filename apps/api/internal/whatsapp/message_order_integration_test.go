package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestMessageCanonicalOrderPlanIntegration(t *testing.T) {
	_, postgres := webhookDependencyDatabase(t)
	// The 1000-row dataset executes all real capture/notification triggers.
	// Its setup budget is independent of message delivery or API latency SLAs.
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Minute)
	defer cancel()
	fixture := newWebhookDependencyFixture(t, ctx, postgres, "message-order-plan")
	tx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `insert into public.whatsapp_messages
		(organization_id,session_id,conversation_id,lead_id,message_id,content,from_me,direction,capture_state,sent_at)
		select $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5||'-'||n::text,'synthetic plan row',false,'inbound','captured',now()-n*interval '1 second'
		from generate_series(1,1000) n`, fixture.organizationID, fixture.sessionID, fixture.conversationID, fixture.leadID, fixture.suffix); err != nil {
		t.Fatal(err)
	}
	args := append(baseConversationArgs(fixture.tenant), fixture.conversationID, 20, fixture.leadID)
	query := `select wm.id, ` + messageIngressOrderSQL() + `
		from public.whatsapp_messages wm
		join public.whatsapp_conversations wc on wc.id=wm.conversation_id and wc.organization_id=wm.organization_id
		left join public.whatsapp_sessions ws on ws.id=wc.session_id and ws.organization_id=wc.organization_id
		left join public.leads l on l.id=wc.lead_id and l.organization_id=wc.organization_id
		where wm.organization_id=$1::uuid and wm.conversation_id=$5::uuid
		and wm.capture_state is distinct from 'suppressed' and wc.deleted_at is null
		and ` + conversationVisibilitySQL(canViewOwnWhatsAppLeads(fixture.tenant)) + `
		and ` + conversationMessageLeadMatchSQL() + ` and wc.lead_id=$7::uuid
		order by ` + messageOrderSQL(MessageFilter{OrderingVersion: 2}) + ` limit $6::integer`
	var encoded []byte
	if err := tx.QueryRow(ctx, "explain (analyze,buffers,format json) "+query, args...).Scan(&encoded); err != nil {
		t.Fatal(err)
	}
	var plan []struct {
		Plan          map[string]any `json:"Plan"`
		ExecutionTime float64        `json:"Execution Time"`
	}
	if err := json.Unmarshal(encoded, &plan); err != nil {
		t.Fatal(err)
	}
	var summarize func(map[string]any, string)
	summarize = func(node map[string]any, indent string) {
		t.Logf("%s%s index=%v rows=%v loops=%v", indent, node["Node Type"], node["Index Name"], node["Actual Rows"], node["Actual Loops"])
		if children, ok := node["Plans"].([]any); ok {
			for _, child := range children {
				summarize(child.(map[string]any), indent+"  ")
			}
		}
	}
	if len(plan) != 1 {
		t.Fatal("unexpected explain document")
	}
	summarize(plan[0].Plan, "")
	t.Logf("synthetic 1000-row authorized head EXPLAIN execution_ms=%.3f; rollback, no SLA or production-scale claim", plan[0].ExecutionTime)
	previewQuery := `select ` + conversationListPreviewSQL() + `
		from public.whatsapp_conversations wc
		left join public.whatsapp_sessions ws on ws.id=wc.session_id and ws.organization_id=wc.organization_id
		left join public.leads l on l.id=wc.lead_id and l.organization_id=wc.organization_id
		where wc.organization_id=$1::uuid and wc.id=$5::uuid and wc.deleted_at is null
		and ` + conversationVisibilitySQL(canViewOwnWhatsAppLeads(fixture.tenant))
	if err := tx.QueryRow(ctx, "explain (analyze,buffers,format json) "+previewQuery,
		append(baseConversationArgs(fixture.tenant), fixture.conversationID)...).Scan(&encoded); err != nil {
		t.Fatal(err)
	}
	plan = nil
	if err := json.Unmarshal(encoded, &plan); err != nil || len(plan) != 1 {
		t.Fatalf("unexpected canonical conversation preview explain: %v", err)
	}
	summarize(plan[0].Plan, "preview ")
	t.Logf("synthetic 1000-row canonical conversation-list preview EXPLAIN execution_ms=%.3f; same dataset, rollback, no SLA or production-scale claim", plan[0].ExecutionTime)
}

// This is a real repository/SQL test. One admitted envelope owns three routes;
// the synthetic messages share a transaction timestamp and deliberately reverse
// UUID order. No provider or remote database is contacted.
func TestMessageCanonicalOrderIntegration(t *testing.T) {
	ctx, postgres := webhookDependencyDatabase(t)
	fixture := newWebhookDependencyFixture(t, ctx, postgres, "message-canonical-order")
	providerIDs := []string{fixture.suffix + "-0", fixture.suffix + "-1", fixture.suffix + "-2"}
	snapshots := make([]map[string]any, 0, len(providerIDs))
	for _, providerID := range providerIDs {
		snapshots = append(snapshots, map[string]any{
			"provider_message_id": providerID, "binding_eligible": true, "processing_epoch": 1,
		})
	}
	insertWebhookDependencyEvent(t, ctx, postgres, fixture, webhookDependencyEvent{
		key: fixture.suffix + "-envelope", providerID: providerIDs[0],
		route: "jid:" + fixture.remoteJID, lane: evolutionWebhookLaneLive, epoch: 1,
		snapshots: snapshots,
	})
	ids := []string{
		"00000000-0000-4000-8000-000000000003",
		"00000000-0000-4000-8000-000000000002",
		"00000000-0000-4000-8000-000000000001",
	}
	tx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	for index, id := range ids {
		if _, err := tx.Exec(ctx, `insert into public.whatsapp_messages (
			id, organization_id, session_id, conversation_id, lead_id,
			provider_message_id, message_id, content, from_me, direction,
			capture_state, sent_at, created_at
		) values ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$6,$7,false,'inbound',
			'captured',now(),now())`, id, fixture.organizationID, fixture.sessionID,
			fixture.conversationID, fixture.leadID, providerIDs[index], fmt.Sprintf("order %d", index)); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `update public.whatsapp_messages set metadata=jsonb_build_object(
		'whatsapp_provider_reaction',jsonb_build_object('ingress_sequence',987654321), 'private_fixture','do-not-expose')
		where organization_id=$1::uuid`, fixture.organizationID); err != nil {
		t.Fatal(err)
	}
	filter, err := ParseMessageFilter(url.Values{
		"orderingVersion": {"2"}, "expectedLeadId": {fixture.leadID}, "includeMediaUrls": {"false"},
	})
	if err != nil {
		t.Fatal(err)
	}
	repo := NewRepository(postgres, nil, StorageConfig{})
	read := func(endpoint string, filter MessageFilter) (MessagePage, error) {
		if endpoint == "conversation" {
			return repo.ListMessages(ctx, fixture.tenant, fixture.conversationID, filter)
		}
		return repo.listLeadHistoryMessages(ctx, fixture.tenant, fixture.leadID, fixture.conversationID, filter)
	}
	assertIDs := func(t *testing.T, page MessagePage, want []string) {
		t.Helper()
		got := make([]string, 0, len(page.Messages))
		for _, message := range page.Messages {
			got = append(got, message.ID)
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("message order = %v, want %v", got, want)
		}
	}
	for _, endpoint := range []string{"conversation", "lead-history"} {
		t.Run(endpoint, func(t *testing.T) {
			page, err := read(endpoint, filter)
			if err != nil {
				t.Fatal(err)
			}
			assertIDs(t, page, ids)
			for _, message := range page.Messages {
				if message.OrderIngressSequence <= 0 {
					t.Fatal("committed admission route was not used")
				}
				if len(message.Metadata) != 0 {
					t.Fatalf("private metadata was exposed: %v", message.Metadata)
				}
			}
			limited := filter
			limited.Limit = 2
			head, err := read(endpoint, limited)
			if err != nil {
				t.Fatal(err)
			}
			assertIDs(t, head, ids[1:])
			if head.NextCursor == nil || !strings.HasPrefix(*head.NextCursor, "v2|") {
				t.Fatal("canonical next cursor missing")
			}
			next, err := ParseMessageFilter(url.Values{
				"orderingVersion": {"2"}, "cursor": {*head.NextCursor}, "limit": {"2"},
				"expectedLeadId": {fixture.leadID}, "includeMediaUrls": {"false"},
			})
			if err != nil {
				t.Fatal(err)
			}
			older, err := read(endpoint, next)
			if err != nil {
				t.Fatal(err)
			}
			assertIDs(t, older, ids[:1])
			if older.NextCursor != nil {
				t.Fatal("canonical terminal page has a cursor")
			}
			// Head reconciliation and reusing a cursor never reshuffle a batch.
			again, err := read(endpoint, limited)
			if err != nil {
				t.Fatal(err)
			}
			assertIDs(t, again, ids[1:])
			if *again.NextCursor != *head.NextCursor {
				t.Fatal("head cursor changed without a message change")
			}
			for _, mismatch := range []string{"missing", "timestamp", "created"} {
				bad := next
				switch mismatch {
				case "missing":
					bad.CursorID = "00000000-0000-4000-8000-000000000099"
				case "timestamp":
					value := bad.CursorAt.Add(time.Microsecond)
					bad.CursorAt = &value
				case "created":
					value := bad.CursorCreatedAt.Add(time.Microsecond)
					bad.CursorCreatedAt = &value
				}
				if _, err := read(endpoint, bad); !errors.Is(err, ErrMessageCursorRebaseRequired) {
					t.Fatalf("%s anchor mismatch = %v, want explicit rebase", mismatch, err)
				}
			}
			legacy := limited
			legacy.OrderingVersion = 0
			oldHead, err := read(endpoint, legacy)
			if err != nil {
				t.Fatal(err)
			}
			assertIDs(t, oldHead, []string{ids[1], ids[0]})
			if oldHead.NextCursor == nil || strings.HasPrefix(*oldHead.NextCursor, "v2|") {
				t.Fatal("legacy cursor protocol changed")
			}
			oldNext, err := ParseMessageFilter(url.Values{"cursor": {*oldHead.NextCursor}, "limit": {"2"}, "includeMediaUrls": {"false"}, "expectedLeadId": {fixture.leadID}})
			if err != nil {
				t.Fatal(err)
			}
			oldOlder, err := read(endpoint, oldNext)
			if err != nil {
				t.Fatal(err)
			}
			assertIDs(t, oldOlder, ids[2:])
			oldTimestampOnly := legacy
			oldTimestampOnly.CursorAt = &page.Messages[0].SentAt
			oldTimestampOnly.CursorID = ""
			timestampPage, err := read(endpoint, oldTimestampOnly)
			if err != nil {
				t.Fatal(err)
			}
			if len(timestampPage.Messages) != 0 {
				t.Fatal("legacy timestamp-only strict comparison changed")
			}
			body, err := json.Marshal(head)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(body), "ingress_sequence") || strings.Contains(string(body), "OrderIngress") || strings.Contains(string(body), "OrderCreated") {
				t.Fatalf("private ordering fields escaped: %s", body)
			}
		})
	}
	t.Run("lead history head preview follows the requested ordering version", func(t *testing.T) {
		var bindingID string
		if err := postgres.Pool().QueryRow(ctx, `select id::text from public.whatsapp_conversation_lead_bindings
			where organization_id=$1::uuid and conversation_id=$2::uuid and lead_id=$3::uuid and active_to is null and not stale`, fixture.organizationID, fixture.conversationID, fixture.leadID).Scan(&bindingID); err != nil {
			t.Fatal(err)
		}
		var reactionIDs []string
		defer func() {
			for _, id := range reactionIDs {
				if _, err := postgres.Pool().Exec(ctx, "delete from public.whatsapp_messages where id=$1::uuid", id); err != nil {
					t.Error(err)
				}
			}
		}()
		for index, emoji := range []string{"👍", ""} {
			providerID := fmt.Sprintf("%s-preview-reaction-%d", fixture.suffix, index)
			key := providerID + "-event"
			inboxID := insertWebhookDependencyEvent(t, ctx, postgres, fixture, webhookDependencyEvent{
				key: key, providerID: providerID, route: "jid:" + fixture.remoteJID, lane: evolutionWebhookLaneLive, epoch: 1,
				snapshots: []map[string]any{{"provider_message_id": providerID, "binding_eligible": true, "processing_epoch": 1,
					"conversation_id": fixture.conversationID, "context_kind": "organic", "state": "bound", "active_binding_id": bindingID, "event_lead_id": fixture.leadID}},
			})
			workerID := "vimob-api-evolution-webhook-epoch1-preview-fixture"
			if _, err := postgres.Pool().Exec(ctx, "update public.whatsapp_webhook_inbox set status='processing',locked_by=$2,locked_at=clock_timestamp() where id=$1::uuid", inboxID, workerID); err != nil {
				t.Fatal(err)
			}
			var result struct {
				Outcome   string `json:"outcome"`
				MessageID string `json:"message_id"`
			}
			var encoded []byte
			if err := postgres.Pool().QueryRow(ctx, `select public.apply_whatsapp_provider_reaction(
				route.organization_id,route.session_id,route.provider_message_id,$4,$5,'Synthetic',false,$6,
				(select sent_at+interval '1 hour' from public.whatsapp_messages where id=$7::uuid),
				route.inbox_event_key,route.processing_epoch,route.ingress_sequence,null,$8)
				from public.whatsapp_webhook_routing_snapshots route where route.organization_id=$1::uuid
				and route.session_id=$2::uuid and route.provider_message_id=$3`, fixture.organizationID, fixture.sessionID, providerID, providerIDs[2], fixture.remoteJID, emoji, ids[2], workerID).Scan(&encoded); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(encoded, &result); err != nil {
				t.Fatal(err)
			}
			if result.Outcome != "applied" || result.MessageID == "" {
				t.Fatalf("real reaction RPC = %s", encoded)
			}
			reactionIDs = append(reactionIDs, result.MessageID)
		}
		for _, version := range []int{0, 2} {
			requested := filter
			requested.OrderingVersion = version
			history, err := repo.GetHistoryAccess(ctx, fixture.tenant, HistoryAccessFilter{LeadID: fixture.leadID, ConversationID: fixture.conversationID, MessageFilter: requested})
			if err != nil {
				t.Fatal(err)
			}
			if len(history.Conversations) != 1 || history.Conversation == nil {
				t.Fatal("history head missing authorized conversation")
			}
			want := "order 0"
			if version == 2 {
				want = "order 2"
			}
			if history.Conversation.LastMessage == nil || *history.Conversation.LastMessage != want {
				t.Fatalf("history preview version %d = %v, want %q", version, history.Conversation.LastMessage, want)
			}
			page, err := read("conversation", filter)
			if err != nil {
				t.Fatal(err)
			}
			var base time.Time
			for _, message := range page.Messages {
				if message.ID == ids[2] {
					base = message.SentAt
				}
			}
			if history.Conversation.LastMessageAt == nil || !history.Conversation.LastMessageAt.Equal(base) {
				t.Fatal("reaction changed historical preview timestamp")
			}
		}
	})
	t.Run("legacy provider identity backfill preserves route order and cursor", func(t *testing.T) {
		if _, err := postgres.Pool().Exec(ctx, "update public.whatsapp_messages set provider_message_id = null where id = $1::uuid", ids[2]); err != nil {
			t.Fatal(err)
		}
		limited := filter
		limited.Limit = 2
		before, err := read("conversation", limited)
		if err != nil {
			t.Fatal(err)
		}
		assertIDs(t, before, ids[1:])
		if before.Messages[1].OrderIngressSequence <= 0 {
			t.Fatal("legacy message_id did not resolve its immutable route")
		}
		if _, err := postgres.Pool().Exec(ctx, "update public.whatsapp_messages set provider_message_id = message_id where id = $1::uuid", ids[2]); err != nil {
			t.Fatal(err)
		}
		after, err := read("conversation", limited)
		if err != nil {
			t.Fatal(err)
		}
		assertIDs(t, after, ids[1:])
		if *before.NextCursor != *after.NextCursor || before.Messages[1].OrderIngressSequence != after.Messages[1].OrderIngressSequence {
			t.Fatal("provider identity backfill changed order/cursor")
		}
	})
	t.Run("late echo never reorders an existing outbox or legacy row", func(t *testing.T) {
		const lateID = "00000000-0000-4000-8000-000000000004"
		providerID := fixture.suffix + "-late-echo"
		if _, err := postgres.Pool().Exec(ctx, `insert into public.whatsapp_messages
			(id,organization_id,session_id,conversation_id,lead_id,message_id,content,from_me,direction,capture_state,sent_at,created_at)
			select $1::uuid,organization_id,session_id,conversation_id,lead_id,$3,'late echo',true,'outbound','captured',sent_at,created_at
			from public.whatsapp_messages where id=$2::uuid`, lateID, ids[0], providerID); err != nil {
			t.Fatal(err)
		}
		defer func() {
			_, err := postgres.Pool().Exec(ctx, "delete from public.whatsapp_messages where id=$1::uuid", lateID)
			if err != nil {
				t.Error(err)
			}
		}()
		before, err := read("conversation", filter)
		if err != nil {
			t.Fatal(err)
		}
		want := append([]string{lateID}, ids...)
		assertIDs(t, before, want)
		insertWebhookDependencyEvent(t, ctx, postgres, fixture, webhookDependencyEvent{
			key: fixture.suffix + "-late-echo-envelope", providerID: providerID,
			route: "jid:" + fixture.remoteJID, lane: evolutionWebhookLaneLive, epoch: 1,
		})
		if _, err := postgres.Pool().Exec(ctx, "update public.whatsapp_messages set provider_message_id=message_id where id=$1::uuid", lateID); err != nil {
			t.Fatal(err)
		}
		after, err := read("conversation", filter)
		if err != nil {
			t.Fatal(err)
		}
		assertIDs(t, after, want)
		if before.Messages[0].OrderIngressSequence != 0 || after.Messages[0].OrderIngressSequence != 0 {
			t.Fatal("later echo changed original row's order")
		}
	})
	t.Run("foreign scope and removed anchors fail closed", func(t *testing.T) {
		foreign := newWebhookDependencyFixture(t, ctx, postgres, "foreign-order-anchor")
		var foreignID string
		var sentAt, createdAt time.Time
		if err := postgres.Pool().QueryRow(ctx, `insert into public.whatsapp_messages
			(organization_id,session_id,conversation_id,lead_id,message_id,content,capture_state)
			values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'foreign synthetic','captured')
			returning id::text,coalesce(sent_at,created_at),created_at`, foreign.organizationID, foreign.sessionID, foreign.conversationID, foreign.leadID, foreign.suffix).Scan(&foreignID, &sentAt, &createdAt); err != nil {
			t.Fatal(err)
		}
		bad := filter
		bad.CursorID = foreignID
		bad.CursorAt = &sentAt
		bad.CursorCreatedAt = &createdAt
		for _, endpoint := range []string{"conversation", "lead-history"} {
			if _, err := read(endpoint, bad); !errors.Is(err, ErrMessageCursorRebaseRequired) {
				t.Fatalf("foreign anchor %s: %v", endpoint, err)
			}
		}
		bad.ExpectedLeadID = foreign.leadID
		if _, err := read("conversation", bad); !errors.Is(err, ErrConversationNotFound) {
			t.Fatalf("stale lead view: %v", err)
		}
		page, err := read("conversation", filter)
		if err != nil {
			t.Fatal(err)
		}
		anchor := page.Messages[1]
		bad = filter
		bad.CursorID = anchor.ID
		bad.CursorAt = &anchor.SentAt
		bad.CursorCreatedAt = &anchor.OrderCreatedAt
		if _, err := postgres.Pool().Exec(ctx, "delete from public.whatsapp_messages where id=$1::uuid", anchor.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := read("conversation", bad); !errors.Is(err, ErrMessageCursorRebaseRequired) {
			t.Fatalf("removed anchor: %v", err)
		}
	})
}
