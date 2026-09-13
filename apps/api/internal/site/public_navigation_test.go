package site

import "testing"

func TestSanitizePublicNavigationDropsQueryFragmentAndCredentials(t *testing.T) {
	t.Parallel()

	value := "https://user:secret@Partner.Example/imoveis/123?email=lead@example.com#form"
	got := sanitizePublicNavigationPointer(&value, 2000)
	if got == nil || *got != "https://partner.example/imoveis/123" {
		t.Fatalf("sanitized navigation = %v", got)
	}
}

func TestSanitizePublicNavigationAcceptsOnlyHTTPOrRelativePaths(t *testing.T) {
	t.Parallel()

	for _, value := range []string{"javascript:alert(1)", "mailto:lead@example.com", "relative-path"} {
		if got := sanitizePublicNavigationPointer(&value, 2000); got != nil {
			t.Fatalf("unsafe navigation %q became %q", value, *got)
		}
	}
	relative := "/imoveis?token=secret#contact"
	if got := sanitizePublicNavigationPointer(&relative, 2000); got == nil || *got != "/imoveis" {
		t.Fatalf("relative navigation = %v", got)
	}
}

func TestSanitizePublicPagePathNeverPersistsQueryData(t *testing.T) {
	t.Parallel()

	if got := sanitizePublicPagePath("/imoveis?email=lead@example.com#form"); got != "/imoveis" {
		t.Fatalf("page path = %q", got)
	}
	if got := sanitizePublicPagePath("https://site.example/imovel/123?token=secret"); got != "/imovel/123" {
		t.Fatalf("absolute page path = %q", got)
	}
}
