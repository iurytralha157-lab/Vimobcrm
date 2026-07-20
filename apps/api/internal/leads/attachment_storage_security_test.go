package leads

import "testing"

func TestStoragePathFromPublicURLRejectsForeignOriginWithSupabasePath(t *testing.T) {
	foreignURL := "https://attacker.invalid/storage/v1/object/public/whatsapp-media/orgs/org-b/leads/lead-b/private.pdf"
	if got := storagePathFromPublicURL(foreignURL, "https://project.supabase.co"); got != "" {
		t.Fatalf("foreign storage-looking URL resolved to %q", got)
	}
}

func TestLeadAttachmentStoragePathBelongsToOrganization(t *testing.T) {
	organizationID := "20000000-0000-0000-0000-000000000001"
	tests := []struct {
		name string
		path string
		want bool
	}{
		{name: "scoped", path: "orgs/" + organizationID + "/leads/lead/docs/file.pdf", want: true},
		{name: "legacy tenant root", path: organizationID + "/messages/file.pdf", want: true},
		{name: "foreign tenant", path: "orgs/20000000-0000-0000-0000-000000000002/leads/lead/docs/file.pdf", want: false},
		{name: "traversal", path: "orgs/" + organizationID + "/../foreign/file.pdf", want: false},
		{name: "encoded path", path: "orgs/" + organizationID + "/%2e%2e/foreign/file.pdf", want: false},
		{name: "backslash", path: "orgs\\" + organizationID + "\\file.pdf", want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := leadAttachmentStoragePathBelongsToOrganization(test.path, organizationID); got != test.want {
				t.Fatalf("leadAttachmentStoragePathBelongsToOrganization(%q) = %t, want %t", test.path, got, test.want)
			}
		})
	}
}
