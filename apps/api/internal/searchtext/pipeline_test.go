package searchtext

import (
	"strings"
	"testing"
)

func TestPipelineNormalizeMatchesBrowserUnicodeContract(t *testing.T) {
	for _, item := range []struct{ value, want string }{
		{"Åsa", "asa"}, {"Černý", "cerny"}, {" MÁRCIA ", "marcia"},
		{"Jose\u0301", "jose"}, {"𝓜𝓪𝓻𝓲𝓵𝓲𝓪", "marilia"}, {"Ｍárcia", "marcia"},
		{"ΟΣ", "ος"}, {"ΟΣΑ", "οσα"}, {"Σ", "σ"}, {"ος", "ος"}, {"οσ", "οσ"},
		{"ΟΣ\u0301", "ος"}, {"İ", "i"}, {"Łukasz", "łukasz"}, {"Straße", "straße"},
		{"👩🏽‍💻 Ana", "👩🏽‍💻 ana"}, {"李明", "李明"}, {"Ана", "ана"},
		{"\ufeff Åsa \ufeff", "asa"}, {"\u0085Asa\u0085", "\u0085asa\u0085"},
	} {
		t.Run(item.value, func(t *testing.T) {
			if got := PipelineNormalize(item.value); got != item.want {
				t.Fatalf("PipelineNormalize(%q)=%q, want %q", item.value, got, item.want)
			}
		})
	}
}

func TestPipelineTrimUsesECMAScriptWhitespaceWithoutErasingContent(t *testing.T) {
	for _, item := range []struct{ value, want string }{
		{"\ufeff \t\r\nAsa\u00a0\ufeff", "Asa"}, {"\ufeff", ""},
		{"\u1680\u2000\u200aAsa\u2028\u2029\u202f\u205f\u3000", "Asa"},
		{"\u0085Asa\u0085", "\u0085Asa\u0085"},
		{"\u200bAsa\u200b", "\u200bAsa\u200b"}, {"A\ufeffsa", "A\ufeffsa"},
		{"A\x00sa", "A\x00sa"},
	} {
		if got := PipelineTrim(item.value); got != item.want {
			t.Fatalf("PipelineTrim(%q)=%q, want %q", item.value, got, item.want)
		}
	}
}

func TestPipelinePatternRemainsLiteralAndScoped(t *testing.T) {
	for _, item := range []struct{ query, want string }{
		{"\ufeffΟΣ\ufeff", "%ος%"}, {"Åsa_100%", `%asa\_100\%%`},
		{`C:\folder`, `%c:\\folder%`}, {"%' OR 1=1 --", `%\%' or 1=1 --%`},
	} {
		if got := PipelinePattern(item.query); got != item.want {
			t.Fatalf("PipelinePattern(%q)=%q, want %q", item.query, got, item.want)
		}
	}
	// The Pipeline fix must not silently change another screen's helpers.
	if Normalize("Åsa") != "åsa" || Normalize("ΟΣ") != "οσ" ||
		Pattern("\ufeffAsa\ufeff") != "%\ufeffasa\ufeff%" || PhoneDigits("１２３４") != "" {
		t.Fatal("the generic normalization/phone contract changed outside Pipeline")
	}
	if !strings.Contains(SQL("l.name"), "NFKC") ||
		PhoneSQL("l.phone", "$2") != "regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g') like $2" {
		t.Fatal("the generic SQL contract changed outside Pipeline")
	}
}

func TestPipelinePhoneDigitsNormalizeCompatibilityButKeepThePhoneGate(t *testing.T) {
	for _, item := range []struct{ query, want string }{
		{"（１１）９９９９９－８８８８", "11999998888"}, {"＋５５（１１）９９９９９－８８８８", "5511999998888"},
		{"\ufeff１２３４\ufeff", "1234"}, {"12.34", "1234"}, {"１２３", ""},
		{"Lote １２３４", ""}, {"abc1234", ""}, {"name12@example.invalid", ""},
		{"１２_３４", ""}, {"１２%３４", ""}, {"١٢٣٤", ""}, {"+()", ""},
	} {
		if got := PipelinePhoneDigits(item.query); got != item.want {
			t.Fatalf("PipelinePhoneDigits(%q)=%q, want %q", item.query, got, item.want)
		}
	}
}

func TestPipelineSearchSQLKeepsBoundParametersAndExplicitCollations(t *testing.T) {
	query := PipelineAnySQL([]string{"l.name", "l.phone", "l.email"}, "$7")
	for _, expression := range []string{"l.name", "l.phone", "l.email"} {
		if !strings.Contains(query, expression) {
			t.Fatalf("search omitted %s", expression)
		}
	}
	if strings.Count(query, " like $7") != 3 || !strings.HasPrefix(query, "(") || !strings.HasSuffix(query, ")") {
		t.Fatalf("search must group all three bound alternatives: %s", query)
	}
	if !strings.Contains(query, `pg_catalog."und-x-icu"`) || !strings.Contains(strings.ToLower(query), `collate pg_catalog."c"`) {
		t.Fatalf("Pipeline search depends on database default collation: %s", query)
	}
	phone := PipelinePhoneSQL("l.phone", "$8")
	if !strings.Contains(phone, "NFKD") || !strings.Contains(phone, "regexp_replace(") ||
		!strings.Contains(phone, "like $8") || strings.Contains(phone, "11999998888") {
		t.Fatalf("phone must normalize the stored value and bind the pattern: %s", phone)
	}
}
