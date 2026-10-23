package properties

import (
	"errors"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/searchtext"
)

// Public address privacy accepts known aliases and fails closed for old or
// malformed values. Canonical partial/full choices retain their granularity.
func NormalizePublicAddressVisibility(value string) string {
	switch searchtext.Normalize(value) {
	case "completo", "complete", "full":
		return "completo"
	case "parcial", "partial":
		return "parcial"
	default:
		return "minimo"
	}
}

func normalizeAddressVisibilityInput(value any) (any, error) {
	text, ok := value.(string)
	if !ok {
		return nil, errors.New("address visibility must be a known string")
	}
	switch searchtext.Normalize(text) {
	case "completo", "complete", "full", "parcial", "partial",
		"minimo", "minimum", "minimal", "city", "cidade":
		return NormalizePublicAddressVisibility(text), nil
	default:
		return nil, errors.New("address visibility is invalid")
	}
}

// SQL expressions/aliases are source controlled, never request values.
func PublicAddressVisibilitySQL(expression string) string {
	return `case ` + searchtext.SQL("trim("+expression+")") + `
		when 'completo' then 'completo'
		when 'complete' then 'completo'
		when 'full' then 'completo'
		when 'parcial' then 'parcial'
		when 'partial' then 'parcial'
		else 'minimo' end`
}

func PropertyPublicAddressVisibilitySQL(alias string) string {
	return PublicAddressVisibilitySQL(`coalesce(
		nullif(trim(` + alias + `.address_visibility), ''),
		nullif(trim(` + alias + `.public_address_visibility), ''), '')`)
}

// Delivered snapshots may predate canonical privacy markers. Known aliases
// retain the selected granularity; unknown markers never expose exact fields.
func NormalizePublicSnapshotAddressVisibility(value string) string {
	return NormalizePublicAddressVisibility(value)
}

func PublicSnapshotAddressVisibilitySQL(expression string) string {
	return PublicAddressVisibilitySQL(expression)
}
