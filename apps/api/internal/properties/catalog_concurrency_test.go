package properties

import (
	"errors"
	"testing"
	"time"
)

func TestValidateCatalogMutationVersionRejectsMissingVersion(t *testing.T) {
	current := time.Date(2026, time.September, 8, 12, 0, 0, 123000000, time.UTC)
	if err := validateCatalogMutationVersion(current, ""); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("missing version error = %v, want ErrInvalidInput", err)
	}
}

func TestValidateCatalogMutationVersionRejectsStaleWrite(t *testing.T) {
	current := time.Date(2026, time.September, 8, 12, 0, 0, 123000000, time.UTC)
	stale := current.Add(-time.Second).Format(time.RFC3339Nano)
	if err := validateCatalogMutationVersion(current, stale); !errors.Is(err, ErrPropertyWorkspaceConflict) {
		t.Fatalf("stale version error = %v, want ErrPropertyWorkspaceConflict", err)
	}
}

func TestValidateCatalogMutationVersionAcceptsCurrentVersion(t *testing.T) {
	current := time.Date(2026, time.September, 8, 12, 0, 0, 123000000, time.UTC)
	if err := validateCatalogMutationVersion(current, current.Format(time.RFC3339Nano)); err != nil {
		t.Fatalf("current version returned error: %v", err)
	}
}
