package app

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

func TestAuthenticatedWhatsAppRoutesRequireModuleAndPermission(t *testing.T) {
	raw, err := os.ReadFile("routes.go")
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

func TestWhatsAppUnreadCountRouteUsesViewPermission(t *testing.T) {
	raw, err := os.ReadFile("routes.go")
	if err != nil {
		t.Fatalf("read routes.go: %v", err)
	}

	expected := `mux.Handle("GET /v1/whatsapp/conversations/unread-count", withModulePermission("whatsapp", permissions.WhatsAppView, http.HandlerFunc(whatsappHandler.CountUnreadConversations)))`
	if !strings.Contains(string(raw), expected) {
		t.Fatal("WhatsApp unread count must stay behind the WhatsApp view permission")
	}
}

func TestWhatsAppConversationSnapshotRouteUsesViewPermission(t *testing.T) {
	raw, err := os.ReadFile("routes.go")
	if err != nil {
		t.Fatalf("read routes.go: %v", err)
	}

	expected := `mux.Handle("GET /v1/whatsapp/conversations/{id}/snapshot", withModulePermission("whatsapp", permissions.WhatsAppView, http.HandlerFunc(whatsappHandler.ShowConversationSnapshot)))`
	if !strings.Contains(string(raw), expected) {
		t.Fatal("WhatsApp conversation snapshot must stay behind the WhatsApp view permission")
	}
}

func TestWhatsAppSessionStatusesRouteUsesViewPermission(t *testing.T) {
	raw, err := os.ReadFile("routes.go")
	if err != nil {
		t.Fatalf("read routes.go: %v", err)
	}

	expected := `mux.Handle("GET /v1/whatsapp/session-statuses", withModulePermission("whatsapp", permissions.WhatsAppView, http.HandlerFunc(whatsappHandler.ListSessionStatuses)))`
	if !strings.Contains(string(raw), expected) {
		t.Fatal("WhatsApp session statuses must stay behind the WhatsApp module and view permission")
	}
}

func TestWhatsAppLazyMediaURLRouteUsesViewPermission(t *testing.T) {
	raw, err := os.ReadFile("routes.go")
	if err != nil {
		t.Fatalf("read routes.go: %v", err)
	}

	expected := `mux.Handle("GET /v1/whatsapp/messages/{id}/media-url", withModulePermission("whatsapp", permissions.WhatsAppView, http.HandlerFunc(whatsappHandler.GetMessageMediaURL)))`
	if !strings.Contains(string(raw), expected) {
		t.Fatal("WhatsApp lazy media URL must stay behind the WhatsApp view permission")
	}
}
