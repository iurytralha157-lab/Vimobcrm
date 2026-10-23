package meta

import (
	"regexp"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/phonenumber"
)

var metaPhoneContactLabel = regexp.MustCompile(`(?i)^(?:tel|cel|telefone|celular|whatsapp)[.:]\s*`)

func canonicalizeMetaPhoneContact(value string) (string, error) {
	// Some mapped Meta answers include a contact label. Remove only one known
	// leading label with punctuation; extensions, prose and multiple numbers
	// must still fail the shared structural validation.
	value = metaPhoneContactLabel.ReplaceAllString(strings.TrimSpace(value), "")
	return phonenumber.Canonicalize(value)
}
