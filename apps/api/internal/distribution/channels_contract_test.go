package distribution

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCanonicalDistributionChannelContracts(t *testing.T) {
	t.Run("site", func(t *testing.T) {
		source := goFunctionSource(t, filepath.Join("..", "site", "repository.go"), "CreatePublicContact")
		requireContains(t, source,
			"distribution.Distribute(ctx, tx",
			`"site:" + submissionID`,
			"PreserveAssignee: true",
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
			`"manual:" + leadID`,
			"distribution.Distribute(ctx, tx",
			"PreserveAssignee: true",
			"Source:           &distributionSource",
		)
		requireOrdered(t, source, "repo.insertInitialFeedbackActivity", "distribution.Distribute(ctx, tx")
		requireOrdered(t, source, "distribution.Distribute(ctx, tx", "repo.insertNotification")
		requireAbsent(t, source, "handle_lead_intake", "round_robin_logs")
	})

	t.Run("generic webhook", func(t *testing.T) {
		source := goFunctionSource(t, filepath.Join("..", "webhooks", "repository.go"), "ReceiveLead")
		requireContains(t, source,
			`"distribution_deferred": true`,
			"sha256.Sum256",
			`"generic-webhook:"`,
			"distribution.Distribute(ctx, tx",
			"PreserveAssignee: true",
			`distributionSource := "webhook"`,
			"OccurredAt:       occurredAt",
		)
		requireOrdered(t, source, "repo.insertWebhookLeadEntry", "distribution.Distribute(ctx, tx")
		requireAbsent(t, source, "handle_lead_intake", "round_robin_members", "round_robin_logs")
	})

	t.Run("meta", func(t *testing.T) {
		persist := goFunctionSource(t, filepath.Join("..", "meta", "repository.go"), "persistLead")
		requireContains(t, persist,
			`metadata["distribution_deferred"] = true`,
			`distribution.StableKey("meta", integration.ID, change.LeadgenID)`,
			"RoundRobinID:     destination.RoundRobinID",
			"PreserveAssignee: true",
			"Source:           &source",
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
			"RoundRobinID:     roundRobinID",
			"PreserveAssignee: true",
		)
		requireOrdered(t, process, "insert into public.lead_meta", "distribution.Distribute(ctx, tx")
		requireAbsent(t, process, "recordPortalRoundRobinAssignment", "source_webhook_id")

		resolver := goFunctionSource(t, filepath.Join("..", "portals", "repository.go"), "resolvePortalDestination")
		requireAbsent(t, resolver, "selectPortalRoundRobinMember", "for update")
	})

	t.Run("whatsapp native", func(t *testing.T) {
		process := goFunctionSource(t, filepath.Join("..", "whatsapp", "webhook_native_processor.go"), "createVerifiedNativeCampaignLead")
		requireContains(t, process,
			`"distribution_deferred": true`,
			`distribution.StableKey("whatsapp-native", session.ID, message.ProviderMessageID)`,
			"distribution.Distribute(ctx, tx",
			"PreserveAssignee: true",
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
			"async function stableDistributionKey",
			`crypto.subtle.digest("SHA-256"`,
			"async function resolveRoundRobinTarget",
			"async function distributeLeadFromEdge",
			"parseBoolean(existingMetadata.distribution_deferred)",
			`normalizeText(existingMetadata.source).toLowerCase() === "whatsapp"`,
			`/^whatsapp-edge:[0-9a-f]{64}$/.test(persistedKey)`,
			"existingMetadata.distribution_idempotency_key",
			"distribution_deferred: true",
			"distribution_idempotency_key: distributionKey",
			`.rpc("distribute_lead_from_backend"`,
			"p_preserve_assignee: true",
			`p_source: "whatsapp"`,
		)
		requireOrdered(t, source, `.rpc("upsert_whatsapp_webhook_lead"`, `.rpc("distribute_lead_from_backend"`)
		requireAbsent(t, source, "resolveRoundRobinAssignee", "round_robin_logs", "current_position")
	})
}

func goFunctionSource(t *testing.T, path string, name string) string {
	t.Helper()
	source := readSourceBytes(t, path)
	files := token.NewFileSet()
	parsed, err := parser.ParseFile(files, path, source, 0)
	if err != nil {
		t.Fatalf("parse %s: %v", path, err)
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
	t.Fatalf("function %s not found in %s", name, path)
	return ""
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
