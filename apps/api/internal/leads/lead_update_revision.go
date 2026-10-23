package leads

import "time"

// The snapshot is locked before this check. Older clients without a revision
// retain their existing behavior; an editor with a revision never overwrites
// a newer stored contact, including when the realtime event was missed.
func validateLeadUpdateRevision(current leadSnapshot, input updateInput) error {
	if input.ExpectedUpdatedAt == nil {
		return nil
	}
	raw, ok := current.Data["updated_at"].(string)
	if !ok {
		return ErrLeadChanged
	}
	updatedAt, err := time.Parse(time.RFC3339Nano, raw)
	if err != nil || !updatedAt.Equal(*input.ExpectedUpdatedAt) {
		return ErrLeadChanged
	}
	return nil
}
