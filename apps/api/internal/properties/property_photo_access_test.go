package properties

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// newCountingSignServer issues a different token on every signature, as Storage
// does, and records how many signatures and which lifetime were requested.
func newCountingSignServer(t *testing.T, requests *atomic.Int64, expiresIn *atomic.Int64) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			ExpiresIn int64    `json:"expiresIn"`
			Paths     []string `json:"paths"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		sequence := requests.Add(1)
		expiresIn.Store(body.ExpiresIn)
		items := make([]map[string]string, 0, len(body.Paths))
		for _, path := range body.Paths {
			items = append(items, map[string]string{
				"path":      path,
				"signedURL": fmt.Sprintf("/object/sign/property-private/%s?token=%d", path, sequence),
			})
		}
		_ = json.NewEncoder(w).Encode(items)
	}))
	t.Cleanup(server.Close)
	return server
}

// The catalog keeps list data for up to an hour and lazy-loads cards as they
// scroll into view, so a 90-second URL shows an empty thumbnail.
func TestPropertyListCoverURLOutlivesTheFrontendListCache(t *testing.T) {
	var requests, expiresIn atomic.Int64
	server := newCountingSignServer(t, &requests, &expiresIn)
	repository := Repository{storage: newStorageClient(StorageConfig{ProjectURL: server.URL, APIKey: "service-key"})}

	repository.attachSignedPropertyCoverURLs(context.Background(), testOrganizationID, []Property{{
		"id":                        testPropertyID,
		"_asset_cover_storage_path": "orgs/" + testOrganizationID + "/properties/" + testPropertyID + "/" + testAssetID + "/cover.jpg",
	}})

	const frontendListGCTime = time.Hour
	if lifetime := time.Duration(expiresIn.Load()) * time.Second; lifetime <= frontendListGCTime {
		t.Fatalf("cover URL lives %s, shorter than the %s the list can stay cached", lifetime, frontendListGCTime)
	}
}

// The workspace refetches every 30 seconds. A new token per refetch changes the
// image src, so the browser downloads and decodes every photo again.
func TestRepeatedReadsReuseTheSamePhotoURL(t *testing.T) {
	var requests, expiresIn atomic.Int64
	server := newCountingSignServer(t, &requests, &expiresIn)
	repository := Repository{storage: newStorageClient(StorageConfig{ProjectURL: server.URL, APIKey: "service-key"})}
	path := "orgs/" + testOrganizationID + "/properties/" + testPropertyID + "/" + testAssetID + "/one.jpg"
	read := func() string {
		assets := []map[string]any{{
			"id": testAssetID, "asset_type": "photo", "visibility": "public", "_storage_path_for_access": path,
		}}
		repository.enrichWorkspaceAssetAccessURLs(context.Background(), testOrganizationID, testPropertyID, assets)
		return workspaceString(assets[0], "access_url")
	}

	first, second := read(), read()
	if first == "" || first != second {
		t.Fatalf("photo URL changed between reads: %q then %q", first, second)
	}
	if requests.Load() != 1 {
		t.Fatalf("signed %d times, want 1", requests.Load())
	}
}

func TestDocumentsAndConfidentialPhotosKeepShortLivedUnsharedURLs(t *testing.T) {
	for name, asset := range map[string]map[string]any{
		"document":           {"asset_type": "document", "visibility": "internal"},
		"confidential photo": {"asset_type": "photo", "visibility": "confidential"},
	} {
		t.Run(name, func(t *testing.T) {
			var requests, expiresIn atomic.Int64
			server := newCountingSignServer(t, &requests, &expiresIn)
			repository := Repository{storage: newStorageClient(StorageConfig{ProjectURL: server.URL, APIKey: "service-key"})}
			path := "orgs/" + testOrganizationID + "/properties/" + testPropertyID + "/" + testAssetID + "/file.pdf"
			read := func() string {
				assets := []map[string]any{{
					"id": testAssetID, "asset_type": asset["asset_type"], "visibility": asset["visibility"], "_storage_path_for_access": path,
				}}
				repository.enrichWorkspaceAssetAccessURLs(context.Background(), testOrganizationID, testPropertyID, assets)
				return workspaceString(assets[0], "access_url")
			}
			if first, second := read(), read(); first == second {
				t.Fatalf("private file URL was reused: %q", first)
			}
			if expiresIn.Load() != int64(propertyAssetAccessTTL/time.Second) {
				t.Fatalf("lifetime = %ds, want %s", expiresIn.Load(), propertyAssetAccessTTL)
			}
		})
	}
}
