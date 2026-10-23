package leads

// The durable import receipt and its replay accept exactly the same completed
// outcomes. Transient errors (for example queue_busy) must never be receipts.
func validCreateDistributionOutcome(value CreateDistributionOutcome) bool {
	switch value {
	case CreateDistributionOutcomeAssigned, CreateDistributionOutcomeAlreadyAssigned,
		CreateDistributionOutcomeNoMatchingQueue, CreateDistributionOutcomeNoAvailableMembers,
		CreateDistributionOutcomeSkipped, CreateDistributionOutcomeReentryPreserved,
		CreateDistributionOutcomePooled, CreateDistributionOutcomeQueueClosed,
		CreateDistributionOutcomeQueueWaiting, CreateDistributionOutcomeQueueLimitReached,
		CreateDistributionOutcomeQueueProtected:
		return true
	default:
		return false
	}
}
