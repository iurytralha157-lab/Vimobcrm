package leads

// A transfer always acknowledges its original lead snapshot. Unlike the legacy
// general editor, omission is a conflict rather than a last-writer-wins fallback.
func validateLeadAssignmentRevision(current leadSnapshot, input assignInput) error {
	if input.ExpectedUpdatedAt == nil {
		return ErrLeadChanged
	}
	return validateLeadUpdateRevision(current, updateInput{ExpectedUpdatedAt: input.ExpectedUpdatedAt})
}
