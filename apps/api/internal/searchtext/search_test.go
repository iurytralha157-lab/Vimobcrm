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
	if strings.Count(query, "translate(lower(normalize(coalesce(") != 2 {
		t.Fatalf("unexpected normalized query: %s", query)
	}
}

func TestDecorativeNamesNormalizeForSearchWithoutChangingOtherAlphabets(t *testing.T) {
	for value, want := range map[string]string{
		"𝓐𝓷𝓪 𝓢𝓲𝓵𝓿𝓪": "ana silva", "Ｍárcia": "marcia",
		"José": "jose", "Jose\u0301": "jose", "👩🏽‍💻 Ana": "👩🏽‍💻 ana",
		"李明": "李明", "أحمد علي": "أحمد علي", "Ана Иванова": "ана иванова",
	} {
		if got := Normalize(value); got != want {
			t.Fatalf("Normalize(%q)=%q, want %q", value, got, want)
		}
	}
	if !Contains("𝓐𝓷𝓪 𝓢𝓲𝓵𝓿𝓪", "Ana Silva") || !Contains("Ana Silva", "𝓐𝓷𝓪") {
		t.Fatal("compatibility search must match both directions")
	}
}

func TestLiteralSearchEscapesLikePatternCharacters(t *testing.T) {
	for value, want := range map[string]string{
		"%": `%\%%`, "_": `%\_%`, `C:\folder`: `%c:\\folder%`,
		"Márcia_100%": `%marcia\_100\%%`,
	} {
		if got := Pattern(value); got != want {
			t.Fatalf("Pattern(%q) = %q, want %q", value, got, want)
		}
	}
	if Contains("plain name", "%") || !Contains("100% completed", "%") {
		t.Fatal("browser substring semantics changed")
	}
}
