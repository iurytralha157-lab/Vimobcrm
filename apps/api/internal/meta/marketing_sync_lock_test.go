package meta

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type marketingSyncLockTestDB struct {
	queryCalls int
	queryErr   error
}

func (database *marketingSyncLockTestDB) Query(context.Context, string, ...any) (pgx.Rows, error) {
	database.queryCalls++
	return nil, database.queryErr
}

func (*marketingSyncLockTestDB) QueryRow(context.Context, string, ...any) pgx.Row {
	panic("unexpected QueryRow call")
}

func (*marketingSyncLockTestDB) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	panic("unexpected Exec call")
}

func (*marketingSyncLockTestDB) SendBatch(context.Context, *pgx.Batch) pgx.BatchResults {
	panic("unexpected SendBatch call")
}

func TestMarketingSyncRejectsConcurrentOrganizationBeforeDatabaseWork(t *testing.T) {
	database := &marketingSyncLockTestDB{}
	service := newMarketingSyncService(database, Config{}, nil)
	service.acquireOrganizationLock = func(context.Context, string) (func(), bool, error) {
		return nil, false, nil
	}

	result, err := service.Sync(t.Context(), validMarketingSyncLockTestRequest())
	var failure *MarketingSyncFailure
	if !errors.As(err, &failure) || failure.Code != "marketing_sync_in_progress" || failure.HTTPStatus != http.StatusConflict {
		t.Fatalf("failure = %#v, error = %v", failure, err)
	}
	if database.queryCalls != 0 {
		t.Fatalf("database query calls = %d, want 0", database.queryCalls)
	}
	if len(result.Errors) != 1 || result.Errors[0] != "marketing_sync_in_progress" {
		t.Fatalf("result = %#v", result)
	}
}

func TestMarketingSyncReleasesOrganizationLockAfterTargetLookupFailure(t *testing.T) {
	database := &marketingSyncLockTestDB{queryErr: errors.New("test lookup failure")}
	service := newMarketingSyncService(database, Config{}, nil)
	releaseCalls := 0
	service.acquireOrganizationLock = func(context.Context, string) (func(), bool, error) {
		return func() { releaseCalls++ }, true, nil
	}

	_, err := service.Sync(t.Context(), validMarketingSyncLockTestRequest())
	if marketingSyncErrorCode(err) != "sync_target_lookup_failed" {
		t.Fatalf("error = %v", err)
	}
	if releaseCalls != 1 {
		t.Fatalf("release calls = %d, want 1", releaseCalls)
	}
	if database.queryCalls != 1 {
		t.Fatalf("database query calls = %d, want 1", database.queryCalls)
	}

	// The process-local guard must also be released on every error path.
	releaseLocal, acquired := service.tryAcquireLocalMarketingSync(validMarketingSyncLockTestRequest().OrganizationID)
	if !acquired {
		t.Fatal("local organization lock remained held after Sync returned")
	}
	releaseLocal()
}

func TestMarketingSyncLocalOrganizationGateFailsFastAndReopens(t *testing.T) {
	service := &MarketingSyncService{}
	organizationID := validMarketingSyncLockTestRequest().OrganizationID
	release, acquired := service.tryAcquireLocalMarketingSync(organizationID)
	if !acquired {
		t.Fatal("first local lock was not acquired")
	}
	if _, secondAcquired := service.tryAcquireLocalMarketingSync(organizationID); secondAcquired {
		t.Fatal("second local lock unexpectedly acquired")
	}
	release()
	releaseAfterFree, acquiredAfterFree := service.tryAcquireLocalMarketingSync(organizationID)
	if !acquiredAfterFree {
		t.Fatal("local lock did not reopen after release")
	}
	releaseAfterFree()
}

func validMarketingSyncLockTestRequest() MarketingSyncRequest {
	return MarketingSyncRequest{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
		DateFrom:       "2026-07-01",
		DateTo:         "2026-07-31",
	}
}
