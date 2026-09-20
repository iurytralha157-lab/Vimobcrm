package leads

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

const (
	avatarTestOrganizationID = "22222222-2222-4222-8222-222222222222"
	avatarTestLeadID         = "11111111-1111-4111-8111-111111111111"
)

func avatarTestStoragePath(organizationID string, leadID string) string {
	return "orgs/" + organizationID + "/profile-pictures/" + leadID + "/" + strings.Repeat("a", 64) + ".jpg"
}

func TestWhatsAppAvatarStoragePathRequiresExactLeadAndOrganizationScope(t *testing.T) {
	validPath := avatarTestStoragePath(avatarTestOrganizationID, avatarTestLeadID)
	tests := []struct {
		name string
		path string
		org  string
		lead string
		want bool
	}{
		{name: "valid", path: validPath, org: avatarTestOrganizationID, lead: avatarTestLeadID, want: true},
		{name: "foreign organization", path: validPath, org: "33333333-3333-4333-8333-333333333333", lead: avatarTestLeadID},
		{name: "foreign lead", path: validPath, org: avatarTestOrganizationID, lead: "44444444-4444-4444-8444-444444444444"},
		{name: "parent traversal", path: strings.Replace(validPath, "/"+strings.Repeat("a", 64)+".jpg", "/../avatar.jpg", 1), org: avatarTestOrganizationID, lead: avatarTestLeadID},
		{name: "encoded traversal", path: strings.Replace(validPath, "/"+strings.Repeat("a", 64)+".jpg", "/%2e%2e/avatar.jpg", 1), org: avatarTestOrganizationID, lead: avatarTestLeadID},
		{name: "backslash", path: strings.Replace(validPath, "/"+strings.Repeat("a", 64)+".jpg", `\avatar.jpg`, 1), org: avatarTestOrganizationID, lead: avatarTestLeadID},
		{name: "query", path: validPath + "?download=1", org: avatarTestOrganizationID, lead: avatarTestLeadID},
		{name: "fragment", path: validPath + "#avatar", org: avatarTestOrganizationID, lead: avatarTestLeadID},
		{name: "blank suffix", path: strings.TrimSuffix(validPath, strings.Repeat("a", 64)+".jpg"), org: avatarTestOrganizationID, lead: avatarTestLeadID},
		{name: "non digest basename", path: strings.Replace(validPath, strings.Repeat("a", 64)+".jpg", "avatar.jpg", 1), org: avatarTestOrganizationID, lead: avatarTestLeadID},
		{name: "uppercase digest", path: strings.Replace(validPath, strings.Repeat("a", 64)+".jpg", strings.Repeat("A", 64)+".jpg", 1), org: avatarTestOrganizationID, lead: avatarTestLeadID},
		{name: "nested suffix", path: strings.Replace(validPath, "/"+strings.Repeat("a", 64)+".jpg", "/nested/"+strings.Repeat("a", 64)+".jpg", 1), org: avatarTestOrganizationID, lead: avatarTestLeadID},
		{name: "surrounding whitespace", path: " " + validPath, org: avatarTestOrganizationID, lead: avatarTestLeadID},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := whatsAppAvatarStoragePathBelongsToLead(test.path, test.org, test.lead); got != test.want {
				t.Fatalf("path scope = %t, want %t for %q", got, test.want, test.path)
			}
		})
	}
}

func newAvatarSigningTestRepository(server *httptest.Server) Repository {
	return Repository{
		storage: storageClient{
			projectURL: server.URL,
			apiKey:     "service-key",
			httpClient: server.Client(),
		},
		whatsAppAvatarURLs:  newBoundedWhatsAppAvatarSignedURLCache(32),
		whatsAppAvatarSlots: make(chan struct{}, whatsAppAvatarSigningConcurrency),
	}
}

func TestWhatsAppAvatarReadModelsSignPrivateStoragePathAndReuseCache(t *testing.T) {
	if whatsAppAvatarSignedURLTTLSeconds > 60*60 {
		t.Fatalf("avatar bearer URL TTL = %ds, exceeds one-hour security bound", whatsAppAvatarSignedURLTTLSeconds)
	}
	if whatsAppAvatarSignedURLCacheSkew < 15*time.Minute {
		t.Fatalf("avatar cache skew = %s, want at least 15 minutes of client validity", whatsAppAvatarSignedURLCacheSkew)
	}
	storagePath := avatarTestStoragePath(avatarTestOrganizationID, avatarTestLeadID)
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.Method != http.MethodPost {
			t.Errorf("method = %s, want POST", r.Method)
		}
		wantPath := "/storage/v1/object/sign/whatsapp-media/" + storagePath
		if r.URL.Path != wantPath {
			t.Errorf("path = %q, want %q", r.URL.Path, wantPath)
		}
		var body map[string]int
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode signing payload: %v", err)
		}
		if body["expiresIn"] != whatsAppAvatarSignedURLTTLSeconds {
			t.Errorf("expiresIn = %d, want %d", body["expiresIn"], whatsAppAvatarSignedURLTTLSeconds)
		}
		_, _ = w.Write([]byte(`{"signedURL":"/object/sign/whatsapp-media/safe?token=avatar"}`))
	}))
	defer server.Close()
	repo := newAvatarSigningTestRepository(server)
	legacyURL := "https://pps.whatsapp.net/legacy.jpg"

	lead := Lead{
		ID:                        avatarTestLeadID,
		OrganizationID:            avatarTestOrganizationID,
		WhatsAppAvatarURL:         &legacyURL,
		WhatsAppAvatarStoragePath: &storagePath,
	}
	repo.hydrateLeadAvatar(context.Background(), avatarTestOrganizationID, &lead)

	boardLead := PipelineBoardLead{
		ID:                        avatarTestLeadID,
		OrganizationID:            avatarTestOrganizationID,
		WhatsAppAvatarURL:         &legacyURL,
		WhatsAppAvatarStoragePath: &storagePath,
	}
	repo.hydratePipelineBoardLeadAvatars(context.Background(), avatarTestOrganizationID, []*PipelineBoardLead{&boardLead})

	contacts := []Contact{{
		ID:                        avatarTestLeadID,
		WhatsAppAvatarURL:         &legacyURL,
		WhatsAppAvatarStoragePath: &storagePath,
	}}
	repo.hydrateContactAvatars(context.Background(), avatarTestOrganizationID, contacts)

	wantURL := server.URL + "/storage/v1/object/sign/whatsapp-media/safe?token=avatar"
	for name, got := range map[string]*string{
		"lead":    lead.WhatsAppAvatarURL,
		"board":   boardLead.WhatsAppAvatarURL,
		"contact": contacts[0].WhatsAppAvatarURL,
	} {
		if got == nil || *got != wantURL {
			t.Fatalf("%s signed avatar = %#v, want %q", name, got, wantURL)
		}
	}
	if requests.Load() != 1 {
		t.Fatalf("signing requests = %d, want one cached request", requests.Load())
	}
}

func TestWhatsAppAvatarSigningFailureAndMissingPathDegradeToNil(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		http.Error(w, `{"message":"storage unavailable"}`, http.StatusServiceUnavailable)
	}))
	defer server.Close()
	repo := newAvatarSigningTestRepository(server)
	storagePath := avatarTestStoragePath(avatarTestOrganizationID, avatarTestLeadID)
	legacyURL := "https://pps.whatsapp.net/legacy.jpg"
	lead := Lead{
		ID:                        avatarTestLeadID,
		OrganizationID:            avatarTestOrganizationID,
		WhatsAppAvatarURL:         &legacyURL,
		WhatsAppAvatarStoragePath: &storagePath,
	}

	repo.hydrateLeadAvatar(context.Background(), avatarTestOrganizationID, &lead)
	if lead.WhatsAppAvatarURL != nil {
		t.Fatalf("failed signing returned avatar: %#v", lead.WhatsAppAvatarURL)
	}
	repo.hydrateLeadAvatar(context.Background(), avatarTestOrganizationID, &lead)
	if requests.Load() != 1 {
		t.Fatalf("negative cache signing requests = %d, want 1", requests.Load())
	}

	lead.WhatsAppAvatarURL = &legacyURL
	lead.WhatsAppAvatarStoragePath = nil
	repo.hydrateLeadAvatar(context.Background(), avatarTestOrganizationID, &lead)
	if lead.WhatsAppAvatarURL != nil {
		t.Fatalf("legacy URL survived without storage path: %#v", lead.WhatsAppAvatarURL)
	}
	if requests.Load() != 1 {
		t.Fatalf("missing path triggered signing; requests = %d", requests.Load())
	}
}

func TestWhatsAppAvatarHydrationRejectsCrossOrganizationRecord(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		_, _ = w.Write([]byte(`{"signedURL":"/object/sign/whatsapp-media/unsafe?token=avatar"}`))
	}))
	defer server.Close()
	repo := newAvatarSigningTestRepository(server)
	foreignOrganizationID := "33333333-3333-4333-8333-333333333333"
	foreignPath := avatarTestStoragePath(foreignOrganizationID, avatarTestLeadID)
	legacyURL := "https://pps.whatsapp.net/legacy.jpg"
	lead := Lead{
		ID:                        avatarTestLeadID,
		OrganizationID:            foreignOrganizationID,
		WhatsAppAvatarURL:         &legacyURL,
		WhatsAppAvatarStoragePath: &foreignPath,
	}

	repo.hydrateLeadAvatar(context.Background(), avatarTestOrganizationID, &lead)
	if lead.WhatsAppAvatarURL != nil {
		t.Fatalf("cross-organization avatar survived: %#v", lead.WhatsAppAvatarURL)
	}
	if requests.Load() != 0 {
		t.Fatalf("cross-organization path triggered %d signing requests", requests.Load())
	}
}

func TestWhatsAppAvatarHydrationUsesBoundedParallelSigning(t *testing.T) {
	var current atomic.Int32
	var maximum atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		active := current.Add(1)
		defer current.Add(-1)
		for {
			observed := maximum.Load()
			if active <= observed || maximum.CompareAndSwap(observed, active) {
				break
			}
		}
		time.Sleep(20 * time.Millisecond)
		_, _ = w.Write([]byte(`{"signedURL":"/object/sign/whatsapp-media/safe?token=avatar"}`))
	}))
	defer server.Close()
	repo := newAvatarSigningTestRepository(server)

	contacts := make([]Contact, 12)
	paths := make([]string, len(contacts))
	for index := range contacts {
		leadID := fmt.Sprintf("11111111-1111-4111-8111-%012d", index+1)
		paths[index] = avatarTestStoragePath(avatarTestOrganizationID, leadID)
		contacts[index] = Contact{ID: leadID, WhatsAppAvatarStoragePath: &paths[index]}
	}
	repo.hydrateContactAvatars(context.Background(), avatarTestOrganizationID, contacts)

	if maximum.Load() < 2 {
		t.Fatalf("maximum concurrent signings = %d, want parallel signing", maximum.Load())
	}
	if maximum.Load() > whatsAppAvatarSigningConcurrency {
		t.Fatalf("maximum concurrent signings = %d, limit = %d", maximum.Load(), whatsAppAvatarSigningConcurrency)
	}
	for index := range contacts {
		if contacts[index].WhatsAppAvatarURL == nil {
			t.Fatalf("contact %d did not receive a signed avatar", index)
		}
	}
}

func TestWhatsAppAvatarSignedURLCacheIsBounded(t *testing.T) {
	cache := newBoundedWhatsAppAvatarSignedURLCache(2)
	now := time.Now()
	cache.store("first", cachedWhatsAppAvatarSignedURL{url: "first", expiresAt: now.Add(time.Minute)})
	cache.store("second", cachedWhatsAppAvatarSignedURL{url: "second", expiresAt: now.Add(2 * time.Minute)})
	cache.store("third", cachedWhatsAppAvatarSignedURL{url: "third", expiresAt: now.Add(3 * time.Minute)})
	if cache.len() != 2 {
		t.Fatalf("cache entries = %d, want 2", cache.len())
	}
	if _, ok := cache.load("first"); ok {
		t.Fatal("oldest cache entry was not evicted")
	}
}

type pipelineBoardAvatarRow struct {
	storagePath string
}

func (row pipelineBoardAvatarRow) Scan(destinations ...any) error {
	if err := zeroAvatarScanDestinations(destinations); err != nil {
		return err
	}
	if len(destinations) < 19 {
		return fmt.Errorf("pipeline lead scan has %d destinations", len(destinations))
	}
	*(destinations[0].(*string)) = avatarTestLeadID
	*(destinations[13].(*pgtype.Text)) = pgtype.Text{String: avatarTestOrganizationID, Valid: true}
	*(destinations[16].(*pgtype.Text)) = pgtype.Text{String: "https://pps.whatsapp.net/legacy.jpg", Valid: true}
	*(destinations[17].(*pgtype.Text)) = pgtype.Text{String: row.storagePath, Valid: true}
	return nil
}

func TestScanPipelineBoardLeadKeepsOnlyAvatarStoragePath(t *testing.T) {
	storagePath := avatarTestStoragePath(avatarTestOrganizationID, avatarTestLeadID)
	lead, _, err := scanPipelineBoardLead(pipelineBoardAvatarRow{storagePath: storagePath}, false)
	if err != nil {
		t.Fatalf("scan pipeline board lead: %v", err)
	}
	if lead.WhatsAppAvatarURL != nil {
		t.Fatalf("pipeline scanner leaked legacy URL: %#v", lead.WhatsAppAvatarURL)
	}
	if lead.WhatsAppAvatarStoragePath == nil || *lead.WhatsAppAvatarStoragePath != storagePath {
		t.Fatalf("pipeline storage path = %#v, want %q", lead.WhatsAppAvatarStoragePath, storagePath)
	}
	if !strings.Contains(pipelineBoardLeadSelectFields("true"), "l.whatsapp_avatar_storage_path") ||
		!strings.Contains(pipelineBoardLeadColumnFields(), "whatsapp_avatar_storage_path") {
		t.Fatal("pipeline board selects do not include whatsapp_avatar_storage_path")
	}
}

type contactAvatarRow struct {
	storagePath string
}

func (row contactAvatarRow) Scan(destinations ...any) error {
	if err := zeroAvatarScanDestinations(destinations); err != nil {
		return err
	}
	if len(destinations) < 8 {
		return fmt.Errorf("contact scan has %d destinations", len(destinations))
	}
	*(destinations[1].(*string)) = avatarTestLeadID
	*(destinations[6].(*pgtype.Text)) = pgtype.Text{String: "https://pps.whatsapp.net/legacy.jpg", Valid: true}
	*(destinations[7].(*pgtype.Text)) = pgtype.Text{String: row.storagePath, Valid: true}
	return nil
}

func TestScanContactKeepsOnlyAvatarStoragePathInBothQueries(t *testing.T) {
	storagePath := avatarTestStoragePath(avatarTestOrganizationID, avatarTestLeadID)
	contact, err := scanContact(contactAvatarRow{storagePath: storagePath})
	if err != nil {
		t.Fatalf("scan contact: %v", err)
	}
	if contact.WhatsAppAvatarURL != nil {
		t.Fatalf("contact scanner leaked legacy URL: %#v", contact.WhatsAppAvatarURL)
	}
	if contact.WhatsAppAvatarStoragePath == nil || *contact.WhatsAppAvatarStoragePath != storagePath {
		t.Fatalf("contact storage path = %#v, want %q", contact.WhatsAppAvatarStoragePath, storagePath)
	}

	source, err := os.ReadFile("support_contacts.go")
	if err != nil {
		t.Fatalf("read support_contacts.go: %v", err)
	}
	if count := strings.Count(string(source), "l.whatsapp_avatar_storage_path"); count != 2 {
		t.Fatalf("contact avatar storage path select count = %d, want 2", count)
	}
}

func zeroAvatarScanDestinations(destinations []any) error {
	for index, destination := range destinations {
		value := reflect.ValueOf(destination)
		if value.Kind() != reflect.Pointer || value.IsNil() {
			return fmt.Errorf("destination %d has type %T, want non-nil pointer", index, destination)
		}
		value.Elem().Set(reflect.Zero(value.Elem().Type()))
	}
	return nil
}
