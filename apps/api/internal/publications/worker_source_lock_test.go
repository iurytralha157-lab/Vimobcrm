package publications

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type sourceLockTx struct {
	pgx.Tx
	t                  *testing.T
	job                pendingJob
	propertyLocked     bool
	claimQueries       int
	validLease         bool
	propertyError      error
	onPropertyLock     func()
	propertyDeleted    bool
	privateFailQueries int
	canonicalWrites    int
	commits            int
}

func (tx *sourceLockTx) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	switch {
	case strings.Contains(query, "from public.property_development_units"):
		if args[0] != tx.job.OrganizationID || args[1] != tx.job.PropertyID {
			tx.t.Fatal("inventory escaped tenant/property")
		}
		return sourceLockRow{err: pgx.ErrNoRows}
	case strings.Contains(query, "from public.properties"):
		if !strings.Contains(query, "for update") {
			return sourceLockRow{err: pgx.ErrNoRows} // Failure diagnostics have no source fixture.
		}
		if args[0] != tx.job.OrganizationID || args[1] != tx.job.PropertyID {
			tx.t.Fatal("property lock escaped scope")
		}
		if tx.propertyError != nil {
			return sourceLockRow{err: tx.propertyError}
		}
		tx.propertyLocked = true
		if tx.propertyDeleted {
			return sourceLockRow{err: pgx.ErrNoRows}
		}
		if tx.onPropertyLock != nil {
			tx.onPropertyLock()
		}
		return sourceLockRow{value: tx.job.PropertyID}
	case strings.Contains(query, "from public.property_channel_publication_jobs"):
		tx.claimQueries++
		if !tx.propertyLocked {
			tx.t.Fatal("claim lock precedes property and can deadlock deletion")
		}
		if len(args) != 6 || args[3] != tx.job.OrganizationID || args[4] != tx.job.PropertyID || args[5] != float64(60) {
			tx.t.Fatalf("claim lost scope/lease age: %#v", args)
		}
		return sourceLockRow{value: tx.validLease}
	case strings.Contains(query, "private.fail_property_channel_publication_job"):
		tx.privateFailQueries++
		if !tx.propertyLocked || tx.claimQueries != 1 {
			tx.t.Fatal("failure accounting acquired job before ordered source fence")
		}
		return sourceLockRow{value: true}
	default:
		tx.t.Fatalf("unexpected query %s", query)
		return sourceLockRow{err: errors.New("unexpected query")}
	}
}

func (tx *sourceLockTx) Exec(_ context.Context, query string, _ ...any) (pgconn.CommandTag, error) {
	if !strings.Contains(query, "update public.property_channel_publications") || tx.privateFailQueries != 1 || !tx.propertyLocked {
		tx.t.Fatal("unfenced canonical failure write")
	}
	tx.canonicalWrites++
	return pgconn.NewCommandTag("UPDATE 1"), nil
}

func (tx *sourceLockTx) Commit(context.Context) error {
	tx.commits++
	return nil
}

type sourceLockRow struct {
	value any
	err   error
}

func (row sourceLockRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	switch value := row.value.(type) {
	case string:
		*dest[0].(*string) = value
	case bool:
		*dest[0].(*bool) = value
	}
	return nil
}

func TestWorkerSourceLockRechecksReclaimedOrExpiredLeaseAfterProperty(t *testing.T) {
	for _, action := range []string{ActionPublish, ActionUnpublish, ActionUpdate, ActionRevalidate} {
		job := pendingJob{ID: "job", OrganizationID: "org-a", PropertyID: "property-a", LeaseToken: "lease", Action: action}
		tx := &sourceLockTx{t: t, job: job, validLease: true}
		tx.onPropertyLock = func() { tx.validLease = false }
		valid, err := lockPublicationJobSource(context.Background(), tx, job, "worker", time.Minute)
		if err != nil || valid || tx.claimQueries != 1 {
			t.Fatalf("stale %s lease accepted: %t %v", action, valid, err)
		}
		tx.validLease = true
		tx.onPropertyLock = nil
		if valid, err := lockPublicationJobSource(context.Background(), tx, job, "worker", time.Minute); err != nil || !valid {
			t.Fatalf("current %s lease rejected: %t %v", action, valid, err)
		}
	}
}

func TestWorkerWaitingForDeletionNeverHoldsClaimLock(t *testing.T) {
	job := pendingJob{ID: "job", OrganizationID: "org-a", PropertyID: "property-a"}
	tx := &sourceLockTx{t: t, job: job, validLease: true, propertyError: context.DeadlineExceeded}
	valid, err := lockPublicationJobSource(context.Background(), tx, job, "worker", time.Minute)
	if valid || !errors.Is(err, errPublicationInventoryLock) || !errors.Is(err, context.DeadlineExceeded) || tx.claimQueries != 0 {
		t.Fatalf("property wait took claim or lost cause: valid=%t queries=%d err=%v", valid, tx.claimQueries, err)
	}
}

func TestWorkerSourceLockRefusesMissingLeaseDuration(t *testing.T) {
	job := pendingJob{ID: "job", OrganizationID: "org-a", PropertyID: "property-a"}
	tx := &sourceLockTx{t: t, job: job, validLease: true}
	valid, err := lockPublicationJobSource(context.Background(), tx, job, "worker", 0)
	if valid || !errors.Is(err, errPublicationInventoryLock) || tx.propertyLocked || tx.claimQueries != 0 {
		t.Fatalf("missing lease bypassed source fence: valid=%t err=%v", valid, err)
	}
}

func TestWorkerFailureAccountingUsesOrderedSourceFenceAndStopsOnGoneOrStaleClaim(t *testing.T) {
	job := pendingJob{ID: "job", OrganizationID: "org-a", PropertyID: "property-a", LeaseToken: "lease", Action: ActionPublish}
	repo := Repository{config: Config{Worker: WorkerConfig{Lease: time.Minute}}}
	for _, scenario := range []string{"current", "reclaimed while waiting", "deleted property and cascading job"} {
		t.Run(scenario, func(t *testing.T) {
			tx := &sourceLockTx{t: t, job: job, validLease: true}
			if scenario == "reclaimed while waiting" {
				tx.onPropertyLock = func() { tx.validLease = false }
			}
			if scenario == "deleted property and cascading job" {
				tx.propertyDeleted, tx.validLease = true, false
			}
			if err := repo.failJobWithTx(context.Background(), tx, "worker", job, "synthetic_failure", "Synthetic failure", false); err != nil {
				t.Fatal(err)
			}
			if scenario == "current" {
				if tx.privateFailQueries != 1 || tx.canonicalWrites != 1 || tx.commits != 1 {
					t.Fatalf("current failure was not recorded once: %#v", tx)
				}
			} else if tx.privateFailQueries != 0 || tx.canonicalWrites != 0 || tx.commits != 0 {
				t.Fatalf("gone/stale claim wrote failure or canonical state: %#v", tx)
			}
		})
	}
}
