package searchtext

import (
	"fmt"
	"strings"
)

// PhoneDigits enables the digit fallback only for phone-shaped input. Mixed
// text/email queries keep their literal semantics; short numbers stay textual.
func PhoneDigits(query string) string {
	var digits strings.Builder
	for _, character := range query {
		switch {
		case character >= '0' && character <= '9':
			digits.WriteRune(character)
		case strings.ContainsRune(" +-().\t\r\n", character):
		default:
			return ""
		}
	}
	if digits.Len() < 4 {
		return ""
	}
	return digits.String()
}

// PhoneSQL receives source-controlled SQL expressions and bound placeholders.
func PhoneSQL(expression, placeholder string) string {
	return fmt.Sprintf("regexp_replace(coalesce(%s, ''), '[^0-9]', '', 'g') like %s", expression, placeholder)
}
