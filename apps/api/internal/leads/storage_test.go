package leads

import "testing"

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
