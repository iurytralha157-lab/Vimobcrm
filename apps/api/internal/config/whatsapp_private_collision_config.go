package config

// Enable emission after every native worker can read the private route proof.
func loadWhatsAppPrivateCollisionCaptureEnabled() bool {
	return parseBool("WHATSAPP_PRIVATE_COLLISION_CAPTURE_ENABLED", false)
}

func loadWhatsAppPrivateLegacyOutboundEnabled() bool {
	return parseBool("WHATSAPP_PRIVATE_LEGACY_OUTBOUND_CAPTURE_ENABLED", false)
}
