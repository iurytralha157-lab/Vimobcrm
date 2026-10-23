package whatsapp

import (
	"context"
	"testing"
	"time"
)

func TestLocalDeferredSessionControlsAcceptCurrentEpochAndPreserveLogout(t *testing.T) {
	for _, test := range []struct {
		name, event, initial, want string
		data                       map[string]any
		loggedOut                  bool
	}{
		{"connected_epoch_one", "connection.update", "disconnected", "connected", map[string]any{"state": "open"}, false},
		{"disconnected_epoch_one", "connection.update", "connected", "disconnected", map[string]any{"state": "close"}, false},
		{"qr_epoch_one", "qrcode.updated", "disconnected", "qr_ready", map[string]any{"qrcode": "synthetic-current-qr"}, false},
		{"qr_without_blob_preserves_existing", "connection.update", "disconnected", "qr_ready", map[string]any{"state": "qr_ready"}, false},
		{"unknown_preserves_connection", "connection.update", "connected", "connected", map[string]any{"state": "error", "message": "synthetic unknown observation"}, false},
		{"logged_out_rejects_connect", "connection.update", "disconnected", "disconnected", map[string]any{"state": "open"}, true},
		{"logged_out_rejects_qr", "qrcode.updated", "disconnected", "disconnected", map[string]any{"qrcode": "synthetic-stale-qr"}, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx, postgres, f := sessionObservationFixture(t)
			repo := NewRepository(postgres, nil, StorageConfig{})
			if _, err := postgres.Pool().Exec(ctx, `insert into private.whatsapp_webhook_session_cutovers(session_id,active_epoch,cutover_at)values($1::uuid,1,now());
				update public.whatsapp_sessions set status=$2,qr_code='synthetic-existing-qr',advanced_settings=case when $3::boolean
				then '{"auto_reconnect_enabled":false,"auto_reconnect_blocked_reason":"user_logged_out"}'::jsonb else '{}'::jsonb end where id=$1::uuid`, f.sessionID, test.initial, test.loggedOut); err != nil {
				t.Fatal(err)
			}
			item := insertObservationControl(t, ctx, postgres, f, test.event, test.data, time.Now().UTC().Add(-time.Second))
			if item.ProcessingEpoch != 1 {
				t.Fatal("positive control did not use epoch one")
			}
			if handled, err := repo.processEvolutionWebhookNative(ctx, item); err != nil || !handled {
				t.Fatalf("current epoch control failed: handled=%v error=%v", handled, err)
			}
			observationSessionState(t, ctx, postgres, f, test.want)
			var before string
			if err := postgres.Pool().QueryRow(ctx, `select updated_at::text from public.whatsapp_sessions where id=$1::uuid`, f.sessionID).Scan(&before); err != nil {
				t.Fatal(err)
			}
			if _, err := repo.processEvolutionWebhookNative(ctx, item); err != nil {
				t.Fatal(err)
			}
			var unchanged bool
			if err := postgres.Pool().QueryRow(ctx, `select updated_at::text=$2 from public.whatsapp_sessions where id=$1::uuid`, f.sessionID, before).Scan(&unchanged); err != nil || !unchanged {
				t.Fatalf("exact control replay mutated session: unchanged=%v error=%v", unchanged, err)
			}
			if test.name == "qr_without_blob_preserves_existing" {
				var qr string
				if err := postgres.Pool().QueryRow(ctx, `select qr_code from public.whatsapp_sessions where id=$1::uuid`, f.sessionID).Scan(&qr); err != nil || qr != "synthetic-existing-qr" {
					t.Fatalf("QR pulse erased current blob: %q error=%v", qr, err)
				}
			}
		})
	}
}

func TestLocalDeferredSessionControlsRevalidateClaimGenerationAndPayload(t *testing.T) {
	for _, test := range []string{"attempt_aba", "payload_changed", "event_changed", "created_at_changed", "terminal_claim", "other_session", "other_organization"} {
		t.Run(test, func(t *testing.T) {
			ctx, postgres, f := sessionObservationFixture(t)
			repo := NewRepository(postgres, nil, StorageConfig{})
			item := insertObservationControl(t, ctx, postgres, f, "connection.update", map[string]any{"state": "close"}, time.Now().UTC().Add(-time.Second))
			switch test {
			case "attempt_aba":
				if _, err := postgres.Pool().Exec(ctx, `update public.whatsapp_webhook_inbox set attempts=attempts+1 where id=$1::uuid`, item.ID); err != nil {
					t.Fatal(err)
				}
			case "payload_changed":
				item.Payload = []byte(`{"event":"connection.update","data":{"state":"open"}}`)
			case "event_changed":
				item.EventType = "connection.forged"
			case "created_at_changed":
				item.CreatedAt = item.CreatedAt.Add(time.Second)
			case "terminal_claim":
				if _, err := postgres.Pool().Exec(ctx, `update public.whatsapp_webhook_inbox set status='processed',processed_at=now(),locked_at=null,locked_by=null where id=$1::uuid`, item.ID); err != nil {
					t.Fatal(err)
				}
			case "other_session":
				if err := postgres.Pool().QueryRow(ctx, `insert into public.whatsapp_sessions(organization_id,owner_user_id,instance_name,provider,status,is_active)
				values($1::uuid,$2::uuid,'synthetic-other-session','evolution_go','connected',true) returning id::text`, f.organizationID, f.userID).Scan(&item.SessionID); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() {
					cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
					defer cancel()
					if _, err := postgres.Pool().Exec(cleanupCtx, `delete from public.whatsapp_sessions where organization_id=$1::uuid and id=$2::uuid`, f.organizationID, item.SessionID); err != nil {
						t.Errorf("cleanup second synthetic session: %v", err)
					}
				})
			case "other_organization":
				other := createSessionConversationLockFixture(t, ctx, postgres.Pool(), "other-control-tenant")
				t.Cleanup(func() { cleanupSessionConversationLockFixture(t, postgres.Pool(), other) })
				item.OrganizationID, item.SessionID = other.organizationID, other.sessionID
			}
			if handled, err := repo.processEvolutionWebhookNative(ctx, item); err == nil || !handled {
				t.Fatalf("changed claim accepted: handled=%v error=%v", handled, err)
			}
			observationSessionState(t, ctx, postgres, f, "connected")
		})
	}
}

func TestLocalInboundCaptureContinuesAfterDeferredSessionDisconnect(t *testing.T) {
	ctx, postgres, f := sessionObservationFixture(t)
	repo := NewRepository(postgres, nil, StorageConfig{})
	if _, err := postgres.Pool().Exec(ctx, `insert into private.whatsapp_webhook_session_cutovers(session_id,active_epoch,cutover_at)values($1::uuid,1,now())`, f.sessionID); err != nil {
		t.Fatal(err)
	}
	configureCaptureIsolationFixture(t, ctx, repo, f)
	control := insertObservationControl(t, ctx, postgres, f, "connection.update", map[string]any{"state": "close"}, time.Now().UTC().Add(-time.Second))
	if err := repo.processClaimedEvolutionWebhook(ctx, control); err != nil {
		t.Fatalf("deferred disconnect drain: %v", err)
	}
	observationSessionState(t, ctx, postgres, f, "disconnected")
	receipt, envelope := acceptCaptureIsolationMessage(t, ctx, repo, f, "inbound-disconnected", map[string]any{"conversation": "synthetic inbound remains capturable"})
	processCaptureIsolationInbox(t, ctx, repo, receipt.ID)
	assertCaptureIsolationCounts(t, ctx, repo, f, 1, 0, 1)
	var captured, oneLead bool
	if err := postgres.Pool().QueryRow(ctx, `select exists(select 1 from public.whatsapp_messages where organization_id=$1::uuid
		and session_id=$2::uuid and conversation_id=$3::uuid and lead_id=$4::uuid and not from_me and capture_state='captured'
		and content='synthetic inbound remains capturable'),(select count(*)=1 from public.leads where organization_id=$1::uuid)`, f.organizationID, f.sessionID, f.conversationID, f.leadID).Scan(&captured, &oneLead); err != nil || !captured || !oneLead {
		t.Fatalf("existing linked lead inbound was lost/recreated: captured=%v oneLead=%v error=%v", captured, oneLead, err)
	}
	replay, err := repo.AcceptEvolutionWebhook(ctx, envelope)
	if err != nil || !replay.Duplicate || replay.ID != receipt.ID {
		t.Fatalf("inbound replay lost durable dedup: %+v error=%v", replay, err)
	}
	assertCaptureIsolationCounts(t, ctx, repo, f, 1, 0, 1)
}
