package schedule

import "time"

// pgx encodes PostgreSQL timestamps at microsecond precision. Normalize before
// validating intervals and matching retried commands, so a positive nanoscale
// interval cannot be persisted as zero and a valid retry cannot lose equality.
func schedulePersistedTime(value time.Time) time.Time {
	return value.Truncate(time.Microsecond)
}

func schedulePersistedPatchTime(field patchTime) patchTime {
	if field.Value != nil {
		value := schedulePersistedTime(*field.Value)
		field.Value = &value
	}
	return field
}
