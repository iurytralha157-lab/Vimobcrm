package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// TestConversationListFiltersSourceAndPeriodIntegration exercises the actual
// paginated inbox SQL in a disposable database. The synthetic fixture is
// committed so the repository pool can read it, then removed during cleanup.
func TestConversationListFiltersSourceAndPeriodIntegration(t *testing.T) {
	if os.Getenv("WHATSAPP_TEST_ISOLATED") != "1" {
		t.Skip("WHATSAPP_TEST_ISOLATED=1 is required for the disposable fixture")
	}
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}
	target, err := url.Parse(databaseURL)
	if err != nil || (target.Scheme != "postgres" && target.Scheme != "postgresql") {
		t.Fatal("WHATSAPP_TEST_DATABASE_URL must be a PostgreSQL URL")
	}
	switch strings.ToLower(target.Hostname()) {
	case "localhost", "127.0.0.1", "::1":
	default:
		t.Fatalf("WHATSAPP_TEST_DATABASE_URL must use a disposable loopback database, got %q", target.Hostname())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)

	fixtureName := fmt.Sprintf("wa-conversation-filters-%d", time.Now().UnixNano())
	tx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var organizationID, userID, sessionID string
	if err := tx.QueryRow(ctx, `
		insert into public.organizations (name, slug)
		values ($1, $1)
		returning id::text
	`, fixtureName).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `
		insert into auth.users (
			id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		) values (
			$1::uuid, 'authenticated', 'authenticated', $2, '', now(),
			'{}'::jsonb, '{}'::jsonb, now(), now()
		)
	`, userID, fixtureName+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `
		insert into public.users (id, organization_id, name, email, role, is_active)
		values ($1::uuid, $2::uuid, $3, $4, 'owner', true)
		on conflict (id) do update
		set organization_id = excluded.organization_id,
		    name = excluded.name,
		    email = excluded.email,
		    role = excluded.role,
		    is_active = true
	`, userID, organizationID, fixtureName, fixtureName+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `
		insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($1::uuid, $2::uuid, 'owner', true)
		on conflict (user_id, organization_id) do update
		set role = 'owner', is_active = true, deleted_at = null
	`, organizationID, userID); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `
		insert into public.whatsapp_sessions (
			organization_id, instance_name, owner_user_id, provider, status, is_active
		) values ($1::uuid, $2, $3::uuid, 'evolution_go', 'connected', true)
		returning id::text
	`, organizationID, fixtureName, userID).Scan(&sessionID); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC().Truncate(time.Second)
	from, to := now.Add(-48*time.Hour), now.Add(time.Hour)
	createConversation := func(index int, source string, lastMessageAt time.Time, unreadCount int) (string, string) {
		t.Helper()
		var leadID, conversationID string
		if err := tx.QueryRow(ctx, `
			insert into public.leads (organization_id, assigned_user_id, name, source)
			values ($1::uuid, $2::uuid, $3, $4)
			returning id::text
		`, organizationID, userID, fmt.Sprintf("%s-lead-%d", fixtureName, index), source).Scan(&leadID); err != nil {
			t.Fatal(err)
		}
		if err := tx.QueryRow(ctx, `
			insert into public.whatsapp_conversations (
				organization_id, session_id, lead_id, remote_jid,
				contact_name, last_message, last_message_at, unread_count
			) values (
				$1::uuid, $2::uuid, $3::uuid, $4, $5, 'test', $6, $7
			)
			returning id::text
		`, organizationID, sessionID, leadID,
			fmt.Sprintf("551199900%05d@s.whatsapp.net", index),
			fmt.Sprintf("%s-contact-%d", fixtureName, index),
			lastMessageAt, unreadCount).Scan(&conversationID); err != nil {
			t.Fatal(err)
		}
		return leadID, conversationID
	}

	// The manual conversation is newest: a client-side filter after LIMIT 1
	// would miss both matching Meta conversations.
	_, _ = createConversation(1, "manual", now, 4)
	metaNewestLeadID, metaNewestID := createConversation(2, "meta", now.Add(-time.Hour), 2)
	_, metaOlderID := createConversation(3, "meta", now.Add(-30*time.Hour), 3)
	_, _ = createConversation(4, "meta", now.Add(-72*time.Hour), 5)
	_, readUnansweredID := createConversation(5, "manual", now.Add(-96*time.Hour), 0)
	for _, item := range []struct {
		conversationID string
		messageID      string
		at             time.Time
		fromMe         bool
	}{
		{metaNewestID, "inbound-newest", now.Add(-time.Hour), false},
		{metaOlderID, "inbound-older", now.Add(-31 * time.Hour), false},
		{metaOlderID, "outbound-older", now.Add(-30 * time.Hour), true},
		{readUnansweredID, "inbound-read", now.Add(-96 * time.Hour), false},
	} {
		direction := "inbound"
		if item.fromMe {
			direction = "outbound"
		}
		if _, err := tx.Exec(ctx, `
			insert into public.whatsapp_messages (
				organization_id, session_id, conversation_id, message_id,
				content, from_me, direction, sent_at, capture_state
			) values ($1::uuid, $2::uuid, $3::uuid, $4, 'test', $5, $6, $7, 'recorded')
		`, organizationID, sessionID, item.conversationID, fixtureName+"-"+item.messageID,
			item.fromMe, direction, item.at); err != nil {
			t.Fatal(err)
		}
	}
	for _, item := range []struct{ page, campaign, name string }{
		{"page-a", "campaign-a", "Campaign A"},
		{"page-b", "campaign-b", "Campaign B"},
	} {
		if _, err := tx.Exec(ctx, `
			insert into public.lead_entry_events (
				organization_id, lead_id, entry_type, source, provider,
				page_id, page_name, campaign_id, campaign_name, is_countable
			) values ($1::uuid, $2::uuid, 'reentry', 'meta', 'meta', $3, $3, $4, $5, true)
		`, organizationID, metaNewestLeadID, item.page, item.campaign, item.name); err != nil {
			t.Fatal(err)
		}
	}
	// A second owner in the same organization has no session grant to viewer.
	// The viewer cannot see that number; an admin may read its lead, but not
	// the unlinked conversation or use the number to send.
	var otherUserID, otherSessionID, privateLeadID, privateConversationID, privateUnlinkedID string
	if err := tx.QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&otherUserID); err != nil {
		t.Fatal(err)
	}
	otherEmail := fixtureName + "-other@example.invalid"
	if _, err := tx.Exec(ctx, `
		insert into auth.users (
			id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		) values ($1::uuid, 'authenticated', 'authenticated', $2, '', now(),
			'{}'::jsonb, '{}'::jsonb, now(), now())
	`, otherUserID, otherEmail); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `
		insert into public.users (id, organization_id, name, email, role, is_active)
		values ($1::uuid, $2::uuid, $3, $4, 'owner', true)
		on conflict (id) do update
		set organization_id = excluded.organization_id,
		    name = excluded.name,
		    email = excluded.email,
		    role = excluded.role,
		    is_active = true
	`, otherUserID, organizationID, fixtureName+"-other", otherEmail); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `
		insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($1::uuid, $2::uuid, 'owner', true)
		on conflict (user_id, organization_id) do update
		set role = 'owner', is_active = true, deleted_at = null
	`, organizationID, otherUserID); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `
		insert into public.whatsapp_sessions (
			organization_id, instance_name, owner_user_id, provider, status, is_active
		) values ($1::uuid, $2, $3::uuid, 'evolution_go', 'connected', true)
		returning id::text
	`, organizationID, fixtureName+"-private", otherUserID).Scan(&otherSessionID); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `
		insert into public.leads (organization_id, assigned_user_id, name, source)
		values ($1::uuid, $2::uuid, $3, 'private-source') returning id::text
	`, organizationID, otherUserID, fixtureName+"-private-lead").Scan(&privateLeadID); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `
		insert into public.whatsapp_conversations (
			organization_id, session_id, lead_id, remote_jid,
			contact_name, last_message, last_message_at, unread_count
		) values ($1::uuid, $2::uuid, $3::uuid, $4, $5, 'private', $6, 11)
		returning id::text
	`, organizationID, otherSessionID, privateLeadID,
		"55119990000999@s.whatsapp.net", fixtureName+"-private-contact", now).Scan(&privateConversationID); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `
		insert into public.whatsapp_conversations (
			organization_id, session_id, remote_jid, contact_name,
			last_message, last_message_at
		) values ($1::uuid, $2::uuid, $3, $4, 'unlinked', $5)
		returning id::text
	`, organizationID, otherSessionID,
		"55119990000888@s.whatsapp.net", fixtureName+"-private-unlinked", now).Scan(&privateUnlinkedID); err != nil {
		t.Fatal(err)
	}
	var privateMediaMessageID string
	privateMediaPath := fmt.Sprintf("orgs/%s/sessions/%s/incoming/%s-private.jpg", organizationID, otherSessionID, fixtureName)
	if err := tx.QueryRow(ctx, `
		insert into public.whatsapp_messages (
			organization_id, session_id, conversation_id, lead_id, message_id,
			content, message_type, media_status, media_storage_path,
			from_me, direction, sent_at, capture_state, status
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
			'private media', 'image', 'ready', $6,
			false, 'inbound', $7, 'recorded', 'received'
		)
		returning id::text
	`, organizationID, otherSessionID, privateConversationID, privateLeadID,
		fixtureName+"-private-media", privateMediaPath, now).Scan(&privateMediaMessageID); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `
		insert into public.lead_entry_events (
			organization_id, lead_id, entry_type, source, provider,
			page_id, page_name, campaign_id, campaign_name, is_countable
		) values ($1::uuid, $2::uuid, 'initial', 'private-source', 'meta',
			'private-page', 'Private Page', 'private-campaign', 'Private Campaign', true)
	`, organizationID, privateLeadID); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		for _, cleanup := range []struct {
			label string
			query string
			arg   string
		}{
			{"messages", `delete from public.whatsapp_messages where organization_id = $1::uuid`, organizationID},
			{"conversations", `delete from public.whatsapp_conversations where organization_id = $1::uuid`, organizationID},
			{"entry events", `delete from public.lead_entry_events where organization_id = $1::uuid`, organizationID},
			{"leads", `delete from public.leads where organization_id = $1::uuid`, organizationID},
			{"sessions", `delete from public.whatsapp_sessions where organization_id = $1::uuid`, organizationID},
			{"membership", `delete from public.organization_members where organization_id = $1::uuid`, organizationID},
			{"other profile", `delete from public.users where id = $1::uuid`, otherUserID},
			{"profile", `delete from public.users where id = $1::uuid`, userID},
			{"other auth user", `delete from auth.users where id = $1::uuid`, otherUserID},
			{"auth user", `delete from auth.users where id = $1::uuid`, userID},
			{"organization", `delete from public.organizations where id = $1::uuid`, organizationID},
		} {
			if _, err := postgres.Pool().Exec(cleanupCtx, cleanup.query, cleanup.arg); err != nil {
				t.Errorf("remove isolated %s fixture: %v", cleanup.label, err)
			}
		}
	})

	values := url.Values{
		"leadSource":      {"meta"},
		"lastMessageFrom": {from.Format(time.RFC3339Nano)},
		"lastMessageTo":   {to.Format(time.RFC3339Nano)},
		"limit":           {"1"},
	}
	filter, err := ParseConversationListFilter(values)
	if err != nil {
		t.Fatal(err)
	}
	var signingRequests atomic.Int32
	storage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		signingRequests.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"signedURL":"/object/sign/whatsapp-media/authorized?token=test"}`))
	}))
	defer storage.Close()
	repo := NewRepository(postgres, nil, StorageConfig{ProjectURL: storage.URL, APIKey: "service-role-test-key"})
	viewer := tenant.Context{
		OrganizationID: organizationID,
		UserID:         userID,
		MemberRole:     "agent",
		Permissions:    []string{"lead_view_own"},
	}
	firstPage, cursor, err := repo.listConversationsPage(ctx, viewer, filter)
	if err != nil {
		t.Fatal(err)
	}
	if len(firstPage) != 1 || firstPage[0].ID != metaNewestID || cursor == nil {
		t.Fatalf("first filtered page = %#v, cursor = %v", firstPage, cursor)
	}
	if firstPage[0].Lead == nil || firstPage[0].Lead.Source == nil || *firstPage[0].Lead.Source != "meta" {
		t.Fatalf("lead source missing from filtered conversation: %#v", firstPage[0].Lead)
	}
	values.Set("cursor", *cursor)
	filter, err = ParseConversationListFilter(values)
	if err != nil {
		t.Fatal(err)
	}
	secondPage, nextCursor, err := repo.listConversationsPage(ctx, viewer, filter)
	if err != nil {
		t.Fatal(err)
	}
	if len(secondPage) != 1 || secondPage[0].ID != metaOlderID || nextCursor != nil {
		t.Fatalf("second filtered page = %#v, cursor = %v", secondPage, nextCursor)
	}
	unread, err := repo.CountUnreadMessages(ctx, viewer, filter)
	if err != nil {
		t.Fatal(err)
	}
	if unread != 5 {
		t.Fatalf("filtered unread count = %d, want 5", unread)
	}
	allVisible, err := repo.ListConversations(ctx, viewer, ConversationListFilter{Limit: 120})
	if err != nil {
		t.Fatal(err)
	}
	if len(allVisible) != 5 {
		t.Fatalf("visible conversations = %d, want 5 without private session", len(allVisible))
	}
	for _, conversation := range allVisible {
		if conversation.ID == privateConversationID {
			t.Fatal("conversation from another owner leaked into list")
		}
	}
	admin := viewer
	admin.MemberRole = "admin"
	admin.Permissions = []string{"lead_view_all"}
	adminLeads, err := repo.ListConversations(ctx, admin, ConversationListFilter{OnlyLeads: true, HideGroups: true, Limit: 120})
	if err != nil {
		t.Fatal(err)
	}
	if len(adminLeads) != 6 {
		t.Fatalf("admin operational inbox = %d, want all six visible leads across numbers", len(adminLeads))
	}
	adminFoundPrivateLead := false
	for _, conversation := range adminLeads {
		if conversation.ID == privateConversationID {
			adminFoundPrivateLead = true
		}
	}
	if !adminFoundPrivateLead {
		t.Fatal("admin inbox lost a visible lead on another number")
	}
	adminInbox, err := repo.ListConversations(ctx, admin, ConversationListFilter{Limit: 120})
	if err != nil {
		t.Fatal(err)
	}
	for _, conversation := range adminInbox {
		if conversation.ID == privateUnlinkedID {
			t.Fatal("admin inbox exposed another owner's unlinked conversation")
		}
	}
	if snapshot, err := repo.GetConversationSnapshot(ctx, admin, privateConversationID); err != nil || snapshot.ID != privateConversationID {
		t.Fatalf("admin lost direct lead history across numbers: %+v, %v", snapshot, err)
	}
	t.Run("media is signed for admin across sessions but denied to agent", func(t *testing.T) {
		before := signingRequests.Load()
		if _, err := repo.GetMessageMediaURL(ctx, viewer, privateMediaMessageID); !errors.Is(err, ErrMessageNotFound) {
			t.Fatalf("agent media access error = %v, want message not found", err)
		}
		if got := signingRequests.Load(); got != before {
			t.Fatalf("denied agent media reached Storage signing: before=%d after=%d", before, got)
		}
		media, err := repo.GetMessageMediaURL(ctx, admin, privateMediaMessageID)
		if err != nil {
			t.Fatalf("admin cross-session lead media: %v", err)
		}
		if media.MessageID != privateMediaMessageID || media.URL == "" || media.ExpiresIn <= 0 {
			t.Fatalf("admin cross-session lead media = %#v, want temporary signed URL", media)
		}
		if got := signingRequests.Load(); got != before+1 {
			t.Fatalf("admin media signing requests = %d, want %d", got, before+1)
		}
	})
	if allUnread, err := repo.CountUnreadMessages(ctx, viewer, ConversationListFilter{}); err != nil || allUnread != 14 {
		t.Fatalf("visible unread count = %d, error = %v; private unread must be excluded", allUnread, err)
	}
	privateSessionScope := ConversationListFilter{SessionIDs: []string{otherSessionID}, AccessibleProvided: true}
	if scoped, err := repo.ListConversations(ctx, viewer, privateSessionScope); err != nil || len(scoped) != 0 {
		t.Fatalf("ungranted session list = %#v, error = %v", scoped, err)
	}
	if count, err := repo.CountUnreadMessages(ctx, viewer, privateSessionScope); err != nil || count != 0 {
		t.Fatalf("ungranted session unread = %d, error = %v", count, err)
	}

	pending, err := repo.ListConversations(ctx, viewer, ConversationListFilter{PendingReply: true})
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	for _, conversation := range pending {
		found[conversation.ID] = true
	}
	if !found[metaNewestID] || !found[readUnansweredID] || found[metaOlderID] {
		t.Fatalf("pending reply must include read inbound and exclude later outbound: %#v", found)
	}
	pendingUnread, err := repo.CountUnreadMessages(ctx, viewer, ConversationListFilter{PendingReply: true})
	if err != nil || pendingUnread != 2 {
		t.Fatalf("unread count for unanswered conversations = %d, error = %v", pendingUnread, err)
	}

	// Page and campaign from separate arrivals on the same lead must not
	// combine into a false match.
	crossEntry, err := ParseConversationListFilter(url.Values{
		"pageId": {"page-a"}, "campaignIds": {"campaign-b"},
	})
	if err != nil {
		t.Fatal(err)
	}
	crossPage, err := repo.ListConversations(ctx, viewer, crossEntry)
	if err != nil {
		t.Fatal(err)
	}
	if len(crossPage) != 0 {
		t.Fatalf("cross-entry attribution matched: %#v", crossPage)
	}
	if count, err := repo.CountUnreadMessages(ctx, viewer, crossEntry); err != nil || count != 0 {
		t.Fatalf("cross-entry unread count = %d, error = %v", count, err)
	}
	sameEntry, err := ParseConversationListFilter(url.Values{
		"pageId": {"page-a"}, "campaignIds": {"campaign-a", "campaign-b"},
	})
	if err != nil {
		t.Fatal(err)
	}
	samePage, err := repo.ListConversations(ctx, viewer, sameEntry)
	if err != nil {
		t.Fatal(err)
	}
	if len(samePage) != 1 || samePage[0].ID != metaNewestID {
		t.Fatalf("same-entry attribution did not match: %#v", samePage)
	}
	options, err := repo.ListConversationFilterOptions(ctx, viewer, ConversationListFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(options.Campaigns) != 2 || len(options.Pages) != 2 {
		t.Fatalf("visible Meta filter options = %#v", options)
	}
	for _, item := range options.Campaigns {
		if item.ID == "private-campaign" {
			t.Fatal("campaign from another owner's session leaked into options")
		}
	}
	for _, item := range options.Pages {
		if item.ID == "private-page" {
			t.Fatal("page from another owner's session leaked into options")
		}
	}
	privateOptions, err := repo.ListConversationFilterOptions(ctx, viewer, privateSessionScope)
	if err != nil || len(privateOptions.Campaigns) != 0 || len(privateOptions.Pages) != 0 || len(privateOptions.Sources) != 0 {
		t.Fatalf("ungranted session options = %#v, error = %v", privateOptions, err)
	}
	pageOptions, err := repo.ListConversationFilterOptions(ctx, viewer, ConversationListFilter{PageID: "page-a"})
	if err != nil || len(pageOptions.Campaigns) != 1 || pageOptions.Campaigns[0].ID != "campaign-a" {
		t.Fatalf("campaign options for page-a = %#v, error = %v", pageOptions.Campaigns, err)
	}
	emptyOptions, err := repo.ListConversationFilterOptions(ctx, viewer, ConversationListFilter{AccessibleProvided: true})
	if err != nil || len(emptyOptions.Campaigns) != 0 || len(emptyOptions.Sources) != 0 {
		t.Fatalf("explicitly empty session scope leaked options: %#v, error = %v", emptyOptions, err)
	}
}
