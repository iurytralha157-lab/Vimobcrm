package settings

import (
	"strings"
	"testing"
)

func TestNormalizeAPIKeyNameUsesBoundedUnicodeNames(t *testing.T) {
	if got, ok := normalizeAPIKeyName("   "); !ok || got != "Chave Padrao" {
		t.Fatalf("blank API key name = %q, %v", got, ok)
	}
	if got, ok := normalizeAPIKeyName(" Integração ERP "); !ok || got != "Integração ERP" {
		t.Fatalf("trimmed API key name = %q, %v", got, ok)
	}
	if _, ok := normalizeAPIKeyName(strings.Repeat("á", 80)); !ok {
		t.Fatal("80-rune API key name should be accepted")
	}
	if _, ok := normalizeAPIKeyName(strings.Repeat("á", 81)); ok {
		t.Fatal("81-rune API key name should be rejected")
	}
}
