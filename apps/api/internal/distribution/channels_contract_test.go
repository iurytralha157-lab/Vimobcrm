package distribution

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

func TestCanonicalDistributionChannelContracts(t *testing.T) {
	t.Run("site", func(t *testing.T) {
		source := goFunctionSource(t, filepath.Join("..", "site", "repository.go"), "CreatePublicContact")
		requireContains(t, source,
			"distribution.ResolveIntakeDestination(ctx, tx",
			"distribution.Distribute(ctx, tx",
			`"site:" + submissionID`,
			"RoundRobinID:       intakeDestination.RoundRobinID",
			"RoundRobinResolved: intakeDestination.Resolved",
			"PreserveAssignee:   distribution.PreserveAssigneeForIntake(reentry, intakeDestination)",
			`distributionSource := "site"`,
		)
		if strings.Count(source, "distribution_deferred") < 2 {
			t.Fatal("site intake must defer legacy distribution for both insert and reentry")
		}
		requireOrdered(t, source, "insert into public.lead_entry_events", "distribution.Distribute(ctx, tx")
		requireAbsent(t, source, "handle_lead_intake", "round_robin_logs", "request.jwt.claim.role")
	})

	t.Run("manual lead", func(t *testing.T) {
		source := goFunctionSource(t, filepath.Join("..", "leads", "repository.go"), "createNewLead")
		requireContains(t, source,
			`leadMetadata["distribution_deferred"] = true`,
			"distributionOutcome := CreateDistributionOutcomeSkipped",
			"if shouldAutoDistribute(input)",
			"distribution.Distribute(ctx, tx",
			"newLeadDistributionRequest(tenantContext, input, leadID, intakeDestination)",
			"distributionOutcome = CreateDistributionOutcome(distributionResult.Reason)",
			"DistributionOutcome: distributionOutcome",
		)
		requireOrdered(t, source, "repo.insertInitialFeedbackActivity", "distribution.Distribute(ctx, tx")
		requireOrdered(t, source, "distribution.Distribute(ctx, tx", "repo.insertNotification")
		requireAbsent(t, source, "handle_lead_intake", "round_robin_logs")

		request := goFunctionSource(t, filepath.Join("..", "leads", "repository.go"), "newLeadDistributionRequest")
		requireContains(t, request,
			`"manual:" + leadID`,
			"RoundRobinID:       input.RoundRobinID",
			"RoundRobinResolved: intakeDestination.Resolved",
			"PreserveAssignee:   true",
			"Source:             &distributionSource",
		)
		requireAbsent(t, request, "handle_lead_intake", "round_robin_logs", "request.jwt.claim.role")

		reentry := goFunctionSource(t, filepath.Join("..", "leads", "repository.go"), "registerReentry")
		requireContains(t, reentry,
			"distributionOutcome := CreateDistributionOutcomeReentryPreserved",
			`reentryBehavior := "keep_assignee"`,
			`if reentryBehavior == "redistribute"`,
			"distribution.Distribute(ctx, tx",
			`distribution.StableKey("manual-reentry", existingLead.ID, entryID)`,
			"PreserveAssignee:   false",
			"Reentry:             true",
			"DistributionOutcome: distributionOutcome",
		)
		requireOrdered(t, reentry, `if reentryBehavior == "redistribute"`, "distribution.Distribute(ctx, tx")
	})

	t.Run("generic webhook", func(t *testing.T) {
		delegation := goFunctionSource(t, filepath.Join("..", "webhooks", "repository.go"), "ReceiveLead")
		requireContains(t, delegation,
			"repo.receiveLead(ctx",
			`Source:                "webhook"`,
			`Provider:              "generic_webhook"`,
			"ProviderEventID:       providerEventID",
			"SourceWebhookID:       &webhookID",
			"IncrementWebhookStats: true",
		)

		apiDelegation := goFunctionSource(t, filepath.Join("..", "webhooks", "repository.go"), "ReceiveAPILead")
		requireContains(t, apiDelegation,
			"repo.receiveLead(ctx",
			`Source:          "api"`,
			`Provider:        "public_api"`,
			"ProviderEventID: &idempotencyKey",
			"RequirePhone:    true",
		)

		shared := goFunctionSource(t, filepath.Join("..", "webhooks", "repository.go"), "receiveLeadWithIdentityMode")
		requireContains(t, shared,
			`"distribution_deferred": true`,
			"webhookDistributionKey(webhook.ID, options.Provider, providerEventKey, leadEntryID)",
			"distribution.ResolveIntakeDestination(ctx, tx",
			"distribution.Distribute(ctx, tx",
			"RoundRobinID:       intakeDestination.RoundRobinID",
			"RoundRobinResolved: intakeDestination.Resolved",
			"PreserveAssignee:   distribution.PreserveAssigneeForIntake(reentry, intakeDestination)",
			"distributionSource := options.Source",
			"OccurredAt:         occurredAt",
		)
		requireOrdered(t, shared, "repo.insertWebhookLeadEntry", "distribution.Distribute(ctx, tx")
		requireAbsent(t, shared, "handle_lead_intake", "round_robin_members", "round_robin_logs")

		distributionKey := goFunctionSource(t, filepath.Join("..", "webhooks", "repository.go"), "webhookDistributionKey")
		requireContains(t, distributionKey,
			"sha256.Sum256",
			`return strings.TrimSpace(provider) + ":"`,
		)
	})

	t.Run("meta", func(t *testing.T) {
		persist := goFunctionSource(t, filepath.Join("..", "meta", "repository.go"), "persistLeadWithIdentityMode")
		requireContains(t, persist,
			`metadata["distribution_deferred"] = true`,
			`distribution.StableKey("meta", integration.ID, change.LeadgenID)`,
			"RoundRobinID:       destination.RoundRobinID",
			"RoundRobinResolved: destination.RoundRobinResolved",
			"preserveAssignee := preserveAssigneeForMetaIntake(reentry, destination)",
			"PreserveAssignee:   preserveAssignee",
			"Source:             &source",
			"repo.enrichCanonicalLeadNotification",
		)
		requireOrdered(t, persist, "repo.insertLeadEntry", "distribution.Distribute(ctx, tx")
		requireOrdered(t, persist, "distribution.Distribute(ctx, tx", "repo.insertLeadRedistributionJob")
		requireAbsent(t, persist, "repo.insertRoundRobinLog")

		resolver := goFunctionSource(t, filepath.Join("..", "meta", "repository.go"), "resolveRoundRobin")
		requireAbsent(t, resolver, "repo.selectRoundRobinMember", "for update")
	})

	t.Run("grupo olx", func(t *testing.T) {
		process := goFunctionSource(t, filepath.Join("..", "portals", "repository.go"), "ProcessGrupoOLXLead")
		requireContains(t, process,
			`"distribution_deferred": true`,
			`"portal:" + eventID`,
			`distributionSource := "grupo_olx"`,
			"RoundRobinID:       roundRobinID",
			"RoundRobinResolved: destination.RoundRobinResolved",
			"PreserveAssignee:   preserveAssigneeForPortalIntake(reentry, destination)",
		)
		requireOrdered(t, process, "insert into public.lead_meta", "distribution.Distribute(ctx, tx")
		requireAbsent(t, process, "recordPortalRoundRobinAssignment", "source_webhook_id")

		resolver := goFunctionSource(t, filepath.Join("..", "portals", "repository.go"), "resolvePortalDestination")
		requireAbsent(t, resolver, "selectPortalRoundRobinMember", "for update")
	})

	t.Run("whatsapp native", func(t *testing.T) {
		process := goFunctionSource(t, filepath.Join("..", "whatsapp", "webhook_native_processor.go"), "createAuthorizedNativeLead")
		requireContains(t, process,
			`metadataPayload["distribution_deferred"] = true`,
			`if !rule.ManagedMessageDistribution`,
			"resolveNativeCTWAIntakeDestination(",
			"lockNativeCTWAIntakeDestination(",
			`distribution.StableKey("whatsapp-native", session.ID, message.ProviderMessageID)`,
			"distribution.Distribute(ctx, tx",
			"RoundRobinResolved: true",
			"PreserveAssignee:   distribution.PreserveAssigneeForIntake(!lead.IsNew, intakeDestination)",
			`distributionSource := "whatsapp"`,
		)
		requireOrdered(t, process, "upsert_whatsapp_webhook_lead", "distribution.Distribute(ctx, tx")
		requireAbsent(t, process, "update public.round_robins", "insert into public.round_robin_logs")

		resolver := goFunctionSource(t, filepath.Join("..", "whatsapp", "webhook_native_business.go"), "resolveNativeLeadAssignment")
		requireContains(t, resolver, `assignment.UserID == "" && assignment.RoundRobinID == ""`)
		requireAbsent(t, resolver, "round_robin_members", "for update")
	})

	t.Run("whatsapp edge", func(t *testing.T) {
		source := readSource(t, filepath.Join("..", "..", "..", "..", "supabase", "functions", "evolution-go-webhook", "index.ts"))
		requireContains(t, source,
			"async function processManagedWhatsAppLeadEntry",
			`.rpc("process_managed_whatsapp_lead_entry"`,
			"p_organization_id: session.organization_id",
			"p_lead_id: lead.id",
			"p_session_id: session.id",
			"p_rule_id: rule.id",
			"p_provider_message_id: message.messageId",
			"p_message: message.content",
			"p_occurred_at: message.sentAt",
			"Managed WhatsApp intake was not handled",
			"async function processCanonicalNonManagedWhatsAppDistribution",
			`.rpc("distribute_lead_from_backend"`,
			"p_round_robin_id: queueId",
			"p_preserve_assignee: preserveAssignee",
			"const idempotencyKey = `whatsapp-native:${await sha256Hex(stableKeyPayload)}`",
		)
		requireOrdered(t, source, `.rpc("upsert_whatsapp_webhook_lead"`, `.rpc("process_managed_whatsapp_lead_entry"`)
		requireOrdered(t, source, `.rpc("upsert_whatsapp_webhook_lead"`, `.rpc("distribute_lead_from_backend"`)
		requireAbsent(t, source,
			"resolveRoundRobinAssignee",
			"async function distributeLeadFromEdge",
			"round_robin_logs",
			"current_position",
		)
	})
}

func goFunctionSource(t *testing.T, path string, name string) string {
	t.Helper()
	sourcePaths := canonicalGoSourcePaths(t, path)
	for _, sourcePath := range sourcePaths {
		source := readSourceBytes(t, sourcePath)
		files := token.NewFileSet()
		parsed, err := parser.ParseFile(files, sourcePath, source, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", sourcePath, err)
		}
		for _, declaration := range parsed.Decls {
			function, ok := declaration.(*ast.FuncDecl)
			if !ok || function.Name.Name != name {
				continue
			}
			start := files.Position(function.Pos()).Offset
			end := files.Position(function.End()).Offset
			return string(source[start:end])
		}
	}
	t.Fatalf("function %s not found in canonical sources: %s", name, strings.Join(sourcePaths, ", "))
	return ""
}

func canonicalGoSourcePaths(t *testing.T, path string) []string {
	t.Helper()
	if filepath.Base(path) != "repository.go" {
		return []string{path}
	}

	directory := filepath.Dir(path)
	switch filepath.Base(directory) {
	case "site", "portals", "roundrobin":
	default:
		return []string{path}
	}

	matches, err := filepath.Glob(filepath.Join(directory, "repository*.go"))
	if err != nil {
		t.Fatalf("glob canonical repository sources in %s: %v", directory, err)
	}
	sources := make([]string, 0, len(matches))
	for _, match := range matches {
		if !strings.HasSuffix(match, "_test.go") {
			sources = append(sources, match)
		}
	}
	sort.Strings(sources)
	if len(sources) == 0 {
		t.Fatalf("no canonical repository sources found in %s", directory)
	}
	return sources
}

func readSource(t *testing.T, path string) string {
	t.Helper()
	return string(readSourceBytes(t, path))
}

func readSourceBytes(t *testing.T, path string) []byte {
	t.Helper()
	source, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return source
}

func requireContains(t *testing.T, source string, fragments ...string) {
	t.Helper()
	for _, fragment := range fragments {
		if !strings.Contains(source, fragment) {
			t.Fatalf("contract is missing %q", fragment)
		}
	}
}

func requireAbsent(t *testing.T, source string, fragments ...string) {
	t.Helper()
	for _, fragment := range fragments {
		if strings.Contains(source, fragment) {
			t.Fatalf("contract still contains forbidden fragment %q", fragment)
		}
	}
}

func requireOrdered(t *testing.T, source string, first string, second string) {
	t.Helper()
	firstIndex := strings.Index(source, first)
	secondIndex := strings.Index(source, second)
	if firstIndex < 0 || secondIndex < 0 || firstIndex >= secondIndex {
		t.Fatalf("expected %q before %q", first, second)
	}
}
