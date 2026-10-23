package config

// Enable only after every native and Edge consumer accepts the marked organic
// snapshot. An unset or malformed value must retain the existing ingress policy.
func loadWhatsAppPostFormFollowUpGuardEnabled() bool {
	return parseBool("WHATSAPP_POST_FORM_FOLLOW_UP_GUARD_ENABLED", false)
}
