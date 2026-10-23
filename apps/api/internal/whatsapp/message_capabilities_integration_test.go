package whatsapp

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestLocalWhatsAppTargetEligibilityRejectsUncapturedAndDeleted(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	for _, s := range []struct {
		name, capture, kind, provider, status string
		fromMe, expired, want                 bool
	}{
		{"inbound", "captured", "image", "synthetic", "received", false, false, true},
		{"confirmed", "captured", "audio", "synthetic", "sent", true, false, true},
		{"observed", "observed_unattended", "image", "synthetic", "received", false, false, false},
		{"unlinked", "unlinked_ephemeral", "image", "synthetic", "received", false, false, false},
		{"suppressed", "suppressed", "image", "synthetic", "received", false, false, false},
		{"expired", "captured", "image", "synthetic", "received", false, true, false},
		{"reaction", "captured", "reaction", "synthetic", "received", false, false, false},
		{"deleted", "captured", "deleted", "synthetic", "received", false, false, false},
		{"system", "captured", "system", "synthetic", "received", false, false, false},
		{"unsafe provider reference", "captured", "image", "synthetic\ncontrol", "received", false, false, false},
		{"unconfirmed", "captured", "image", "synthetic", "queued", true, false, false},
	} {
		t.Run(s.name, func(t *testing.T) {
			var eligible bool
			if err := db.Pool().QueryRow(ctx, `select `+messageTargetEligibleSQL("target")+`
		 from (select $1::text capture_state,case when $2::bool then now() else null::timestamptz end unlinked_retention_scrubbed_at,
		 $3::text message_type,$4::text provider_message_id,$4::text message_id,$5::bool from_me,$6::text status) target`, s.capture, s.expired, s.kind, s.provider, s.fromMe, s.status).Scan(&eligible); err != nil || eligible != s.want {
				t.Fatalf("target eligibility=%t want%t: %v", eligible, s.want, err)
			}
		})
	}
}

func TestLocalSharedMessageCapabilitiesTrackGrantAndAssignment(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	repo := NewRepository(db, nil, StorageConfig{})
	f := createLocalSharedOutboundFixture(t, ctx, db.Pool(), "shared-capabilities")
	f.tenant.Permissions = append(f.tenant.Permissions, "lead_operate")
	insertHardeningTarget(t, ctx, db.Pool(), f, "-received", "received", false)
	assert := func(want bool) {
		t.Helper()
		page, err := repo.ListMessages(ctx, f.tenant, f.conversationID, MessageFilter{Limit: 20, OrderingVersion: 2, ExpectedLeadID: f.leadID})
		if err != nil || len(page.Messages) != 1 || page.Messages[0].CanQuote != want || page.Messages[0].CanReact != want {
			t.Fatalf("shared capability want%t: %+v %v", want, page, err)
		}
	}
	assert(true)
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_session_access set can_send=false where organization_id=$1::uuid and user_id=$2::uuid`, f.organizationID, f.tenant.UserID); err != nil {
		t.Fatal(err)
	}
	assert(false)
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_session_access set can_send=true where organization_id=$1::uuid and user_id=$2::uuid;
	 update public.leads set assigned_user_id=$3::uuid where id=$4::uuid`, f.organizationID, f.tenant.UserID, f.userID, f.leadID); err != nil {
		t.Fatal(err)
	}
	// Broad historical permission does not borrow another assignee's shared send.
	f.tenant.Permissions = append(f.tenant.Permissions, "lead_view_all")
	assert(false)
}

func TestLocalWhatsAppMessageTargetCapabilities(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	repo := NewRepository(db, nil, StorageConfig{})
	f := outboundHardeningFixture(t, ctx, db, repo, "message-capabilities")
	statuses := []string{"queued", "sending", "pending", "submitted", "failed", "sent", "delivered", "read", "played"}
	ids := map[string]string{}
	for _, status := range statuses {
		ids[status] = insertHardeningTarget(t, ctx, db.Pool(), f, "-"+status, status, true)
	}
	ids["received"] = insertHardeningTarget(t, ctx, db.Pool(), f, "-received", "received", false)
	// Eligible target actions can offer the explicit join prompt. The send/react
	// write paths still require attendance after that gesture.
	if _, err := db.Pool().Exec(ctx, `delete from public.whatsapp_attendance_marker_confirmations where organization_id=$1::uuid;
	 delete from public.whatsapp_attendance_entries where organization_id=$1::uuid`, f.organizationID); err != nil {
		t.Fatal(err)
	}
	page, err := repo.ListMessages(ctx, f.tenant, f.conversationID, MessageFilter{Limit: 30, OrderingVersion: 2, ExpectedLeadID: f.leadID})
	if err != nil || len(page.Messages) != len(ids) {
		t.Fatalf("canonical capability list: %d %v", len(page.Messages), err)
	}
	for _, message := range page.Messages {
		want := !message.FromMe || confirmedWhatsAppOutboundStatus(message.Status)
		if message.CanQuote != want || message.CanReact != want {
			t.Errorf("target %s capabilities quote=%t react=%t want%t", message.Status, message.CanQuote, message.CanReact, want)
		}
		body, err := json.Marshal(message)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(body), `"can_quote":`) || !strings.Contains(string(body), `"can_react":`) {
			t.Fatalf("explicit capabilities missing: %s", body)
		}
	}
	history, err := repo.listLeadHistoryMessages(ctx, f.tenant, f.leadID, "", MessageFilter{Limit: 30, OrderingVersion: 2})
	if err != nil || len(history.Messages) != len(ids) {
		t.Fatalf("history: %d %v", len(history.Messages), err)
	}
	for _, message := range history.Messages {
		if message.CanQuote || message.CanReact {
			t.Fatalf("readonly lead history grants operations: %+v", message)
		}
	}
	if _, err := db.Pool().Exec(ctx, `update public.leads set phone='5511444433333' where id=$1::uuid`, f.leadID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.StartConversation(ctx, f.tenant, phoneConfirmationRequest(f, "5511444433333")); err != nil {
		t.Fatal(err)
	}
	history, err = repo.listLeadHistoryMessages(ctx, f.tenant, f.leadID, "", MessageFilter{Limit: 30, OrderingVersion: 2})
	if err != nil || len(history.Messages) != len(ids) {
		t.Fatalf("retired physical history disappeared: %d %v", len(history.Messages), err)
	}
	for _, message := range history.Messages {
		if message.CanQuote || message.CanReact {
			t.Fatal("retired target is operational")
		}
	}
}
