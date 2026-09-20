package webhooks

import (
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestWebhookFormAnswersExtractsFormFields(t *testing.T) {
	payload := map[string]any{
		"nome":                 "Cliente Teste",
		"email":                "cliente@example.com",
		"whatsapp":             "(12) 99999-9999",
		"estado":               "SP",
		"cidade":               "Sao Paulo",
		"tipo_empreendimento":  "Vertical",
		"vgv_estimado":         "R$ 80.000.000",
		"participacao_projeto": []any{"Sou o principal responsavel", "Participo da decisao"},
		"principal_desafio":    []any{"Acelerar as vendas", "Atrair compradores"},
		"enviado_em":           "2026-07-07T12:00:00Z",
		"field_data":           []any{map[string]any{"label": "Pergunta extra", "value": "Resposta extra"}},
		"posted_data":          map[string]any{"nested_field": map[string]any{"label": "Campo aninhado", "value": []any{"A", "B"}}},
		"source_page":          "https://neximob.com.br/lancamento/quero-contratar/",
	}

	answers := webhookFormAnswers(payload)
	byQuestion := make(map[string]string, len(answers))
	for _, answer := range answers {
		byQuestion[answer["question"]] = answer["answer"]
	}

	expected := map[string]string{
		"estado":               "SP",
		"cidade":               "Sao Paulo",
		"tipo_empreendimento":  "Vertical",
		"vgv_estimado":         "R$ 80.000.000",
		"participacao_projeto": "Sou o principal responsavel, Participo da decisao",
		"principal_desafio":    "Acelerar as vendas, Atrair compradores",
		"Pergunta extra":       "Resposta extra",
		"Campo aninhado":       "A, B",
	}

	for question, answer := range expected {
		if byQuestion[question] != answer {
			t.Fatalf("expected %q to be %q, got %q in %#v", question, answer, byQuestion[question], answers)
		}
	}

	for _, hiddenQuestion := range []string{"nome", "email", "whatsapp", "enviado_em", "source_page"} {
		if _, ok := byQuestion[hiddenQuestion]; ok {
			t.Fatalf("did not expect technical/contact field %q in %#v", hiddenQuestion, answers)
		}
	}
}

func TestGenericWebhookReentryAdvancesBoardOrderWithoutResettingStageClock(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read webhook repository: %v", err)
	}
	source := string(raw)
	start := strings.Index(source, `reentry := existingLeadID != ""`)
	if start < 0 {
		t.Fatal("generic webhook reentry branch was not found")
	}
	flow := source[start:]
	end := strings.Index(flow, "\t} else {")
	if end < 0 {
		t.Fatal("generic webhook insert branch was not found")
	}
	update := flow[:end]

	if !strings.Contains(update, "stage_entered_at = case") ||
		!strings.Contains(update, "then stage_entered_at") {
		t.Fatal("generic webhook reentry must preserve stage_entered_at in the same stage")
	}
	if !strings.Contains(update, "board_order_at = now(),") {
		t.Fatal("generic webhook reentry must promote the card even in the same stage")
	}
	if strings.Contains(update, "board_order_at = case") {
		t.Fatal("generic webhook board ordering must not depend on a stage change")
	}
}

func TestGenericWebhookKeepsProviderIdempotencyAheadOfScopedPhoneIdentity(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read webhook repository: %v", err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) receiveLead(")
	if start < 0 {
		t.Fatal("generic webhook intake was not found")
	}
	end := strings.Index(source[start:], "func (repo Repository) resolveWebhookDestination")
	if end < 0 {
		t.Fatal("generic webhook intake boundary was not found")
	}
	intake := source[start : start+end]

	providerLookup := strings.Index(intake, "select lead_id::text, payload = $4::jsonb")
	routingResolution := strings.Index(intake, "distribution.ResolveIntakeDestination(")
	legacyProbe := strings.Index(intake, "legacyWebhookLeadPhoneUniquenessActive")
	phoneLock := strings.Index(intake, "lockWebhookLeadIntakeIdentity")
	phoneLookup := strings.Index(intake, "repo.findExistingLeadByPhoneLegacy")
	if providerLookup < 0 || routingResolution < 0 || legacyProbe < 0 || phoneLock < 0 || phoneLookup < 0 ||
		providerLookup >= routingResolution || routingResolution >= legacyProbe || legacyProbe >= phoneLock || phoneLock >= phoneLookup {
		t.Fatal("provider idempotency and frozen queue routing must run before the rollout-aware phone identity lock and lookup")
	}
	for _, required := range []string{
		"distribution.ResolveIntakeDestination(ctx, tx",
		"distribution.IntakeScopeKey(intakeDestination.RoundRobinID)",
		"if legacyIdentity {",
		"repo.findExistingLeadByPhoneLegacy",
		"repo.findExistingLeadByPhone(ctx",
		"webhookLeadPhoneUniqueViolationConstraint",
		"receiveLeadWithIdentityMode",
		`constraintName == "leads_org_phone_unique"`,
		"intake_scope_key",
		"origin_round_robin_id",
		"RoundRobinID:       intakeDestination.RoundRobinID",
		"RoundRobinResolved: intakeDestination.Resolved",
		"distribution.PreserveAssigneeForIntake(reentry, intakeDestination)",
		"repo.insertLeadTags(ctx, tx, webhook.OrganizationID, leadID, intakeDestination.TagIDs)",
	} {
		if !strings.Contains(intake, required) {
			t.Fatalf("generic webhook scoped identity contract is missing %q", required)
		}
	}

	for _, required := range []string{
		"$1 || ':legacy-global:' || normalize_phone($2)",
		"$1 || ':' || $2 || ':' || normalize_phone($3)",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("generic webhook advisory identity contract is missing %q", required)
		}
	}
}

func TestGenericWebhookPhoneConflictRetryDistinguishesLegacyAndScopedIndexes(t *testing.T) {
	for _, constraintName := range []string{"leads_org_phone_unique", "leads_org_scope_phone_unique"} {
		err := &pgconn.PgError{Code: "23505", ConstraintName: constraintName}
		if got := webhookLeadPhoneUniqueViolationConstraint(err); got != constraintName {
			t.Fatalf("constraint = %q, want %q", got, constraintName)
		}
	}
	if got := webhookLeadPhoneUniqueViolationConstraint(&pgconn.PgError{Code: "23505", ConstraintName: "other_unique"}); got != "" {
		t.Fatalf("unrelated constraint was recognized: %q", got)
	}
}

func TestWebhookProviderEventKeyRequiresExplicitProducerIdentity(t *testing.T) {
	t.Parallel()

	const webhookID = "11111111-1111-4111-8111-111111111111"
	if got := webhookProviderEventKey(webhookID, nil); got != nil {
		t.Fatalf("missing producer identity generated a durable key: %q", *got)
	}
	empty := "   "
	if got := webhookProviderEventKey(webhookID, &empty); got != nil {
		t.Fatalf("blank producer identity generated a durable key: %q", *got)
	}
	providerID := "provider-event-1"
	got := webhookProviderEventKey(webhookID, &providerID)
	if got == nil || *got != webhookID+":"+providerID {
		t.Fatalf("provider key = %v", got)
	}
}

func TestWebhookDistributionKeyUsesLeadEntryWhenProducerIdentityIsAbsent(t *testing.T) {
	t.Parallel()

	const webhookID = "11111111-1111-4111-8111-111111111111"
	const provider = "generic_webhook"
	first := webhookDistributionKey(webhookID, provider, nil, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
	second := webhookDistributionKey(webhookID, provider, nil, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
	if first == second {
		t.Fatalf("distinct lead entries shared distribution key %q", first)
	}

	providerEventKey := webhookID + ":provider-event-1"
	explicitFirst := webhookDistributionKey(webhookID, provider, &providerEventKey, "entry-one")
	explicitRetry := webhookDistributionKey(webhookID, provider, &providerEventKey, "entry-two")
	if explicitFirst != explicitRetry {
		t.Fatalf("explicit producer identity did not keep a stable distribution key: %q != %q", explicitFirst, explicitRetry)
	}
}
