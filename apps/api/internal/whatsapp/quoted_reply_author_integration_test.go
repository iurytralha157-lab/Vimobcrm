package whatsapp

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

// Requires the existing disposable loopback database guard. Merely compiling
// this fixture is not evidence that the SQL reconciliation was executed.
func TestLocalQuotedReplyEchoRetainsCanonicalCRMAuthor(t *testing.T) {
	for _, crmAuthor := range []bool{true, false} {
		name := "pending without CRM author"
		if crmAuthor {
			name = "pending with CRM author"
		}
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			db := openLocalOutboundDatabase(t, ctx)
			repo := NewRepository(db, nil, StorageConfig{})
			fixture := outboundHardeningFixture(t, ctx, db, repo, "reply-echo-author")
			clientID := fixture.suffix + "-intent"
			queued := queueHardeningMessage(t, ctx, repo, fixture, sendMessageInput{Text: "Synthetic reply", ClientMessageID: clientID})
			item := leaseLocalOutbound(t, ctx, db.Pool(), fixture.organizationID, clientID)
			var actor any
			if crmAuthor {
				actor = fixture.tenant.UserID
			}
			// Legacy pending and provider echo have separate row IDs. The durable
			// provider ID is still pinned by the outbox's immutable intent.
			if _, err := db.Pool().Exec(ctx, `update public.whatsapp_messages set message_id=$2, sender_user_id=$3::uuid, sender_name='Pending CRM label' where id=$1::uuid`, queued.Message.ID, clientID, actor); err != nil {
				t.Fatal(err)
			}
			canonical := insertHardeningTarget(t, ctx, db.Pool(), fixture, "-echo", "sent", true)
			if _, err := db.Pool().Exec(ctx, `update public.whatsapp_messages set message_id=$2,provider_message_id=$2,sender_user_id=null,sender_name='WhatsApp device label' where id=$1::uuid`, canonical, item.ProviderMessageID); err != nil {
				t.Fatal(err)
			}
			tx, err := db.Pool().Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(ctx)
			if err := reconcileNativeOutboundOutbox(ctx, tx, nativeEvolutionSession{ID: fixture.sessionID, OrganizationID: fixture.organizationID}, nativeEvolutionMessage{ProviderMessageID: item.ProviderMessageID, FromMe: true, SentAt: time.Now().UTC()}, canonical); err != nil {
				t.Fatal(err)
			}
			if err := tx.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			var actualActor pgtype.Text
			var actualName string
			if err := db.Pool().QueryRow(ctx, `select sender_user_id::text,sender_name from public.whatsapp_messages where id=$1::uuid`, canonical).Scan(&actualActor, &actualName); err != nil {
				t.Fatal(err)
			}
			if crmAuthor {
				if !actualActor.Valid || actualActor.String != fixture.tenant.UserID || actualName != "Pending CRM label" {
					t.Fatalf("echo lost canonical CRM author: actor=%+v name=%q", actualActor, actualName)
				}
			} else if actualActor.Valid || actualName != "WhatsApp device label" {
				t.Fatalf("authorless pending label invented CRM authorship: actor=%+v name=%q", actualActor, actualName)
			}
		})
	}
}
