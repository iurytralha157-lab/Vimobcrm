package whatsapp

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// A bucket allow-list rejection names the mime type; the upload retries once
// as application/octet-stream. Parameters such as ";codecs=opus" never reach
// the bucket: the first attempt already sends the base type.
func TestUploadRetriesRejectedMimeAsOctetStream(t *testing.T) {
	t.Parallel()
	posts := 0
	var contentTypes []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("unexpected method %s", r.Method)
			return
		}
		posts++
		contentTypes = append(contentTypes, r.Header.Get("Content-Type"))
		if posts == 1 {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"statusCode":"400","error":"invalid_mime_type","message":"mime type audio/ogg is not supported"}`))
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client := newStorageClient(StorageConfig{ProjectURL: server.URL, APIKey: "synthetic"})
	err := client.upload(context.Background(), whatsappMediaBucket, "orgs/synthetic/audio-file", "audio/ogg;codecs=opus", bytes.NewReader([]byte("payload")), false)
	if err != nil {
		t.Fatalf("upload failed: %v", err)
	}
	if posts != 2 {
		t.Fatalf("upload attempted %d times, wanted 2", posts)
	}
	if contentTypes[0] != "audio/ogg" {
		t.Fatalf("first attempt content type %q, wanted base type audio/ogg", contentTypes[0])
	}
	if contentTypes[1] != "application/octet-stream" {
		t.Fatalf("retry content type %q, wanted application/octet-stream", contentTypes[1])
	}
}

// A generic 400 without a mime complaint stays a single attempt.
func TestUploadGenericBadRequestDoesNotRetry(t *testing.T) {
	t.Parallel()
	posts := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		posts++
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"message":"Bad request"}`))
	}))
	defer server.Close()

	client := newStorageClient(StorageConfig{ProjectURL: server.URL, APIKey: "synthetic"})
	err := client.upload(context.Background(), whatsappMediaBucket, "orgs/synthetic/audio-file", "audio/ogg", bytes.NewReader([]byte("payload")), false)
	if err == nil {
		t.Fatal("upload unexpectedly succeeded")
	}
	if posts != 1 {
		t.Fatalf("upload attempted %d times, wanted 1", posts)
	}
}
