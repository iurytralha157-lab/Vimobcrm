package whatsapp

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestRemoveWhatsAppMediaObjectRequiresExactStorageConfirmation(t *testing.T) {
	const organizationID = "20000000-0000-0000-0000-000000000041"
	const foreignID = "20000000-0000-0000-0000-000000000042"
	path := "orgs/" + organizationID + "/sessions/session-1/incoming/image.png"
	for _, test := range []struct {
		name       string
		deleteCode int
		getCode    int
		wantError  bool
		wantGets   int32
	}{
		{name: "confirmed delete", deleteCode: http.StatusOK},
		{name: "already absent", deleteCode: http.StatusNotFound, getCode: http.StatusNotFound, wantGets: 1},
		{name: "not found but object still exists", deleteCode: http.StatusNotFound, getCode: http.StatusPartialContent, wantError: true, wantGets: 1},
		{name: "provider error", deleteCode: http.StatusServiceUnavailable, wantError: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			var deletes, gets atomic.Int32
			storage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if !strings.HasSuffix(r.URL.Path, "/whatsapp-media/"+path) {
					t.Errorf("Storage path = %q, want exact object path", r.URL.Path)
				}
				switch r.Method {
				case http.MethodDelete:
					deletes.Add(1)
					w.WriteHeader(test.deleteCode)
				case http.MethodGet:
					gets.Add(1)
					if r.Header.Get("Range") != "bytes=0-0" {
						t.Errorf("existence check Range = %q", r.Header.Get("Range"))
					}
					w.WriteHeader(test.getCode)
				default:
					t.Errorf("unexpected Storage method %s", r.Method)
				}
			}))
			defer storage.Close()
			client := newStorageClient(StorageConfig{ProjectURL: storage.URL, APIKey: "service-role-test-key"})
			err := client.removeWhatsAppMediaObject(context.Background(), organizationID, path)
			if (err != nil) != test.wantError {
				t.Fatalf("delete error = %v, wantError %v", err, test.wantError)
			}
			if deletes.Load() != 1 || gets.Load() != test.wantGets {
				t.Fatalf("Storage requests delete=%d get=%d, want 1/%d", deletes.Load(), gets.Load(), test.wantGets)
			}
			if err := client.removeWhatsAppMediaObject(context.Background(), foreignID, path); err == nil {
				t.Fatal("cross-organization delete was accepted")
			}
			if deletes.Load() != 1 {
				t.Fatal("cross-organization delete reached Storage")
			}
		})
	}
}

func TestRemoveWhatsAppMediaObjectTimeoutHasUnknownOutcome(t *testing.T) {
	const organizationID = "20000000-0000-0000-0000-000000000043"
	path := "orgs/" + organizationID + "/assets/v2/image.png"
	storage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	defer storage.Close()
	client := newStorageClient(StorageConfig{ProjectURL: storage.URL, APIKey: "service-role-test-key"})
	client.httpClient.Timeout = 25 * time.Millisecond
	err := client.removeWhatsAppMediaObject(context.Background(), organizationID, path)
	if err == nil || !errors.Is(err, context.DeadlineExceeded) && !strings.Contains(err.Error(), "Client.Timeout") {
		t.Fatalf("timed-out delete result = %v, want unknown error", err)
	}
}
