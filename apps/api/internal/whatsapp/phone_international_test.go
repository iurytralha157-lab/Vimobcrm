package whatsapp

import (
	"os"
	"strings"
	"testing"
)

func TestFormatPhoneForWhatsAppPreservesInternationalCountryCode(t *testing.T) {
	tests := map[string]string{
		"+1 (415) 555-2671":  "14155552671",
		"00 351 912 345 678": "351912345678",
		"(11) 99999-9999":    "5511999999999",
	}

	for input, want := range tests {
		if got := formatPhoneForWhatsApp(input); got != want {
			t.Fatalf("formatPhoneForWhatsApp(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestInternationalPhoneVariantsDoNotCreateBrazilianAliases(t *testing.T) {
	variants := phoneVariants("+1 (415) 555-2671")
	if len(variants) != 1 || variants[0] != "+14155552671" {
		t.Fatalf("phoneVariants() = %#v, want only the explicit canonical international phone", variants)
	}
	for _, variant := range variants {
		if strings.HasPrefix(variant, "55") || strings.HasPrefix(variant, "+55") {
			t.Fatalf("phoneVariants() created Brazilian alias for international phone: %#v", variants)
		}
	}
}

func TestInternationalWhatsAppJIDUsesItsExistingCountryCode(t *testing.T) {
	variants := phoneVariants("14155552671@s.whatsapp.net")
	if len(variants) != 1 || variants[0] != "+14155552671" {
		t.Fatalf("phoneVariants() = %#v, want the explicit JID country-inclusive phone", variants)
	}
}

func TestInternationalPhoneCandidateKeepsPrefixUntilSQLNormalization(t *testing.T) {
	candidates := phoneMatchCandidates("+1 (415) 555-2671")
	if len(candidates) != 1 || candidates[0] != "+14155552671" {
		t.Fatalf("phoneMatchCandidates() = %#v, want explicit E.164", candidates)
	}

	source, err := os.ReadFile("lead_matching.go")
	if err != nil {
		t.Fatalf("read lead_matching.go: %v", err)
	}
	if !strings.Contains(string(source), "normalize_phone(candidate.value)") {
		t.Fatal("lead matching must pass candidates through normalize_phone in SQL")
	}
}

func TestWhatsAppPhoneValidationUsesE164Structure(t *testing.T) {
	if !isValidWhatsAppPhone("+800 12345") {
		t.Fatal("8-digit E.164 phone should be valid")
	}
	if isValidWhatsAppPhone("+1 415 CALL-NOW") {
		t.Fatal("alphabetic phone must be rejected")
	}
}
