package whatsapp

import "strings"

// WhatsApp PN values already include a country calling code. Preserve that
// intent at lead RPC boundaries, where bare 10/11-digit values default to BR.
// Brazilian storage stays compatible; conversation JIDs and phones are unchanged.
func leadPhoneFromWhatsAppPN(phone string) string {
	if phone == "" || strings.HasPrefix(phone, "55") || strings.HasPrefix(phone, "+") {
		return phone
	}
	return "+" + phone
}
