package leads

import "github.com/vimob-crm/vimob-crm/apps/api/internal/searchtext"

// Only a phone-shaped query receives the digit fallback. Text/email searches
// retain their literal matching semantics and do not become a broad digit OR.
func contactPhoneSearchDigits(search string) string {
	return searchtext.PhoneDigits(search)
}
