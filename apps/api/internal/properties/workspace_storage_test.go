package properties

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"
)

func TestStoredJPEGVerificationUsesAuthenticatedBytesNotUploaderMetadata(t *testing.T) {
	tests := []struct {
		name      string
		body      []byte
		wantError bool
	}{
		{name: "jpeg", body: []byte{0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10}},
		{name: "png declared jpeg", body: []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}, wantError: true},
		{name: "html declared jpeg", body: []byte("<!doctype html><html></html>"), wantError: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("apikey") != "service-key" {
					t.Fatalf("authenticated Storage read omitted server credential: %#v", r.Header)
				}
				switch {
				case strings.Contains(r.URL.Path, "/object/info/"):
					_ = json.NewEncoder(w).Encode(map[string]any{
						"metadata": map[string]any{"mimetype": "image/jpeg", "size": float64(4096)},
					})
				case strings.Contains(r.URL.Path, "/object/authenticated/"):
					if r.Header.Get("Range") != "bytes=0-511" {
						t.Fatalf("byte verification range = %q", r.Header.Get("Range"))
					}
					w.WriteHeader(http.StatusPartialContent)
					_, _ = w.Write(test.body)
				default:
					http.NotFound(w, r)
				}
			}))
			defer server.Close()

			storagePath := "orgs/example/properties/example/asset/photo.jpg"
			input := CreatePropertyAssetInput{AssetType: "photo", StoragePath: &storagePath}
			repo := Repository{storage: newStorageClient(StorageConfig{ProjectURL: server.URL, APIKey: "service-key"})}
			err := repo.verifyStoredPropertyAsset(context.Background(), &input)
			if test.wantError {
				if !errors.Is(err, ErrInvalidInput) {
					t.Fatalf("spoofed JPEG error = %v, want invalid input", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("valid JPEG verification failed: %v", err)
			}
			if input.MIMEType == nil || *input.MIMEType != "image/jpeg" || input.FileSizeBytes == nil || *input.FileSizeBytes != 4096 {
				t.Fatalf("verified metadata = mime %#v size %#v", input.MIMEType, input.FileSizeBytes)
			}
		})
	}
}

func TestPropertyStorageSignedUploadInfoBatchAndRemove(t *testing.T) {
	requests := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer header.payload.signature" || r.Header.Get("apikey") != "header.payload.signature" {
			t.Fatalf("storage request omitted server credentials: %#v", r.Header)
		}
		requests = append(requests, r.Method+" "+r.URL.Path)
		switch {
		case strings.Contains(r.URL.Path, "/object/upload/sign/"):
			_ = json.NewEncoder(w).Encode(map[string]string{
				"url": "/object/upload/sign/property-private/example?token=upload-token",
			})
		case strings.Contains(r.URL.Path, "/object/info/"):
			_ = json.NewEncoder(w).Encode(map[string]any{
				"metadata": map[string]any{"mimetype": "image/jpeg", "size": float64(4096)},
			})
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/object/sign/property-private"):
			_ = json.NewEncoder(w).Encode([]map[string]any{
				{"path": "b.jpg", "signedURL": "/object/sign/property-private/b.jpg?token=b"},
				{"path": "a.jpg", "signedURL": "/object/sign/property-private/a.jpg?token=a"},
			})
		case r.Method == http.MethodDelete:
			_ = json.NewEncoder(w).Encode([]any{})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := newStorageClient(StorageConfig{ProjectURL: server.URL, APIKey: "header.payload.signature"})
	signedURL, token, err := client.createSignedUploadURL(context.Background(), propertyPrivateBucket, "example")
	if err != nil || token != "upload-token" || !strings.Contains(signedURL, "/storage/v1/object/upload/sign/") {
		t.Fatalf("signed upload = %q, %q, %v", signedURL, token, err)
	}
	info, err := client.objectInfo(context.Background(), propertyPrivateBucket, "example")
	if err != nil || info.MIMEType != "image/jpeg" || info.Size != 4096 {
		t.Fatalf("object info = %#v, %v", info, err)
	}
	urls, err := client.createSignedURLs(context.Background(), propertyPrivateBucket, []string{"a.jpg", "b.jpg"}, 90*time.Second)
	if err != nil || !strings.Contains(urls["a.jpg"], "token=a") || !strings.Contains(urls["b.jpg"], "token=b") {
		t.Fatalf("signed URL batch = %#v, %v", urls, err)
	}
	if err := client.remove(context.Background(), propertyPrivateBucket, []string{"a.jpg"}); err != nil {
		t.Fatalf("remove returned error: %v", err)
	}
	if len(requests) != 4 {
		t.Fatalf("storage request count = %d, want 4: %#v", len(requests), requests)
	}
}

func TestPropertyStorageUsesAPIKeyOnlyForOpaqueSecret(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "https://project.supabase.co/storage/v1/object", nil)
	client := newStorageClient(StorageConfig{ProjectURL: "https://project.supabase.co", APIKey: "sb_secret_example"})
	client.setAuthorizedHeaders(request)
	if request.Header.Get("apikey") != "sb_secret_example" {
		t.Fatal("opaque Supabase secret is missing apikey header")
	}
	if authorization := request.Header.Get("Authorization"); authorization != "" {
		t.Fatalf("opaque Supabase secret must not be sent as Bearer, got %q", authorization)
	}
}

func TestEnrichWorkspaceAssetAccessURLsMapsByAssetIdentity(t *testing.T) {
	pathsReceived := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Paths []string `json:"paths"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode signed URL batch: %v", err)
		}
		pathsReceived = append(pathsReceived, body.Paths...)
		items := []map[string]string{}
		for index := len(body.Paths) - 1; index >= 0; index-- {
			path := body.Paths[index]
			items = append(items, map[string]string{
				"path": path, "signedURL": "/object/sign/property-private/" + path + "?token=" + path,
			})
		}
		_ = json.NewEncoder(w).Encode(items)
	}))
	defer server.Close()

	pathOne := "orgs/" + testOrganizationID + "/properties/" + testPropertyID + "/" + testAssetID + "/one.jpg"
	assetThreeID := "55555555-5555-4555-8555-555555555555"
	pathThree := "orgs/" + testOrganizationID + "/properties/" + testPropertyID + "/" + assetThreeID + "/three.jpg"
	assets := []map[string]any{
		{"id": testAssetID, "storage_path": nil, "_storage_path_for_access": pathOne},
		{"id": "44444444-4444-4444-8444-444444444444", "storage_path": nil, "_storage_path_for_access": "legacy/path.jpg"},
		{"id": assetThreeID, "storage_path": nil, "_storage_path_for_access": pathThree},
	}
	repository := Repository{storage: newStorageClient(StorageConfig{ProjectURL: server.URL, APIKey: "service-key"})}
	repository.enrichWorkspaceAssetAccessURLs(context.Background(), testOrganizationID, testPropertyID, assets)

	sort.Strings(pathsReceived)
	wantPaths := []string{pathOne, pathThree}
	sort.Strings(wantPaths)
	if !reflect.DeepEqual(pathsReceived, wantPaths) {
		t.Fatalf("signed paths = %#v, want %#v", pathsReceived, wantPaths)
	}
	if !strings.Contains(workspaceString(assets[0], "access_url"), pathOne) {
		t.Fatalf("first asset received wrong signed URL: %#v", assets[0])
	}
	if _, exists := assets[1]["access_url"]; exists {
		t.Fatalf("legacy path received another asset URL: %#v", assets[1])
	}
	if !strings.Contains(workspaceString(assets[2], "access_url"), pathThree) {
		t.Fatalf("third asset received wrong signed URL: %#v", assets[2])
	}
	for _, asset := range assets {
		if _, leaked := asset["_storage_path_for_access"]; leaked {
			t.Fatalf("internal access path leaked: %#v", asset)
		}
		if asset["storage_path"] != nil {
			t.Fatalf("viewer storage path was restored: %#v", asset)
		}
	}
}
