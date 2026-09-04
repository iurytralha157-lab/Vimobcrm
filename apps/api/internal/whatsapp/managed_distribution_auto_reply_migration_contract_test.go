package whatsapp

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestManagedWhatsAppDistributionAutoReplyMigrationContract(t *testing.T) {
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to locate managed WhatsApp auto-reply migration contract test")
	}
	migrationPath := filepath.Clean(filepath.Join(
		filepath.Dir(sourceFile),
		"..", "..", "..", "..",
		"supabase", "migrations",
		"20260904123000_managed_whatsapp_distribution_auto_reply.sql",
	))
	raw, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	source := strings.ToLower(string(raw))
	compact := strings.Join(strings.Fields(source), " ")

	required := []string{
		"create or replace function private.reserve_managed_whatsapp_distribution_auto_reply_from_entry()",
		"old.metadata ? 'intake_result'",
		"new.created_at < pg_catalog.statement_timestamp() - interval '1 hour'",
		"jsonb_typeof( v_settings->'whatsapp_distribution_auto_reply_enabled' ) <> 'boolean'",
		"jsonb_typeof( v_settings->'whatsapp_distribution_auto_reply_message' ) <> 'string'",
		"jsonb_typeof( v_settings->'whatsapp_distribution_auto_reply_delay_seconds' ) = 'number'",
		"'managed_whatsapp_distribution_auto_reply_reservation'",
		"'version', 'v1'",
		"create trigger trg_reserve_managed_whatsapp_distribution_auto_reply before update of metadata on public.lead_entry_events",
		"create or replace function public.enqueue_managed_whatsapp_distribution_auto_reply(",
		"security definer set search_path = ''",
		"entry.entry_type = 'initial'",
		"entry.provider = 'whatsapp'",
		"entry.provider_event_id is distinct from ( v_session_id::text || ':' || v_provider_message_id )",
		"distribution_log.metadata->>'distribution_event_id' = v_distribution_event_id",
		"v_existing_message.metadata->>'managed_whatsapp_distribution_event_id'",
		"'reason', 'already_processed'",
		"v_reservation->>'entry_event_id'",
		"v_reservation->>'round_robin_id'",
		"v_reservation->>'rule_id'",
		"v_reservation->>'session_id'",
		"v_delay_seconds not between 1 and 3600",
		"lead.assigned_user_id = p_assigned_user_id",
		"conversation.session_id = inbound_message.session_id",
		"inbound_message.session_id = v_session_id",
		"inbound_message.lead_id = v_entry.lead_id",
		"from public.whatsapp_contact_identity_aliases as identity_alias",
		"identity_alias.canonical_jid ~ '^[0-9]{10,15}@(s[.]whatsapp[.]net|c[.]us)$'",
		"v_remote_jid !~ '^[0-9]{10,15}@s[.]whatsapp[.]net$'",
		"v_destination := split_part(v_remote_jid, '@', 1)",
		"'managed-wa-distribution-reply:'",
		"on conflict (organization_id, session_id, client_message_id) where client_message_id is not null do nothing",
		"'managed_whatsapp_reply_to_message_id', v_inbound_message_id",
		"'managed_whatsapp_distribution_event_id', v_distribution_event_id",
		"'origin', 'automation'",
		"'is_automation', true",
		"insert into public.whatsapp_outbox",
		"'action', 'send.text'",
		"v_now + pg_catalog.make_interval(secs => v_delay_seconds)",
		"last_message_preview = left(v_reply_message, 500)",
		"old.metadata->'intake_result' is not distinct from new.metadata->'intake_result'",
		"new.metadata->'intake_result'->>'success'",
		"new.metadata->'intake_result'->>'distribution_pending'",
		"create trigger trg_enqueue_managed_whatsapp_auto_reply after update of metadata on public.lead_entry_events",
		"revoke all on function public.enqueue_managed_whatsapp_distribution_auto_reply( uuid, uuid, uuid, text ) from public, anon, authenticated",
		"grant execute on function public.enqueue_managed_whatsapp_distribution_auto_reply( uuid, uuid, uuid, text ) to service_role",
		"create trigger trg_touch_whatsapp_conversation_received_at after insert on public.whatsapp_messages for each row when ( coalesce(new.from_me, false) = false and lower(coalesce(new.direction, 'inbound')) <> 'outbound' )",
		"'reason', 'auto_reply_enqueue_failed'",
	}
	for _, fragment := range required {
		if !strings.Contains(source, fragment) && !strings.Contains(compact, fragment) {
			t.Fatalf("managed WhatsApp auto-reply migration is missing %q", fragment)
		}
	}

	for _, forbidden := range []string{
		" to anon",
		" to authenticated",
		"http://",
		"https://",
		"raga",
		"insert into public.notifications",
		"update public.notifications",
		"delete from public.notifications",
		"nullif(btrim(lead.phone)",
		"length(v_destination) not between 8 and 20",
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("managed WhatsApp auto-reply migration contains forbidden fragment %q", forbidden)
		}
	}

	messageLookup := strings.Index(compact, "select message.* into v_existing_message")
	queueLookup := strings.Index(compact, "select true into v_context_active from public.round_robins")
	if messageLookup < 0 || queueLookup < 0 || messageLookup > queueLookup {
		t.Fatal("idempotent message tombstone lookup must run before mutable queue context")
	}
}
