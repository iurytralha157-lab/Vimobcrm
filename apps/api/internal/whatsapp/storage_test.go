package whatsapp

import "testing"

func TestWhatsAppStorageUsesDedicatedUploadTimeout(t *testing.T) {
	client := newStorageClient(StorageConfig{
		ProjectURL: "https://example.supabase.co",
		APIKey:     "test-key",
	})
	if client.httpClient == nil || client.httpClient.Timeout != whatsappStorageRequestTimeout {
		t.Fatalf("ordinary storage timeout = %v, want %s", client.httpClient, whatsappStorageRequestTimeout)
	}
	if client.uploadHTTPClient == nil || client.uploadHTTPClient.Timeout != whatsappStorageUploadTimeout {
		t.Fatalf("storage upload timeout = %v, want %s", client.uploadHTTPClient, whatsappStorageUploadTimeout)
	}
	if client.uploadHTTPClient.Timeout <= client.httpClient.Timeout {
		t.Fatalf("upload timeout %s must exceed ordinary timeout %s", client.uploadHTTPClient.Timeout, client.httpClient.Timeout)
	}
}

func TestStorageResolveSignedURL(t *testing.T) {
	client := storageClient{projectURL: "https://example.supabase.co"}

	cases := map[string]string{
		"/object/sign/whatsapp-media/file.png?token=abc":            "https://example.supabase.co/storage/v1/object/sign/whatsapp-media/file.png?token=abc",
		"object/sign/whatsapp-media/file.png?token=abc":             "https://example.supabase.co/storage/v1/object/sign/whatsapp-media/file.png?token=abc",
		"/storage/v1/object/sign/whatsapp-media/file.png?token=abc": "https://example.supabase.co/storage/v1/object/sign/whatsapp-media/file.png?token=abc",
		"https://cdn.example.com/file.png":                          "https://cdn.example.com/file.png",
	}

	for input, expected := range cases {
		if actual := client.resolveSignedURL(input); actual != expected {
			t.Fatalf("resolveSignedURL(%q) = %q, want %q", input, actual, expected)
		}
	}
}
