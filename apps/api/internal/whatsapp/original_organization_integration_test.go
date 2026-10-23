package whatsapp

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestLocalWhatsAppOperationsRequireOriginalOrganization(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		http.Error(w, "synthetic unsupported endpoint", 404)
	}))
	t.Cleanup(provider.Close)
	repo := NewRepository(db, nil, StorageConfig{EvolutionGo: EvolutionGoConfig{APIURL: provider.URL, APIKey: "synthetic-provider-key"}})
	a := outboundHardeningFixture(t, ctx, db, repo, "original-org-a")
	b := outboundHardeningFixture(t, ctx, db, repo, "original-org-b")
	target := insertHardeningTarget(t, ctx, db.Pool(), b, "-target", "received", false)
	retryTarget := insertHardeningTarget(t, ctx, db.Pool(), b, "-retry-target", "received", false)
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_messages set message_type='image',media_mime_type='image/png' where id=$1::uuid`, retryTarget); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool().Exec(ctx, `insert into public.organization_members(organization_id,user_id,role,is_active)
		values($1::uuid,$2::uuid,'admin',true); update public.whatsapp_sessions set owner_user_id=$2::uuid where id=$3::uuid;
		update public.leads set assigned_user_id=$2::uuid where id=$4::uuid`, b.organizationID, a.userID, b.sessionID, b.leadID); err != nil {
		t.Fatal(err)
	}
	secondary := a.tenant
	secondary.OrganizationID = b.organizationID
	if page, err := repo.ListMessages(ctx, secondary, b.conversationID, MessageFilter{Limit: 20, OrderingVersion: 2, ExpectedLeadID: b.leadID}); err != nil || len(page.Messages) != 2 {
		t.Fatalf("authorized history was incorrectly revoked: %+v %v", page, err)
	} else {
		for _, message := range page.Messages {
			if message.CanQuote || message.CanReact {
				t.Fatal("secondary-organization history granted operations")
			}
		}
	}
	checks := []struct {
		name string
		call func() error
	}{
		{"create", func() error { return repo.ensureCanCreateSession(ctx, secondary) }},
		{"start", func() error {
			_, err := repo.StartConversation(ctx, secondary, StartConversationRequest{Phone: b.phone, LeadID: b.leadID, SessionID: b.sessionID, ExpectedPreviousLeadID: b.leadID})
			return err
		}},
		{"join", func() error {
			_, err := repo.JoinConversationAttendance(ctx, secondary, b.conversationID, attendanceInput{ExpectedLeadID: b.leadID, SendSessionID: b.sessionID})
			return err
		}},
		{"send", func() error {
			_, err := repo.SendMessage(ctx, secondary, b.conversationID, sendMessageInput{Text: "Synthetic denied intent", ClientMessageID: b.suffix + "-denied", ExpectedLeadID: b.leadID})
			return err
		}},
		{"reaction", func() error {
			_, err := repo.ReactToMessage(ctx, secondary, b.conversationID, target, reactToMessageInput{Emoji: "👍", ClientReactionID: b.suffix + "-denied-reaction", ExpectedLeadID: b.leadID})
			return err
		}},
		{"retry_media", func() error {
			_, err := repo.RetryMediaDownload(ctx, secondary, retryTarget)
			return err
		}},
		{"grant", func() error {
			return repo.GrantSessionAccess(ctx, secondary, b.sessionID, grantAccessInput{UserID: b.userID, CanView: true, CanSend: true})
		}},
		{"qr", func() error { _, err := repo.GetQRCode(ctx, secondary, b.sessionID); return err }},
	}
	for _, check := range checks {
		t.Run(check.name, func(t *testing.T) {
			if err := check.call(); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
				t.Fatalf("secondary-organization operation did not return access denied: %v", err)
			}
		})
	}
	if calls.Load() != 0 {
		t.Fatalf("secondary-organization provider calls=%d, want0", calls.Load())
	}
	var mediaJobs int
	if err := db.Pool().QueryRow(ctx, `select count(*) from public.media_jobs where organization_id=$1::uuid`, b.organizationID).Scan(&mediaJobs); err != nil || mediaJobs != 0 {
		t.Fatalf("secondary retry queued media jobs=%d: %v", mediaJobs, err)
	}
	// Returning to the original organization preserves ordinary operation.
	if err := repo.ensureCanCreateSession(ctx, a.tenant); err != nil {
		t.Fatalf("original organization denied: %v", err)
	}
}
