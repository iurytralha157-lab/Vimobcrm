package whatsapp

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// This test writes only to an explicitly supplied isolated test database.
func TestAttendanceMarkerWaitsForAcceptedHumanOutbound(t *testing.T) {
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
	fixture := createSessionConversationLockFixture(t, ctx, postgres.Pool(), "attendance-marker")
	t.Cleanup(func() {
		cleanupSessionConversationLockFixture(t, postgres.Pool(), fixture)
	})
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		for _, statement := range []string{
			`delete from public.whatsapp_attendance_marker_confirmations where organization_id = $1::uuid`,
			`delete from public.lead_timeline_events where organization_id = $1::uuid`,
			`delete from public.whatsapp_outbox where organization_id = $1::uuid`,
			`delete from public.whatsapp_messages where organization_id = $1::uuid`,
			`delete from public.whatsapp_attendance_entries where organization_id = $1::uuid`,
		} {
			_, _ = postgres.Pool().Exec(cleanupCtx, statement, fixture.organizationID)
		}
	})

	repo := Repository{db: postgres}
	input := attendanceInput{ExpectedLeadID: fixture.leadID, SendSessionID: fixture.sessionID}
	joined, err := repo.JoinConversationAttendance(ctx, fixture.tenant, fixture.conversationID, input)
	if err != nil {
		t.Fatal(err)
	}
	if !joined.Joined || joined.CurrentEntry == nil || joined.CurrentEntry.MarkerAt != nil || len(joined.Entries) != 0 {
		t.Fatalf("capture entry must be authorized but not yet visible: %+v", joined)
	}

	insertOutbound := func(origin, action, messageType, status string) string {
		t.Helper()
		clientID := fmt.Sprintf("marker-%s-%d", origin, time.Now().UnixNano())
		var messageID string
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.whatsapp_messages (
				organization_id, conversation_id, session_id, lead_id,
				sender_user_id, message_id, client_message_id,
				from_me, direction, content, message_type, remote_jid,
				status, capture_state, metadata
			) values (
				$1::uuid, $2::uuid, $3::uuid, $4::uuid,
				$5::uuid, $6, $6, true, 'outbound', 'Teste',
				$7, $8, $9, 'captured',
				jsonb_build_object(
				  'attendance_entry_id', $10::uuid,
				  'attendance_send_origin', $11
				)
			) returning id::text
		`, fixture.organizationID, fixture.conversationID,
			fixture.sessionID, fixture.leadID, fixture.userID,
			clientID, messageType, fixture.remoteJID, status,
			joined.CurrentEntry.ID, origin).Scan(&messageID); err != nil {
			t.Fatal(err)
		}
		if _, err := postgres.Pool().Exec(ctx, `
			insert into public.whatsapp_outbox (
				organization_id, session_id, conversation_id,
				message_id, client_message_id, recipient_jid,
				message_type, payload, status, sent_at
			) values (
				$1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6,
				$7, jsonb_build_object(
				  'action', $8, 'attendance_send_origin', $9,
				  'body', jsonb_build_object('text', 'Teste')
				), $10, case when $10 = 'sent' then now() else null end
			)
		`, fixture.organizationID, fixture.sessionID, fixture.conversationID,
			messageID, clientID, fixture.remoteJID, messageType, action,
			origin, status); err != nil {
			t.Fatal(err)
		}
		return messageID
	}

	confirm := func(messageID string) {
		t.Helper()
		tx, err := postgres.Pool().Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(ctx)
		if err := confirmHumanWhatsAppAttendance(ctx, tx, fixture.organizationID, messageID); err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
	}
	countMarkers := func() (int, int) {
		t.Helper()
		var proofs, timeline int
		if err := postgres.Pool().QueryRow(ctx, `
			select
			  (select count(*)::integer from public.whatsapp_attendance_marker_confirmations
			   where organization_id = $1::uuid),
			  (select count(*)::integer from public.lead_timeline_events
			   where organization_id = $1::uuid
			     and event_type = 'whatsapp_attendance_joined')
		`, fixture.organizationID).Scan(&proofs, &timeline); err != nil {
			t.Fatal(err)
		}
		return proofs, timeline
	}

	queued := insertOutbound("human", "send.text", "text", "pending")
	confirm(queued)
	automation := insertOutbound("automation", "send.text", "text", "sent")
	confirm(automation)
	reaction := insertOutbound("human", "message.react", "reaction", "sent")
	confirm(reaction)
	if proofs, timeline := countMarkers(); proofs != 0 || timeline != 0 {
		t.Fatalf("queued, automation and reaction must not create marker: %d proofs, %d events", proofs, timeline)
	}

	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_messages
		set status = 'sent'
		where id = $1::uuid
	`, queued); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_outbox
		set status = 'sent', sent_at = now()
		where message_id = $1::uuid
	`, queued); err != nil {
		t.Fatal(err)
	}
	confirm(queued)
	confirm(queued)
	if proofs, timeline := countMarkers(); proofs != 1 || timeline != 1 {
		t.Fatalf("accepted human outbound must create exactly one marker: %d proofs, %d events", proofs, timeline)
	}
	visible, err := repo.GetConversationAttendance(ctx, fixture.tenant, fixture.conversationID, input)
	if err != nil {
		t.Fatal(err)
	}
	// The already accepted automation message above is prior conversation
	// history, so this human entry is correctly labelled as joined.
	if len(visible.Entries) != 1 || visible.Entries[0].MarkerAt == nil ||
		visible.Entries[0].MarkerKind == nil || *visible.Entries[0].MarkerKind != "joined" {
		t.Fatalf("visible attendance marker missing: %+v", visible.Entries)
	}

	// A second accepted human send by the same attendance entry is idempotent.
	second := insertOutbound("human", "send.text", "text", "sent")
	confirm(second)
	if proofs, timeline := countMarkers(); proofs != 1 || timeline != 1 {
		t.Fatalf("subsequent human outbound duplicated marker: %d proofs, %d events", proofs, timeline)
	}

	// The database boundary ignores the old code path that inserts a marker at
	// join time without a matching accepted-message confirmation.
	var oldMarkerID *string
	err = postgres.Pool().QueryRow(ctx, `
		insert into public.lead_timeline_events (
			organization_id, lead_id, user_id, actor_user_id,
			event_type, title, metadata, event_at
		) values (
			$1::uuid, $2::uuid, $3::uuid, $3::uuid,
			'whatsapp_attendance_joined', 'Prematuro',
			jsonb_build_object('attendance_entry_id', gen_random_uuid()),
			now()
		) returning id::text
	`, fixture.organizationID, fixture.leadID, fixture.userID).Scan(&oldMarkerID)
	if err != nil && err != pgx.ErrNoRows {
		t.Fatal(err)
	}
	if oldMarkerID != nil {
		t.Fatal("unconfirmed legacy marker was inserted")
	}
}
