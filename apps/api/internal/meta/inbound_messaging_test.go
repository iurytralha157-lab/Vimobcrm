package meta

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/realtime"
)

func TestExtractMessagingEventsMessengerText(t *testing.T) {
	payload := map[string]any{
		"object": "page",
		"entry": []any{map[string]any{
			"id":   "page-123",
			"time": float64(1_721_000_000),
			"messaging": []any{map[string]any{
				"sender":    map[string]any{"id": "psid-456", "name": "Maria"},
				"recipient": map[string]any{"id": "page-123"},
				"timestamp": float64(1_721_000_000_123),
				"message":   map[string]any{"mid": "mid.messenger-1", "text": "Olá"},
			}},
		}},
	}

	events := extractMessagingEvents(payload)
	if len(events) != 1 {
		t.Fatalf("events = %#v, want one", events)
	}
	event := events[0]
	if event.Platform != "messenger" || event.EntryID != "page-123" ||
		event.SenderID != "psid-456" || event.RecipientID != "page-123" ||
		event.ExternalMessageID != "mid.messenger-1" || event.Content != "Olá" ||
		event.MessageType != "text" {
		t.Fatalf("event = %#v", event)
	}
	if event.ContactName == nil || *event.ContactName != "Maria" {
		t.Fatalf("contact name = %#v", event.ContactName)
	}
	wantTime := time.UnixMilli(1_721_000_000_123).UTC()
	if !event.SentAt.Equal(wantTime) {
		t.Fatalf("sent at = %v, want %v", event.SentAt, wantTime)
	}
}

func TestExtractMessagingEventsInstagramMediaStripsProviderURLSecrets(t *testing.T) {
	payload := map[string]any{
		"object": "instagram",
		"entry": []any{map[string]any{
			"id": "ig-business-123",
			"messaging": []any{map[string]any{
				"sender":    map[string]any{"id": "igsid-456"},
				"recipient": map[string]any{"id": "ig-business-123"},
				"timestamp": "1721000000123",
				"message": map[string]any{
					"mid": "mid.instagram-1",
					"attachments": []any{map[string]any{
						"type": "image",
						"payload": map[string]any{
							"url":       "https://lookaside.fbsbx.com/media/photo.jpg?access_token=provider-secret&signature=abc#fragment",
							"mime_type": "image/jpeg; charset=binary",
						},
					}},
				},
			}},
		}},
	}

	events := extractMessagingEvents(payload)
	if len(events) != 1 {
		t.Fatalf("events = %#v, want one", events)
	}
	event := events[0]
	if event.Platform != "instagram" || event.MessageType != "image" || event.Content != "" {
		t.Fatalf("event = %#v", event)
	}
	if event.MediaURL == nil || *event.MediaURL != "https://lookaside.fbsbx.com/media/photo.jpg" {
		t.Fatalf("safe media URL = %#v", event.MediaURL)
	}
	if strings.Contains(*event.MediaURL, "provider-secret") || strings.Contains(*event.MediaURL, "?") {
		t.Fatalf("media URL leaked provider query: %q", *event.MediaURL)
	}
	if event.MediaMIMEType == nil || *event.MediaMIMEType != "image/jpeg" {
		t.Fatalf("MIME type = %#v", event.MediaMIMEType)
	}
}

func TestExtractMessagingEventsIgnoresNonInboundEvents(t *testing.T) {
	payload := map[string]any{
		"object": "page",
		"entry": []any{map[string]any{
			"id": "page-123",
			"messaging": []any{
				map[string]any{"sender": map[string]any{"id": "user"}, "delivery": map[string]any{"mids": []any{"mid-1"}}},
				map[string]any{"sender": map[string]any{"id": "user"}, "read": map[string]any{"watermark": 1}},
				map[string]any{"sender": map[string]any{"id": "user"}, "postback": map[string]any{"payload": "BUTTON"}},
				map[string]any{
					"sender":    map[string]any{"id": "page-123"},
					"recipient": map[string]any{"id": "user"},
					"message":   map[string]any{"mid": "echo-1", "text": "sent", "is_echo": true},
				},
			},
		}},
	}
	if events := extractMessagingEvents(payload); len(events) != 0 {
		t.Fatalf("events = %#v, want none", events)
	}
}

func TestWebhookPayloadCanContainLeadgenAndMessagingTogether(t *testing.T) {
	payload := map[string]any{
		"object": "page",
		"entry": []any{map[string]any{
			"id": "page-123",
			"changes": []any{map[string]any{
				"field": "leadgen",
				"value": map[string]any{"page_id": "page-123", "form_id": "form-1", "leadgen_id": "lead-1"},
			}},
			"messaging": []any{map[string]any{
				"sender":    map[string]any{"id": "psid-1"},
				"recipient": map[string]any{"id": "page-123"},
				"message":   map[string]any{"mid": "mid-1", "text": "Olá"},
			}},
		}},
	}
	if leads := extractLeadgenChanges(payload); len(leads) != 1 || leads[0].LeadgenID != "lead-1" {
		t.Fatalf("leadgen changes = %#v", leads)
	}
	if messages := extractMessagingEvents(payload); len(messages) != 1 || messages[0].ExternalMessageID != "mid-1" {
		t.Fatalf("messaging events = %#v", messages)
	}
}

func TestMessagingDestinationMatchesIntegrationAndRejectsImplicitEcho(t *testing.T) {
	integration := messagingIntegration{
		PageID:                     "page-123",
		InstagramBusinessAccountID: "ig-business-123",
	}
	if !messagingDestinationMatches(messagingEvent{
		EntryID: "ig-business-123", SenderID: "igsid-1", RecipientID: "ig-business-123",
	}, integration) {
		t.Fatal("Instagram recipient should match the connected business account")
	}
	if messagingDestinationMatches(messagingEvent{
		EntryID: "page-123", SenderID: "page-123", RecipientID: "psid-1",
	}, integration) {
		t.Fatal("business sender must be treated as an outbound echo")
	}
	if messagingDestinationMatches(messagingEvent{
		EntryID: "page-123", SenderID: "psid-1", RecipientID: "another-page",
	}, integration) {
		t.Fatal("foreign recipient must fail closed")
	}
}

func TestMessagingIntegrationAmbiguityFailsClosed(t *testing.T) {
	queryer := stubMessagingQueryer{
		count: 2,
		raw:   []byte(`{"id":"integration-1","organization_id":"00000000-0000-4000-8000-000000000001","page_id":"page-1"}`),
	}
	_, err := findMessagingIntegration(t.Context(), queryer, "page-1", "messenger")
	if !errors.Is(err, ErrAmbiguousMessagingIntegration) {
		t.Fatalf("error = %v, want ErrAmbiguousMessagingIntegration", err)
	}
}

func TestMessagingSQLContractsAreTenantSafeAndIdempotent(t *testing.T) {
	routing := strings.Join(strings.Fields(findMessagingIntegrationQuery), " ")
	for _, required := range []string{
		"from public.meta_integrations integration",
		"join public.organization_modules marketing_access",
		"lower(btrim(marketing_access.module_name)) = 'campaigns'",
		"marketing_access.is_enabled = true",
		"join public.organization_modules conversations_access",
		"lower(btrim(conversations_access.module_name)) = 'whatsapp'",
		"conversations_access.is_enabled = true",
		"coalesce(integration.is_connected, false) = true",
		"integration.page_id = $1",
		"integration.instagram_business_account_id = $1",
		"integration.organization_id::text",
	} {
		if !strings.Contains(routing, required) {
			t.Fatalf("routing query must contain %q; query = %q", required, routing)
		}
	}
	if strings.Contains(routing, "organization_id = $") {
		t.Fatalf("routing must not accept an organization from the webhook: %q", routing)
	}

	conversation := strings.Join(strings.Fields(upsertMessagingConversationQuery), " ")
	if !strings.Contains(conversation, "on conflict (organization_id, platform, page_id, external_id)") ||
		!strings.Contains(conversation, "where organization_id is not null") {
		t.Fatalf("conversation upsert key must isolate tenant and platform: %q", conversation)
	}
	message := strings.Join(strings.Fields(insertInboundMessageQuery), " ")
	if !strings.Contains(message, "on conflict (conversation_id, external_id)") ||
		!strings.Contains(message, "do nothing") {
		t.Fatalf("message insert must be idempotent: %q", message)
	}
	update := strings.Join(strings.Fields(updateInboundConversationQuery), " ")
	if !strings.Contains(update, "where organization_id = $1::uuid") ||
		!strings.Contains(update, "unread_count = least") {
		t.Fatalf("conversation update must be tenant-scoped and bounded: %q", update)
	}
}

func TestFilterMessagingPayloadRedactsContentWithoutMarketingModule(t *testing.T) {
	payload := map[string]any{
		"object": "page",
		"entry": []any{map[string]any{
			"id": "page-1",
			"messaging": []any{map[string]any{
				"sender":  map[string]any{"id": "person-1"},
				"message": map[string]any{"mid": "mid-1", "text": "sensitive message"},
			}},
			"changes": []any{map[string]any{
				"field": "leadgen",
				"value": map[string]any{"leadgen_id": "lead-1", "form_id": "form-1"},
			}},
		}},
	}

	filtered, err := filterMessagingPayload(payload, func(routeID string, platform string) (bool, error) {
		if routeID != "page-1" || platform != "messenger" {
			t.Fatalf("entitlement lookup = %q/%q", routeID, platform)
		}
		return false, nil
	})
	if err != nil {
		t.Fatalf("filter payload: %v", err)
	}
	entry := filtered["entry"].([]any)[0].(map[string]any)
	if _, exists := entry["messaging"]; exists {
		t.Fatalf("message content survived module gate: %#v", entry)
	}
	if entry["storage_decision"] != "skipped_module_disabled" || entry["messaging_redacted"] != true {
		t.Fatalf("redaction decision = %#v", entry)
	}
	if _, exists := entry["changes"]; !exists {
		t.Fatalf("base leadgen event was removed: %#v", entry)
	}
	originalEntry := payload["entry"].([]any)[0].(map[string]any)
	if _, exists := originalEntry["messaging"]; !exists {
		t.Fatal("filter must not mutate the in-memory payload used by the enabled processor")
	}
}

func TestFilterMessagingPayloadKeepsEnabledMessageForDurableRetry(t *testing.T) {
	payload := map[string]any{
		"object": "instagram",
		"entry": []any{map[string]any{
			"id": "ig-1",
			"messaging": []any{map[string]any{
				"sender":  map[string]any{"id": "person-1"},
				"message": map[string]any{"mid": "mid-1", "text": "hello"},
			}},
		}},
	}
	filtered, err := filterMessagingPayload(payload, func(string, string) (bool, error) { return true, nil })
	if err != nil {
		t.Fatalf("filter payload: %v", err)
	}
	entry := filtered["entry"].([]any)[0].(map[string]any)
	if _, exists := entry["messaging"]; !exists {
		t.Fatalf("enabled message was removed: %#v", entry)
	}
}

func TestAggregateWebhookResultsDoesNotAttributeCrossTenantBatch(t *testing.T) {
	status, organizationID, _, processed := aggregateWebhookResults(
		[]LeadgenResult{{Status: "processed", OrganizationID: "org-a"}},
		[]MessagingResult{{Status: "processed", OrganizationID: "org-b"}},
	)
	if status != "processed" || processed != 2 || organizationID != "" {
		t.Fatalf("aggregate = (%q, %q, %d), want processed, empty org, 2", status, organizationID, processed)
	}
}

func TestExtractWebhookEventContextUsesMessagingProviderID(t *testing.T) {
	context := extractWebhookEventContext(map[string]any{
		"object": "instagram",
		"entry": []any{map[string]any{
			"id": "ig-1",
			"messaging": []any{map[string]any{
				"sender":  map[string]any{"id": "user-1"},
				"message": map[string]any{"mid": "mid-1", "text": "hello"},
			}},
		}},
	})
	if context.EventType != "messages" || context.PageID != "ig-1" || context.ProviderEventID != "mid-1" {
		t.Fatalf("context = %#v", context)
	}
}

func TestPublishWebhookResultsEmitsTenantScopedMessagingRealtimeEvent(t *testing.T) {
	publisher := &captureMessagingPublisher{}
	handler := Handler{publisher: publisher}
	handler.publishWebhookResults(WebhookResponse{MessagingResults: []MessagingResult{
		{
			Status: "processed", OrganizationID: "org-1", ConversationID: "conversation-1",
			MessageID: "message-1", ExternalMessageID: "mid-1", PageID: "page-1", Platform: "messenger",
		},
		{Status: "duplicate", OrganizationID: "org-2", MessageID: "message-2"},
	}})
	if len(publisher.events) != 1 {
		t.Fatalf("events = %#v, want one", publisher.events)
	}
	event := publisher.events[0]
	if event.Type != "meta.message.received" || event.OrganizationID != "org-1" ||
		event.Data["conversationId"] != "conversation-1" || event.Data["messageId"] != "message-1" {
		t.Fatalf("event = %#v", event)
	}
}

type stubMessagingQueryer struct {
	count int64
	raw   []byte
}

func (stub stubMessagingQueryer) QueryRow(_ context.Context, _ string, _ ...any) pgx.Row {
	return stubMessagingRow{count: stub.count, raw: stub.raw}
}

type stubMessagingRow struct {
	count int64
	raw   []byte
}

func (row stubMessagingRow) Scan(destinations ...any) error {
	*(destinations[0].(*int64)) = row.count
	*(destinations[1].(*[]byte)) = row.raw
	return nil
}

type captureMessagingPublisher struct {
	events []realtime.Event
}

func (publisher *captureMessagingPublisher) Publish(event realtime.Event) {
	publisher.events = append(publisher.events, event)
}
