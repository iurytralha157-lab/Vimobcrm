package settings

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/pushconfig"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	authpkg "github.com/vimob-crm/vimob-crm/packages/auth"
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

func TestSavePushTokenChecksInactiveSyncBeforeTransferringOwnership(t *testing.T) {
	t.Parallel()

	source, err := os.ReadFile("push_device_admission.go")
	if err != nil {
		t.Fatalf("read push_device_admission.go: %v", err)
	}
	content := string(source)
	transferCall := strings.Index(content, "where user_id is distinct from $1::uuid")
	syncCheck := strings.Index(content, "if request.SyncOnly != nil && *request.SyncOnly")
	resubscribe := strings.Index(content, "RequiresResubscribe: true")
	upsert := strings.Index(content, "insert into public.push_tokens")
	if syncCheck < 0 || resubscribe < syncCheck || transferCall < resubscribe || upsert < transferCall {
		t.Fatal("inactive sync must return before ownership transfer, and transfer must precede upsert")
	}
	for _, required := range []string{
		"where user_id is distinct from $1::uuid",
		"private.push_device_endpoint_key",
		"pg_advisory_xact_lock",
		"tx.Commit(ctx)",
		"registration_sid=excluded.registration_sid",
		"on conflict(user_id,endpoint) where endpoint is not null",
	} {
		if !strings.Contains(content, required) {
			t.Fatalf("missing endpoint ownership guard %q", required)
		}
	}
	if strings.Contains(content, "repo.db.Pool().Exec(ctx, `update public.push_tokens set is_active=false") {
		// Only session-bound logout is a single independent atomic update.
		save := content[:strings.Index(content, "func (repo Repository) deactivatePushTokenSession")]
		if strings.Contains(save, "repo.db.Pool().Exec") {
			t.Fatal("ownership write escaped the registration transaction")
		}
	}
	actor := strings.Index(content, "lockPushDeviceActor(ctx, tx, actor)")
	device := strings.Index(content, "pg_advisory_xact_lock")
	session := strings.Index(content, "lockPushDeviceSession(ctx, tx, actor, sid)")
	if actor < 0 || device < actor || session < device || transferCall < session {
		t.Fatal("registration must lock actor, endpoint, live SID before ownership writes")
	}
}

func TestPushDeviceActorSessionUsesVerifiedSubject(t *testing.T) {
	const actorID = "00000000-0000-0000-0000-000000000002"
	const sid = "00000000-0000-0000-0000-000000000003"
	for _, test := range []struct {
		name    string
		subject authpkg.User
		present bool
		allowed bool
	}{
		{"trusted", authpkg.User{ID: actorID, SessionID: sid}, true, true},
		{"missing", authpkg.User{}, false, false},
		{"other_actor", authpkg.User{ID: "00000000-0000-0000-0000-000000000004", SessionID: sid}, true, false},
		{"missing_sid", authpkg.User{ID: actorID}, true, false},
		{"malformed_sid", authpkg.User{ID: actorID, SessionID: "client-not-a-session"}, true, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx := context.Background()
			if test.present {
				ctx = httpserver.ContextWithUser(ctx, test.subject)
			}
			got, err := pushDeviceActorSession(ctx, tenant.Context{UserID: actorID})
			if test.allowed {
				if err != nil || got != sid {
					t.Fatalf("trusted subject: %q %v", got, err)
				}
			} else if !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
				t.Fatalf("untrusted SID admitted: %q %v", got, err)
			}
		})
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
