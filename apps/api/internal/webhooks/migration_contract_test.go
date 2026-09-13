package webhooks

import (
	"os"
	"strings"
	"testing"
)

const pipelineBoardOrderMigration = "../../../../supabase/migrations/20260912172606_advance_pipeline_board_order_on_reentry_and_distribution.sql"

func TestOutgoingWebhookMigrationUsesCanonicalLeadEntryOutbox(t *testing.T) {
	sourceBytes, err := os.ReadFile("../../../../supabase/migrations/20260907230630_add_durable_outgoing_webhook_delivery.sql")
	if err != nil {
		t.Fatalf("read outgoing webhook migration: %v", err)
	}
	source := strings.ToLower(string(sourceBytes))

	for _, fragment := range []string{
		"create table if not exists private.webhook_delivery_outbox",
		"unique (webhook_id, event_key)",
		"webhook_delivery_outbox_lead_id_idx",
		"force row level security",
		"revoke all on table private.webhook_delivery_outbox",
		"create or replace function private.enqueue_outgoing_lead_webhooks()",
		"after insert or update of",
		"on public.lead_entry_events",
		"when 'initial' then 'lead.created'",
		"when 'reentry' then 'lead.reentered'",
		"lower(trim(module.module_name)) = 'webhooks'",
		"on conflict (webhook_id, event_key) do update",
		"webhook_delivery_outbox.attempts = 0",
		"webhook_url is not null",
		"trigger_events is not null",
		"drop policy if exists webhooks_integrations_managers_select",
	} {
		if !strings.Contains(source, fragment) {
			t.Fatalf("outgoing webhook migration is missing %q", fragment)
		}
	}
}

func TestWebhookSecretsAreNotGrantedThroughTheDataAPI(t *testing.T) {
	sourceBytes, err := os.ReadFile("../../../../supabase/migrations/20260907230630_add_durable_outgoing_webhook_delivery.sql")
	if err != nil {
		t.Fatalf("read outgoing webhook migration: %v", err)
	}
	source := strings.ToLower(string(sourceBytes))

	if !strings.Contains(source, "revoke all on table public.webhooks_integrations") {
		t.Fatal("webhook table privileges are not revoked before granting safe columns")
	}
	grantStart := strings.Index(source, "grant select (")
	if grantStart < 0 {
		t.Fatal("safe authenticated webhook column grant is missing")
	}
	grantEnd := strings.Index(source[grantStart:], ") on public.webhooks_integrations to authenticated")
	if grantEnd < 0 {
		t.Fatal("safe authenticated webhook column grant is missing")
	}
	grant := source[grantStart : grantStart+grantEnd]
	if strings.Contains(grant, "api_token") {
		t.Fatal("webhook api_token must not be granted through the Data API")
	}
}

func TestPipelineBoardOrderMigrationIsEventScopedAndPreservesStageClock(t *testing.T) {
	t.Parallel()

	sourceBytes, err := os.ReadFile(pipelineBoardOrderMigration)
	if err != nil {
		t.Fatalf("read pipeline board order migration: %v", err)
	}
	source := strings.ToLower(string(sourceBytes))
	functionStart := strings.Index(source, "create or replace function private.guard_lead_clocks()")
	functionEnd := strings.Index(source, "comment on function private.guard_lead_clocks()")
	if functionStart < 0 || functionEnd <= functionStart {
		t.Fatal("lead clock guard replacement was not found")
	}
	guard := source[functionStart:functionEnd]

	for _, fragment := range []string{
		"new.assigned_user_id is distinct from old.assigned_user_id",
		"new.team_id is distinct from old.team_id",
		"new.assigned_at is distinct from old.assigned_at",
		"coalesce(new.reentry_count, 0) > coalesce(old.reentry_count, 0)",
		"new.stage_entered_at := old.stage_entered_at",
		"v_board_event_at := clock_timestamp()",
		"new.board_order_at := greatest(",
	} {
		if !strings.Contains(guard, fragment) {
			t.Fatalf("lead clock guard is missing %q", fragment)
		}
	}
	for _, forbidden := range []string{
		"whatsapp_messages",
		"lead_tags",
		"lead_events",
		"automations",
	} {
		if strings.Contains(guard, forbidden) {
			t.Fatalf("lead clock guard must not be driven by %q", forbidden)
		}
	}

	triggerStart := strings.Index(source, "create trigger trg_guard_lead_clocks")
	if triggerStart < 0 {
		t.Fatal("lead clock trigger replacement was not found")
	}
	trigger := source[triggerStart:]
	for _, column := range []string{
		"assigned_user_id",
		"assigned_at",
		"team_id",
		"reentry_count",
	} {
		if !strings.Contains(trigger, column) {
			t.Fatalf("lead clock trigger is missing event column %q", column)
		}
	}
	if !strings.Contains(source, "revoke all on function private.guard_lead_clocks()") {
		t.Fatal("lead clock guard must remain unavailable to Data API roles")
	}

	for _, fragment := range []string{
		"update public.leads",
		"set board_order_at = coalesce(",
		"last_entry_at,",
		"stage_entered_at,",
		"created_at,",
		"where stage_id is not null",
		"and board_order_at is null",
	} {
		if !strings.Contains(source, fragment) {
			t.Fatalf("legacy board clock backfill is missing %q", fragment)
		}
	}
}
