package leads

import (
	"strings"
	"testing"
)

func TestCustomWhatsAppBillingTemplateCannotOmitCheckoutLink(t *testing.T) {
	checkoutURL := "https://app.vimobcrm.com.br/checkout/0123456789abcdef"
	message := buildWhatsAppNotificationText(
		"billing_due_today",
		"Sua assinatura vence hoje",
		"Conteudo padrao",
		map[string]any{
			"__rendered_whatsapp_message": "Template personalizado sem a acao.",
			"billing_url":                 checkoutURL,
		},
	)

	if !strings.Contains(message, checkoutURL) {
		t.Fatalf("custom actionable billing template must include the canonical checkout link, got %q", message)
	}
}

func TestCustomWhatsAppBillingTemplateDoesNotDuplicateCheckoutLink(t *testing.T) {
	checkoutURL := "https://app.vimobcrm.com.br/checkout/0123456789abcdef"
	message := buildWhatsAppNotificationText(
		"billing_overdue_1_day",
		"Pagamento em atraso",
		"Conteudo padrao",
		map[string]any{
			"__rendered_whatsapp_message": "Pague aqui: " + checkoutURL,
			"billing_url":                 checkoutURL,
		},
	)

	if occurrences := strings.Count(message, checkoutURL); occurrences != 1 {
		t.Fatalf("canonical checkout link must appear exactly once, got %d in %q", occurrences, message)
	}
}

func TestTerminalWhatsAppBillingTemplateDoesNotGainPaymentAction(t *testing.T) {
	detailURL := "https://app.vimobcrm.com.br/settings?tab=subscription&billing=payments"
	message := buildWhatsAppNotificationText(
		"billing_payment_cancelled",
		"Cobranca cancelada",
		"Conteudo padrao",
		map[string]any{
			"__rendered_whatsapp_message": "A cobranca foi cancelada.",
			"billing_url":                 detailURL,
		},
	)

	if strings.Contains(message, detailURL) {
		t.Fatalf("terminal billing template must not be converted into a payment action, got %q", message)
	}
}
