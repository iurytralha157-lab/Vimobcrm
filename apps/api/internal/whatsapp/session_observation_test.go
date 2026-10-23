package whatsapp

import (
	"errors"
	"testing"
	"time"
)

func TestSessionConnectionObservationReturnsOnlyTheWinningState(t *testing.T) {
	observed := connectionStatusResponse("disconnected", true, "stale-provider-identity")
	t.Run("accepted observation", func(t *testing.T) {
		got, err := reconcileSessionConnectionObservation(observed, func() (bool, error) { return true, nil }, func() (Session, error) {
			t.Fatal("accepted observation must not reload")
			return Session{}, nil
		})
		if err != nil || got.Status != "disconnected" || !got.InstanceNotFound {
			t.Fatalf("accepted observation=%+v: %v", got, err)
		}
	})
	t.Run("webhook won", func(t *testing.T) {
		phone := "5511999991111"
		got, err := reconcileSessionConnectionObservation(observed, func() (bool, error) { return false, nil }, func() (Session, error) {
			return Session{Status: "connected", PhoneNumber: &phone}, nil
		})
		if err != nil || !got.Connected || got.Status != "connected" || got.State != "open" || got.InstanceNotFound || got.Instance["wuid"] != phone {
			t.Fatalf("rejected observation escaped to response=%+v: %v", got, err)
		}
	})
	t.Run("apply failed", func(t *testing.T) {
		failure := errors.New("synthetic SQL failure")
		got, err := reconcileSessionConnectionObservation(observed, func() (bool, error) { return false, failure }, func() (Session, error) {
			t.Fatal("failed persistence must not be hidden by a reload")
			return Session{}, nil
		})
		if !errors.Is(err, failure) || got.Status != "" {
			t.Fatalf("apply failure=%+v: %v", got, err)
		}
	})
	t.Run("owner revoked", func(t *testing.T) {
		got, err := reconcileSessionConnectionObservation(observed, func() (bool, error) { return false, nil }, func() (Session, error) { return Session{}, ErrSessionNotFound })
		if !errors.Is(err, ErrSessionNotFound) || got.Status != "" {
			t.Fatalf("revoked owner received stale observation=%+v: %v", got, err)
		}
	})
	t.Run("current unknown", func(t *testing.T) {
		got, err := reconcileSessionConnectionObservation(observed, func() (bool, error) { return false, nil }, func() (Session, error) { return Session{Status: "disabled"}, nil })
		if !errors.Is(err, ErrProviderOutcomeUnknown) || got.Status != "" {
			t.Fatalf("unknown became disconnected=%+v: %v", got, err)
		}
	})
}

func TestDeferredSessionControlUsesIngressTimeForEveryUnversionedState(t *testing.T) {
	at := time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)
	for _, test := range []struct {
		event string
		data  map[string]any
		want  string
		rank  int
	}{
		{"connection.update", map[string]any{"state": "close"}, "disconnected", evolutionWebhookStateRankTerminal},
		{"connection.update", map[string]any{"state": "open"}, "connected", evolutionWebhookStateRankTerminal},
		{"connected", map[string]any{}, "connected", evolutionWebhookStateRankTerminal},
		{"loggedout", map[string]any{}, "disconnected", evolutionWebhookStateRankTerminal},
		{"qrcode.updated", map[string]any{"qrcode": "synthetic-qr"}, "qr_ready", evolutionWebhookStateRankQRCode},
		{"connection.update", map[string]any{"state": "qr_ready"}, "qr_ready", evolutionWebhookStateRankQRCode},
	} {
		state, recognized := deferredEvolutionWebhookSessionState(pendingEvolutionWebhook{ID: "synthetic-control", EventType: test.event, CreatedAt: at}, map[string]any{"event": test.event, "data": test.data})
		if !recognized || state.Status != test.want || state.Rank != test.rank || !state.OccurredAt.Equal(at) || state.ProviderTimestamp || state.EventKey != "synthetic-control" {
			t.Fatalf("unversioned %s=%+v, recognized=%v", test.event, state, recognized)
		}
	}
	state, recognized := deferredEvolutionWebhookSessionState(pendingEvolutionWebhook{ID: "control", CreatedAt: at}, map[string]any{"event": "connection.update", "timestamp": at.Add(6 * time.Minute).Unix(), "data": map[string]any{"state": "close"}})
	if !recognized || state.ProviderTimestamp || !state.OccurredAt.Equal(at) {
		t.Fatalf("future provider clock=%+v recognized=%v", state, recognized)
	}
}

func TestDeferredSessionControlOrderingPreservesConnectedAndExplicitLogout(t *testing.T) {
	at := time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)
	settings := map[string]any{"webhook_state_event_at_ms": at.UnixMilli(), "webhook_state_event_rank": evolutionWebhookStateRankTerminal, "webhook_state_event_key": "current"}
	candidate := evolutionWebhookSessionState{Status: "disconnected", OccurredAt: at.Add(-time.Second), Rank: evolutionWebhookStateRankTerminal, EventKey: "old"}
	if deferredSessionStateIsCurrent(settings, "connected", candidate) {
		t.Fatal("old queued disconnect replaced newer connected")
	}
	candidate.OccurredAt, candidate.EventKey = at, "current"
	if deferredSessionStateIsCurrent(settings, "connected", candidate) {
		t.Fatal("exact replay reapplied state")
	}
	candidate.OccurredAt, candidate.Status = at.Add(time.Second), "qr_ready"
	if deferredSessionStateIsCurrent(settings, "connected", candidate) {
		t.Fatal("QR replaced connected")
	}
	candidate.Status = "disconnected"
	if !deferredSessionStateIsCurrent(settings, "connected", candidate) {
		t.Fatal("new disconnect was lost")
	}
	settings["auto_reconnect_enabled"], settings["auto_reconnect_blocked_reason"] = false, "user_logged_out"
	for _, status := range []string{"connected", "qr_ready"} {
		candidate.Status = status
		if deferredSessionStateIsCurrent(settings, "disconnected", candidate) {
			t.Fatalf("%s resurrected explicit logout", status)
		}
	}
}

func TestDeferredSessionControlOrderingUsesTheInlineMillisecondPrecision(t *testing.T) {
	at := time.Date(2026, 10, 15, 12, 0, 0, 123456000, time.UTC)
	settings := map[string]any{"webhook_state_event_at_ms": at.UnixMilli(), "webhook_state_event_rank": evolutionWebhookStateRankTerminal, "webhook_state_event_key": "control-b"}
	candidate := evolutionWebhookSessionState{Status: "connected", OccurredAt: at, Rank: evolutionWebhookStateRankTerminal, EventKey: "control-b"}
	if deferredSessionStateIsCurrent(settings, "disconnected", candidate) {
		t.Fatal("microsecond replay bypassed the stored tuple")
	}
	candidate.EventKey = "control-a"
	if deferredSessionStateIsCurrent(settings, "disconnected", candidate) {
		t.Fatal("microseconds overrode lexical ordering within the same millisecond")
	}
	candidate.EventKey = "control-c"
	if !deferredSessionStateIsCurrent(settings, "disconnected", candidate) {
		t.Fatal("newer lexical control was lost within the same millisecond")
	}
}
