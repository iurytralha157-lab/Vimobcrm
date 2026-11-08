package properties

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// fakeSignedUploadStorage signs uploads and can hang object removal.
func fakeSignedUploadStorage(t *testing.T, removeDelay time.Duration) *httptest.Server {
	t.Helper()
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.Contains(r.URL.Path, "/object/upload/sign/"):
			_ = json.NewEncoder(w).Encode(map[string]string{"url": r.URL.Path + "?token=upload-token"})
		case r.Method == http.MethodDelete:
			select {
			case <-time.After(removeDelay):
			case <-release:
			}
			_, _ = w.Write([]byte(`[]`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	t.Cleanup(func() { close(release) })
	return server
}

func photoUploadIntent(size int64) CreatePropertyAssetUploadIntentInput {
	return CreatePropertyAssetUploadIntentInput{AssetType: "photo", FileName: "foto.jpg", MIMEType: "image/jpeg", FileSizeBytes: size}
}

// A discarded token stays counted until it expires, about two hours later. The
// bound must leave room for several failed batches of a full 20-photo selection.
func TestRepeatedFailedBatchesDoNotExhaustPendingCapacity(t *testing.T) {
	f := newPortfolioFixture(t, fakeSignedUploadStorage(t, 0).URL)
	created := f.create(t, propertyRequest{})
	id := anyString(created["id"])
	const discardedAttempts = 60
	for attempt := 0; attempt < discardedAttempts; attempt++ {
		intent, err := f.repository.CreatePropertyAssetUploadIntent(f.ctx, f.manager(), id, photoUploadIntent(int64(1000+attempt)))
		if err != nil {
			t.Fatalf("intent %d: %v", attempt, err)
		}
		if _, err := f.repository.DiscardPropertyAssetUpload(f.ctx, f.manager(), id, DiscardPropertyAssetUploadInput{StoragePath: intent.StoragePath}); err != nil {
			t.Fatalf("discard %d: %v", attempt, err)
		}
	}
	if _, err := f.repository.CreatePropertyAssetUploadIntent(f.ctx, f.manager(), id, photoUploadIntent(2000)); err != nil {
		t.Fatalf("new upload after %d discarded attempts: %v", discardedAttempts, err)
	}
}

// The browser gives this request 12 seconds. Housekeeping the background worker
// also performs must not consume them when Storage is slow.
func TestUploadIntentIsNotHeldByBackgroundCleanup(t *testing.T) {
	f := newPortfolioFixture(t, fakeSignedUploadStorage(t, 25*time.Second).URL)
	created := f.create(t, propertyRequest{})
	id := anyString(created["id"])
	if _, err := f.postgres.Pool().Exec(f.ctx, `
		insert into public.property_asset_upload_intents(organization_id, property_id, storage_path, asset_type, file_name, mime_type, file_size_bytes, created_at, expires_at)
		values ($1::uuid, $2::uuid, 'orgs/' || $1 || '/properties/' || $2 || '/' || gen_random_uuid() || '/velho.jpg', 'photo', 'velho.jpg', 'image/jpeg', 10, now() - interval '2 days', now() - interval '1 day')
	`, f.orgA, id); err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	if _, err := f.repository.CreatePropertyAssetUploadIntent(f.ctx, f.manager(), id, photoUploadIntent(10)); err != nil {
		t.Fatalf("intent: %v", err)
	}
	if elapsed := time.Since(started); elapsed > 5*time.Second {
		t.Fatalf("upload intent took %s behind storage cleanup", elapsed)
	}
}

// The real asset flow: a staged batch, then the compensation that follows a
// failure. Compensation deletes each asset with the version createAsset returned,
// so any later write that bumps it would leave partial photos behind.
func TestPhotoBatchCreateAndCompensationAgainstDatabase(t *testing.T) {
	jpeg := []byte{0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.Contains(r.URL.Path, "/object/upload/sign/"):
			_ = json.NewEncoder(w).Encode(map[string]string{"url": r.URL.Path + "?token=upload-token"})
		case strings.Contains(r.URL.Path, "/object/info/"):
			_ = json.NewEncoder(w).Encode(map[string]any{"size": float64(len(jpeg)), "content_type": "image/jpeg", "metadata": nil})
		case strings.Contains(r.URL.Path, "/object/authenticated/"):
			_, _ = w.Write(jpeg)
		case r.Method == http.MethodDelete:
			_, _ = w.Write([]byte(`[]`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	f := newPortfolioFixture(t, server.URL)
	created := f.create(t, propertyRequest{})
	id := anyString(created["id"])
	size := int64(len(jpeg))
	mime := "image/jpeg"
	title := "Sala (1) com acao.jpg"

	assets := make([]map[string]any, propertyAssetMaxPhotos)
	create := func(index int) error {
		intent, err := f.repository.CreatePropertyAssetUploadIntent(f.ctx, f.manager(), id, photoUploadIntent(size))
		if err != nil {
			return err
		}
		path := intent.StoragePath
		asset, err := f.repository.CreatePropertyAsset(f.ctx, f.manager(), id, CreatePropertyAssetInput{
			AssetType: "photo", Visibility: "public", StoragePath: &path, Title: &title, FileName: &title,
			MIMEType: &mime, FileSizeBytes: &size, SortOrder: index, IsPrimary: index == 0,
			Metadata: map[string]any{"source": "property_form"},
		})
		assets[index] = asset
		return err
	}
	if err := create(0); err != nil {
		t.Fatalf("cover: %v", err)
	}
	errs := make(chan error, propertyAssetMaxPhotos)
	for index := 1; index < propertyAssetMaxPhotos; index++ {
		go func(index int) { errs <- create(index) }(index)
	}
	for index := 1; index < propertyAssetMaxPhotos; index++ {
		if err := <-errs; err != nil {
			t.Fatalf("concurrent photo: %v", err)
		}
	}

	workspace, err := f.repository.GetWorkspace(f.ctx, f.manager(), id)
	if err != nil {
		t.Fatalf("workspace: %v", err)
	}
	if len(workspace.Data.Assets) != propertyAssetMaxPhotos {
		t.Fatalf("assets = %d", len(workspace.Data.Assets))
	}
	primaries := 0
	for _, asset := range workspace.Data.Assets {
		if workspaceBool(asset, "is_primary") {
			primaries++
		}
	}
	if primaries != 1 {
		t.Fatalf("primary photos = %d", primaries)
	}

	// Same order as rollbackCreatedAssets: every non-primary, then the primary.
	for index := len(assets) - 1; index >= 0; index-- {
		if _, err := f.repository.DeletePropertyAsset(f.ctx, f.manager(), id, workspaceString(assets[index], "id"), DeletePropertyAssetInput{
			ExpectedUpdatedAt: workspaceString(assets[index], "updated_at"),
		}); err != nil {
			t.Fatalf("compensate asset %d: %v", index, err)
		}
	}
	after, err := f.repository.GetWorkspace(f.ctx, f.manager(), id)
	if err != nil || len(after.Data.Assets) != 0 {
		t.Fatalf("assets after compensation: %d, %v", len(after.Data.Assets), err)
	}
}
