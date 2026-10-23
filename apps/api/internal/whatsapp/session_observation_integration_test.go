package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/packages/db"
)

func sessionObservationFixture(t *testing.T) (context.Context, *db.Postgres, sessionConversationLockFixture) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	t.Cleanup(cancel)
	postgres := openLocalOutboundDatabase(t, ctx)
	f := createSessionConversationLockFixture(t, ctx, postgres.Pool(), "session-observation")
	t.Cleanup(func() { cleanupSessionConversationLockFixture(t, postgres.Pool(), f) })
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := postgres.Pool().Exec(cleanupCtx, `delete from public.whatsapp_webhook_inbox where organization_id=$1::uuid`, f.organizationID); err != nil {
			t.Errorf("cleanup synthetic session observations: %v", err)
		}
	})
	return ctx, postgres, f
}

func observationSessionState(t *testing.T, ctx context.Context, postgres *db.Postgres, f sessionConversationLockFixture, want string) {
	t.Helper()
	var status string
	if err := postgres.Pool().QueryRow(ctx, `select status from public.whatsapp_sessions where organization_id=$1::uuid and id=$2::uuid`, f.organizationID, f.sessionID).Scan(&status); err != nil || status != want {
		t.Fatalf("persisted session status=%q, want %q: %v", status, want, err)
	}
}

func applyObservationWebhook(t *testing.T, ctx context.Context, repo Repository, f sessionConversationLockFixture, status string, at time.Time) {
	t.Helper()
	if err := repo.applyEvolutionWebhookSessionState(ctx, evolutionWebhookSession{ID: f.sessionID, OrganizationID: f.organizationID}, evolutionWebhookSessionState{
		Handled: true, Status: status, OccurredAt: at, ProviderTimestamp: true,
		Rank: evolutionWebhookStateRankTerminal, EventKey: "synthetic-newer-" + status,
	}); err != nil {
		t.Fatalf("apply synthetic newer webhook: %v", err)
	}
}

func TestLocalSessionQRCodeDoesNotInventDisconnect(t *testing.T) {
	for _, test := range []struct {
		name string
		code int
		body string
	}{
		{"ambiguous_disconnect_text", 400, "client is not disconnected"},
		{"proxy_route_missing", 404, "upstream route not found"},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx, postgres, f := sessionObservationFixture(t)
			var qrCalls atomic.Int32
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/instance/status" {
					_, _ = w.Write([]byte(`{"connected":true,"loggedIn":true}`))
					return
				}
				qrCalls.Add(1)
				http.Error(w, test.body, test.code)
			}))
			t.Cleanup(provider.Close)
			repo := NewRepository(postgres, nil, StorageConfig{EvolutionGo: EvolutionGoConfig{APIURL: provider.URL, APIKey: "synthetic-provider-key"}})
			if _, err := repo.GetQRCode(ctx, f.tenant, f.sessionID); err != nil && !errors.Is(err, ErrProviderFailed) {
				t.Fatalf("unexpected QR error before provider observation: %v", err)
			}
			if qrCalls.Load() != 1 {
				t.Fatalf("QR calls=%d, want one synthetic provider observation", qrCalls.Load())
			}
			observationSessionState(t, ctx, postgres, f, "connected")
		})
	}
	for _, body := range []string{"upstream route not found", `{"qrcode":"synthetic-obsolete-qr"}`} {
		t.Run(body, func(t *testing.T) {
			ctx, postgres, f := sessionObservationFixture(t)
			if _, err := postgres.Pool().Exec(ctx, `update public.whatsapp_sessions set status='disconnected' where id=$1::uuid`, f.sessionID); err != nil {
				t.Fatal(err)
			}
			started, release := make(chan struct{}), make(chan struct{})
			var once sync.Once
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/instance/status" {
					_, _ = w.Write([]byte(`{"connected":true,"loggedIn":true}`))
					return
				}
				once.Do(func() { close(started) })
				select {
				case <-release:
				case <-r.Context().Done():
					return
				}
				if body == "upstream route not found" {
					w.WriteHeader(404)
				}
				_, _ = w.Write([]byte(body))
			}))
			t.Cleanup(provider.Close)
			repo := NewRepository(postgres, nil, StorageConfig{EvolutionGo: EvolutionGoConfig{APIURL: provider.URL, APIKey: "synthetic-provider-key"}})
			finished := make(chan error, 1)
			go func() { _, err := repo.GetQRCode(ctx, f.tenant, f.sessionID); finished <- err }()
			select {
			case <-started:
			case <-ctx.Done():
				t.Fatal("QR observation did not reach synthetic provider")
			}
			applyObservationWebhook(t, ctx, repo, f, "connected", time.Now().UTC())
			close(release)
			select {
			case err := <-finished:
				if err != nil && !errors.Is(err, ErrProviderFailed) {
					t.Fatalf("unexpected late QR error: %v", err)
				}
			case <-ctx.Done():
				t.Fatal("QR observation did not finish")
			}
			observationSessionState(t, ctx, postgres, f, "connected")
		})
	}
}

func TestLocalSessionStatusReturnsStateThatWonTheCAS(t *testing.T) {
	for _, test := range []struct {
		name, current, newer, body string
		code                       int
	}{
		{"old_disconnect_new_connect", "disconnected", "connected", `{"connected":false,"loggedIn":false}`, 200},
		{"old_connect_new_disconnect", "connected", "disconnected", `{"connected":true,"loggedIn":true}`, 200},
		{"old_missing_new_connect", "disconnected", "connected", `{"error":"instance not found"}`, 404},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx, postgres, f := sessionObservationFixture(t)
			if _, err := postgres.Pool().Exec(ctx, `update public.whatsapp_sessions set status=$2 where id=$1::uuid`, f.sessionID, test.current); err != nil {
				t.Fatal(err)
			}
			started, release := make(chan struct{}), make(chan struct{})
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				close(started)
				select {
				case <-release:
				case <-r.Context().Done():
					return
				}
				w.WriteHeader(test.code)
				_, _ = w.Write([]byte(test.body))
			}))
			t.Cleanup(provider.Close)
			repo := NewRepository(postgres, nil, StorageConfig{EvolutionGo: EvolutionGoConfig{APIURL: provider.URL, APIKey: "synthetic-provider-key"}})
			type outcome struct {
				response ConnectionStatusResponse
				err      error
			}
			finished := make(chan outcome, 1)
			go func() {
				response, err := repo.GetConnectionStatus(ctx, f.tenant, f.sessionID)
				finished <- outcome{response, err}
			}()
			select {
			case <-started:
			case <-ctx.Done():
				t.Fatal("status observation did not reach synthetic provider")
			}
			applyObservationWebhook(t, ctx, repo, f, test.newer, time.Now().UTC())
			close(release)
			select {
			case result := <-finished:
				if result.err != nil || result.response.Status != test.newer || result.response.Connected != (test.newer == "connected") || result.response.InstanceNotFound {
					t.Fatalf("status returned rejected observation: %+v, %v; want %s", result.response, result.err, test.newer)
				}
			case <-ctx.Done():
				t.Fatal("status observation did not finish")
			}
			observationSessionState(t, ctx, postgres, f, test.newer)
		})
	}
}

func TestLocalSessionQRCodeAppliesOnlyCurrentOwnedObservation(t *testing.T) {
	for _, loggedOut := range []bool{false, true} {
		name := "current_disconnected"
		if loggedOut {
			name = "explicit_logout"
		}
		t.Run(name, func(t *testing.T) {
			ctx, postgres, f := sessionObservationFixture(t)
			if _, err := postgres.Pool().Exec(ctx, `update public.whatsapp_sessions set status='disconnected',advanced_settings=
				case when $2::boolean then '{"auto_reconnect_enabled":false,"auto_reconnect_blocked_reason":"user_logged_out"}'::jsonb else '{}'::jsonb end where id=$1::uuid`, f.sessionID, loggedOut); err != nil {
				t.Fatal(err)
			}
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/instance/qr" {
					t.Errorf("unexpected synthetic QR route: %s", r.URL.Path)
				}
				_, _ = w.Write([]byte(`{"qrcode":"synthetic-current-owned-qr"}`))
			}))
			t.Cleanup(provider.Close)
			repo := NewRepository(postgres, nil, StorageConfig{EvolutionGo: EvolutionGoConfig{APIURL: provider.URL, APIKey: "synthetic-provider-key"}})
			response, err := repo.GetQRCode(ctx, f.tenant, f.sessionID)
			if err != nil {
				t.Fatal(err)
			}
			if loggedOut {
				if response.QRCode != "" {
					t.Fatal("QR response resurrected an explicitly logged-out session")
				}
				observationSessionState(t, ctx, postgres, f, "disconnected")
			} else {
				if response.QRCode != "synthetic-current-owned-qr" {
					t.Fatalf("current QR lost: %+v", response)
				}
				observationSessionState(t, ctx, postgres, f, "qr_ready")
			}
		})
	}
}

func TestLocalSessionStatusCannotUndoExplicitLogout(t *testing.T) {
	ctx, postgres, f := sessionObservationFixture(t)
	if _, err := postgres.Pool().Exec(ctx, `update public.whatsapp_sessions set status='disconnected',advanced_settings=
		'{"auto_reconnect_enabled":false,"auto_reconnect_blocked_reason":"user_logged_out"}'::jsonb where id=$1::uuid`, f.sessionID); err != nil {
		t.Fatal(err)
	}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/instance/status" {
			t.Errorf("unexpected synthetic status route: %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"connected":true,"loggedIn":true}`))
	}))
	t.Cleanup(provider.Close)
	repo := NewRepository(postgres, nil, StorageConfig{EvolutionGo: EvolutionGoConfig{APIURL: provider.URL, APIKey: "synthetic-provider-key"}})
	response, err := repo.GetConnectionStatus(ctx, f.tenant, f.sessionID)
	if err != nil || response.Status != "disconnected" || response.Connected {
		t.Fatalf("manual provider probe undid explicit logout: %+v error=%v", response, err)
	}
	observationSessionState(t, ctx, postgres, f, "disconnected")
	var preserved bool
	if err := postgres.Pool().QueryRow(ctx, `select advanced_settings @> '{"auto_reconnect_enabled":false,"auto_reconnect_blocked_reason":"user_logged_out"}'::jsonb
		from public.whatsapp_sessions where id=$1::uuid`, f.sessionID).Scan(&preserved); err != nil || !preserved {
		t.Fatalf("manual provider probe changed explicit logout marker: preserved=%v error=%v", preserved, err)
	}
}

func insertObservationControl(t *testing.T, ctx context.Context, postgres *db.Postgres, f sessionConversationLockFixture, event string, data map[string]any, at time.Time) pendingEvolutionWebhook {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"event": event, "data": data,
		"__vimob_ingress": map[string]any{"epoch_capable": true, "routing_key": "__session__", "routing_snapshot": map[string]any{"version": 1, "messages": []any{}}}})
	if err != nil {
		t.Fatal(err)
	}
	return leaseObservationControl(t, ctx, postgres, pendingEvolutionWebhook{OrganizationID: f.organizationID, SessionID: f.sessionID, EventType: event, Payload: raw, CreatedAt: at})
}

func leaseObservationControl(t *testing.T, ctx context.Context, postgres *db.Postgres, item pendingEvolutionWebhook) pendingEvolutionWebhook {
	t.Helper()
	payload, err := decodeNativeEvolutionPayload(item.Payload)
	if err != nil {
		t.Fatal(err)
	}
	payload["__vimob_ingress"] = map[string]any{"epoch_capable": true, "routing_key": "__session__", "routing_snapshot": map[string]any{"version": 1, "messages": []any{}}}
	item.Payload, err = json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	item.Attempts = 1
	if err := postgres.Pool().QueryRow(ctx, `select coalesce((select active_epoch from private.whatsapp_webhook_session_cutovers where session_id=$1::uuid),0)`, item.SessionID).Scan(&item.ProcessingEpoch); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `insert into public.whatsapp_webhook_inbox
		(organization_id,session_id,event_key,event_type,provider,payload,status,attempts,locked_by,locked_at,created_at,processing_epoch)
		values($1::uuid,$2::uuid,'synthetic-session-control-'||gen_random_uuid()::text,$3,'evolution_go',$4::jsonb,'processing',1,$5,now(),$6,$7)
		returning id::text,created_at`, item.OrganizationID, item.SessionID, item.EventType, string(item.Payload), whatsappWebhookWorkerID, item.CreatedAt, item.ProcessingEpoch).Scan(&item.ID, &item.CreatedAt); err != nil {
		t.Fatal(err)
	}
	return item
}

func TestLocalDeferredSessionControlsCannotOverwriteNewerConnection(t *testing.T) {
	for _, test := range []struct {
		name, event, newer string
		data               map[string]any
	}{
		{"disconnect", "connection.update", "connected", map[string]any{"state": "close"}},
		{"connect", "connection.update", "disconnected", map[string]any{"state": "open"}},
		{"qr", "qrcode.updated", "connected", map[string]any{"qrcode": "synthetic-old-qr"}},
		{"logged_out", "loggedout", "connected", map[string]any{}},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx, postgres, f := sessionObservationFixture(t)
			repo := NewRepository(postgres, nil, StorageConfig{})
			at := time.Now().UTC().Add(-time.Minute)
			item := insertObservationControl(t, ctx, postgres, f, test.event, test.data, at)
			applyObservationWebhook(t, ctx, repo, f, test.newer, at.Add(30*time.Second))
			if handled, err := repo.processEvolutionWebhookNative(ctx, item); err != nil || !handled {
				t.Fatalf("deferred control failed: handled=%v error=%v", handled, err)
			}
			observationSessionState(t, ctx, postgres, f, test.newer)
		})
	}
}

func TestLocalDeferredSessionControlsRejectRetainedEpochAndLostLease(t *testing.T) {
	for _, test := range []string{"retained_epoch", "lost_lease"} {
		t.Run(test, func(t *testing.T) {
			ctx, postgres, f := sessionObservationFixture(t)
			repo := NewRepository(postgres, nil, StorageConfig{})
			item := insertObservationControl(t, ctx, postgres, f, "connection.update", map[string]any{"state": "close"}, time.Now().UTC().Add(-time.Minute))
			if test == "retained_epoch" {
				if _, err := postgres.Pool().Exec(ctx, `insert into private.whatsapp_webhook_session_cutovers(session_id,active_epoch,cutover_at)values($1::uuid,1,now())`, f.sessionID); err != nil {
					t.Fatal(err)
				}
			} else {
				if _, err := postgres.Pool().Exec(ctx, `update public.whatsapp_webhook_inbox set locked_by='synthetic-other-worker' where id=$1::uuid`, item.ID); err != nil {
					t.Fatal(err)
				}
			}
			if handled, err := repo.processEvolutionWebhookNative(ctx, item); err == nil || !handled {
				t.Fatalf("unowned control accepted: handled=%v error=%v", handled, err)
			}
			observationSessionState(t, ctx, postgres, f, "connected")
		})
	}
}
