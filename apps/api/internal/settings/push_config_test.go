package settings

import (
	"context"
	"errors"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/pushconfig"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestPublicPushConfigExposesOnlyPublicMaterial(t *testing.T) {
	t.Parallel()

	const publicKey = "public-key"
	repo := Repository{
		vapidPublicKey:      publicKey,
		vapidKeyFingerprint: pushconfig.Fingerprint(publicKey),
	}

	config := repo.PublicPushConfig()
	if !config.Enabled || config.PublicKey != publicKey {
		t.Fatalf("unexpected public push config: %#v", config)
	}
	if config.Fingerprint != pushconfig.Fingerprint(publicKey) {
		t.Fatalf("unexpected VAPID fingerprint: %q", config.Fingerprint)
	}
}

func TestSavePushTokenRejectsClientVAPIDMismatchBeforeDatabaseWrite(t *testing.T) {
	t.Parallel()

	clientKey := "client-public-key"
	repo := Repository{vapidPublicKey: "server-public-key"}
	_, err := repo.SavePushToken(context.Background(), tenant.Context{
		OrganizationID: "00000000-0000-0000-0000-000000000001",
		UserID:         "00000000-0000-0000-0000-000000000002",
	}, PushTokenRequest{
		Endpoint:       "https://push.example.test/subscription",
		VAPIDPublicKey: &clientKey,
	})

	if !errors.Is(err, ErrPushVAPIDMismatch) {
		t.Fatalf("expected ErrPushVAPIDMismatch, got %v", err)
	}
}
