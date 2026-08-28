package meta

import (
	"os"
	"strings"
	"testing"
)

func TestConversionFeedbackRepositoryKeepsDurabilityAndCredentialContracts(t *testing.T) {
	t.Parallel()

	repositorySource, err := os.ReadFile("conversion_feedback_repository.go")
	if err != nil {
		t.Fatalf("read repository source: %v", err)
	}
	repository := strings.ToLower(string(repositorySource))
	for _, required := range []string{
		"for update skip locked",
		"locked_at",
		"locked_by",
		"vault.decrypted_secrets",
		"crm_dataset_access_token_secret_ref",
		"organization_modules",
		"module_name)) = 'campaigns'",
		"conversion_feedback_enabled",
		"conversion_feedback_status",
		"crm_dataset_id",
		"interval '7 days'",
		"where id = nullif($1, '')::uuid",
		"for update of successor skip locked",
		"'predecessor_dead'",
		"'invalid_funnel_timeline'",
		"predecessor.event_time > successor.event_time",
		"last_error_code = blocked_candidates.error_code",
		"predecessor.event_sequence < outbox.event_sequence",
		"predecessor.status = 'sent'",
		"coalesce(outbox.test_event_code, '')",
	} {
		if !strings.Contains(repository, required) {
			t.Errorf("repository contract is missing %q", required)
		}
	}

	senderSource, err := os.ReadFile("conversion_feedback.go")
	if err != nil {
		t.Fatalf("read sender source: %v", err)
	}
	sender := strings.ToLower(string(senderSource))
	for _, required := range []string{
		`header.set("authorization", "bearer "+token)`,
		`if repo.config.conversionfeedbackappsecretproofenabled`,
		`query.set("appsecret_proof", proof)`,
		`json.number(job.leadgenid)`,
		`actionsource: "system_generated"`,
		`partneragent:  conversionfeedbackpartneragent`,
		`testeventcode: strings.trimspace(job.testeventcode)`,
		`"lead_event_source": "vimob crm"`,
		`"event_source":      "crm"`,
	} {
		if !strings.Contains(sender, required) {
			t.Errorf("sender contract is missing %q", required)
		}
	}
	for _, forbidden := range []string{
		`query.set("access_token"`,
		"access_token=",
		"conversionfeedbacktesteventcode",
	} {
		if strings.Contains(sender, forbidden) {
			t.Errorf("sender contract contains forbidden token-in-URL pattern %q", forbidden)
		}
	}
}

func TestRecentFactsReplayPreservesRealTimelineAndTenantDestination(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("../../../../supabase/migrations/20260801131841_meta_crm_conversion_feedback.sql")
	if err != nil {
		t.Fatalf("read conversion feedback migration: %v", err)
	}
	source := strings.ToLower(string(raw))
	for _, required := range []string{
		"private.enqueue_recent_meta_crm_facts(",
		"integration.id = p_integration_id",
		"integration.organization_id = p_organization_id",
		"entry.occurred_at >= replay_now - interval '7 days'",
		"entry.occurred_at <= replay_now",
		"funnel.occurred_at >= entry.occurred_at",
		"funnel.occurred_at <= replay_now",
		"entry.provider_event_id ~ '^[0-9]{15,17}$'",
		"nullif(entry.metadata->>'integration_id', '') = integration.id::text",
		"nullif(entry.page_id, '') = integration.page_id",
		"integration.crm_dataset_id as dataset_id",
		"predecessor.event_sequence < target.event_sequence",
		") <> (target.event_sequence - 1)::bigint",
		"initial_fact.occurred_at <= fact.occurred_at",
		"qualified_fact.occurred_at <= fact.occurred_at",
		"initial_fact.occurred_at <= qualified_fact.occurred_at",
		"on conflict (funnel_event_id) do nothing",
		"normalized_test_event_code",
	} {
		if !strings.Contains(source, required) {
			t.Errorf("recent-fact replay contract is missing %q", required)
		}
	}
	for _, forbidden := range []string{
		"event_time = replay_now",
		"funnel.occurred_at = replay_now",
	} {
		if strings.Contains(source, forbidden) {
			t.Errorf("recent-fact replay fabricates time with %q", forbidden)
		}
	}
}

func TestConversionFeedbackClaimsEachJobJustInTime(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("conversion_feedback_repository.go")
	if err != nil {
		t.Fatalf("read conversion feedback repository: %v", err)
	}
	source := string(raw)
	if !strings.Contains(source, "claimConversionFeedbackJobs(ctx, 1, settings.Lease)") {
		t.Fatal("conversion feedback jobs must be claimed immediately before each sequential send")
	}
}

func TestMetaReentryPersistsNewEntryBeforeMovingExistingLead(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read Meta repository source: %v", err)
	}
	source := string(raw)
	start := strings.Index(source, "entryInserted := false")
	if start < 0 {
		t.Fatal("reentry ordering guard is missing")
	}
	reentryFlow := source[start:]
	entryIndex := strings.Index(reentryFlow, "repo.insertLeadEntry")
	leadUpdateIndex := strings.Index(reentryFlow, "update public.leads")
	if entryIndex < 0 || leadUpdateIndex < 0 || entryIndex > leadUpdateIndex {
		t.Fatal("new Meta reentry must exist before a stage move can emit funnel feedback")
	}
}
