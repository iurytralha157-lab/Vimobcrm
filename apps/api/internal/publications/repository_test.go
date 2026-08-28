package publications

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestPublicationWorkerRetriesTransientLoadsAndDeadLettersMissingRecords(t *testing.T) {
	transient := errors.New("database connection reset")
	if publicationWorkerLoadFailurePermanent(transient) {
		t.Fatal("a transient database/network failure must remain retryable")
	}
	if publicationWorkerLoadFailurePermanent(fmt.Errorf("query source: %w", transient)) {
		t.Fatal("a wrapped transient failure must remain retryable")
	}
	for _, missing := range []error{
		ErrPropertyNotFound,
		fmt.Errorf("load property: %w", ErrPropertyNotFound),
		ErrPublicationNotFound,
		fmt.Errorf("load publication: %w", ErrPublicationNotFound),
	} {
		if !publicationWorkerLoadFailurePermanent(missing) {
			t.Fatalf("deterministic missing record %v must be permanent", missing)
		}
	}
}

func TestNormalizeDatabaseErrorExplainsDuplicateGrupoOLXListingID(t *testing.T) {
	err := normalizeDatabaseError(&pgconn.PgError{
		Code:           "23505",
		ConstraintName: "property_channel_publications_provider_uidx",
	})
	if !errors.Is(err, ErrPublicationNotReady) {
		t.Fatalf("error = %v, want publication not ready", err)
	}
	if !strings.Contains(err.Error(), "ListingID is already used") {
		t.Fatalf("error does not explain the permanent conflict: %v", err)
	}

	otherUnique := normalizeDatabaseError(&pgconn.PgError{Code: "23505", ConstraintName: "other_unique"})
	if !errors.Is(otherUnique, ErrPublicationConflict) {
		t.Fatalf("other unique error = %v, want revision conflict", otherUnique)
	}
}

func TestGrupoOLXListingIDIsImmutableAndProductChangesOnlyAfterFullUnpublish(t *testing.T) {
	publishedVersion := int64(1)
	publication := &publicationRecord{
		DesiredState:            DesiredPublished,
		ObservedState:           ObservedPublished,
		PublishedVersion:        &publishedVersion,
		ProviderListingID:       stringPointer("OLD-10"),
		ProviderPublicationType: "STANDARD",
	}
	if err := ensureProviderConfigurationStable(
		grupoOLXPublicationScope("account"), publication, stringPointer("NEW-10"), "STANDARD",
	); !errors.Is(err, ErrPublicationNotReady) {
		t.Fatalf("active ListingID change error = %v, want publication not ready", err)
	}
	if err := ensureProviderConfigurationStable(
		grupoOLXPublicationScope("account"), publication, stringPointer("OLD-10"), "PREMIUM",
	); !errors.Is(err, ErrPublicationNotReady) {
		t.Fatalf("active product change error = %v, want publication not ready", err)
	}

	publication.DesiredState = DesiredUnpublished
	publication.ObservedState = ObservedUnpublished
	publication.PublishedVersion = nil
	if err := ensureProviderConfigurationStable(
		grupoOLXPublicationScope("account"), publication, stringPointer("NEW-10"), "STANDARD",
	); !errors.Is(err, ErrPublicationNotReady) {
		t.Fatalf("fully unpublished ListingID change error = %v, want immutable identity", err)
	}
	if err := ensureProviderConfigurationStable(
		grupoOLXPublicationScope("account"), publication, stringPointer("OLD-10"), "PREMIUM",
	); err != nil {
		t.Fatalf("fully unpublished product change must be allowed: %v", err)
	}
}

func TestRetryCapabilityDistinguishesDeliveryFailuresFromProviderAnnotations(t *testing.T) {
	if !publicationDeliveryError(stringPointer("snapshot_changed")) {
		t.Fatal("a failed delivery must remain manually retryable while last-good is published")
	}
	for _, code := range []string{"grupo_olx_feed_validation", "grupo_olx_import_error", "grupo_olx_import_warning"} {
		if publicationDeliveryError(stringPointer(code)) {
			t.Fatalf("provider annotation %q must not create a delivery retry", code)
		}
	}
	if publicationDeliveryError(nil) {
		t.Fatal("missing delivery error must not create a retry")
	}
	if !hasActivePublicationJob([]RecentJob{{Status: "retry"}}) {
		t.Fatal("automatic retry in flight must suppress the manual retry capability")
	}
	if hasActivePublicationJob([]RecentJob{{Status: "dead"}, {Status: "succeeded"}}) {
		t.Fatal("terminal jobs must not suppress a manual retry")
	}
}
