package admin

import (
	"strings"
	"unicode/utf8"
)

const (
	onboardingCompanyNameMinLength = 2
	onboardingCompanyNameMaxLength = 160
	onboardingAdminNameMinLength   = 2
	onboardingAdminNameMaxLength   = 140
	onboardingEmailMaxLength       = 180
	onboardingPasswordMinLength    = 8
	onboardingPasswordMaxLength    = 128
	onboardingBrokersMin           = 1
	onboardingBrokersMax           = 500
)

var onboardingPhoneDigitsByCountryCode = map[string]int{
	"+55":  11,
	"+1":   10,
	"+351": 9,
	"+54":  10,
	"+56":  9,
	"+598": 8,
	"+595": 9,
}

func validatePublicOnboardingSignupRequest(request OnboardingSignupRequest) (OnboardingSignupRequest, error) {
	attemptID, validAttemptID := normalizeUUID(request.AttemptID)
	if !validAttemptID {
		return OnboardingSignupRequest{}, ErrInvalidInput
	}
	request.AttemptID = attemptID
	request.CompanyName = strings.TrimSpace(request.CompanyName)
	request.AdminName = strings.TrimSpace(request.AdminName)
	rawDocumentNumber := strings.TrimSpace(request.DocumentNumber)
	if !hasOnlyBrazilianTaxIDCharacters(rawDocumentNumber) {
		return OnboardingSignupRequest{}, ErrInvalidInput
	}
	request.DocumentNumber = normalizeBrazilianTaxID(request.DocumentNumber)
	request.PhoneCountryCode = strings.TrimSpace(request.PhoneCountryCode)
	request.Phone = strings.TrimSpace(request.Phone)
	request.TermsVersion = strings.TrimSpace(request.TermsVersion)
	request.PrivacyVersion = strings.TrimSpace(request.PrivacyVersion)

	email, err := normalizeEmail(request.Email)
	if err != nil {
		return OnboardingSignupRequest{}, ErrInvalidInput
	}
	request.Email = email

	companyNameLength := utf8.RuneCountInString(request.CompanyName)
	adminNameLength := utf8.RuneCountInString(request.AdminName)
	passwordLength := utf8.RuneCountInString(request.Password)
	if !utf8.ValidString(request.CompanyName) ||
		companyNameLength < onboardingCompanyNameMinLength ||
		companyNameLength > onboardingCompanyNameMaxLength ||
		!utf8.ValidString(request.AdminName) ||
		adminNameLength < onboardingAdminNameMinLength ||
		adminNameLength > onboardingAdminNameMaxLength ||
		utf8.RuneCountInString(request.Email) > onboardingEmailMaxLength ||
		passwordLength < onboardingPasswordMinLength ||
		passwordLength > onboardingPasswordMaxLength ||
		request.BrokersCount < onboardingBrokersMin ||
		request.BrokersCount > onboardingBrokersMax ||
		!isValidBrazilianTaxID(request.DocumentNumber) ||
		!isValidOnboardingPhone(request.PhoneCountryCode, request.Phone) ||
		!request.TermsAccepted ||
		!request.PrivacyAccepted ||
		request.TermsVersion != currentTermsVersion ||
		request.PrivacyVersion != currentPrivacyVersion {
		return OnboardingSignupRequest{}, ErrInvalidInput
	}

	return request, nil
}

func normalizeBrazilianTaxID(value string) string {
	return onlyDigitsAdmin(value)
}

func hasOnlyBrazilianTaxIDCharacters(value string) bool {
	if value == "" {
		return false
	}
	for _, character := range value {
		if (character >= '0' && character <= '9') || character == '.' || character == '/' ||
			character == '-' || character == ' ' || character == '\t' || character == '\n' || character == '\r' {
			continue
		}
		return false
	}
	return true
}

func isValidBrazilianTaxID(value string) bool {
	digits := normalizeBrazilianTaxID(value)
	switch len(digits) {
	case 11:
		return isValidCPF(digits)
	case 14:
		return isValidCNPJ(digits)
	default:
		return false
	}
}

func isValidCPF(value string) bool {
	if len(value) != 11 || hasRepeatedDigits(value) {
		return false
	}

	calculateDigit := func(length int) byte {
		sum := 0
		for index := 0; index < length; index++ {
			sum += int(value[index]-'0') * (length + 1 - index)
		}
		remainder := (sum * 10) % 11
		if remainder == 10 {
			return 0
		}
		return byte(remainder)
	}

	return calculateDigit(9) == value[9]-'0' && calculateDigit(10) == value[10]-'0'
}

func isValidCNPJ(value string) bool {
	if len(value) != 14 || hasRepeatedDigits(value) {
		return false
	}

	calculateDigit := func(base string, weights []int) byte {
		sum := 0
		for index := range base {
			sum += int(base[index]-'0') * weights[index]
		}
		remainder := sum % 11
		if remainder < 2 {
			return 0
		}
		return byte(11 - remainder)
	}

	first := calculateDigit(value[:12], []int{5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2})
	secondBase := value[:12] + string([]byte{first + '0'})
	second := calculateDigit(secondBase, []int{6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2})
	return first == value[12]-'0' && second == value[13]-'0'
}

func hasRepeatedDigits(value string) bool {
	for index := 1; index < len(value); index++ {
		if value[index] != value[0] {
			return false
		}
	}
	return true
}

func isValidOnboardingPhone(countryCode string, phone string) bool {
	expectedDigits, allowedCountry := onboardingPhoneDigitsByCountryCode[countryCode]
	if !allowedCountry || phone == "" {
		return false
	}

	for _, character := range phone {
		if (character >= '0' && character <= '9') || character == ' ' || character == '\t' ||
			character == '\n' || character == '\r' || character == '(' || character == ')' || character == '-' {
			continue
		}
		return false
	}

	return len(onlyDigitsAdmin(phone)) == expectedDigits
}
