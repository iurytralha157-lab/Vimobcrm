package properties

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestExpiredUploadCleanupCountsOneAttemptPerFailedRemovalAgainstDatabase(t *testing.T) {
	if os.Getenv("VIMOB_RUN_DB_TESTS") != "1" {
		t.Skip("set VIMOB_RUN_DB_TESTS=1 to run database integration tests")
	}
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if databaseURL == "" {
		t.Fatal("DATABASE_URL is required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL: databaseURL, MaxConns: 2, MinConns: 0, HealthTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("NewPostgres() returned error: %v", err)
	}
	t.Cleanup(postgres.Close)

	var organizationID, propertyID, uploadToken string
	if err := postgres.Pool().QueryRow(ctx, `select gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text`).Scan(
		&organizationID,
		&propertyID,
		&uploadToken,
	); err != nil {
		t.Fatalf("fixture id generation returned error: %v", err)
	}
	code := fmt.Sprintf("MEDIA-CLEANUP-%d", time.Now().UnixNano())
	storagePath := fmt.Sprintf("orgs/%s/properties/%s/%s/failed.jpg", organizationID, propertyID, uploadToken)
	futureDiscardPath := fmt.Sprintf("orgs/%s/properties/%s/%s/future-discard.jpg", organizationID, propertyID, uploadToken)
	consumedPath := fmt.Sprintf("orgs/%s/properties/%s/%s/consumed.jpg", organizationID, propertyID, uploadToken)
	queuedPath := fmt.Sprintf("orgs/%s/properties/%s/%s/queued.jpg", organizationID, propertyID, uploadToken)
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.organizations (id, name, is_active)
		values ($1::uuid, $2, true)
	`, organizationID, code); err != nil {
		t.Fatalf("organization fixture insert returned error: %v", err)
	}
	t.Cleanup(func() {
		cleanupContext, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = postgres.Pool().Exec(cleanupContext, `delete from public.property_asset_upload_intents where organization_id = $1::uuid and property_id = $2::uuid`, organizationID, propertyID)
		_, _ = postgres.Pool().Exec(cleanupContext, `delete from public.property_asset_storage_cleanup_queue where organization_id = $1::uuid and property_id = $2::uuid`, organizationID, propertyID)
		_, _ = postgres.Pool().Exec(cleanupContext, `delete from public.properties where organization_id = $1::uuid and id = $2::uuid`, organizationID, propertyID)
		_, _ = postgres.Pool().Exec(cleanupContext, `delete from public.organizations where id = $1::uuid`, organizationID)
	})
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.properties (id, organization_id, code, title)
		values ($1::uuid, $2::uuid, $3, 'Media cleanup attempt fixture')
	`, propertyID, organizationID, code); err != nil {
		t.Fatalf("property fixture insert returned error: %v", err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.property_asset_upload_intents (
			organization_id, property_id, storage_path, asset_type,
			file_name, mime_type, file_size_bytes, expires_at, created_at
		)
		values (
			$1::uuid, $2::uuid, $3, 'photo',
			'failed.jpg', 'image/jpeg', 1024, now() - interval '1 hour', now() - interval '2 hours'
		)
	`, organizationID, propertyID, storagePath); err != nil {
		t.Fatalf("upload intent fixture insert returned error: %v", err)
	}

	var removalCalls atomic.Int32
	storageServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		removalCalls.Add(1)
		if request.Method != http.MethodDelete || request.URL.Path != "/storage/v1/object/property-private" {
			t.Errorf("storage removal request = %s %s", request.Method, request.URL.Path)
		}
		http.Error(w, "simulated storage outage", http.StatusBadGateway)
	}))
	defer storageServer.Close()

	repository := NewRepository(postgres, StorageConfig{ProjectURL: storageServer.URL, APIKey: "service-key"})
	if err := repository.cleanupExpiredPropertyAssetUploads(ctx, organizationID, 10); err != nil {
		t.Fatalf("cleanupExpiredPropertyAssetUploads() returned error: %v", err)
	}
	if got := removalCalls.Load(); got != 1 {
		t.Fatalf("storage removal calls = %d, want 1", got)
	}

	var attempts int
	var retryScheduled, discardRequested bool
	var lastError string
	err = postgres.Pool().QueryRow(ctx, `
		select
			cleanup_attempts,
			cleanup_claimed_until > now() + interval '4 minutes',
			discard_requested_at is not null,
			coalesce(last_cleanup_error, '')
		from public.property_asset_upload_intents
		where storage_path = $1
	`, storagePath).Scan(&attempts, &retryScheduled, &discardRequested, &lastError)
	if errors.Is(err, pgx.ErrNoRows) {
		t.Fatal("failed upload cleanup removed the durable intent")
	}
	if err != nil {
		t.Fatalf("cleanup attempt readback returned error: %v", err)
	}
	if attempts != 1 {
		t.Fatalf("cleanup_attempts = %d, want exactly one increment for one storage call", attempts)
	}
	if !retryScheduled || !discardRequested || !strings.Contains(lastError, "simulated storage outage") {
		t.Fatalf(
			"failed cleanup retry state = scheduled:%v discard:%v error:%q",
			retryScheduled,
			discardRequested,
			lastError,
		)
	}

	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.property_asset_upload_intents (
			organization_id, property_id, storage_path, asset_type,
			file_name, mime_type, file_size_bytes, expires_at, discard_requested_at
		)
		values (
			$1::uuid, $2::uuid, $3, 'photo',
			'future-discard.jpg', 'image/jpeg', 1024, now() + interval '1 hour', now()
		)
	`, organizationID, propertyID, futureDiscardPath); err != nil {
		t.Fatalf("future discard fixture insert returned error: %v", err)
	}
	if err := repository.cleanupExpiredPropertyAssetUploads(ctx, organizationID, 10); err != nil {
		t.Fatalf("future cleanup returned error: %v", err)
	}
	if got := removalCalls.Load(); got != 1 {
		t.Fatalf("storage removal calls after future discard = %d, want unchanged 1", got)
	}
	var futureIntentExists bool
	if err := postgres.Pool().QueryRow(ctx, `
		select exists (
			select 1 from public.property_asset_upload_intents where storage_path = $1
		)
	`, futureDiscardPath).Scan(&futureIntentExists); err != nil || !futureIntentExists {
		t.Fatalf("future discard tombstone = %v, exists:%v", err, futureIntentExists)
	}

	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.property_asset_upload_intents (
			organization_id, property_id, storage_path, asset_type,
			file_name, mime_type, file_size_bytes, expires_at
		)
		values (
			$1::uuid, $2::uuid, $3, 'photo',
			'consumed.jpg', 'image/jpeg', 1024, now() + interval '1 hour'
		)
	`, organizationID, propertyID, consumedPath); err != nil {
		t.Fatalf("consumed fixture insert returned error: %v", err)
	}
	tx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatalf("begin consumed intent transaction returned error: %v", err)
	}
	if err := completePropertyAssetUploadIntent(ctx, tx, organizationID, propertyID, consumedPath); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatalf("completePropertyAssetUploadIntent() returned error: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit consumed intent returned error: %v", err)
	}
	var consumedTombstone bool
	if err := postgres.Pool().QueryRow(ctx, `
		select consumed_at is not null
		from public.property_asset_upload_intents
		where storage_path = $1
	`, consumedPath).Scan(&consumedTombstone); err != nil || !consumedTombstone {
		t.Fatalf("consumed upload tombstone = %v, consumed:%v", err, consumedTombstone)
	}

	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.property_asset_storage_cleanup_queue (
			organization_id, property_id, storage_path, available_at
		)
		values ($1::uuid, $2::uuid, $3, now() - interval '1 minute')
	`, organizationID, propertyID, queuedPath); err != nil {
		t.Fatalf("queued cleanup fixture insert returned error: %v", err)
	}
	if err := repository.cleanupQueuedPropertyAssetStoragePath(ctx, queuedPath); err == nil {
		t.Fatal("single-path cleanup unexpectedly succeeded during simulated Storage outage")
	}
	if got := removalCalls.Load(); got != 2 {
		t.Fatalf("storage removal calls after single-path cleanup = %d, want 2", got)
	}
	var queuedAttempts int
	var queuedRetryScheduled bool
	var queuedLastError string
	if err := postgres.Pool().QueryRow(ctx, `
		select
			cleanup_attempts,
			available_at > now() + interval '4 minutes',
			coalesce(last_cleanup_error, '')
		from public.property_asset_storage_cleanup_queue
		where storage_path = $1
	`, queuedPath).Scan(&queuedAttempts, &queuedRetryScheduled, &queuedLastError); err != nil {
		t.Fatalf("queued cleanup attempt readback returned error: %v", err)
	}
	if queuedAttempts != 1 || !queuedRetryScheduled || !strings.Contains(queuedLastError, "simulated storage outage") {
		t.Fatalf(
			"single-path cleanup retry state = attempts:%d scheduled:%v error:%q",
			queuedAttempts,
			queuedRetryScheduled,
			queuedLastError,
		)
	}
	if err := repository.cleanupQueuedPropertyAssetStorage(ctx, organizationID, 10); err != nil {
		t.Fatalf("queued cleanup worker returned error: %v", err)
	}
	if got := removalCalls.Load(); got != 2 {
		t.Fatalf("worker raced a leased single-path cleanup: storage calls = %d, want unchanged 2", got)
	}

	discardQuotaPrefix := fmt.Sprintf("orgs/%s/properties/%s/%s", organizationID, propertyID, uploadToken)
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.property_asset_upload_intents (
			organization_id, property_id, storage_path, asset_type,
			file_name, mime_type, file_size_bytes, expires_at, discard_requested_at
		)
		select
			$1::uuid,
			$2::uuid,
			$3 || '/discarded-' || series::text || '.jpg',
			'photo',
			'discarded-' || series::text || '.jpg',
			'image/jpeg',
			1024,
			now() + interval '1 hour',
			now()
		from generate_series(1, $4::integer) as series
	`, organizationID, propertyID, discardQuotaPrefix, propertyAssetMaxPendingUploads-1); err != nil {
		t.Fatalf("discarded upload quota fixtures returned error: %v", err)
	}
	_, err = repository.CreatePropertyAssetUploadIntent(
		ctx,
		tenant.Context{OrganizationID: organizationID, MemberRole: "owner"},
		propertyID,
		CreatePropertyAssetUploadIntentInput{
			AssetType: "photo", FileName: "blocked.jpg", MIMEType: "image/jpeg", FileSizeBytes: 1024,
		},
	)
	if !errors.Is(err, ErrInvalidInput) || !strings.Contains(err.Error(), "too many pending property asset uploads") {
		t.Fatalf("create after %d discarded live intents error = %v, want upload quota rejection", propertyAssetMaxPendingUploads, err)
	}
	if got := removalCalls.Load(); got != 2 {
		t.Fatalf("quota rejection unexpectedly called Storage: removal calls = %d, want unchanged 2", got)
	}
}
