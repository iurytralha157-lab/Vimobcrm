package roundrobin

import (
	"errors"
	"strings"
	"testing"
)

func TestListMetaFormOptionsQueryIsTenantScopedAndReadOnly(t *testing.T) {
	for _, fragment := range []string{
		"form_config.id::text",
		"from public.meta_form_configs form_config",
		"join public.meta_integrations meta_integration",
		"meta_integration.organization_id = form_config.organization_id",
		"meta_integration.id = form_config.integration_id",
		"where form_config.organization_id = $1::uuid",
		"btrim(form_config.form_id) <> ''",
		"coalesce(meta_integration.is_connected, true)",
		"coalesce(nullif(btrim(meta_integration.page_name), ''), '')",
		"btrim(coalesce(meta_integration.page_id, '')) <> ''",
	} {
		if !strings.Contains(listMetaFormOptionsQuery, fragment) {
			t.Errorf("Meta form option query does not contain %q", fragment)
		}
	}

	lowerQuery := strings.ToLower(listMetaFormOptionsQuery)
	for _, forbidden := range []string{"access_token", "select *", "to_jsonb", " insert ", " update ", " delete "} {
		if strings.Contains(lowerQuery, forbidden) {
			t.Errorf("Meta form option query must not contain %q", forbidden)
		}
	}
}

func TestListMetaFormLinkRulesQueryIsTenantScopedAndReadOnly(t *testing.T) {
	for _, fragment := range []string{
		"from public.meta_form_configs form_config",
		"join public.round_robins round_robin",
		"round_robin.organization_id = form_config.organization_id",
		"round_robin.id = form_config.round_robin_id",
		"where form_config.organization_id = $1::uuid",
		"form_config.round_robin_id is not null",
	} {
		if !strings.Contains(listMetaFormLinkRulesQuery, fragment) {
			t.Errorf("Meta form link rule query does not contain %q", fragment)
		}
	}

	lowerQuery := strings.ToLower(listMetaFormLinkRulesQuery)
	for _, forbidden := range []string{"access_token", "select *", "to_jsonb", " insert ", " update ", " delete "} {
		if strings.Contains(lowerQuery, forbidden) {
			t.Errorf("Meta form link rule query must not contain %q", forbidden)
		}
	}
}

func TestMergeMissingMetaFormLinkRulesPreservesDirectLinksWithoutDuplicates(t *testing.T) {
	const queueID = "11111111-1111-4111-8111-111111111111"
	rules := []Rule{
		{ID: "rule-1", RoundRobinID: queueID, MatchType: "meta_form", MatchValue: "form-a, form-b"},
		{ID: "rule-2", RoundRobinID: queueID, MatchType: "source", MatchValue: "website"},
	}
	linkedRules := []Rule{
		{ID: "config-a", RoundRobinID: queueID, MatchType: "meta_form", MatchValue: "form-a"},
		{ID: "config-b", RoundRobinID: queueID, MatchType: "meta_form", MatchValue: "form-b"},
		{ID: "config-c", RoundRobinID: queueID, MatchType: "meta_form", MatchValue: "form-c"},
		{ID: "config-c-duplicate", RoundRobinID: queueID, MatchType: "meta_form", MatchValue: "form-c"},
	}

	merged := mergeMissingMetaFormLinkRules(rules, linkedRules)
	if len(merged) != len(rules)+1 {
		t.Fatalf("expected one missing direct link, got %#v", merged)
	}
	if merged[len(merged)-1].ID != "config-c" || merged[len(merged)-1].MatchValue != "form-c" {
		t.Fatalf("unexpected synthesized rule: %#v", merged[len(merged)-1])
	}
}

func TestMergeMissingMetaFormLinkRulesRecognizesLegacyConfigID(t *testing.T) {
	const queueID = "11111111-1111-4111-8111-111111111111"
	rules := []Rule{
		{ID: "rule-1", RoundRobinID: queueID, MatchType: "meta_form", MatchValue: "config-a"},
	}
	linkedRules := []Rule{
		{ID: "config-a", RoundRobinID: queueID, MatchType: "meta_form", MatchValue: "form-a"},
	}

	merged := mergeMissingMetaFormLinkRules(rules, linkedRules)
	if len(merged) != len(rules) {
		t.Fatalf("legacy config ID must not create a duplicate synthesized rule: %#v", merged)
	}
	if merged[0].MatchValue != "form-a" {
		t.Fatalf("legacy config ID must be canonicalized for safe edits: %#v", merged[0])
	}
}

func TestMergeMissingMetaFormLinkRulesRecognizesLegacyFormMatchType(t *testing.T) {
	const queueID = "11111111-1111-4111-8111-111111111111"
	rules := []Rule{
		{ID: "rule-1", RoundRobinID: queueID, MatchType: "form", MatchValue: "form-a"},
	}
	linkedRules := []Rule{
		{ID: "config-a", RoundRobinID: queueID, MatchType: "meta_form", MatchValue: "form-a"},
	}

	merged := mergeMissingMetaFormLinkRules(rules, linkedRules)
	if len(merged) != len(rules) {
		t.Fatalf("legacy form match type must not create a duplicate synthesized rule: %#v", merged)
	}
}

func TestValidateMetaFormLinksRejectsAnotherQueue(t *testing.T) {
	const queueID = "11111111-1111-4111-8111-111111111111"
	err := validateMetaFormLinks(queueID, []string{"form-a"}, []metaFormLinkState{{
		FormID:       "form-a",
		RoundRobinID: "22222222-2222-4222-8222-222222222222",
		QueueName:    "Fila existente",
	}})
	if !errors.Is(err, ErrConditionConflict) {
		t.Fatalf("expected a condition conflict, got %v", err)
	}
}

func TestValidateMetaFormLinksAcceptsUnlockedAndCurrentQueueLinks(t *testing.T) {
	const queueID = "11111111-1111-4111-8111-111111111111"
	err := validateMetaFormLinks(queueID, []string{"form-a", "form-b"}, []metaFormLinkState{
		{FormID: "form-a"},
		{FormID: "form-b", RoundRobinID: queueID, QueueName: "Fila atual"},
	})
	if err != nil {
		t.Fatalf("expected links to be valid, got %v", err)
	}
}

func TestValidateMetaFormLinksRejectsUnknownForm(t *testing.T) {
	err := validateMetaFormLinks(
		"11111111-1111-4111-8111-111111111111",
		[]string{"form-a", "missing-form"},
		[]metaFormLinkState{{FormID: "form-a"}},
	)
	if !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("expected an invalid reference, got %v", err)
	}
}

func TestMetaFormLinkLockIsTenantScopedAndSerializesConcurrentClaims(t *testing.T) {
	for _, fragment := range []string{
		"where form_config.organization_id = $1::uuid",
		"form_config.form_id = any($2::text[])",
		"order by form_config.form_id asc",
		"for update of form_config",
	} {
		if !strings.Contains(lockMetaFormLinksQuery, fragment) {
			t.Errorf("Meta form link lock does not contain %q", fragment)
		}
	}
}
