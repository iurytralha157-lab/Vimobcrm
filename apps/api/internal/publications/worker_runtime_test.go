package publications

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestPublicationExecutionRecoversPanicWithoutSourceData(t *testing.T) {
	err := executePublicationJob(context.Background(), time.Second, func(context.Context) error { panic("secret source data") })
	if !errors.Is(err, errPublicationWorkerPanic) || err.Error() != "publication worker panic" {
		t.Fatalf("unexpected safe panic result: %v", err)
	}
	if err := executePublicationJob(context.Background(), time.Second, func(context.Context) error { return nil }); err != nil {
		t.Fatalf("next job after panic failed: %v", err)
	}
}

func TestPublicationExecutionCancelsBeforeLeaseExpiry(t *testing.T) {
	for _, lease := range []time.Duration{time.Nanosecond, time.Millisecond, 10 * time.Second, 2 * time.Minute, time.Hour} {
		if timeout := publicationJobTimeout(lease); timeout >= lease || timeout > 30*time.Second {
			t.Fatalf("timeout %s exceeds safe lease %s", timeout, lease)
		}
	}
	err := executePublicationJob(context.Background(), time.Millisecond, func(ctx context.Context) error {
		<-ctx.Done()
		return ctx.Err()
	})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("job timeout = %v", err)
	}
}

func TestPublicationBatchRecoveryWorksWithNilLogger(t *testing.T) {
	repo := NewRepository(nil, Config{Worker: WorkerConfig{Enabled: true, Lease: time.Millisecond}})
	if repo.config.Worker.Lease < 2*time.Second {
		t.Fatal("tiny lease was not bounded")
	}
	// A nil pool causes a controlled panic in claimJobs. Batch recovery must
	// absorb it even when the caller supplied no logger and still record failure.
	repo.runWorkerBatch(context.Background(), nil, "synthetic-worker")
	if repo.workerState.failed.Load() != 1 {
		t.Fatal("batch panic was not recorded")
	}
}

func TestSnapshotRefreshNeverResetsAttemptBudgetOrRevivesWithdrawal(t *testing.T) {
	version := int64(2)
	publication := publicationRecord{DesiredState: DesiredPublished, CurrentVersion: version}
	job := pendingJob{Version: &version, Attempts: 11, MaxAttempts: 12}
	if !publicationRefreshAllowed(publication, job) {
		t.Fatal("current version with remaining budget must refresh")
	}
	job.Attempts = job.MaxAttempts
	if publicationRefreshAllowed(publication, job) {
		t.Fatal("exhausted job must not refresh")
	}
	job.Attempts = 1
	publication.DesiredState = DesiredUnpublished
	if publicationRefreshAllowed(publication, job) {
		t.Fatal("withdrawn publication must never refresh")
	}
	publication.DesiredState = DesiredPublished
	publication.CurrentVersion++
	if publicationRefreshAllowed(publication, job) {
		t.Fatal("old job must never replace newer intent")
	}
}

func TestWorkerAuthorizationRequiresCurrentTenantPermissionAndBilling(t *testing.T) {
	current := tenant.Context{OrganizationID: "org-a", UserID: "actor", MemberRole: "user",
		Permissions: []string{permissions.PropertyManage}, EnabledModules: []string{"properties"},
		SubscriptionType: "free", SubscriptionStatus: "active"}
	if err := validateWorkerPublicationAuthorization(current, "org-a"); err != nil {
		t.Fatal(err)
	}
	if err := validateWorkerPublicationAuthorization(current, "org-b"); err == nil {
		t.Fatal("cross-tenant delivery allowed")
	}
	current.Permissions = nil
	if err := validateWorkerPublicationAuthorization(current, "org-a"); err == nil {
		t.Fatal("revoked permission delivery allowed")
	}
	current.Permissions = []string{permissions.PropertyManage}
	current.SubscriptionStatus = "overdue"
	if err := validateWorkerPublicationAuthorization(current, "org-a"); err == nil {
		t.Fatal("disabled billing delivery allowed")
	}
}

func TestCommercializationAndAvailableStatusMatchBothPublicationChannels(t *testing.T) {
	for _, entry := range []struct {
		source publicationSource
		scope  publicationScope
	}{
		{readyPublicationSource(), sitePublicationScope()},
		{readyGrupoOLXPublicationSource(), grupoOLXPublicationScope("account")},
	} {
		entry.source.Status = "available"
		if checks, _, state := evaluatePublicationReadiness(entry.scope, entry.source); state != ReadinessReady {
			t.Fatalf("available must be publishable: %s %#v", entry.scope.Channel, checks)
		}
		entry.source.CommercializationDenied = true
		checks, _, state := evaluatePublicationReadiness(entry.scope, entry.source)
		if state != ReadinessBlocked || findCheck(checks, "commercialization").Resolved {
			t.Fatalf("explicit commercialization denial must block: %#v", checks)
		}
	}
}

func TestDisabledWorkerRejectsNewPublicationBeforeStartingDatabaseWork(t *testing.T) {
	repo := NewRepository(nil, Config{Worker: WorkerConfig{Enabled: false}})
	actor := tenant.Context{UserID: "actor", OrganizationID: "org", MemberRole: "admin", EnabledModules: []string{"properties", "site"}}
	_, err := repo.executeCommand(context.Background(), actor, "33333333-3333-4333-8333-333333333333", SiteChannel, ActionPublish, "", nil, "request")
	if !errors.Is(err, ErrWorkerUnavailable) {
		t.Fatalf("disabled executor publish = %v", err)
	}
}

func TestWorkerReadyRequiresProgressOnlyForEnabledExecution(t *testing.T) {
	now := time.Now()
	disabled := NewRepository(nil, Config{})
	if err := disabled.WorkerReady(now); err != nil {
		t.Fatal("disabled worker must not block unrelated API routes")
	}
	enabled := NewRepository(nil, Config{Worker: WorkerConfig{Enabled: true}})
	if err := enabled.WorkerReady(now); !errors.Is(err, ErrWorkerUnavailable) {
		t.Fatal("not-started worker reported ready")
	}
	enabled.workerState.running.Store(true)
	if err := enabled.WorkerReady(now); !errors.Is(err, ErrWorkerUnavailable) {
		t.Fatal("worker with no successful claim/progress reported ready")
	}
	enabled.workerState.lastProgress.Store(now.Add(-time.Second).UnixNano())
	if err := enabled.WorkerReady(now); err != nil {
		t.Fatalf("active executor was not ready: %v", err)
	}
	enabled.workerState.lastProgress.Store(now.Add(-10 * time.Minute).UnixNano())
	if err := enabled.WorkerReady(now); !errors.Is(err, ErrWorkerUnavailable) {
		t.Fatal("stalled executor reported ready")
	}
}
