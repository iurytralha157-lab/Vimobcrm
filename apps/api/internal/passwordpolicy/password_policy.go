package passwordpolicy

import (
	"unicode"
	"unicode/utf8"
)

const (
	MinLength = 8
	// MaxBytes mirrors Supabase Auth's bcrypt boundary. Go's len(string)
	// measures UTF-8 bytes, exactly like the upstream Auth check.
	MaxBytes = 72
)

// IsStrong is the authoritative API-side password policy used by account
// creation and password changes. It deliberately preserves the password as
// entered; callers must never trim or normalize password material.
func IsStrong(password string) bool {
	if !utf8.ValidString(password) {
		return false
	}

	length := utf8.RuneCountInString(password)
	if length < MinLength || len(password) > MaxBytes {
		return false
	}

	var hasUpper, hasLower, hasNumber, hasSymbol bool
	for _, character := range password {
		hasUpper = hasUpper || unicode.IsUpper(character)
		hasLower = hasLower || unicode.IsLower(character)
		hasNumber = hasNumber || unicode.IsNumber(character)
		hasSymbol = hasSymbol || unicode.IsPunct(character) || unicode.IsSymbol(character)
	}

	return hasUpper && hasLower && hasNumber && hasSymbol
}
