package webhooks

import (
	"os"
	"strings"
	"testing"
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
