package searchtext

import (
	"fmt"
	"strings"

	"golang.org/x/text/cases"
	"golang.org/x/text/language"
	"golang.org/x/text/unicode/norm"
)

const accentedCharacters = "áàâãäéèêëíìîïóòôõöúùûüçñ"
const asciiCharacters = "aaaaaeeeeiiiiooooouuuucn"

var asciiReplacer = strings.NewReplacer(
	"á", "a", "à", "a", "â", "a", "ã", "a", "ä", "a",
	"é", "e", "è", "e", "ê", "e", "ë", "e",
	"í", "i", "ì", "i", "î", "i", "ï", "i",
	"ó", "o", "ò", "o", "ô", "o", "õ", "o", "ö", "o",
	"ú", "u", "ù", "u", "û", "u", "ü", "u",
	"ç", "c", "ñ", "n",
)

// SQL normalizes a trusted SQL expression for case- and accent-insensitive matching.
func SQL(expression string) string {
	return fmt.Sprintf(
		"translate(lower(normalize(coalesce(%s, ''), NFKC)), '%s', '%s')",
		expression,
		accentedCharacters,
		asciiCharacters,
	)
}

func AnySQL(expressions []string, placeholder string) string {
	clauses := make([]string, 0, len(expressions))
	for _, expression := range expressions {
		clauses = append(clauses, SQL(expression)+" like "+placeholder)
	}
	return "(" + strings.Join(clauses, " or ") + ")"
}

// PipelineTrim uses ECMAScript WhiteSpace/LineTerminator characters, including
// BOM but not U+0085. Other domains keep their existing trim semantics.
func PipelineTrim(value string) string {
	return strings.Trim(value, "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff")
}

// PipelineNormalize mirrors the browser's NFKD, mark removal and pt-BR lower
// casing, including contextual forms such as Greek final sigma.
func PipelineNormalize(value string) string {
	decomposed := norm.NFKD.String(value)
	withoutCombiningMarks := strings.Map(func(character rune) rune {
		if character >= '\u0300' && character <= '\u036f' {
			return -1
		}
		return character
	}, decomposed)
	// Casers may carry state: each call owns its instance, including concurrent
	// requests. The module is already a dependency; no shared Caser is retained.
	return PipelineTrim(cases.Lower(language.BrazilianPortuguese).String(withoutCombiningMarks))
}

func PipelinePattern(value string) string {
	// Keep search literal: LIKE metacharacters are escaped before binding.
	return "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(PipelineNormalize(value)) + "%"
}

// PipelineSQL removes marks before contextual lower casing, just like the
// browser. PostgreSQL 17's ICU root collation makes that rule independent of
// the database's default locale. The final C collation keeps LIKE literal.
// Only source-controlled SQL expressions may be passed here.
func PipelineSQL(expression string) string {
	var combiningMarks strings.Builder
	for character := rune('\u0300'); character <= '\u036f'; character++ {
		combiningMarks.WriteRune(character)
	}
	return fmt.Sprintf(
		"(lower(translate(normalize(coalesce(%s, ''), NFKD), '%s', '') collate pg_catalog.\"und-x-icu\") collate pg_catalog.\"C\")",
		expression,
		combiningMarks.String(),
	)
}

// PipelinePhoneDigits normalizes compatibility digits and formatting before
// applying the shared phone-shaped-input and four-digit minimum restrictions.
func PipelinePhoneDigits(query string) string {
	return PhoneDigits(PipelineNormalize(query))
}

func PipelinePhoneSQL(expression, placeholder string) string {
	return PhoneSQL(PipelineSQL(expression), placeholder)
}

func PipelineAnySQL(expressions []string, placeholder string) string {
	clauses := make([]string, 0, len(expressions))
	for _, expression := range expressions {
		clauses = append(clauses, PipelineSQL(expression)+" like "+placeholder)
	}
	return "(" + strings.Join(clauses, " or ") + ")"
}

func Normalize(value string) string {
	return asciiReplacer.Replace(strings.ToLower(strings.TrimSpace(norm.NFKC.String(value))))
}

func Pattern(value string) string {
	// PostgreSQL LIKE treats %, _ and backslash as pattern syntax. Search is
	// literal, matching Contains and the browser's substring search.
	return "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(Normalize(value)) + "%"
}

func Contains(value string, query string) bool {
	return strings.Contains(Normalize(value), Normalize(query))
}
