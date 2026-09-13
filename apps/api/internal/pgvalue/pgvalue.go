// Package pgvalue contains the small, policy-named conversions shared by
// repositories that read PostgreSQL values through pgx.
package pgvalue

import (
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
)

func NormalizeUUID(value string) (string, bool) {
	var uuid pgtype.UUID
	if err := uuid.Scan(strings.TrimSpace(value)); err != nil || !uuid.Valid {
		return "", false
	}
	return uuid.String(), true
}

// TextPointer preserves a valid PostgreSQL text value exactly, including an
// empty string. Callers that treat blank text as NULL must use a policy-specific
// helper below.
func TextPointer(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	result := value.String
	return &result
}

// TextPointerNonEmpty maps only the exact empty string to nil and preserves
// whitespace-only values.
func TextPointerNonEmpty(value pgtype.Text) *string {
	if !value.Valid || value.String == "" {
		return nil
	}
	result := value.String
	return &result
}

// TextPointerNonBlank maps empty and whitespace-only values to nil while
// preserving the original non-blank text.
func TextPointerNonBlank(value pgtype.Text) *string {
	if !value.Valid || strings.TrimSpace(value.String) == "" {
		return nil
	}
	result := value.String
	return &result
}

// TextPointerTrimmed maps blank values to nil and returns trimmed non-blank
// text.
func TextPointerTrimmed(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	result := strings.TrimSpace(value.String)
	if result == "" {
		return nil
	}
	return &result
}

// NullableString creates a SQL argument that maps blank text to NULL while
// preserving the original non-blank value.
func NullableString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

// NullableTrimmedString maps blank text to NULL and trims non-blank values.
func NullableTrimmedString(value string) any {
	result := strings.TrimSpace(value)
	if result == "" {
		return nil
	}
	return result
}

// NullableStringPointer maps only a nil pointer to NULL and otherwise
// preserves the pointed-to value, including an empty string.
func NullableStringPointer(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

// NullableTrimmedStringPointer maps nil or blank text to NULL and trims the
// returned non-blank SQL argument.
func NullableTrimmedStringPointer(value *string) any {
	if value == nil {
		return nil
	}
	return NullableTrimmedString(*value)
}
