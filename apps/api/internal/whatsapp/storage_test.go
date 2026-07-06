package whatsapp

import "testing"

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
