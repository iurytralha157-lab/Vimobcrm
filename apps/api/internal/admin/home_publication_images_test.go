package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestHomePublicationMobileProjectionIsExplicitAndLegacyCompatible(t *testing.T) {
	desktop, mobile := "https://images.example.invalid/desktop.png", "https://images.example.invalid/mobile.png"
	input := []HomePublicationCard{{ID: "publication", ImageURL: &desktop, MobileImageURL: &mobile}}
	for _, includeMobile := range []bool{false, true} {
		cards := homePublicationCardsForClient(input, includeMobile)
		payload, err := json.Marshal(cards[0])
		if err != nil {
			t.Fatal(err)
		}
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(payload, &fields); err != nil {
			t.Fatal(err)
		}
		_, mobilePresent := fields["mobileImageUrl"]
		if mobilePresent != includeMobile {
			t.Fatalf("mobile field opt-in mismatch: include=%v payload=%s", includeMobile, payload)
		}
		if !includeMobile && len(fields) != 9 {
			t.Fatalf("legacy clients require exactly nine fields, got %d", len(fields))
		}
		if cards[0].ImageURL == nil || *cards[0].ImageURL != desktop {
			t.Fatal("desktop field changed during projection")
		}
	}
	if input[0].MobileImageURL == nil || *input[0].MobileImageURL != mobile {
		t.Fatal("legacy projection mutated the source card")
	}
	if got := homePublicationCardsForClient(nil, false); got == nil {
		t.Fatal("an empty feed must encode as an array, not null")
	}
}

type homePublicationImageScannerFunc func(...any) error

func (scan homePublicationImageScannerFunc) Scan(dest ...any) error { return scan(dest...) }

func TestHomePublicationScannersKeepMobileAndDesktopIndependent(t *testing.T) {
	card, err := scanHomePublicationCard(homePublicationImageScannerFunc(func(dest ...any) error {
		if len(dest) != 10 {
			t.Fatalf("public projection expects ten selected columns, got %d", len(dest))
		}
		*dest[5].(*pgtype.Text) = pgtype.Text{String: "desktop-url", Valid: true}
		*dest[6].(*pgtype.Text) = pgtype.Text{String: "mobile-url", Valid: true}
		return nil
	}))
	if err != nil || card.ImageURL == nil || *card.ImageURL != "desktop-url" || card.MobileImageURL == nil || *card.MobileImageURL != "mobile-url" {
		t.Fatalf("public scanner mixed variants: %#v, %v", card, err)
	}
	record, err := scanHomePublication(homePublicationImageScannerFunc(func(dest ...any) error {
		if len(dest) != 21 {
			t.Fatalf("admin projection expects 21 selected columns, got %d", len(dest))
		}
		for index, value := range map[int]string{5: "desktop-url", 6: "desktop-private-path", 7: "mobile-url", 8: "mobile-private-path"} {
			*dest[index].(*pgtype.Text) = pgtype.Text{String: value, Valid: true}
		}
		return nil
	}))
	if err != nil || record.MobileImageURL == nil || *record.MobileImageURL != "mobile-url" || record.ImageStoragePath != "desktop-private-path" || record.MobileImageStoragePath != "mobile-private-path" {
		t.Fatalf("admin scanner mixed variants: %#v, %v", record, err)
	}
	payload, err := json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"StoragePath", "storage_path", "private-path"} {
		if bytes.Contains(payload, []byte(forbidden)) {
			t.Fatalf("storage internals leaked through JSON: %s", payload)
		}
	}
}

func TestHomePublicationImageVariantIsClosedAndCannotTargetDesktopByFallback(t *testing.T) {
	record := homePublicationRecord{ImageStoragePath: "desktop", MobileImageStoragePath: "mobile"}
	for value := 0; value <= 255; value++ {
		variant := homePublicationImageVariant(value)
		columns, err := variant.columns()
		switch variant {
		case homePublicationDesktopImage:
			if err != nil || columns.urlColumn != "image_url" || columns.storageColumn != "image_storage_path" || columns.directory != "" || variant.storagePath(record) != "desktop" {
				t.Fatal("desktop contract changed")
			}
		case homePublicationMobileImage:
			if err != nil || columns.urlColumn != "mobile_image_url" || columns.storageColumn != "mobile_image_storage_path" || columns.directory != "mobile/" || variant.storagePath(record) != "mobile" {
				t.Fatal("mobile variant must use separate columns and object directory")
			}
		default:
			if !errors.Is(err, ErrInvalidInput) || variant.storagePath(record) != "" {
				t.Fatalf("unknown variant %d was accepted or fell back to desktop", value)
			}
		}
	}
	admin := tenant.Context{IsSuperAdmin: true}
	if _, _, err := (Repository{}).uploadHomePublicationImage(context.Background(), admin, "id", "image/png", bytes.NewReader(nil), 255); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("unknown upload variant reached the database: %v", err)
	}
	if _, _, err := (Repository{}).clearHomePublicationImage(context.Background(), admin, "id", 255); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("unknown delete variant reached the database: %v", err)
	}
}

func TestHomePublicationImageEndpointsRequireSuperAdminBeforeDataOrStorage(t *testing.T) {
	handler := Handler{}
	for name, serve := range map[string]http.HandlerFunc{
		"desktop-upload": handler.UploadHomePublicationImageAdmin,
		"mobile-upload":  handler.UploadHomePublicationMobileImageAdmin,
		"desktop-delete": handler.DeleteHomePublicationImageAdmin,
		"mobile-delete":  handler.DeleteHomePublicationMobileImageAdmin,
	} {
		for _, actor := range []string{"anonymous", "organization-admin"} {
			t.Run(name+"/"+actor, func(t *testing.T) {
				request := httptest.NewRequest(http.MethodPost, "/image", nil)
				if actor != "anonymous" {
					request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{UserID: "actor", MemberRole: "admin"}))
				}
				response := httptest.NewRecorder()
				serve(response, request)
				if response.Code != http.StatusForbidden {
					t.Fatalf("expected superadmin denial before any dependency, got %d", response.Code)
				}
			})
		}
	}
}

func TestHomePublicationBothImageVariantsShareSniffAndSizeRules(t *testing.T) {
	for _, variant := range []homePublicationImageVariant{homePublicationDesktopImage, homePublicationMobileImage} {
		for _, scenario := range []struct {
			name string
			body []byte
		}{
			{"spoofed-png", []byte("<html>not an image</html>")},
			{"over-5-MiB", append([]byte{137, 80, 78, 71, 13, 10, 26, 10}, make([]byte, homePublicationImageLimit-7)...)},
		} {
			var body bytes.Buffer
			form := multipart.NewWriter(&body)
			file, err := form.CreateFormFile("file", "image.png")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := file.Write(scenario.body); err != nil {
				t.Fatal(err)
			}
			if err := form.Close(); err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest(http.MethodPost, "/image", &body)
			request.SetPathValue("id", "10000000-0000-4000-8000-000000000101")
			request.Header.Set("Content-Type", form.FormDataContentType())
			request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{IsSuperAdmin: true}))
			response := httptest.NewRecorder()
			(Handler{}).uploadHomePublicationImage(response, request, variant)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("variant %d accepted %s: %d", variant, scenario.name, response.Code)
			}
		}
	}
}

func TestHomePublicationCleanupAttemptsBothVariantsAndNeverForeignObjects(t *testing.T) {
	var mu sync.Mutex
	paths := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		paths = append(paths, r.URL.Path)
		mu.Unlock()
		if strings.HasSuffix(r.URL.Path, "/desktop.png") {
			http.Error(w, "private-storage-failure", http.StatusBadGateway)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	repo := Repository{projectURL: server.URL, apiKey: "synthetic-service-key", httpClient: server.Client()}
	desktop, mobile := "platform/home/publication/desktop.png", "platform/home/publication/mobile/mobile.png"
	if repo.cleanupHomePublicationObjects([]string{desktop, mobile, desktop, "", "organizations/foreign/image.png"}) {
		t.Fatal("cleanup must signal a failed or foreign object")
	}
	mu.Lock()
	defer mu.Unlock()
	if len(paths) != 2 || !strings.HasSuffix(paths[0], "/desktop.png") || !strings.HasSuffix(paths[1], "/mobile/mobile.png") {
		t.Fatalf("cleanup must independently attempt both owned variants only, got %#v", paths)
	}
	response := httptest.NewRecorder()
	writeHomePublicationError(response, httptest.NewRequest(http.MethodPost, "/image", nil), errors.Join(errHomePublicationStorageOperation, errors.New(desktop)))
	if response.Code != http.StatusBadGateway || strings.Contains(response.Body.String(), desktop) || strings.Contains(response.Body.String(), "private-storage-failure") {
		t.Fatal("storage failures must not expose object paths or provider errors")
	}
}
