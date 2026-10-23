package whatsapp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

const conversationAvatarTestOrg = "11111111-1111-4111-8111-111111111111"
const conversationAvatarTestLead = "22222222-2222-4222-8222-222222222222"
const conversationAvatarOtherOrg = "33333333-3333-4333-8333-333333333333"
const conversationAvatarOtherLead = "44444444-4444-4444-8444-444444444444"

func conversationAvatarTestPath(organizationID, leadID string) string {
	return "orgs/" + organizationID + "/profile-pictures/" + leadID + "/" + strings.Repeat("a", 64) + ".jpg"
}

func conversationAvatarTestRecord(organizationID, leadID string, historical bool) Conversation {
	path := conversationAvatarTestPath(organizationID, leadID)
	legacy := "https://legacy.example.invalid/expired"
	return Conversation{ID: "55555555-5555-4555-8555-555555555555", LeadID: &leadID,
		ContactPicture: &legacy, Lead: &LeadLite{ID: leadID, WhatsAppAvatarURL: &legacy},
		HistoricalLeadView: historical, avatarReference: &conversationAvatarReference{
			OrganizationID: organizationID, LeadID: leadID, StoragePath: &path, HistoricalContact: historical}}
}

func conversationAvatarTestRepository(server *httptest.Server) Repository {
	return NewRepository(nil, nil, StorageConfig{ProjectURL: server.URL, APIKey: "synthetic-test-key"})
}

func TestConversationAvatarPathRejectsForeignAndNoncanonicalObjects(t *testing.T) {
	path := conversationAvatarTestPath(conversationAvatarTestOrg, conversationAvatarTestLead)
	cases := []struct {
		name, path, org, lead string
		valid                 bool
	}{
		{"current lead", path, conversationAvatarTestOrg, conversationAvatarTestLead, true},
		{"foreign organization", path, conversationAvatarOtherOrg, conversationAvatarTestLead, false},
		{"foreign lead", path, conversationAvatarTestOrg, conversationAvatarOtherLead, false},
		{"traversal", strings.Replace(path, "/profile-pictures/", "/profile-pictures/../", 1), conversationAvatarTestOrg, conversationAvatarTestLead, false},
		{"encoded traversal", path + "%2f..", conversationAvatarTestOrg, conversationAvatarTestLead, false},
		{"query", path + "?token=x", conversationAvatarTestOrg, conversationAvatarTestLead, false},
		{"backslash", path + `\x`, conversationAvatarTestOrg, conversationAvatarTestLead, false},
		{"uppercase digest", strings.Replace(path, strings.Repeat("a", 64), strings.Repeat("A", 64), 1), conversationAvatarTestOrg, conversationAvatarTestLead, false},
		{"whitespace", " " + path, conversationAvatarTestOrg, conversationAvatarTestLead, false},
		{"nested", path + "/extra.jpg", conversationAvatarTestOrg, conversationAvatarTestLead, false},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if got := conversationAvatarPathBelongsToLead(test.path, test.org, test.lead); got != test.valid {
				t.Fatalf("valid = %v, want %v", got, test.valid)
			}
		})
	}
}

func TestConversationAvatarQueriesUsePrivatePathAndFrozenHistoryLead(t *testing.T) {
	for _, selection := range []string{conversationSelectFields(), leadHistoryConversationSelectFields()} {
		for _, required := range []string{"to_jsonb(l)->>'whatsapp_avatar_storage_path'", "'organizationId', l.organization_id::text", "'leadId', l.id::text"} {
			if !strings.Contains(selection, required) {
				t.Fatalf("missing authorized reference %q", required)
			}
		}
		if strings.Contains(selection, "l.whatsapp_avatar_storage_path,") {
			t.Fatal("new avatar column breaks the older-schema read")
		}
	}
	if !strings.Contains(conversationSelectFields(), "'historicalContact', false") ||
		!strings.Contains(leadHistoryConversationSelectFields(), "'historicalContact', true") {
		t.Fatal("history does not replace the lead contact picture")
	}
	if !strings.Contains(leadHistoryConversationSelectFields(), "$5::uuid::text") {
		t.Fatal("history did not retain requested lead identity")
	}
}

type conversationAvatarScanRow struct{ projection string }

func (row conversationAvatarScanRow) Scan(destinations ...any) error {
	// The final column is deliberately internal. Other optional fields retain
	// zero values just as NULL database columns do.
	if len(destinations) != 40 {
		return fmt.Errorf("scan destinations=%d, want40", len(destinations))
	}
	*(destinations[0].(*string)) = "55555555-5555-4555-8555-555555555555"
	*(destinations[2].(*pgtype.Text)) = pgtype.Text{String: conversationAvatarTestLead, Valid: true}
	*(destinations[23].(*pgtype.Text)) = pgtype.Text{String: conversationAvatarTestLead, Valid: true}
	*(destinations[24].(*pgtype.Text)) = pgtype.Text{String: "Synthetic lead", Valid: true}
	*(destinations[37].(*string)) = "[]"
	*(destinations[39].(*pgtype.Text)) = pgtype.Text{String: row.projection, Valid: true}
	return nil
}

func TestConversationAvatarScanKeepsObjectReferenceOffTheWire(t *testing.T) {
	path := conversationAvatarTestPath(conversationAvatarTestOrg, conversationAvatarTestLead)
	projection, _ := json.Marshal(conversationAvatarReference{OrganizationID: conversationAvatarTestOrg, LeadID: conversationAvatarTestLead, StoragePath: &path, HistoricalContact: true})
	conversation, err := scanConversation(conversationAvatarScanRow{string(projection)})
	if err != nil {
		t.Fatal(err)
	}
	if conversation.avatarReference == nil || *conversation.avatarReference.StoragePath != path || !conversation.avatarReference.HistoricalContact {
		t.Fatal("private reference lost during scan")
	}
	encoded, err := json.Marshal(conversation)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{path, "storagePath", "avatarReference", "historicalContact"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("wire exposed %q", forbidden)
		}
	}
	if _, err := scanConversation(conversationAvatarScanRow{"{"}); err == nil {
		t.Fatal("malformed internal projection accepted")
	}
}

func TestConversationAvatarBatchSignsCurrentAndFrozenHistoryOnce(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != http.MethodPost || !strings.Contains(r.URL.Path, "/object/sign/whatsapp-media/orgs/"+conversationAvatarTestOrg+"/profile-pictures/"+conversationAvatarTestLead+"/") {
			t.Errorf("unexpected signing request %s %s", r.Method, r.URL.Path)
		}
		var body struct {
			ExpiresIn int `json:"expiresIn"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ExpiresIn != 3600 {
			t.Errorf("TTL=%d err=%v", body.ExpiresIn, err)
		}
		_, _ = w.Write([]byte(`{"signedURL":"/object/sign/whatsapp-media/synthetic?token=test"}`))
	}))
	defer server.Close()
	repo := conversationAvatarTestRepository(server)
	current := conversationAvatarTestRecord(conversationAvatarTestOrg, conversationAvatarTestLead, false)
	history := conversationAvatarTestRecord(conversationAvatarTestOrg, conversationAvatarTestLead, true)
	repo.hydrateConversationAvatars(context.Background(), conversationAvatarTestOrg, []*Conversation{&current, &history})
	want := server.URL + "/storage/v1/object/sign/whatsapp-media/synthetic?token=test"
	if calls.Load() != 1 || current.Lead.WhatsAppAvatarURL == nil || *current.Lead.WhatsAppAvatarURL != want ||
		history.Lead.WhatsAppAvatarURL == nil || *history.Lead.WhatsAppAvatarURL != want || history.ContactPicture == nil || *history.ContactPicture != want {
		t.Fatal("list/history did not use one canonical signature")
	}
	if *current.ContactPicture != "https://legacy.example.invalid/expired" {
		t.Fatal("current contact picture changed")
	}
	repo.hydrateConversationAvatar(context.Background(), conversationAvatarTestOrg, &current)
	if calls.Load() != 1 {
		t.Fatal("signature cache not reused")
	}
	entry, ok := repo.avatarURLs.Load(server.URL + "\x00" + *current.avatarReference.StoragePath)
	if !ok || time.Until(entry.expiresAt) < 44*time.Minute || time.Until(entry.expiresAt) > 45*time.Minute {
		t.Fatal("signature cache must reserve15minutes of bearer validity")
	}
}

func TestConversationAvatarDeniesForeignTenantBindingAndGroupBeforeSigning(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); t.Error("denied avatar reached signing") }))
	defer server.Close()
	repo := conversationAvatarTestRepository(server)
	cases := []struct {
		name   string
		change func(*Conversation)
	}{
		{"foreign tenant", func(c *Conversation) { c.avatarReference.OrganizationID = conversationAvatarOtherOrg }},
		{"foreign path", func(c *Conversation) {
			p := conversationAvatarTestPath(conversationAvatarOtherOrg, conversationAvatarTestLead)
			c.avatarReference.StoragePath = &p
		}},
		{"changed binding", func(c *Conversation) { id := conversationAvatarOtherLead; c.LeadID = &id }},
		{"different projected lead", func(c *Conversation) { c.Lead.ID = conversationAvatarOtherLead }},
		{"group", func(c *Conversation) { c.IsGroup = true }},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			c := conversationAvatarTestRecord(conversationAvatarTestOrg, conversationAvatarTestLead, true)
			test.change(&c)
			repo.hydrateConversationAvatar(context.Background(), conversationAvatarTestOrg, &c)
			if c.Lead.WhatsAppAvatarURL != nil || c.ContactPicture != nil {
				t.Fatal("denied projection retained private/legacy photo")
			}
		})
	}
	if calls.Load() != 0 {
		t.Fatal("authorization must precede cache/Storage lookup")
	}
}

func TestConversationAvatarOlderSchemaKeepsAuthorizedLegacyWithoutRequests(t *testing.T) {
	repo := NewRepository(nil, nil, StorageConfig{})
	c := conversationAvatarTestRecord(conversationAvatarTestOrg, conversationAvatarTestLead, false)
	c.avatarReference.StoragePath = nil
	repo.hydrateConversationAvatar(context.Background(), conversationAvatarTestOrg, &c)
	if c.Lead.WhatsAppAvatarURL == nil || *c.Lead.WhatsAppAvatarURL != "https://legacy.example.invalid/expired" {
		t.Fatal("older authorized schema lost its existing avatar")
	}
	c.avatarReference.StoragePath = new(string)
	repo.hydrateConversationAvatar(context.Background(), conversationAvatarTestOrg, &c)
	if c.Lead.WhatsAppAvatarURL != nil {
		t.Fatal("present invalid private path used legacy fallback")
	}
}

func TestConversationAvatarSigningFailureDegradesAndNegativeCachePreventsLoops(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()
	repo := conversationAvatarTestRepository(server)
	c := conversationAvatarTestRecord(conversationAvatarTestOrg, conversationAvatarTestLead, true)
	for attempt := 0; attempt < 2; attempt++ {
		repo.hydrateConversationAvatar(context.Background(), conversationAvatarTestOrg, &c)
	}
	if c.Lead.WhatsAppAvatarURL != nil || c.ContactPicture != nil || calls.Load() != 1 {
		t.Fatal("failed signing reused legacy photo or repeated HTTP")
	}
}

func TestConversationAvatarLateRebindCannotPublishIntoAnotherLead(t *testing.T) {
	started, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-release
		_, _ = w.Write([]byte(`{"signedURL":"/object/sign/whatsapp-media/synthetic?token=old"}`))
	}))
	defer server.Close()
	repo := conversationAvatarTestRepository(server)
	c := conversationAvatarTestRecord(conversationAvatarTestOrg, conversationAvatarTestLead, false)
	go func() {
		repo.hydrateConversationAvatar(context.Background(), conversationAvatarTestOrg, &c)
		close(done)
	}()
	<-started
	id, newURL := conversationAvatarOtherLead, "https://new.example.invalid/avatar"
	c.LeadID = &id
	c.Lead = &LeadLite{ID: id, WhatsAppAvatarURL: &newURL}
	close(release)
	<-done
	if c.Lead.WhatsAppAvatarURL == nil || *c.Lead.WhatsAppAvatarURL != newURL {
		t.Fatal("older signature overwrote the rebound lead")
	}
}

func TestConversationAvatarBatchesShareSixSlots(t *testing.T) {
	var active, peak atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := active.Add(1)
		for {
			p := peak.Load()
			if n <= p || peak.CompareAndSwap(p, n) {
				break
			}
		}
		defer active.Add(-1)
		time.Sleep(20 * time.Millisecond)
		_, _ = w.Write([]byte(`{"signedURL":"/object/sign/whatsapp-media/synthetic?token=test"}`))
	}))
	defer server.Close()
	repo := conversationAvatarTestRepository(server)
	batch := func(offset int) []*Conversation {
		result := make([]*Conversation, 12)
		for i := range result {
			id := fmt.Sprintf("%08d-2222-4222-8222-222222222222", offset+i+1)
			c := conversationAvatarTestRecord(conversationAvatarTestOrg, id, false)
			result[i] = &c
		}
		return result
	}
	first, second := batch(0), batch(20)
	done := make(chan struct{})
	go func() {
		repo.hydrateConversationAvatars(context.Background(), conversationAvatarTestOrg, first)
		close(done)
	}()
	repo.hydrateConversationAvatars(context.Background(), conversationAvatarTestOrg, second)
	<-done
	if peak.Load() < 2 || peak.Load() > 6 {
		t.Fatalf("parallel Storage requests=%d,want2..6", peak.Load())
	}
	for _, c := range append(first, second...) {
		if c.Lead.WhatsAppAvatarURL == nil {
			t.Fatal("bounded batch lost signed photo")
		}
	}
}

func TestConversationAvatarBatchDeadlineDoesNotBlockConversation(t *testing.T) {
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	defer server.Close()
	defer close(release)
	repo := conversationAvatarTestRepository(server)
	c := conversationAvatarTestRecord(conversationAvatarTestOrg, conversationAvatarTestLead, false)
	started := time.Now()
	repo.hydrateConversationAvatar(context.Background(), conversationAvatarTestOrg, &c)
	if elapsed := time.Since(started); elapsed > 3*time.Second {
		t.Fatalf("avatar signing blocked conversation for%s", elapsed)
	}
	if c.Lead.WhatsAppAvatarURL != nil {
		t.Fatal("timed out signing returned photo")
	}
}
