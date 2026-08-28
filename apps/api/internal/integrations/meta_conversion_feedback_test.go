package integrations

import (
	"os"
	"strings"
	"testing"
)

func TestMetaConversionFeedbackValidation(t *testing.T) {
	validUUID := "81000000-0000-4000-8000-000000000020"
	if normalized, ok := validIntegrationUUID(validUUID); !ok || normalized != validUUID {
		t.Fatalf("expected valid normalized UUID, got %q (%v)", normalized, ok)
	}
	if _, ok := validIntegrationUUID("not-a-uuid"); ok {
		t.Fatal("invalid integration UUID must be rejected")
	}

	for _, datasetID := range []string{"12345", "123456789012345", strings.Repeat("9", 30)} {
		if !isDecimalMetaDatasetID(datasetID) {
			t.Fatalf("expected dataset id %q to be valid", datasetID)
		}
	}
	for _, datasetID := range []string{"", "1234", "act_12345", strings.Repeat("9", 31)} {
		if isDecimalMetaDatasetID(datasetID) {
			t.Fatalf("expected dataset id %q to be invalid", datasetID)
		}
	}
	if validMetaDatasetToken("token\nwith-control") {
		t.Fatal("dataset credential containing control characters must be rejected")
	}
	if validMetaDatasetName("dataset\x00name") {
		t.Fatal("dataset name containing control characters must be rejected")
	}
	if !validMetaTestEventCode("TEST-CRM-123") {
		t.Fatal("ordinary Meta test event code must be accepted")
	}
	if validMetaTestEventCode("TEST\nCRM") {
		t.Fatal("test event code containing control characters must be rejected")
	}
	if validMetaTestEventCode(strings.Repeat("x", metaTestEventCodeMaximumBytes+1)) {
		t.Fatal("oversized test event code must be rejected")
	}
}

func TestMetaConversionFeedbackPersistenceIsTenantBoundAndTokenless(t *testing.T) {
	raw, err := os.ReadFile("meta_conversion_feedback.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	for _, required := range []string{
		"integration.organization_id = $1::uuid",
		"integration.id = $2::uuid",
		"lower(btrim(module_access.module_name)) = 'campaigns'",
		"module_access.is_enabled = true",
		"for update",
		"crm_dataset_access_token = nullif($5, '')",
		"conversion_feedback_enabled = $6",
		"datasetID != currentDataset && datasetToken == \"\"",
		"conversion_feedback_activated_at = case",
		"coalesce(integration.conversion_feedback_enabled, false) = false",
		"integration.crm_dataset_id is distinct from nullif($3, '')",
		"or integration.conversion_feedback_activated_at is null",
		") then clock_timestamp()",
		"tx.Commit(ctx)",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("conversion feedback persistence is missing %q", required)
		}
	}

	returningStart := strings.Index(source, "returning jsonb_strip_nulls")
	if returningStart < 0 {
		t.Fatal("safe response projection is missing")
	}
	projection := source[returningStart:]
	for _, forbidden := range []string{
		"'crm_dataset_access_token'",
		"'crm_dataset_access_token_secret_ref'",
		"'decrypted_secret'",
	} {
		if strings.Contains(projection, forbidden) {
			t.Fatalf("browser response projection exposes %s", forbidden)
		}
	}
}

func TestMetaConversionFeedbackReplayIsExplicitTenantBoundAndPostCommit(t *testing.T) {
	raw, err := os.ReadFile("meta_conversion_feedback.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	for _, required := range []string{
		`testEventCode != "" && !request.ReplayRecentFacts`,
		`request.ReplayRecentFacts && !request.Enabled`,
		`select private.enqueue_recent_meta_crm_facts(`,
		`tenantContext.OrganizationID`,
		`integrationID`,
		`result["recent_facts_replay_requested"] = true`,
		`result["recent_facts_queued"] = queued`,
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("explicit recent-fact replay is missing %q", required)
		}
	}

	commitIndex := strings.Index(source, "tx.Commit(ctx)")
	replayIndex := strings.Index(source, "repo.replayRecentMetaCRMFacts(")
	if commitIndex < 0 || replayIndex < 0 || commitIndex > replayIndex {
		t.Fatal("recent-fact replay must run after the integration transaction commits")
	}
}
