package whatsapp

import (
	"context"
	"errors"
	"testing"
	"time"

	leadsrepo "github.com/vimob-crm/vimob-crm/apps/api/internal/leads"
)

func TestLocalLeadDeleteFencesWhatsAppDelivery(t *testing.T) {
	for _, state := range []struct{ name, status, marker string }{
		{"untouched", "pending", ""}, {"retry_untouched", "retry", "storage_http_503"},
		{"processing", "processing", ""}, {"accepted", "retry", whatsappOutboxProviderAcceptedMarker},
		{"started", "retry", whatsappOutboxProviderStartedMarker}, {"unknown", "dead", whatsappOutboxProviderUnknownMarker},
	} {
		t.Run(state.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			defer cancel()
			db := openLocalOutboundDatabase(t, ctx)
			repo := NewRepository(db, nil, StorageConfig{})
			f := outboundHardeningFixture(t, ctx, db, repo, "delete-"+state.name)
			queued := queueHardeningMessage(t, ctx, repo, f, sendMessageInput{Text: "Synthetic delete fence", ClientMessageID: f.suffix + "-intent"})
			if _, err := db.Pool().Exec(ctx, `update public.whatsapp_outbox set status=$3,last_error=nullif($4,''),
			 locked_at=case when $3='processing' then now() else null end,locked_by=case when $3='processing' then 'synthetic-delete-fence' else null end
			 where organization_id=$1::uuid and message_id=$2::uuid`, f.organizationID, queued.Message.ID, state.status, state.marker); err != nil {
				t.Fatal(err)
			}
			err := leadsrepo.NewRepository(db, nil).Delete(ctx, f.tenant, f.leadID)
			blocked := state.status == "processing" || state.marker == whatsappOutboxProviderAcceptedMarker || state.marker == whatsappOutboxProviderStartedMarker || state.marker == whatsappOutboxProviderUnknownMarker
			var leadExists, bindingActive bool
			var lead, stateAfter, messageStatus string
			if scanErr := db.Pool().QueryRow(ctx, `select exists(select 1 from public.leads where id=$1::uuid),
			 exists(select 1 from public.whatsapp_conversation_lead_bindings where conversation_id=$2::uuid and lead_id=$1::uuid and active_to is null),
			 coalesce((select lead_id::text from public.whatsapp_conversations where id=$2::uuid),''),
			 (select status from public.whatsapp_outbox where message_id=$3::uuid),
			 (select status from public.whatsapp_messages where id=$3::uuid)`, f.leadID, f.conversationID, queued.Message.ID).Scan(&leadExists, &bindingActive, &lead, &stateAfter, &messageStatus); scanErr != nil {
				t.Fatal(scanErr)
			}
			if blocked {
				if !errors.Is(err, leadsrepo.ErrWhatsAppSendInFlight) || !leadExists || !bindingActive || lead != f.leadID || stateAfter != state.status || messageStatus != "queued" {
					t.Fatalf("delete mutated in-flight proof: err=%v exists=%t binding=%t lead=%s outbox=%s message=%s", err, leadExists, bindingActive, lead, stateAfter, messageStatus)
				}
			} else if err != nil || leadExists || bindingActive || lead != "" || stateAfter != "failed" || messageStatus != "failed" {
				t.Fatalf("untouched deletion orphaned work: err=%v exists=%t binding=%t lead=%s outbox=%s message=%s", err, leadExists, bindingActive, lead, stateAfter, messageStatus)
			}
		})
	}
}

func TestLocalLeadDeletePreservesLegacyWorkFences(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	repo := NewRepository(db, nil, StorageConfig{})
	f := outboundHardeningFixture(t, ctx, db, repo, "delete-seven-families")
	work := createPhoneWorkFixture(t, ctx, db.Pool(), f)
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		for _, table := range []string{"public.automation_effect_dispatches", "public.automation_execution_steps", "public.automation_executions", "public.automation_event_outbox", "public.automation_flow_versions", "public.automations", "public.ai_outbox_messages", "public.ai_jobs", "public.outbox_messages", "public.jobs"} {
			if _, err := db.Pool().Exec(cleanupCtx, "delete from "+table+" where organization_id=$1::uuid", f.organizationID); err != nil {
				t.Error(err)
			}
		}
		if _, err := db.Pool().Exec(cleanupCtx, `delete from public.ai_global_agents where id=$1::uuid`, work.agent); err != nil {
			t.Error(err)
		}
	})
	queued := queueHardeningMessage(t, ctx, repo, f, sendMessageInput{Text: "Synthetic safe queue", ClientMessageID: f.suffix + "-intent"})
	for _, s := range []struct{ table, id, busy, safe string }{
		{"outbox_messages", work.legacy, "processing", "pending"}, {"ai_jobs", work.aiJob, "processing", "pending"},
		{"jobs", work.job, "processing", "queued"}, {"ai_outbox_messages", work.aiOutbox, "sending", "approved"},
		{"automation_event_outbox", work.event, "processing", "pending"}, {"automation_executions", work.execution, "running", "waiting"},
		{"automation_effect_dispatches", work.dispatch, "sending", "succeeded"},
	} {
		t.Run(s.table, func(t *testing.T) {
			if _, err := db.Pool().Exec(ctx, "update public."+s.table+" set status=$2 where id=$1::uuid", s.id, s.busy); err != nil {
				t.Fatal(err)
			}
			if err := leadsrepo.NewRepository(db, nil).Delete(ctx, f.tenant, f.leadID); !errors.Is(err, leadsrepo.ErrWhatsAppSendInFlight) {
				t.Fatalf("legacy %s did not block delete: %v", s.table, err)
			}
			var stillQueued string
			if err := db.Pool().QueryRow(ctx, `select status from public.whatsapp_outbox where message_id=$1::uuid`, queued.Message.ID).Scan(&stillQueued); err != nil || stillQueued != "pending" {
				t.Fatalf("denial partially canceled queue: %s %v", stillQueued, err)
			}
			if _, err := db.Pool().Exec(ctx, "update public."+s.table+" set status=$2 where id=$1::uuid", s.id, s.safe); err != nil {
				t.Fatal(err)
			}
		})
	}
	if err := leadsrepo.NewRepository(db, nil).Delete(ctx, f.tenant, f.leadID); err != nil {
		t.Fatal(err)
	}
	for _, s := range []struct{ table, id, want string }{
		{"outbox_messages", work.legacy, "failed"}, {"ai_jobs", work.aiJob, "cancelled"}, {"jobs", work.job, "cancelled"},
		{"ai_outbox_messages", work.aiOutbox, "cancelled"}, {"automation_event_outbox", work.event, "dead_letter"},
		{"automation_executions", work.execution, "cancelled"}, {"automation_execution_steps", work.step, "cancelled"},
	} {
		var got string
		if err := db.Pool().QueryRow(ctx, "select status from public."+s.table+" where id=$1::uuid", s.id).Scan(&got); err != nil || got != s.want {
			t.Errorf("%s=%s want%s: %v", s.table, got, s.want, err)
		}
	}
}
