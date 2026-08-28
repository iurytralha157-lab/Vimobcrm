package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func TestValidateHomePublicationAcceptsOnlyRealInternalRoutes(t *testing.T) {
	valid := validHomePublicationRecord()
	if err := validateHomePublication(&valid); err != nil {
		t.Fatalf("expected valid home publication, got %v", err)
	}

	for _, href := range []string{
		"https://attacker.invalid/crm/pipelines",
		"//attacker.invalid",
		"/attention",
		"/crm/management?tab=cadences",
		"/\\attacker.invalid",
		"/route-that-does-not-exist",
	} {
		item := validHomePublicationRecord()
		item.CTAHref = href
		if err := validateHomePublication(&item); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("CTA %q should be rejected, got %v", href, err)
		}
	}
}

func TestValidateHomePublicationEnforcesTargetShape(t *testing.T) {
	item := validHomePublicationRecord()
	item.TargetType = "organizations"
	item.TargetOrganizationIDs = []string{"20000000-0000-4000-8000-000000000001"}
	if err := validateHomePublication(&item); err != nil {
		t.Fatalf("expected organization target to be accepted, got %v", err)
	}

	item.TargetUserIDs = []string{"30000000-0000-4000-8000-000000000001"}
	if err := validateHomePublication(&item); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("mixed target arrays should be rejected, got %v", err)
	}

	item = validHomePublicationRecord()
	item.TargetType = "roles"
	item.TargetRoles = []string{"Corretor", "Administrador", "corretor"}
	if err := validateHomePublication(&item); err != nil {
		t.Fatalf("expected normalized role target to be accepted, got %v", err)
	}
	if strings.Join(item.TargetRoles, ",") != "admin,user" {
		t.Fatalf("roles were not normalized and deduplicated: %#v", item.TargetRoles)
	}

	item.TargetRoles = []string{"manager"}
	if err := validateHomePublication(&item); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("unreachable membership role should be rejected, got %v", err)
	}
}

func TestHomePublicationCardDoesNotExposeAudienceConfiguration(t *testing.T) {
	payload, err := json.Marshal(HomePublicationCard{
		ID:           "10000000-0000-4000-8000-000000000101",
		Title:        "Organize seu funil",
		Body:         "Acompanhe oportunidades no Pipeline.",
		CTALabel:     "Abrir Pipeline",
		CTAHref:      "/crm/pipelines",
		CardSize:     "wide",
		Accent:       "orange",
		DisplayOrder: 10,
	})
	if err != nil {
		t.Fatalf("marshal public home publication: %v", err)
	}
	for _, forbidden := range []string{
		"targetType",
		"targetOrganizationIds",
		"targetUserIds",
		"targetRoles",
		"startsAt",
		"endsAt",
		"isActive",
		"createdAt",
		"updatedAt",
	} {
		if bytes.Contains(payload, []byte(forbidden)) {
			t.Fatalf("public home publication leaked %q: %s", forbidden, payload)
		}
	}
}

func TestSanitizeHomeAssistantTextReturnsPlainText(t *testing.T) {
	input := `<style>body{display:none}</style><h1>Ajuda &amp; suporte</h1><script>alert("x")</script><p>Abra o <strong>Pipeline</strong>.</p>`
	got := sanitizeHomeAssistantText(input, 100)

	if got != "Ajuda & suporte Abra o Pipeline." {
		t.Fatalf("unexpected sanitized answer: %q", got)
	}
	for _, forbidden := range []string{"<", ">", "script", "alert(", "display:none"} {
		if strings.Contains(strings.ToLower(got), strings.ToLower(forbidden)) {
			t.Fatalf("sanitized answer still contains %q: %q", forbidden, got)
		}
	}
}

func TestSanitizeHomeAssistantTextLimitsRunes(t *testing.T) {
	got := sanitizeHomeAssistantText("a\u00e7\u00e3o r\u00e1pida para o pr\u00f3ximo contato", 10)
	if got != "a\u00e7\u00e3o r\u00e1pid\u2026" {
		t.Fatalf("expected rune-safe truncation, got %q", got)
	}
}

func TestHomePublicationImageTypesAreStrict(t *testing.T) {
	for _, contentType := range []string{"image/jpeg", "image/png", "image/webp"} {
		if !isHomePublicationImageType(contentType) {
			t.Fatalf("expected %q to be accepted", contentType)
		}
	}
	for _, contentType := range []string{"image/gif", "image/svg+xml", "text/html", "application/octet-stream"} {
		if isHomePublicationImageType(contentType) {
			t.Fatalf("expected %q to be rejected", contentType)
		}
	}
}

func TestHomePublicationStorageUsesBackendOnlyPlatformPrefix(t *testing.T) {
	var mu sync.Mutex
	methods := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("apikey") != "service-secret" {
			t.Error("storage request is missing backend authorization")
		}
		if authorization := r.Header.Get("Authorization"); authorization != "" {
			t.Errorf("opaque Supabase secret must not be sent as Bearer, got %q", authorization)
		}
		if !strings.HasPrefix(r.URL.Path, "/storage/v1/object/site-images/platform/home/") {
			t.Errorf("unexpected storage path %q", r.URL.Path)
		}
		mu.Lock()
		methods = append(methods, r.Method)
		mu.Unlock()
		if r.Method == http.MethodPost {
			payload, _ := io.ReadAll(r.Body)
			if string(payload) != "image-bytes" {
				t.Errorf("unexpected upload body %q", payload)
			}
			w.WriteHeader(http.StatusCreated)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	repo := Repository{
		projectURL: server.URL,
		apiKey:     "service-secret",
		httpClient: server.Client(),
	}
	path := "platform/home/10000000-0000-4000-8000-000000000101/image.webp"
	if err := repo.uploadHomePublicationObject(context.Background(), path, "image/webp", bytes.NewBufferString("image-bytes")); err != nil {
		t.Fatalf("upload failed: %v", err)
	}
	if err := repo.deleteHomePublicationObject(context.Background(), path); err != nil {
		t.Fatalf("delete failed: %v", err)
	}
	if err := repo.deleteHomePublicationObject(context.Background(), "organizations/foreign/image.webp"); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("foreign prefix should be rejected, got %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if strings.Join(methods, ",") != "POST,DELETE" {
		t.Fatalf("unexpected storage methods: %#v", methods)
	}
}

func TestHomePublicationStorageUsesBearerOnlyForLegacyJWTKeys(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "https://project.supabase.co/storage/v1/object", nil)
	setHomePublicationStorageAuth(request, "header.payload.signature")
	if request.Header.Get("apikey") != "header.payload.signature" {
		t.Fatal("legacy service-role JWT is missing apikey header")
	}
	if request.Header.Get("Authorization") != "Bearer header.payload.signature" {
		t.Fatal("legacy service-role JWT is missing Bearer authorization")
	}

	setHomePublicationStorageAuth(request, "sb_secret_example")
	if request.Header.Get("apikey") != "sb_secret_example" {
		t.Fatal("opaque secret is missing apikey header")
	}
	if authorization := request.Header.Get("Authorization"); authorization != "" {
		t.Fatalf("opaque secret must not be sent as Bearer, got %q", authorization)
	}
}

func validHomePublicationRecord() homePublicationRecord {
	return homePublicationRecord{
		HomePublication: HomePublication{
			Title:                 "Organize seu funil",
			Body:                  "Acompanhe oportunidades no Pipeline.",
			CTALabel:              "Abrir Pipeline",
			CTAHref:               "/crm/pipelines",
			CardSize:              "wide",
			Accent:                "orange",
			DisplayOrder:          10,
			IsActive:              true,
			TargetType:            "all",
			TargetOrganizationIDs: []string{},
			TargetUserIDs:         []string{},
			TargetRoles:           []string{},
		},
	}
}
