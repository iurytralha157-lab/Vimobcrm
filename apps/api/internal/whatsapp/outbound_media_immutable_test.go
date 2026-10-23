package whatsapp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestImmutableOutboundMediaRepairCannotOverwriteDigestPath(t *testing.T) {
	for _, scenario := range []struct {
		name, supplied, stored string
		collision              bool
		wantSuccess            bool
		wantPosts, wantGets    int
	}{
		{"repair different bytes", "changed", "original", false, false, 0, 0},
		{"repair same bytes create only", "original", "", false, true, 1, 0},
		{"repair same bytes existing object", "original", "original", true, true, 1, 1},
		{"repair rejects corrupted existing object", "original", "changed", true, false, 1, 1},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			posts, gets := 0, 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodGet {
					gets++
					_, _ = w.Write([]byte(scenario.stored))
					return
				}
				posts++
				if r.Header.Get("x-upsert") != "false" {
					t.Error("repair enabled overwrite of an immutable digest path")
				}
				body, _ := io.ReadAll(r.Body)
				if string(body) != scenario.supplied {
					t.Errorf("digest verification consumed upload body: %q", body)
				}
				if scenario.collision {
					w.WriteHeader(http.StatusBadRequest)
					_, _ = w.Write([]byte(`{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}`))
				}
			}))
			defer server.Close()
			client := newStorageClient(StorageConfig{ProjectURL: server.URL, APIKey: "synthetic"})
			path := outboundMediaImmutablePath("00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "SYNTHETIC", "image/png", outboundMediaDigest([]byte("original")))
			// This is the repair worker's existing upsert=true call. Use a
			// non-seekable reader as well as the seekable upload path below.
			err := client.upload(context.Background(), whatsappMediaBucket, path, "image/png", struct{ io.Reader }{strings.NewReader(scenario.supplied)}, true)
			if (err == nil) != scenario.wantSuccess || posts != scenario.wantPosts || gets != scenario.wantGets {
				t.Fatalf("repair success=%t posts=%d gets=%d wanted %t/%d/%d: %v", err == nil, posts, gets, scenario.wantSuccess, scenario.wantPosts, scenario.wantGets, err)
			}
		})
	}
}

func TestImmutableOutboundMediaRepairPreservesLegacyPathsAndSeekableBody(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		body, _ := io.ReadAll(r.Body)
		if string(body) != "original" {
			t.Errorf("upload body was not preserved: %q", body)
		}
		want := "true"
		if strings.Contains(r.URL.Path, "/outgoing/") {
			want = "false"
		}
		if r.Header.Get("x-upsert") != want {
			t.Errorf("path-specific overwrite policy = %q wanted %q", r.Header.Get("x-upsert"), want)
		}
	}))
	defer server.Close()
	client := newStorageClient(StorageConfig{ProjectURL: server.URL, APIKey: "synthetic"})
	for _, path := range []string{
		"orgs/synthetic/legacy/inbound.png",
		outboundMediaImmutablePath("00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "SYNTHETIC", "image/png", outboundMediaDigest([]byte("original"))),
	} {
		if err := client.upload(context.Background(), whatsappMediaBucket, path, "image/png", bytes.NewReader([]byte("original")), true); err != nil {
			t.Fatal(err)
		}
	}
	if requests != 2 {
		t.Fatalf("wanted one upload per path, got %d", requests)
	}
}

func TestImmutableOutboundMediaCollisionChecksExactBytes(t *testing.T) {
	for _, scenario := range []struct {
		name        string
		status      int
		body        string
		stored      []byte
		wantSuccess bool
	}{
		{"supabase duplicate same bytes", 400, `{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}`, []byte("original"), true},
		{"supabase duplicate different bytes", 400, `{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}`, []byte("replaced"), false},
		{"asset already exists", 400, `{"message":"Asset Already Exists"}`, []byte("original"), true},
		{"generic 400 does not reconcile", 400, `{"message":"Bad request"}`, []byte("original"), false},
		{"forbidden does not reconcile", 403, `{"message":"Asset Already Exists"}`, []byte("original"), false},
		{"server error does not reconcile", 500, `{"message":"Asset Already Exists"}`, []byte("original"), false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			posts, gets := 0, 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodPost {
					posts++
					if r.Header.Get("x-upsert") != "false" {
						t.Error("immutable media enabled overwrite")
					}
					w.WriteHeader(scenario.status)
					_, _ = w.Write([]byte(scenario.body))
					return
				}
				gets++
				if r.Header.Get("apikey") != "synthetic" {
					t.Error("digest read lacked private Storage authorization")
				}
				_, _ = w.Write(scenario.stored)
			}))
			defer server.Close()
			client := newStorageClient(StorageConfig{ProjectURL: server.URL, APIKey: "synthetic"})
			err := client.uploadImmutable(context.Background(), "orgs/synthetic/outgoing/file", "image/png", []byte("original"))
			if (err == nil) != scenario.wantSuccess {
				t.Fatalf("success=%t wanted=%t: %v", err == nil, scenario.wantSuccess, err)
			}
			if posts != 1 {
				t.Fatalf("upload attempted %d times", posts)
			}
			if strings.Contains(scenario.name, "does not reconcile") && gets != 0 {
				t.Fatal("unrelated error triggered private digest read")
			}
		})
	}
}

func TestImmutableOutboundMediaAmbiguousUploadDoesNotQueueOverwrite(t *testing.T) {
	var object []byte
	posts := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			_, _ = w.Write(object)
			return
		}
		posts++
		if r.Header.Get("x-upsert") != "false" {
			t.Error("immutable retry may overwrite")
		}
		if object != nil {
			w.WriteHeader(400)
			_ = json.NewEncoder(w).Encode(map[string]string{"statusCode": "409", "error": "Duplicate", "message": "The resource already exists"})
			return
		}
		object, _ = io.ReadAll(r.Body)
		w.WriteHeader(503)
	}))
	defer server.Close()
	client := newStorageClient(StorageConfig{ProjectURL: server.URL, APIKey: "synthetic"})
	if err := client.uploadImmutable(context.Background(), "synthetic", "image/png", []byte("original")); err == nil {
		t.Fatal("ambiguous HTTP 503 was classified as upload acceptance")
	}
	if err := client.uploadImmutable(context.Background(), "synthetic", "image/png", []byte("original")); err != nil {
		t.Fatal(err)
	}
	if posts != 2 || string(object) != "original" {
		t.Fatalf("reconciliation changed bytes: posts=%d object=%q", posts, object)
	}
	if err := client.uploadImmutable(context.Background(), "synthetic", "image/png", []byte("different")); !errors.Is(err, errOutboundMediaDigestMismatch) {
		t.Fatalf("different-byte collision accepted: %v", err)
	}
}
