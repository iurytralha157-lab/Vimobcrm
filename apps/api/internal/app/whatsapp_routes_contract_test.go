package app

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

func TestAuthenticatedWhatsAppRoutesRequireModuleAndPermission(t *testing.T) {
	raw, err := os.ReadFile("app.go")
	if err != nil {
		t.Fatalf("read app.go: %v", err)
	}
	source := string(raw)

	registeredRoute := regexp.MustCompile(`mux\.Handle\("(?:GET|POST|PATCH|DELETE) /v1/whatsapp/[^\"]+", ([^\n]+)`)
	matches := registeredRoute.FindAllStringSubmatch(source, -1)
	if len(matches) == 0 {
		t.Fatal("no authenticated WhatsApp routes found")
	}

	for _, match := range matches {
		registration := match[0]
		guard := match[1]
		if !strings.Contains(guard, `withModulePermission("whatsapp", permissions.WhatsApp`) {
			t.Fatalf("WhatsApp route is missing module + permission guard: %s", registration)
		}
	}
}
