package webhooks

import "testing"

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
