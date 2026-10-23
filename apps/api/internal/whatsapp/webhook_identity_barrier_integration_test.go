package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Real admission, claim and Native capture on opt-in disposable loopback DB.
// The conflicting callback must survive as technical evidence, never as a
// customer message or an alias to the other card. No provider is configured.
func TestWebhookContactPNBarrierIntegration(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	repo := NewRepository(db, nil, StorageConfig{})
	repo.functions.webhookProcessorMode = webhookProcessorNative
	for _, label := range []string{"observed", "captured"} {
		t.Run(label, func(t *testing.T) {
			f := newWebhookDependencyFixture(t, ctx, db, "pn-"+label)
			t.Cleanup(func() {
				cleanup, cancel := context.WithTimeout(context.Background(), 8*time.Second)
				defer cancel()
				for _, statement := range []string{
					`delete from public.whatsapp_inbound_logs where organization_id=$1::uuid`,
					`delete from private.realtime_events where organization_id=$1::uuid`,
					`delete from private.notification_deliveries where organization_id=$1::uuid`,
					`delete from public.notifications where organization_id=$1::uuid`,
					`delete from public.whatsapp_messages where organization_id=$1::uuid`,
				} {
					if _, err := db.Pool().Exec(cleanup, statement, f.organizationID); err != nil {
						t.Error(err)
					}
				}
			})
			if _, err := db.Pool().Exec(ctx, `update public.whatsapp_sessions set
				advanced_settings='{"token":"synthetic-pn-instance","webhook_token":"synthetic-pn-webhook"}'::jsonb
				where id=$1::uuid`, f.sessionID); err != nil {
				t.Fatal(err)
			}
			if label == "captured" {
				if _, err := repo.JoinConversationAttendance(ctx, f.tenant, f.conversationID,
					attendanceInput{ExpectedLeadID: f.leadID, SendSessionID: f.sessionID}); err != nil {
					t.Fatal(err)
				}
			}
			a := "5511988881111@s.whatsapp.net"
			if a == f.remoteJID {
				t.Fatal("synthetic PN fixture collision")
			}
			id := f.suffix + "-contradictory"
			payload, err := json.Marshal(map[string]any{"event": "message", "data": map[string]any{
				"Info":    map[string]any{"ID": id, "Chat": a, "SenderPN": f.remoteJID, "Timestamp": time.Now().UTC().Format(time.RFC3339Nano)},
				"Message": map[string]any{"conversation": "private-content-must-not-reach-card-B"},
			}})
			if err != nil {
				t.Fatal(err)
			}
			before := contactPNBusinessCounts(t, ctx, db.Pool(), f.organizationID)
			receipt, err := repo.AcceptEvolutionWebhook(ctx, evolutionWebhookEnvelope{
				SessionID: f.sessionID, InstanceToken: "synthetic-pn-instance", WebhookHeaderTokens: []string{"synthetic-pn-webhook"},
				EventType: "message", Payload: payload, ReceivedAt: time.Now().UTC(),
			})
			if err != nil {
				t.Fatal(err)
			}
			if receipt.Inline || receipt.Duplicate {
				t.Fatalf("conflict must remain durable, receipt=%#v", receipt)
			}
			items, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
			if err != nil || len(items) != 1 {
				t.Fatalf("claim conflict: items=%d err=%v", len(items), err)
			}
			if err := repo.processClaimedEvolutionWebhook(ctx, items[0]); err != nil {
				t.Fatal(err)
			}
			if after := contactPNBusinessCounts(t, ctx, db.Pool(), f.organizationID); after != before {
				t.Fatalf("PN conflict changed business rows: before=%v after=%v", before, after)
			}
			var status, reason, rawContent string
			var snapshots, outcomes int
			if err := db.Pool().QueryRow(ctx, `select status,
				payload #>> '{__vimob_ingress,identity_quarantine_reason}',payload #>> '{data,Message,conversation}',
				(select count(*) from public.whatsapp_webhook_routing_snapshots where organization_id=$1::uuid and provider_message_id=$3),
				(select count(*) from public.whatsapp_webhook_routing_outcomes where organization_id=$1::uuid and provider_message_id=$3)
				from public.whatsapp_webhook_inbox where organization_id=$1::uuid and id=$2::uuid`, f.organizationID, receipt.ID, id).
				Scan(&status, &reason, &rawContent, &snapshots, &outcomes); err != nil {
				t.Fatal(err)
			}
			if status != "processed" || reason != whatsappPNConflictReason || rawContent == "" || snapshots != 0 || outcomes != 0 {
				t.Fatalf("technical durable outcome=%s/%s content=%v snapshots=%d outcomes=%d", status, reason, rawContent != "", snapshots, outcomes)
			}
			var ignored int
			if err := db.Pool().QueryRow(ctx, `select count(*) from private.whatsapp_webhook_ignored_events
				where organization_id=$1::uuid and session_id=$2::uuid
				and event_key=(select event_key from public.whatsapp_webhook_inbox where id=$3::uuid) and reason=$4`, f.organizationID, f.sessionID, receipt.ID, whatsappPNConflictReason).Scan(&ignored); err != nil {
				t.Fatal(err)
			}
			if ignored != 1 {
				t.Fatalf("neutral callback-hash ledger=%d", ignored)
			}
			duplicate, err := repo.AcceptEvolutionWebhook(ctx, evolutionWebhookEnvelope{SessionID: f.sessionID, InstanceToken: "synthetic-pn-instance",
				WebhookHeaderTokens: []string{"synthetic-pn-webhook"}, EventType: "message", Payload: payload, ReceivedAt: time.Now().UTC()})
			if err != nil || !duplicate.Duplicate || duplicate.ID != receipt.ID {
				t.Fatalf("conflict replay=%#v/%v", duplicate, err)
			}

			// The established conversation remains usable and preserves its actual
			// captured/observed semantics after the ambiguous callback is consumed.
			valid := map[string]any{"event": "message", "data": map[string]any{
				"Info":    map[string]any{"ID": id + "-valid", "Chat": f.remoteJID, "SenderPN": f.remoteJID, "Timestamp": time.Now().UTC().Format(time.RFC3339Nano)},
				"Message": map[string]any{"conversation": "valid card B"}}}
			encoded, _ := json.Marshal(valid)
			if _, err := repo.AcceptEvolutionWebhook(ctx, evolutionWebhookEnvelope{SessionID: f.sessionID, InstanceToken: "synthetic-pn-instance",
				WebhookHeaderTokens: []string{"synthetic-pn-webhook"}, EventType: "message", Payload: encoded, ReceivedAt: time.Now().UTC()}); err != nil {
				t.Fatal(err)
			}
			items, _, err = repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
			if err != nil || len(items) != 1 {
				t.Fatalf("valid claim=%d/%v", len(items), err)
			}
			if err := repo.processClaimedEvolutionWebhook(ctx, items[0]); err != nil {
				t.Fatal(err)
			}
			var capture, lead string
			if err := db.Pool().QueryRow(ctx, `select capture_state,lead_id::text from public.whatsapp_messages
				where organization_id=$1::uuid and provider_message_id=$2`, f.organizationID, id+"-valid").Scan(&capture, &lead); err != nil {
				t.Fatal(err)
			}
			want := "observed_unattended"
			if label == "captured" {
				want = "captured"
			}
			if capture != want || lead != f.leadID {
				t.Fatalf("valid capture=%s/%s want=%s/%s", capture, lead, want, f.leadID)
			}

			// One provider envelope may mix an ambiguous PN with a valid sibling.
			// The technical part must not poison or stop that sibling's routing.
			badID, goodID := id+"-batch-conflict", id+"-batch-valid"
			mixed, _ := json.Marshal(map[string]any{"event": "message", "data": map[string]any{"messages": []any{
				map[string]any{"Info": map[string]any{"ID": badID, "Chat": a, "SenderPN": f.remoteJID, "Timestamp": time.Now().UTC().Format(time.RFC3339Nano)}, "Message": map[string]any{"conversation": "quarantined sibling"}},
				map[string]any{"Info": map[string]any{"ID": goodID, "Chat": f.remoteJID, "SenderPN": f.remoteJID, "Timestamp": time.Now().UTC().Format(time.RFC3339Nano)}, "Message": map[string]any{"conversation": "valid batch sibling"}},
			}}})
			if _, err := repo.AcceptEvolutionWebhook(ctx, evolutionWebhookEnvelope{SessionID: f.sessionID, InstanceToken: "synthetic-pn-instance",
				WebhookHeaderTokens: []string{"synthetic-pn-webhook"}, EventType: "message", Payload: mixed, ReceivedAt: time.Now().UTC()}); err != nil {
				t.Fatal(err)
			}
			for i := 0; i < 2; i++ {
				items, _, err = repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
				if err != nil || len(items) != 1 {
					t.Fatalf("mixed sibling claim=%d/%v", len(items), err)
				}
				if err := repo.processClaimedEvolutionWebhook(ctx, items[0]); err != nil {
					t.Fatal(err)
				}
			}
			var badMessages, goodMessages, batchSnapshots, batchOutcomes, batchProcessed int
			if err := db.Pool().QueryRow(ctx, `select
				(select count(*) from public.whatsapp_messages where organization_id=$1::uuid and provider_message_id=$2),
				(select count(*) from public.whatsapp_messages where organization_id=$1::uuid and provider_message_id=$3 and capture_state=$4 and lead_id=$5::uuid),
				(select count(*) from public.whatsapp_webhook_routing_snapshots where organization_id=$1::uuid and provider_message_id in ($2,$3)),
				(select count(*) from public.whatsapp_webhook_routing_outcomes where organization_id=$1::uuid and provider_message_id in ($2,$3)),
				(select count(*) from public.whatsapp_webhook_inbox where organization_id=$1::uuid and status='processed'
				 and payload #>> '{data,messages,0,Info,ID}' in ($2,$3))`, f.organizationID, badID, goodID, want, f.leadID).
				Scan(&badMessages, &goodMessages, &batchSnapshots, &batchOutcomes, &batchProcessed); err != nil {
				t.Fatal(err)
			}
			if badMessages != 0 || goodMessages != 1 || batchSnapshots != 1 || batchOutcomes != 1 || batchProcessed != 2 {
				t.Fatalf("mixed PN envelope bad=%d good=%d snapshots=%d outcomes=%d processed=%d", badMessages, goodMessages, batchSnapshots, batchOutcomes, batchProcessed)
			}

			// A version-skewed caller cannot bypass Go normalization. The SQL
			// barrier fails before inserting immutable routing provenance.
			tx, err := db.Pool().Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			_, err = tx.Exec(ctx, `select private.capture_whatsapp_webhook_routing_snapshot_v2(
				$1::uuid,$2::uuid,$3,$3,'live','phone:conflict',true,$4::text[],$5,'organic',null,
				false,false,false,null,null,null,1)`, f.organizationID, f.sessionID, id+"-sql", []string{a, f.remoteJID}, "5511988881111")
			_ = tx.Rollback(context.Background())
			var pgerr *pgconn.PgError
			if !errorsAsPNGuard(err, &pgerr) {
				t.Fatalf("SQL PN guard=%v", err)
			}
		})
	}
}

func contactPNBusinessCounts(t *testing.T, ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, org string) [6]int {
	t.Helper()
	var counts [6]int
	err := q.QueryRow(ctx, `select
		(select count(*) from public.leads where organization_id=$1::uuid),
		(select count(*) from public.whatsapp_conversations where organization_id=$1::uuid),
		(select count(*) from public.whatsapp_messages where organization_id=$1::uuid),
		(select count(*) from public.whatsapp_contact_identity_aliases where organization_id=$1::uuid),
		(select count(*) from public.notifications where organization_id=$1::uuid),
		(select count(*) from private.realtime_events where organization_id=$1::uuid)`, org).
		Scan(&counts[0], &counts[1], &counts[2], &counts[3], &counts[4], &counts[5])
	if err != nil {
		t.Fatal(err)
	}
	return counts
}

func errorsAsPNGuard(err error, target **pgconn.PgError) bool {
	return errors.As(err, target) && (*target).Code == "23514" && (*target).Message == whatsappPNConflictReason
}

func TestPNCapturePreservesExplicitInternationalCountry(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	f := newWebhookDependencyFixture(t, ctx, db, "pn-nanp")
	var internationalLead, brazilianLead string
	if err := db.Pool().QueryRow(ctx, `insert into public.leads(organization_id,assigned_user_id,name,phone,source)
		values($1::uuid,$2::uuid,'synthetic NANP','+14155552671','whatsapp') returning id::text`, f.organizationID, f.userID).Scan(&internationalLead); err != nil {
		t.Fatal(err)
	}
	if err := db.Pool().QueryRow(ctx, `insert into public.leads(organization_id,assigned_user_id,name,phone,source)
		values($1::uuid,$2::uuid,'synthetic BR lookalike','+5514155552671','whatsapp') returning id::text`, f.organizationID, f.userID).Scan(&brazilianLead); err != nil {
		t.Fatal(err)
	}
	var destination string
	if err := db.Pool().QueryRow(ctx, `select private.capture_whatsapp_webhook_routing_snapshot_v2(
		$1::uuid,$2::uuid,$3,$3,'live','phone:14155552671',true,
		array['14155552671@s.whatsapp.net'],'14155552671','organic',null,
		false,false,false,null,null,null,1)->>'event_lead_id'`, f.organizationID, f.sessionID, f.suffix+"-country").Scan(&destination); err != nil {
		t.Fatal(err)
	}
	if destination != internationalLead {
		t.Fatalf("explicit NANP PN selected lead=%s; expected international=%s (BR lookalike=%s)", destination, internationalLead, brazilianLead)
	}
}

func TestPNGuardsRejectAliasContaminationWithTenantAndVariantControls(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	f := newWebhookDependencyFixture(t, ctx, db, "pn-alias-guard")
	other := newWebhookDependencyFixture(t, ctx, db, "pn-alias-other")
	for _, q := range []struct {
		org, session, alias, canonical string
		denied                         bool
	}{
		{f.organizationID, f.sessionID, "5511977772222@s.whatsapp.net", "5511988881111@s.whatsapp.net", true},
		{f.organizationID, f.sessionID, "777777777@lid", f.remoteJID, false},
		{other.organizationID, other.sessionID, "777777777@lid", other.remoteJID, false},
		{f.organizationID, f.sessionID, "551188881111@c.us", "5511988881111@s.whatsapp.net", false},
		{f.organizationID, f.sessionID, "14155552671", "14155552671@s.whatsapp.net", false},
	} {
		_, err := db.Pool().Exec(ctx, `insert into public.whatsapp_contact_identity_aliases
			(organization_id,session_id,alias_jid,canonical_jid) values($1::uuid,$2::uuid,$3,$4)`, q.org, q.session, q.alias, q.canonical)
		if q.denied {
			var pgerr *pgconn.PgError
			if !errorsAsPNGuard(err, &pgerr) {
				t.Fatalf("alias guard=%v", err)
			}
		} else if err != nil {
			t.Fatal(err)
		}
	}
	var helperAllowed, referenceAllowed, triggerAllowed bool
	if err := db.Pool().QueryRow(ctx, `select
		has_function_privilege('authenticated','private.whatsapp_contact_pns_conflict(text[])','EXECUTE'),
		has_function_privilege('anon','private.whatsapp_contact_pn_reference(text[])','EXECUTE'),
		has_function_privilege('service_role','private.guard_whatsapp_contact_identity_pn()','EXECUTE')`).Scan(&helperAllowed, &referenceAllowed, &triggerAllowed); err != nil {
		t.Fatal(err)
	}
	if helperAllowed || referenceAllowed || triggerAllowed {
		t.Fatal("PN helpers gained direct caller privileges")
	}
}
