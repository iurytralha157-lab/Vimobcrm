package webhooks

import (
	"context"
	"errors"
	"math"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
)

func TestMappedPayloadPhonePreservesJSONNumberDigits(t *testing.T) {
	for _, test := range []struct {
		name    string
		body    string
		mapping map[string]string
		want    string
	}{
		{name: "country code", body: `{"phone":5511987654321}`, want: "5511987654321"},
		{name: "local phone", body: `{"telefone":11987654321}`, want: "11987654321"},
		{name: "mapped field", body: `{"celular":5511987654321,"phone":"11900000000"}`, mapping: map[string]string{"phone": "celular"}, want: "5511987654321"},
		{name: "explicit exponent", body: `{"whatsapp":5.511987654321e12}`, want: "5511987654321"},
		{name: "maximum digit count", body: `{"phone":999999999999999}`, want: "999999999999999"},
		{name: "string preserved", body: `{"phone":" +55 (11) 98765-4321 "}`, want: "+55 (11) 98765-4321"},
		{name: "empty mapping fallback", body: `{"celular":" ","phone":5511987654321}`, mapping: map[string]string{"phone": "celular"}, want: "5511987654321"},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest("POST", "/", strings.NewReader(test.body))
			payload, ok := httpserver.DecodeJSONMap(httptest.NewRecorder(), request, 1024)
			if !ok {
				t.Fatal("valid JSON rejected")
			}
			phone, err := mappedPayloadPhone(incomingWebhook{FieldMapping: test.mapping}, payload)
			if err != nil || phone == nil || *phone != test.want {
				t.Fatalf("phone = %v (%v), want %q", phoneValue(phone), err, test.want)
			}
		})
	}
}

func TestMappedPayloadPhoneRejectsInvalidJSONNumbers(t *testing.T) {
	for _, value := range []float64{5511987654321.5, -5511987654321, 0, 1000000000000000, math.NaN(), math.Inf(1), math.Inf(-1)} {
		phone, err := mappedPayloadPhone(incomingWebhook{}, map[string]any{"phone": value, "telefone": "11900000000"})
		if !errors.Is(err, ErrInvalidInput) || phone != nil {
			t.Errorf("numeric phone %v must fail without fallback, got %v, %v", value, phoneValue(phone), err)
		}
	}
}

func TestMappedPayloadPhoneKeepsMissingContactOptional(t *testing.T) {
	phone, err := mappedPayloadPhone(incomingWebhook{}, map[string]any{"name": "Cliente Sintetico"})
	if err != nil || phone != nil {
		t.Fatalf("missing contact changed: %v, %v", phoneValue(phone), err)
	}
}

func TestIncomingLeadRejectsFractionalPhoneBeforePersistence(t *testing.T) {
	// A repository without a database is intentional: invalid contact data must
	// be rejected before opening a transaction or reaching distribution.
	_, err := (Repository{}).receiveLeadWithIdentityMode(context.Background(), incomingWebhook{
		FieldMapping: map[string]string{"phone": "celular"},
	}, map[string]any{
		"name": "Cliente Sintetico", "celular": float64(5511987654321.5), "phone": "11900000000",
	}, leadIngressOptions{Source: "webhook", Provider: "generic_webhook"}, nil)
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("fractional phone should stop intake before persistence: %v", err)
	}
}

func phoneValue(phone *string) string {
	if phone == nil {
		return "<nil>"
	}
	return *phone
}
