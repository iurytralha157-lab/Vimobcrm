package phonenumber

import (
	"errors"
	"strings"
	"unicode"
)

const (
	defaultCountryCallingCode = "55"
	minE164Digits             = 8
	maxE164Digits             = 15
)

var ErrInvalid = errors.New("invalid phone number")

// Canonicalize converts a structurally valid phone number to E.164. A leading
// + or 00 marks an explicit international number. Unprefixed 10- or 11-digit
// numbers keep the product's Brazilian default. Other unprefixed values are
// accepted as country-inclusive only when they contain 12 to 15 digits, which
// avoids treating a local 8- or 9-digit number without DDD as international.
func Canonicalize(value string) (string, error) {
	raw := strings.TrimSpace(value)
	if raw == "" {
		return "", nil
	}

	explicitInternational := false
	switch {
	case strings.HasPrefix(raw, "+"):
		explicitInternational = true
		raw = strings.TrimSpace(strings.TrimPrefix(raw, "+"))
	case strings.HasPrefix(raw, "00"):
		explicitInternational = true
		raw = strings.TrimSpace(raw[2:])
	}

	digits, err := structuralDigits(raw)
	if err != nil {
		return "", err
	}
	if !explicitInternational {
		switch {
		case len(digits) == 10 || len(digits) == 11:
			digits = defaultCountryCallingCode + digits
		case len(digits) < 12 || len(digits) > maxE164Digits:
			return "", ErrInvalid
		}
	}
	if len(digits) < minE164Digits || len(digits) > maxE164Digits || digits[0] == '0' {
		return "", ErrInvalid
	}

	return "+" + digits, nil
}

func structuralDigits(value string) (string, error) {
	var digits strings.Builder
	parenthesisDepth := 0

	for _, character := range value {
		switch {
		case character >= '0' && character <= '9':
			digits.WriteRune(character)
		case unicode.IsSpace(character), character == '-', character == '.':
			continue
		case character == '(':
			if parenthesisDepth != 0 {
				return "", ErrInvalid
			}
			parenthesisDepth = 1
		case character == ')':
			if parenthesisDepth != 1 {
				return "", ErrInvalid
			}
			parenthesisDepth = 0
		default:
			return "", ErrInvalid
		}
	}

	if parenthesisDepth != 0 || digits.Len() == 0 {
		return "", ErrInvalid
	}
	return digits.String(), nil
}
