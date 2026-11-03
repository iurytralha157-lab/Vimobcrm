package app

import (
	"os"
	"strings"
	"testing"
)

func TestHomePublicationImageRoutesKeepVariantAndSessionBoundaries(t *testing.T) {
	routes, err := os.ReadFile("routes.go")
	if err != nil {
		t.Fatal(err)
	}
	contract, err := os.ReadFile("../../../../packages/contracts/openapi/v1.yaml")
	if err != nil {
		t.Fatal(err)
	}
	documented := documentedOpenAPIOperations(t, string(contract))
	for route, handler := range map[string]string{
		"POST /v1/admin/home-publications/{id}/image":          "UploadHomePublicationImageAdmin",
		"DELETE /v1/admin/home-publications/{id}/image":        "DeleteHomePublicationImageAdmin",
		"POST /v1/admin/home-publications/{id}/mobile-image":   "UploadHomePublicationMobileImageAdmin",
		"DELETE /v1/admin/home-publications/{id}/mobile-image": "DeleteHomePublicationMobileImageAdmin",
	} {
		want := `mux.Handle("` + route + `", withActiveAuthTenant(http.HandlerFunc(adminHandler.` + handler + `)))`
		if strings.Count(string(routes), want) != 1 {
			t.Errorf("image variant route must retain its own handler and active-session boundary: %s", route)
		}
		parts := strings.SplitN(route, " ", 2)
		if _, ok := documented[parts[1]][strings.ToLower(parts[0])]; !ok {
			t.Errorf("image route missing from OpenAPI: %s", route)
		}
	}
}

func TestHomePublicationOpenAPIKeepsMobileAnOptionalOptIn(t *testing.T) {
	source, err := os.ReadFile("../../../../packages/contracts/openapi/v1.yaml")
	if err != nil {
		t.Fatal(err)
	}
	contract := string(source)
	feed := homePublicationContractBlock(t, contract, "  /v1/home/publications:\n", "  /v1/home/assistant:\n")
	for _, want := range []string{"name: include_mobile", "required: false", "default: false", "legacy nine-field card"} {
		if !strings.Contains(feed, want) {
			t.Errorf("public mobile opt-in is not documented: %s", want)
		}
	}
	card := homePublicationContractBlock(t, contract, "    HomePublicationCard:\n", "    HomePublicationCardListEnvelope:\n")
	required := strings.SplitN(card, "      properties:\n", 2)
	if len(required) != 2 || strings.Contains(required[0], "mobileImageUrl") || !strings.Contains(required[1], "        mobileImageUrl:\n") {
		t.Fatal("mobileImageUrl must be an optional property, preserving older responses")
	}
	if strings.Contains(card, "storage_path") || strings.Contains(card, "StoragePath") {
		t.Fatal("storage paths do not belong to the public contract")
	}
}

func homePublicationContractBlock(t *testing.T, source, start, end string) string {
	t.Helper()
	a := strings.Index(source, start)
	if a < 0 {
		t.Fatalf("missing contract block %q", start)
	}
	b := strings.Index(source[a+len(start):], end)
	if b < 0 {
		t.Fatalf("missing end of contract block %q", start)
	}
	return source[a : a+len(start)+b]
}
