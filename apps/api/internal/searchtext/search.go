package searchtext

import (
	"fmt"
	"strings"
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
		"translate(lower(coalesce(%s, '')), '%s', '%s')",
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

func Normalize(value string) string {
	return asciiReplacer.Replace(strings.ToLower(strings.TrimSpace(value)))
}

func Pattern(value string) string {
	return "%" + Normalize(value) + "%"
}

func Contains(value string, query string) bool {
	return strings.Contains(Normalize(value), Normalize(query))
}
