package whatsapp

import (
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// isWhatsAppPostFormFollowUp recognizes the known, structured Meta post-form
// message. It is a content classifier, not proof of a form submission or form ID.
// Keep it conservative: a quoted template, a casual mention of a form, or the
// introductory sentence alone must not suppress ordinary lead intake.
func isWhatsAppPostFormFollowUp(content string) bool {
	content = strings.ReplaceAll(content, "\r\n", "\n")
	content = strings.ReplaceAll(content, "\r", "\n")
	lines := strings.Split(strings.TrimSpace(content), "\n")

	firstField := -1
	for index, line := range lines {
		if strings.Contains(line, ":") {
			firstField = index
			break
		}
	}
	if firstField <= 0 {
		return false
	}

	intro := normalizeWhatsAppPostFormText(strings.Join(lines[:firstField], " "))
	switch intro {
	case "ola! preenchi seu formulario e gostaria de saber mais sobre sua empresa.",
		"hi! i filled out your form and would like to learn more about your business.":
	default:
		return false
	}

	var fullName, phoneNumber bool
	for _, line := range lines[firstField:] {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		label, value, structured := strings.Cut(line, ":")
		if !structured || strings.TrimSpace(label) == "" || strings.TrimSpace(value) == "" {
			return false
		}
		switch normalizeWhatsAppPostFormText(label) {
		case "full name", "nome completo":
			if fullName {
				return false
			}
			fullName = true
		case "phone number", "numero de telefone":
			if phoneNumber {
				return false
			}
			phoneNumber = true
		}
	}

	return fullName && phoneNumber
}

func normalizeWhatsAppPostFormText(value string) string {
	decomposed := norm.NFD.String(value)
	withoutAccents := strings.Map(func(character rune) rune {
		if unicode.Is(unicode.Mn, character) {
			return -1
		}
		return unicode.ToLower(character)
	}, decomposed)
	return strings.Join(strings.Fields(withoutAccents), " ")
}
