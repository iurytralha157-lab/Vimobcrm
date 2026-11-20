package whatsapp

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestLocalWhatsAppHandoffMarkerFollowsEachAcceptedTransfer(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	pool := db.Pool()
	repo := NewRepository(db, nil, StorageConfig{})
	f := createLocalSharedOutboundFixture(t, ctx, pool, "handoff-marker")
	owner := tenant.Context{OrganizationID: f.organizationID, UserID: f.userID, UserRole: "admin", MemberRole: "admin"}
	attendance := attendanceInput{ExpectedLeadID: f.leadID, SendSessionID: f.sessionID}

	transfer := func(userID string) {
		t.Helper()
		if _, err := pool.Exec(ctx, `update public.leads set assigned_user_id=$3::uuid
			where organization_id=$1::uuid and id=$2::uuid`, f.organizationID, f.leadID, userID); err != nil {
			t.Fatal(err)
		}
	}
	entries := func(actor tenant.Context, count int) []AttendanceEntry {
		t.Helper()
		result, err := repo.GetConversationAttendance(ctx, actor, f.conversationID, attendance)
		if err != nil || len(result.Entries) != count {
			t.Fatalf("attendance markers = %+v, error = %v, want %d", result.Entries, err, count)
		}
		return result.Entries
	}
	queue := func(actor tenant.Context, suffix string) pendingWhatsAppOutbox {
		t.Helper()
		if _, err := repo.JoinConversationAttendance(ctx, actor, f.conversationID, attendance); err != nil {
			t.Fatal(err)
		}
		clientID := f.suffix + suffix
		if _, err := repo.SendMessage(ctx, actor, f.conversationID, sendMessageInput{
			ExpectedLeadID: f.leadID, SendSessionID: f.sessionID, ClientMessageID: clientID, Text: "Synthetic handoff reply",
		}); err != nil {
			t.Fatal(err)
		}
		item := leaseLocalOutbound(t, ctx, pool, f.organizationID, clientID)
		if pin, ok := normalizeUUID(stringFromAny(item.Payload["attendance_handoff_id"])); !ok || pin == "" {
			t.Fatal("missing durable handoff pin")
		}
		if _, exposed := mapFromAny(item.Payload["body"])["attendance_handoff_id"]; exposed {
			t.Fatal("handoff pin reached provider request body")
		}
		if _, err := repo.startWhatsAppOutboxProviderAttempt(ctx, item); err != nil {
			t.Fatal(err)
		}
		return item
	}
	accept := func(item pendingWhatsAppOutbox) {
		t.Helper()
		providerID := deterministicProviderMessageID(item.ClientMessageID)
		if _, err := repo.markWhatsAppOutboxProviderAccepted(ctx, item, providerID); err != nil {
			t.Fatal(err)
		}
		if err := repo.completeWhatsAppOutbox(ctx, item, providerID); err != nil {
			t.Fatal(err)
		}
	}

	entries(f.tenant, 0)
	first := queue(f.tenant, "-first")
	entries(f.tenant, 0)
	accept(first)
	firstMarker := entries(f.tenant, 1)[0]
	accept(queue(f.tenant, "-another"))
	entries(f.tenant, 1)

	transfer(owner.UserID)
	entries(owner, 1)
	t.Run("history follows current assignee", func(t *testing.T) {
		if _, err := repo.GetConversationSnapshot(ctx, f.tenant, f.conversationID); !errors.Is(err, ErrConversationNotFound) {
			t.Fatalf("former broker direct lookup = %v, want ErrConversationNotFound", err)
		}
		filter := MessageFilter{Limit: 20, ExpectedLeadID: f.leadID}
		if _, err := repo.ListMessages(ctx, f.tenant, f.conversationID, filter); !errors.Is(err, ErrConversationNotFound) {
			t.Fatalf("former broker message history = %v, want ErrConversationNotFound", err)
		}
		if page, err := repo.ListMessages(ctx, owner, f.conversationID, filter); err != nil || len(page.Messages) == 0 {
			t.Fatalf("new assignee lost prior outbound messages: %v", err)
		}
	})
	accept(queue(owner, "-owner"))
	entries(owner, 2)

	transfer(f.tenant.UserID)
	stale := queue(f.tenant, "-stale")
	transfer(owner.UserID)
	transfer(f.tenant.UserID)
	accept(stale)
	entries(f.tenant, 2)
	returning := queue(f.tenant, "-return")
	if returning.Payload["attendance_handoff_id"] == stale.Payload["attendance_handoff_id"] {
		t.Fatal("return to the same broker reused an earlier handoff pin")
	}
	transfer(f.tenant.UserID) // An update with the same assignee is not a handoff.
	accept(returning)
	markers := entries(f.tenant, 3)
	last := markers[len(markers)-1]
	if last.ID == firstMarker.ID || last.UserID != f.tenant.UserID || pointerValue(last.MarkerKind) != "joined" {
		t.Fatalf("returning broker did not get a distinct compatible marker: %+v", last)
	}
	var timelineCount int
	if err := pool.QueryRow(ctx, `select count(*)::int from public.lead_timeline_events
		where organization_id=$1::uuid and lead_id=$2::uuid and event_type='whatsapp_attendance_joined'`,
		f.organizationID, f.leadID).Scan(&timelineCount); err != nil || timelineCount != 0 {
		t.Fatalf("chat-only handoffs leaked into the CRM timeline: %d, %v", timelineCount, err)
	}
}
