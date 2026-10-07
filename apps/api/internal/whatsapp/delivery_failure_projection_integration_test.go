package whatsapp

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// This test writes only to an explicitly supplied isolated test database.
func TestWhatsAppDeliveryFailureProjectionOnIsolatedDatabase(t *testing.T) {
	databaseURL := os.Getenv("WHATSAPP_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}
	target, err := url.Parse(databaseURL)
	if err != nil ||
		(target.Hostname() != "127.0.0.1" && target.Hostname() != "localhost") ||
		!strings.Contains(strings.ToLower(target.Path), "test") {
		t.Fatal("WHATSAPP_TEST_DATABASE_URL must point to an isolated loopback test database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)
	fixture := createSessionConversationLockFixture(t, ctx, postgres.Pool(), "delivery-failure")
	t.Cleanup(func() { cleanupSessionConversationLockFixture(t, postgres.Pool(), fixture) })
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		for _, statement := range []string{
			`delete from public.whatsapp_outbox where organization_id = $1::uuid`,
			`delete from public.whatsapp_messages where organization_id = $1::uuid`,
		} {
			if _, err := postgres.Pool().Exec(cleanupCtx, statement, fixture.organizationID); err != nil {
				t.Errorf("cleanup delivery failure fixture: %v", err)
			}
		}
	})

	repo := Repository{db: postgres}
	for _, scenario := range []struct {
		name       string
		cause      error
		permanent  bool
		unknown    bool
		wantStatus string
		wantCode   string
	}{
		{
			name:       "recipient not registered",
			cause:      fmt.Errorf("%w: number 5511999999999@s.whatsapp.net is not registered on WhatsApp", ErrRecipientNotRegistered),
			permanent:  true,
			wantStatus: "failed",
			wantCode:   deliveryErrorRecipientNotRegistered,
		},
		{
			name:       "provider outcome unknown",
			cause:      fmt.Errorf("%w: timeout after HTTP request", ErrProviderOutcomeUnknown),
			unknown:    true,
			wantStatus: "dead",
			wantCode:   deliveryErrorOutcomeUnknown,
		},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			clientID := fmt.Sprintf("delivery-failure-%d", time.Now().UnixNano())
			leaseToken := "lease-" + clientID
			var messageID, outboxID string
			if err := postgres.Pool().QueryRow(ctx, `
				insert into public.whatsapp_messages (
					organization_id, conversation_id, session_id, lead_id,
					sender_user_id, message_id, client_message_id,
					from_me, direction, content, message_type, remote_jid,
					status, capture_state, metadata
				) values (
					$1::uuid, $2::uuid, $3::uuid, $4::uuid,
					$5::uuid, $6, $6, true, 'outbound', 'Teste',
					'text', $7, 'pending', 'captured', '{}'::jsonb
				) returning id::text
			`, fixture.organizationID, fixture.conversationID,
				fixture.sessionID, fixture.leadID, fixture.userID,
				clientID, fixture.remoteJID).Scan(&messageID); err != nil {
				t.Fatal(err)
			}
			if err := postgres.Pool().QueryRow(ctx, `
				insert into public.whatsapp_outbox (
					organization_id, session_id, conversation_id,
					message_id, client_message_id, recipient_jid,
					message_type, payload, status, attempts,
					max_attempts, locked_by, locked_at
				) values (
					$1::uuid, $2::uuid, $3::uuid,
					$4::uuid, $5, $6,
					'text', jsonb_build_object(
						'action', 'send.text',
						'body', jsonb_build_object('text', 'Teste')
					), 'processing', 1, 3, $7, now()
				) returning id::text
			`, fixture.organizationID, fixture.sessionID,
				fixture.conversationID, messageID, clientID,
				fixture.remoteJID, leaseToken).Scan(&outboxID); err != nil {
				t.Fatal(err)
			}
			if err := repo.failWhatsAppOutbox(ctx, pendingWhatsAppOutbox{
				ID: outboxID, OrganizationID: fixture.organizationID,
				MessageRowID: messageID, LeaseToken: leaseToken,
				Attempts: 1, MaxAttempts: 3,
			}, scenario.cause, scenario.permanent, scenario.unknown); err != nil {
				t.Fatal(err)
			}
			var outboxStatus, lastError, messageStatus, deliveryCode string
			var failedAt *time.Time
			if err := postgres.Pool().QueryRow(ctx, `
				select outbox.status, outbox.last_error,
				       message.status,
				       message.metadata->>'delivery_error_code',
				       (message.metadata->>'delivery_failed_at')::timestamptz
				from public.whatsapp_outbox as outbox
				join public.whatsapp_messages as message on message.id = outbox.message_id
				where outbox.id = $1::uuid
			`, outboxID).Scan(&outboxStatus, &lastError,
				&messageStatus, &deliveryCode, &failedAt); err != nil {
				t.Fatal(err)
			}
			if outboxStatus != scenario.wantStatus || messageStatus != "failed" ||
				deliveryCode != scenario.wantCode || failedAt == nil ||
				strings.Contains(lastError, "5511999999999") {
				t.Fatalf("unsafe or incorrect failure projection: outbox=%q message=%q code=%q time=%v lastError=%q",
					outboxStatus, messageStatus, deliveryCode, failedAt, lastError)
			}
			// Outbox cleanup must not erase the safe reason shown in CRM history.
			cleanupSimulation, err := postgres.Pool().Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer cleanupSimulation.Rollback(ctx)
			if _, err := cleanupSimulation.Exec(ctx, `
				delete from public.whatsapp_outbox where id = $1::uuid
			`, outboxID); err != nil {
				t.Fatal(err)
			}
			message, err := scanMessage(cleanupSimulation.QueryRow(ctx, `
				select `+messageSelectFields()+`
				from public.whatsapp_messages as wm
				where wm.id = $1::uuid
			`, messageID))
			if err != nil {
				t.Fatal(err)
			}
			if message.DeliveryErrorCode == nil || *message.DeliveryErrorCode != scenario.wantCode ||
				message.DeliveryFailedAt == nil {
				t.Fatalf("CRM history lost safe failure after outbox cleanup: %#v/%v",
					message.DeliveryErrorCode, message.DeliveryFailedAt)
			}
		})
	}
}
