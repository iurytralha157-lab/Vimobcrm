package searchtext

import (
	"strings"
	"testing"
)

func TestNormalizeIgnoresPortugueseAccentsAndCase(t *testing.T) {
	for _, value := range []string{"Márcia", "MARCIA", "marcia"} {
		if got := Normalize(value); got != "marcia" {
			t.Fatalf("Normalize(%q) = %q, want marcia", value, got)
		}
	}
}

func TestPatternAndContainsUseTheSameNormalization(t *testing.T) {
	if got := Pattern("  Márcia  "); got != "%marcia%" {
		t.Fatalf("Pattern() = %q, want %%marcia%%", got)
	}
	if !Contains("Márcia Freitas", "Marcia") || !Contains("Marcia Freitas", "Márcia") {
		t.Fatal("Contains should ignore accents on either side")
	}
}

func TestAnySQLNormalizesEveryExpression(t *testing.T) {
	query := AnySQL([]string{"l.name", "l.email"}, "$2")
	if strings.Count(query, "translate(lower(coalesce(") != 2 {
		t.Fatalf("unexpected normalized query: %s", query)
	}
}
