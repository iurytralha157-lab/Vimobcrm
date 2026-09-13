package supabasehttp

import "testing"

func TestEscapeObjectPathEscapesSegmentsWithoutEscapingSeparators(t *testing.T) {
	t.Parallel()

	got := EscapeObjectPath("/organizations/Example CRM/photos/front door #%2F.jpg/")
	want := "organizations/Example%20CRM/photos/front%20door%20%23%252F.jpg"
	if got != want {
		t.Fatalf("EscapeObjectPath() = %q, want %q", got, want)
	}
}

func TestPublicObjectURLUsesOnlyThePublicStorageEndpoint(t *testing.T) {
	t.Parallel()

	got := PublicObjectURL(
		" https://project.supabase.co/ ",
		"site images",
		"organizations/example/home hero.webp",
	)
	want := "https://project.supabase.co/storage/v1/object/public/site%20images/organizations/example/home%20hero.webp"
	if got != want {
		t.Fatalf("PublicObjectURL() = %q, want %q", got, want)
	}
}

func TestPublicObjectURLRequiresProjectURL(t *testing.T) {
	t.Parallel()

	if got := PublicObjectURL(" ", "site-images", "example.webp"); got != "" {
		t.Fatalf("PublicObjectURL() = %q, want empty", got)
	}
}
