package whatsapp

// Evolution may report a delivery receipt as messages.update rather than a
// status/receipt event. Only a recognized delivery state with message IDs and
// no customer content may use the receipt path; content stays on the native
// message path even when the event name is the same.
func nativeEvolutionMessageUpdateIsReceipt(
	event string,
	payload map[string]any,
	statuses []nativeEvolutionStatus,
) bool {
	return compactEvolutionWebhookControlName(event) == "messagesupdate" &&
		len(statuses) > 0 &&
		!nativeEvolutionAuxiliaryHasMessages(payload) &&
		!nativePayloadHasPotentialCustomerContent(payload, 0)
}
