package developments

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestPriceActivationRejectsStaleSnapshotAgainstDatabase(t *testing.T) {
	fixture := newReservationRegressionFixture(t, false)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	oldVersion := fixture.priceTable.UpdatedAt
	updated, err := fixture.repo.UpdateUnitPrice(ctx, fixture.actor, fixture.developmentID, fixture.units[0].ID, UpdateUnitPriceInput{
		ListPrice: 600000, ExpectedPriceTableID: &fixture.priceTable.ID, ExpectedPriceTableUpdatedAt: &oldVersion,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.repo.ActivatePriceTable(ctx, fixture.actor, fixture.developmentID, fixture.priceTable.ID, ActivatePriceTableInput{ExpectedUpdatedAt: &oldVersion}); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale operator activated changed prices: %v", err)
	}
	var status string
	if err := fixture.database.Pool().QueryRow(ctx, "select status from public.property_development_price_tables where organization_id=$1::uuid and id=$2::uuid", fixture.actor.OrganizationID, fixture.priceTable.ID).Scan(&status); err != nil || status != "draft" {
		t.Fatalf("rejected activation changed status=%s: %v", status, err)
	}
	if _, err := fixture.repo.ActivatePriceTable(ctx, fixture.actor, fixture.developmentID, fixture.priceTable.ID, ActivatePriceTableInput{ExpectedUpdatedAt: &updated.PriceTable.UpdatedAt}); err != nil {
		t.Fatal(err)
	}
}

// Hold DELETE's parent lock before starting the real reservation helper. The
// old reservation -> lead order leaves the FK DELETE waiting on that reservation;
// the corrected helper owns no reservation lock while waiting for the lead.
func TestReservationLeadDeletionCompletesBeforeBlockedMutationAgainstDatabase(t *testing.T) {
	fixture := newReservationRegressionFixture(t, true)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	reservation := fixture.createReservation(t, ctx)
	deleteTx, err := fixture.database.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer deleteTx.Rollback(ctx)
	var leadID string
	if err := deleteTx.QueryRow(ctx, "select id::text from public.leads where organization_id=$1::uuid and id=$2::uuid for update", fixture.actor.OrganizationID, fixture.leadID).Scan(&leadID); err != nil {
		t.Fatal(err)
	}
	mutationTx, err := fixture.database.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	mutationPID := mutationTx.Conn().PgConn().PID()
	completed := make(chan error, 1)
	go func() {
		defer mutationTx.Rollback(context.Background())
		_, err := lockReservationForMutationTx(ctx, mutationTx, fixture.actor, fixture.developmentID, reservation.ID)
		completed <- err
	}()
	if err := waitForReservationDatabaseLock(ctx, mutationPID, fixture.database); err != nil {
		t.Fatalf("mutation did not wait for lead: %v", err)
	}
	if _, err := deleteTx.Exec(ctx, "set local lock_timeout='1s'"); err != nil {
		t.Fatal(err)
	}
	if _, err := deleteTx.Exec(ctx, "delete from public.leads where organization_id=$1::uuid and id=$2::uuid", fixture.actor.OrganizationID, fixture.leadID); err != nil {
		t.Fatalf("lead DELETE waited on reservation held by its lead waiter: %v", err)
	}
	if err := deleteTx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-completed:
		if !errors.Is(err, ErrNotFound) {
			t.Fatalf("command resumed after losing its lead: %v", err)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	var remainingLead *string
	var status string
	if err := fixture.database.Pool().QueryRow(ctx, "select lead_id::text,status from public.property_development_reservations where organization_id=$1::uuid and id=$2::uuid", fixture.actor.OrganizationID, reservation.ID).Scan(&remainingLead, &status); err != nil || remainingLead != nil || status != "active" {
		t.Fatalf("failed command changed reservation: lead=%v status=%s error=%v", remainingLead, status, err)
	}
}

func TestReservationCreateDoesNotCycleWithExistingTransitionAgainstDatabase(t *testing.T) {
	fixture := newReservationRegressionFixture(t, true)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	reservation := fixture.createReservation(t, ctx)
	tx, err := fixture.database.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := lockReservationForMutationTx(ctx, tx, fixture.actor, fixture.developmentID, reservation.ID); err != nil {
		t.Fatal(err)
	}
	var version, key string
	if err := fixture.database.Pool().QueryRow(ctx, "select to_jsonb(unit)->>'updated_at',gen_random_uuid()::text from public.property_development_units unit where organization_id=$1::uuid and id=$2::uuid", fixture.actor.OrganizationID, fixture.units[0].ID).Scan(&version, &key); err != nil {
		t.Fatal(err)
	}
	createCtx, createCancel := context.WithTimeout(ctx, 2*time.Second)
	defer createCancel()
	if _, err := fixture.repo.CreateReservation(createCtx, fixture.actor, fixture.developmentID, fixture.units[0].ID, key, CreateReservationInput{
		LeadID: &fixture.leadID, ExpiresAt: time.Now().UTC().Add(time.Hour).Format(time.RFC3339Nano), ExpectedUnitUpdatedAt: version,
	}); !errors.Is(err, ErrConflict) {
		t.Fatalf("new creation waited on existing reservation instead of rejecting reserved inventory: %v", err)
	}
	if _, err := tx.Exec(ctx, "update public.property_development_reservations set status='cancelled',cancellation_reason='synthetic regression',updated_by=$3::uuid where organization_id=$1::uuid and id=$2::uuid", fixture.actor.OrganizationID, reservation.ID, fixture.actor.UserID); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
}
