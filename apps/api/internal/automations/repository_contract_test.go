package automations

import (
	"os"
	"strings"
	"testing"
)

func TestAutomationConnectionWritesDefaultMissingBranches(t *testing.T) {
	t.Parallel()

	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository.go: %v", err)
	}

	const defaultedBranch = "coalesce($5, 'default')"
	if got := strings.Count(string(source), defaultedBranch); got != 3 {
		t.Fatalf(
			"automation connection writes using %q = %d, want 3 (create, duplicate and save flow)",
			defaultedBranch,
			got,
		)
	}
}

func TestFailedWhatsAppEffectRetryIsFencedByCurrentLeadBinding(t *testing.T) {
	t.Parallel()

	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository.go: %v", err)
	}

	retryStart := strings.Index(string(source), "with locked_conversation as materialized")
	if retryStart < 0 {
		t.Fatal("failed effect retry must lock the conversation before the outbox row")
	}
	retryEnd := strings.Index(string(source)[retryStart:], "select count(*)::integer from reset_outbox")
	if retryEnd < 0 {
		t.Fatal("failed effect retry query end not found")
	}
	retryQuery := string(source)[retryStart : retryStart+retryEnd]

	for _, required := range []string{
		"for no key update of conversation",
		"execution.conversation_id = conversation.id",
		"execution.lead_id = conversation.lead_id",
		"dispatch.response->>'message_id' = outbox.message_id::text",
		"outbox.client_message_id = dispatch.effect_key",
		"dispatch.request->>'session_id' = outbox.session_id::text",
		"message.lead_id = conversation.lead_id",
		"message.metadata->>'automation_effect_key' = dispatch.effect_key",
		"binding.lead_id = conversation.lead_id",
		"binding.active_to is null",
	} {
		if !strings.Contains(retryQuery, required) {
			t.Fatalf("failed effect retry is missing binding fence %q", required)
		}
	}

	if conversationLock, outboxLock := strings.Index(retryQuery, "for no key update of conversation"), strings.Index(retryQuery, "for update of dispatch, outbox"); conversationLock < 0 || outboxLock < 0 || conversationLock >= outboxLock {
		t.Fatal("failed effect retry must establish conversation -> outbox lock order")
	}
}

func TestConversationAutomationEventRetryIsFencedByBindingEpoch(t *testing.T) {
	t.Parallel()

	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository.go: %v", err)
	}

	retryStart := strings.Index(string(source), "with event_route as materialized")
	if retryStart < 0 {
		t.Fatal("event retry must discover routing before acquiring locks")
	}
	retryEnd := strings.Index(string(source)[retryStart:], "`, issueID, tenantContext.OrganizationID, kind)")
	if retryEnd < 0 {
		t.Fatal("event retry query end not found")
	}
	retryQuery := string(source)[retryStart : retryStart+retryEnd]

	for _, required := range []string{
		"for no key update of conversation",
		"for update of event",
		"conversation.deleted_at is null",
		"coalesce(conversation.is_group, false) = false",
		"event.lead_id = conversation.lead_id",
		"event.payload->>'conversation_id' = conversation.id::text",
		"event.payload->>'lead_id' = conversation.lead_id::text",
		"event.payload->>'session_id' = conversation.session_id::text",
		"event.payload->>'whatsapp_binding_id' = binding.id::text",
		"binding.session_id = conversation.session_id",
		"binding.lead_id = conversation.lead_id",
		"binding.active_to is null",
		"event.aggregate_type = 'whatsapp_message'",
		"event.payload->>'message_id' = message.id::text",
		"message.session_id = conversation.session_id",
		"message.conversation_id = conversation.id",
		"message.lead_id = conversation.lead_id",
	} {
		if !strings.Contains(retryQuery, required) {
			t.Fatalf("conversation event retry is missing epoch fence %q", required)
		}
	}
	for _, required := range []string{
		"event.event_type <> 'message_received'",
		"event.aggregate_type <> 'whatsapp_message'",
		"nullif(btrim(event.payload->>'conversation_id'), '') is null",
		"nullif(btrim(event.payload->>'whatsapp_binding_id'), '') is null",
	} {
		if !strings.Contains(retryQuery, required) {
			t.Fatalf("lead-only retry is missing downgrade fence %q", required)
		}
	}

	conversationLock := strings.Index(retryQuery, "for no key update of conversation")
	eventLock := strings.Index(retryQuery, "for update of event")
	if conversationLock < 0 || eventLock < 0 || conversationLock >= eventLock {
		t.Fatal("conversation event retry must establish conversation -> event lock order")
	}
}
