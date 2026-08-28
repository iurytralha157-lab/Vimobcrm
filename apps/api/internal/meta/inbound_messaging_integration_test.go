package meta

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// META_MESSAGING_TEST_DATABASE_URL must point to a disposable loopback
// PostgreSQL/Supabase database containing the canonical Meta tables.
func TestInboundMessagingPersistsMessengerAndInstagramIdempotently(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("META_MESSAGING_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set META_MESSAGING_TEST_DATABASE_URL to run the inbound messaging PostgreSQL contract test")
	}
	parsed, err := url.Parse(databaseURL)
	if err != nil || !isMessagingLoopbackHost(parsed.Hostname()) {
		t.Fatalf("META_MESSAGING_TEST_DATABASE_URL must use a loopback host")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	pageID := "messaging-page-" + suffix
	instagramID := "messaging-ig-" + suffix
	var organizationID, foreignOrganizationID string
	if err := database.Pool().QueryRow(ctx, `
		insert into public.organizations (name, slug, subscription_status)
		values ($1, $2, 'active')
		returning id::text
	`, "Messaging test "+suffix, "messaging-test-"+suffix).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	if err := database.Pool().QueryRow(ctx, `
		insert into public.organizations (name, slug, subscription_status)
		values ($1, $2, 'active')
		returning id::text
	`, "Messaging foreign "+suffix, "messaging-foreign-"+suffix).Scan(&foreignOrganizationID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_, _ = database.Pool().Exec(cleanupCtx, `
			delete from public.organizations
			where id in ($1::uuid, $2::uuid)
		`, organizationID, foreignOrganizationID)
	})

	if _, err := database.Pool().Exec(ctx, `
		insert into public.meta_integrations (
			organization_id, page_id, page_name, access_token,
			instagram_business_account_id, is_connected
		)
		values ($1::uuid, $2, 'Messaging test page', $3, $4, true)
	`, organizationID, pageID, "messaging-test-token-"+suffix, instagramID); err != nil {
		t.Fatal(err)
	}

	repository := NewRepository(database, Config{})
	messengerPayload := map[string]any{
		"object":          "page",
		"organization_id": foreignOrganizationID, // Must never influence routing.
		"entry": []any{map[string]any{
			"id":              pageID,
			"organization_id": foreignOrganizationID,
			"messaging": []any{map[string]any{
				"sender":    map[string]any{"id": "messenger-contact-" + suffix},
				"recipient": map[string]any{"id": pageID},
				"timestamp": float64(1_785_000_000_123),
				"message":   map[string]any{"mid": "mid.messenger." + suffix, "text": "Olá pelo Messenger"},
			}},
		}},
	}

	first, err := repository.ProcessWebhookPayload(ctx, "", messengerPayload)
	if err != nil || len(first.MessagingResults) != 1 || first.MessagingResults[0].Status != "processed" {
		t.Fatalf("first Messenger result = %#v, error = %v", first, err)
	}
	second, err := repository.ProcessWebhookPayload(ctx, "", messengerPayload)
	if err != nil || len(second.MessagingResults) != 1 || second.MessagingResults[0].Status != "duplicate" {
		t.Fatalf("replayed Messenger result = %#v, error = %v", second, err)
	}

	conversationID := first.MessagingResults[0].ConversationID
	var (
		storedOrganization string
		storedPlatform     string
		storedPageID       string
		unreadCount        int
		messageCount       int
	)
	if err := database.Pool().QueryRow(ctx, `
		select
			conversation.organization_id::text,
			conversation.platform,
			conversation.page_id,
			conversation.unread_count,
			count(message.id)::int
		from public.meta_conversations conversation
		left join public.meta_messages message on message.conversation_id = conversation.id
		where conversation.id = $1::uuid
		group by conversation.id
	`, conversationID).Scan(&storedOrganization, &storedPlatform, &storedPageID, &unreadCount, &messageCount); err != nil {
		t.Fatal(err)
	}
	if storedOrganization != organizationID || storedPlatform != "messenger" || storedPageID != pageID || unreadCount != 1 || messageCount != 1 {
		t.Fatalf(
			"stored Messenger state = org %q platform %q page %q unread %d messages %d",
			storedOrganization, storedPlatform, storedPageID, unreadCount, messageCount,
		)
	}

	instagramPayload := map[string]any{
		"object": "instagram",
		"entry": []any{map[string]any{
			"id": instagramID,
			"messaging": []any{map[string]any{
				"sender":    map[string]any{"id": "instagram-contact-" + suffix},
				"recipient": map[string]any{"id": instagramID},
				"timestamp": float64(1_785_000_000_456),
				"message": map[string]any{
					"mid": "mid.instagram." + suffix,
					"attachments": []any{map[string]any{
						"type": "image",
						"payload": map[string]any{
							"url":       "https://lookaside.fbsbx.com/media/test.jpg?access_token=must-not-persist",
							"mime_type": "image/jpeg",
						},
					}},
				},
			}},
		}},
	}
	instagramResponse, err := repository.ProcessWebhookPayload(ctx, "", instagramPayload)
	if err != nil || len(instagramResponse.MessagingResults) != 1 || instagramResponse.MessagingResults[0].Status != "processed" {
		t.Fatalf("Instagram result = %#v, error = %v", instagramResponse, err)
	}
	var instagramPlatform, instagramPageID, mediaURL string
	if err := database.Pool().QueryRow(ctx, `
		select conversation.platform, conversation.page_id, coalesce(message.media_url, '')
		from public.meta_conversations conversation
		join public.meta_messages message on message.conversation_id = conversation.id
		where conversation.id = $1::uuid
	`, instagramResponse.MessagingResults[0].ConversationID).Scan(&instagramPlatform, &instagramPageID, &mediaURL); err != nil {
		t.Fatal(err)
	}
	if instagramPlatform != "instagram" || instagramPageID != pageID ||
		strings.Contains(mediaURL, "access_token") || strings.Contains(mediaURL, "must-not-persist") {
		t.Fatalf("stored Instagram state = platform %q page %q media %q", instagramPlatform, instagramPageID, mediaURL)
	}

	// A destination connected by two tenants cannot be guessed. No message or
	// conversation may be created for this payload.
	if _, err := database.Pool().Exec(ctx, `
		insert into public.meta_integrations (organization_id, page_id, page_name, access_token, is_connected)
		values ($1::uuid, $2, 'Ambiguous page', $3, true)
	`, foreignOrganizationID, pageID, "messaging-foreign-token-"+suffix); err != nil {
		t.Fatal(err)
	}
	ambiguousSender := "ambiguous-contact-" + suffix
	ambiguousPayload := map[string]any{
		"object": "page",
		"entry": []any{map[string]any{
			"id": pageID,
			"messaging": []any{map[string]any{
				"sender":    map[string]any{"id": ambiguousSender},
				"recipient": map[string]any{"id": pageID},
				"message":   map[string]any{"mid": "mid.ambiguous." + suffix, "text": "should not route"},
			}},
		}},
	}
	ambiguousResponse, err := repository.ProcessWebhookPayload(ctx, "", ambiguousPayload)
	if err != nil || len(ambiguousResponse.MessagingResults) != 1 || ambiguousResponse.MessagingResults[0].Status != "failed" ||
		!strings.Contains(ambiguousResponse.MessagingResults[0].Error, ErrAmbiguousMessagingIntegration.Error()) {
		t.Fatalf("ambiguous result = %#v, error = %v", ambiguousResponse, err)
	}
	var ambiguousCount int
	if err := database.Pool().QueryRow(ctx, `
		select count(*)::int from public.meta_conversations where external_id = $1
	`, ambiguousSender).Scan(&ambiguousCount); err != nil || ambiguousCount != 0 {
		t.Fatalf("ambiguous conversation count = %d, error = %v", ambiguousCount, err)
	}
}

func isMessagingLoopbackHost(host string) bool {
	host = strings.TrimSpace(strings.Trim(host, "[]"))
	if strings.EqualFold(host, "localhost") {
		return true
	}
	parsed := net.ParseIP(host)
	return parsed != nil && parsed.IsLoopback()
}
