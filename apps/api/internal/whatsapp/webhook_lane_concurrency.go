package whatsapp

// Zero keeps the established automatic split, including the total-one
// compatibility fallback. Invalid programmatic values also keep that budget;
// environment configuration is rejected before the application starts.
func evolutionWebhookLaneConcurrencyWithBacklog(total, backlog int) (int, int) {
	total = normalizeWebhookWorkerConcurrency(total)
	if backlog <= 0 || backlog >= total {
		return evolutionWebhookLaneConcurrency(total)
	}
	return total - backlog, backlog
}
