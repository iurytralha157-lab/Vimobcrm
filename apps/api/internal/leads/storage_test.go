package leads

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestResolveSignedURL(t *testing.T) {
	client := storageClient{projectURL: "https://example.supabase.co"}

	tests := []struct {
		name   string
		input  string
		output string
	}{
		{
			name:   "supabase relative object path",
			input:  "/object/sign/whatsapp-media/file.png?token=abc",
			output: "https://example.supabase.co/storage/v1/object/sign/whatsapp-media/file.png?token=abc",
		},
		{
			name:   "supabase relative storage path",
			input:  "/storage/v1/object/sign/whatsapp-media/file.png?token=abc",
			output: "https://example.supabase.co/storage/v1/object/sign/whatsapp-media/file.png?token=abc",
		},
		{
			name:   "absolute url",
			input:  "https://cdn.example.com/file.png?token=abc",
			output: "https://cdn.example.com/file.png?token=abc",
		},
		{
			name:   "empty value",
			input:  " ",
			output: "",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := client.resolveSignedURL(test.input); got != test.output {
				t.Fatalf("resolveSignedURL() = %q, want %q", got, test.output)
			}
		})
	}
}

func TestDeleteStorageObject(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			t.Fatalf("method = %s, want DELETE", r.Method)
		}
		if r.URL.Path != "/storage/v1/object/whatsapp-media/orgs/org-1/leads/lead-1/file.txt" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if r.Header.Get("apikey") != "sb_secret_leads_test" || r.Header.Get("Authorization") != "" {
			t.Fatal("invalid opaque storage authorization")
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client := storageClient{
		projectURL: server.URL,
		apiKey:     "sb_secret_leads_test",
		httpClient: server.Client(),
	}
	if err := client.delete(context.Background(), "whatsapp-media", "orgs/org-1/leads/lead-1/file.txt"); err != nil {
		t.Fatalf("delete() error = %v", err)
	}
}
