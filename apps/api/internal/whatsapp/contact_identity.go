package whatsapp

import "strings"

type whatsappContactIdentity struct {
	RemoteJID       string
	ContactPhone    string
	IsGroup         bool
	remoteAliases   []string
	phoneCandidates []string
}

func newWhatsAppContactIdentity(phone string, remoteJID string, forceGroup bool) whatsappContactIdentity {
	values := []string{remoteJID, phone}

	if groupJID := firstGroupJID(values, forceGroup); groupJID != "" {
		return whatsappContactIdentity{
			RemoteJID:     groupJID,
			IsGroup:       true,
			remoteAliases: uniqueStrings(append([]string{groupJID}, values...)...),
		}
	}

	contactPhone := ""
	aliases := []string{}
	for _, value := range values {
		if normalized := normalizeRemoteAlias(value); normalized != "" {
			aliases = append(aliases, normalized)
		}
		if contactPhone == "" {
			if candidate, ok := phoneFromIdentityValue(value); ok {
				contactPhone = candidate
			}
		}
	}

	remote := strings.TrimSpace(remoteJID)
	if contactPhone != "" {
		remote = contactPhone + "@s.whatsapp.net"
		aliases = append(aliases, remote, contactPhone+"@c.us")
	} else if remote == "" {
		remote = strings.TrimSpace(phone)
	}

	return whatsappContactIdentity{
		RemoteJID:       remote,
		ContactPhone:    contactPhone,
		IsGroup:         false,
		remoteAliases:   uniqueStrings(aliases...),
		phoneCandidates: phoneMatchCandidates(contactPhone, phone, remoteJID),
	}
}

func (identity whatsappContactIdentity) RemoteAliases() []string {
	return uniqueStrings(append([]string{identity.RemoteJID}, identity.remoteAliases...)...)
}

func (identity whatsappContactIdentity) LeadMatchValues() []string {
	values := append(append([]string{identity.ContactPhone, identity.RemoteJID}, withoutOpaqueAliases(identity.remoteAliases)...), identity.phoneCandidates...)
	return uniqueStrings(values...)
}

func (identity whatsappContactIdentity) ConversationMatchValues() []string {
	return uniqueStrings(append(append([]string{identity.RemoteJID, identity.ContactPhone}, identity.remoteAliases...), identity.phoneCandidates...)...)
}

func firstGroupJID(values []string, forceGroup bool) string {
	for _, value := range values {
		raw := strings.TrimSpace(value)
		if raw == "" {
			continue
		}
		lower := strings.ToLower(raw)
		if !forceGroup && !strings.Contains(lower, "@g.us") {
			continue
		}
		left := raw
		if at := strings.Index(raw, "@"); at >= 0 {
			left = raw[:at]
		}
		if digits := normalizeDigits(left); digits != "" {
			return digits + "@g.us"
		}
		if strings.Contains(lower, "@g.us") {
			return lower
		}
	}
	return ""
}

func normalizeRemoteAlias(value string) string {
	raw := strings.TrimSpace(value)
	if raw == "" {
		return ""
	}
	lower := strings.ToLower(raw)
	if at := strings.Index(lower, "@"); at >= 0 {
		left := raw[:at]
		domain := lower[at+1:]
		if colon := strings.Index(left, ":"); colon >= 0 {
			left = left[:colon]
		}
		if digits := normalizeDigits(left); digits != "" {
			return digits + "@" + domain
		}
		return lower
	}
	if digits := normalizeDigits(raw); digits != "" {
		return digits
	}
	return raw
}

func phoneFromIdentityValue(value string) (string, bool) {
	raw := strings.TrimSpace(value)
	if raw == "" {
		return "", false
	}
	lower := strings.ToLower(raw)
	if isOpaqueWhatsAppJID(lower) || strings.Contains(lower, "@g.us") {
		return "", false
	}

	hasDomain := strings.Contains(lower, "@")
	left := raw
	if at := strings.Index(raw, "@"); at >= 0 {
		left = raw[:at]
	}
	if colon := strings.Index(left, ":"); colon >= 0 {
		left = left[:colon]
	}

	digits := normalizeDigits(left)
	if len(digits) < 8 {
		return "", false
	}
	if hasDomain {
		return digits, true
	}
	return formatPhoneForWhatsApp(digits), true
}

func canonicalWhatsAppSelfJID(value string) (string, bool) {
	phone, ok := phoneFromIdentityValue(value)
	if !ok || phone == "" {
		return "", false
	}
	return phone + "@s.whatsapp.net", true
}

func uniqueStrings(values ...string) []string {
	seen := map[string]struct{}{}
	result := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func isOpaqueWhatsAppJID(value string) bool {
	lower := strings.ToLower(strings.TrimSpace(value))
	return strings.Contains(lower, "@lid") ||
		strings.Contains(lower, "@newsletter") ||
		strings.Contains(lower, "@broadcast") ||
		strings.Contains(lower, "@status")
}

func withoutOpaqueAliases(values []string) []string {
	result := []string{}
	for _, value := range values {
		if isOpaqueWhatsAppJID(value) {
			continue
		}
		result = append(result, value)
	}
	return result
}
