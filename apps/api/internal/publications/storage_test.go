package publications

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestPublicationStorageSignsPrivateObjectWithCompatibleServiceAuth(t *testing.T) {
	testCases := []struct {
		name           string
		apiKey         string
		expectedBearer string
	}{
		{name: "opaque secret", apiKey: "sb_secret_example"},
		{name: "legacy service role JWT", apiKey: "header.payload.signature", expectedBearer: "Bearer header.payload.signature"},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			const objectPath = "organizations/example/property/photo 1.jpg"
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				if request.Method != http.MethodPost || request.URL.Path != "/storage/v1/object/sign/property-private" {
					t.Fatalf("unexpected request: %s %s", request.Method, request.URL.Path)
				}
				if request.Header.Get("apikey") != testCase.apiKey || request.Header.Get("Authorization") != testCase.expectedBearer {
					t.Fatalf("unexpected service auth headers: %#v", request.Header)
				}
				if contentType := request.Header.Get("Content-Type"); contentType != "application/json" {
					t.Fatalf("Content-Type = %q", contentType)
				}
				var payload struct {
					ExpiresIn int      `json:"expiresIn"`
					Paths     []string `json:"paths"`
				}
				if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
					t.Fatal(err)
				}
				if payload.ExpiresIn != 90 || len(payload.Paths) != 1 || payload.Paths[0] != objectPath {
					t.Fatalf("unexpected signing payload: %#v", payload)
				}
				_ = json.NewEncoder(response).Encode([]map[string]string{{
					"path":      objectPath,
					"signedURL": "/object/sign/property-private/example?token=signed",
				}})
			}))
			defer server.Close()

			client := newPublicationStorageClient(server.URL, testCase.apiKey)
			signedURL, err := client.signedURL(context.Background(), objectPath, 90*time.Second)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.HasPrefix(signedURL, server.URL+"/storage/v1/object/sign/property-private/example?") {
				t.Fatalf("signed URL = %q", signedURL)
			}
		})
	}
}
