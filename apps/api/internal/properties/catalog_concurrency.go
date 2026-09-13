package properties

import (
	"fmt"
	"strings"
	"time"
)

type catalogVersionRequest struct {
	ExpectedUpdatedAt string `json:"expected_updated_at"`
}

// validateCatalogMutationVersion centralizes optimistic-concurrency checks for
// shared property catalog records (owners and locations).
func validateCatalogMutationVersion(current time.Time, expectedUpdatedAt string) error {
	expectedUpdatedAt = strings.TrimSpace(expectedUpdatedAt)
	if err := validateRequiredWorkspaceTimestamp(expectedUpdatedAt, "expected_updated_at"); err != nil {
		return err
	}
	expected, err := time.Parse(time.RFC3339Nano, expectedUpdatedAt)
	if err != nil {
		return fmt.Errorf("%w: expected_updated_at is invalid", ErrInvalidInput)
	}
	if !propertyVersionMatches(current, expected) {
		return ErrPropertyWorkspaceConflict
	}
	return nil
}
