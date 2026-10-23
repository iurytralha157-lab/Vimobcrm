package whatsapp

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/leads"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// No JWT service or WhatsApp provider is used. The tenant context is synthetic;
// actual HTTP handlers, permission middleware, repository SQL and clone guards run.
func TestLocalWhatsAppTagsAndArchiveHTTPRoundtrip(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	repo := NewRepository(db, nil, StorageConfig{})
	f := outboundHardeningFixture(t, ctx, db, repo, "tags-archive")
	foreign := outboundHardeningFixture(t, ctx, db, repo, "tags-archive-foreign")
	var tagID, foreignTagID string
	for _, entry := range []struct {
		org    string
		target *string
	}{{f.organizationID, &tagID}, {foreign.organizationID, &foreignTagID}} {
		if err := db.Pool().QueryRow(ctx, `insert into public.tags(organization_id,name,color) values($1::uuid,'Visita local','#22c55e') returning id::text`, entry.org).Scan(entry.target); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		cleanup, done := context.WithTimeout(context.Background(), 10*time.Second)
		defer done()
		for _, org := range []string{f.organizationID, foreign.organizationID} {
			if _, err := db.Pool().Exec(cleanup, `delete from public.lead_tags where organization_id=$1::uuid; delete from public.tags where organization_id=$1::uuid`, org); err != nil {
				t.Error(err)
			}
		}
	})
	leadHandler := leads.NewHandler(leads.NewRepository(db, nil))
	waHandler := NewHandler(repo)
	actor := f.tenant
	withActor := func(next http.Handler) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r.WithContext(tenant.ContextWithTenant(r.Context(), actor)))
		}
	}
	mux := http.NewServeMux()
	mux.Handle("GET /v1/tags", withActor(http.HandlerFunc(leadHandler.ListTags)))
	mux.Handle("POST /v1/leads/{id}/tags", withActor(tenant.RequirePermission(permissions.LeadOperate, http.HandlerFunc(leadHandler.AddTag))))
	mux.Handle("DELETE /v1/leads/{id}/tags/{tagId}", withActor(tenant.RequirePermission(permissions.LeadOperate, http.HandlerFunc(leadHandler.RemoveTag))))
	mux.Handle("POST /v1/whatsapp/conversations/{id}/archive", withActor(http.HandlerFunc(waHandler.ArchiveConversation)))
	mux.Handle("GET /v1/whatsapp/conversations/{id}", withActor(http.HandlerFunc(waHandler.ShowConversation)))
	crm := httptest.NewServer(mux)
	t.Cleanup(crm.Close)
	client := &http.Client{Timeout: 12 * time.Second}
	call := func(method, path string, body any, wantStatus int) map[string]any {
		t.Helper()
		var data io.Reader
		if body != nil {
			encoded, err := json.Marshal(body)
			if err != nil {
				t.Fatal(err)
			}
			data = bytes.NewReader(encoded)
		}
		request, err := http.NewRequestWithContext(ctx, method, crm.URL+path, data)
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Content-Type", "application/json")
		response, err := client.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		payload, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
		if err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != wantStatus {
			t.Fatalf("%s %s: HTTP%d want%d: %s", method, path, response.StatusCode, wantStatus, payload)
		}
		var result map[string]any
		if len(payload) > 0 {
			if err := json.Unmarshal(payload, &result); err != nil {
				t.Fatal(err)
			}
		}
		return result
	}

	// A picker read needs active membership, not tag management permission.
	actor.MemberRole = "member"
	actor.UserRole = "user"
	actor.Permissions = nil
	if actor.HasPermission(permissions.TagManage) {
		t.Fatal("synthetic reader unexpectedly has tag management")
	}
	catalog := call("GET", "/v1/tags?view=catalog", nil, 200)
	items, ok := catalog["data"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("catalog data: %+v", catalog)
	}
	item := items[0].(map[string]any)
	if len(item) != 4 || item["id"] != tagID || item["organization_id"] != f.organizationID {
		t.Fatalf("narrow tenant catalog: %+v", item)
	}
	call("POST", "/v1/leads/"+f.leadID+"/tags", map[string]string{"tagId": tagID}, 403)
	actor = f.tenant
	call("POST", "/v1/leads/"+f.leadID+"/tags", map[string]string{"tagId": foreignTagID}, 400)
	call("POST", "/v1/leads/"+foreign.leadID+"/tags", map[string]string{"tagId": tagID}, 404)
	call("POST", "/v1/leads/"+f.leadID+"/tags", map[string]string{"tagId": tagID}, 201)
	tagged := call("GET", "/v1/whatsapp/conversations/"+f.conversationID+"?expectedLeadId="+f.leadID, nil, 200)["data"].(map[string]any)
	taggedLead := tagged["lead"].(map[string]any)
	refs, ok := taggedLead["tags"].([]any)
	if !ok || len(refs) != 1 || refs[0].(map[string]any)["tag"].(map[string]any)["id"] != tagID {
		t.Fatalf("canonical conversation GET did not expose durable tag: %+v", taggedLead)
	}
	var count int
	if err := db.Pool().QueryRow(ctx, `select count(*) from public.lead_tags where organization_id=$1::uuid and lead_id=$2::uuid and tag_id=$3::uuid`, f.organizationID, f.leadID, tagID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("durable association count%d: %v", count, err)
	}
	if err := db.Pool().QueryRow(ctx, `select count(*) from public.lead_tags where organization_id=$1::uuid and lead_id=$2::uuid and tag_id=$3::uuid`, f.organizationID, f.leadID, foreignTagID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("foreign association count%d: %v", count, err)
	}
	call("DELETE", "/v1/leads/"+f.leadID+"/tags/"+tagID, nil, 204)
	if err := db.Pool().QueryRow(ctx, `select count(*) from public.lead_tags where organization_id=$1::uuid and lead_id=$2::uuid and tag_id=$3::uuid`, f.organizationID, f.leadID, tagID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("durable removal count%d: %v", count, err)
	}

	actor.OrganizationID = foreign.organizationID
	call("GET", "/v1/tags?view=catalog", nil, 403)
	actor = f.tenant
	actor.UserID = ""
	call("GET", "/v1/tags?view=catalog", nil, 403)
	actor = f.tenant
	if _, err := db.Pool().Exec(ctx, `update public.organization_members set is_active=false where organization_id=$1::uuid and user_id=$2::uuid`, f.organizationID, f.userID); err != nil {
		t.Fatal(err)
	}
	call("GET", "/v1/tags?view=catalog", nil, 403)
	call("POST", "/v1/whatsapp/conversations/"+f.conversationID+"/archive", map[string]any{"archive": true, "expectedLeadId": f.leadID}, 403)
	if _, err := db.Pool().Exec(ctx, `update public.organization_members set is_active=true where organization_id=$1::uuid and user_id=$2::uuid`, f.organizationID, f.userID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool().Exec(ctx, `update public.users set is_active=false where id=$1::uuid`, f.userID); err != nil {
		t.Fatal(err)
	}
	call("GET", "/v1/tags?view=catalog", nil, 403)
	if _, err := db.Pool().Exec(ctx, `update public.users set is_active=true where id=$1::uuid`, f.userID); err != nil {
		t.Fatal(err)
	}

	// Absolute archive commands and subsequent canonical GETs stay in the CRM.
	archivePath := "/v1/whatsapp/conversations/" + f.conversationID + "/archive"
	readPath := "/v1/whatsapp/conversations/" + f.conversationID + "?expectedLeadId=" + f.leadID
	ack := call("POST", archivePath, map[string]any{"archive": true, "expectedLeadId": f.leadID}, 200)
	if ack["ok"] != true {
		t.Fatalf("archive acknowledgement: %+v", ack)
	}
	archived := call("GET", readPath, nil, 200)["data"].(map[string]any)
	if archived["archived_at"] == nil {
		t.Fatal("canonical GET omitted persisted archive")
	}
	call("POST", archivePath, map[string]any{"archive": true, "expectedLeadId": f.leadID}, 200)
	call("POST", archivePath, map[string]any{"archive": false, "expectedLeadId": f.leadID}, 200)
	restored := call("GET", readPath, nil, 200)["data"].(map[string]any)
	if restored["archived_at"] != nil {
		t.Fatal("canonical GET retained archived state after restore")
	}
	// Inbox mutations intentionally hide a mismatched binding as not found.
	call("POST", archivePath, map[string]any{"archive": true, "expectedLeadId": foreign.leadID}, 404)
	if current := call("GET", readPath, nil, 200)["data"].(map[string]any); current["archived_at"] != nil {
		t.Fatal("rejected foreign binding altered the archive")
	}
	var outbox int
	if err := db.Pool().QueryRow(ctx, `select count(*) from public.whatsapp_outbox where organization_id=$1::uuid`, f.organizationID).Scan(&outbox); err != nil || outbox != 0 {
		t.Fatalf("archive/tag operations touched send FIFO%d: %v", outbox, err)
	}

	if directory := os.Getenv("VIMOB_WHATSAPP_TAGS_FRAMES_DIR"); directory != "" {
		expected := filepath.Clean("D:/Vimob/tmp/whatsapp-tags-archive-local-20261013")
		if filepath.Clean(directory) != expected {
			t.Fatal("unexpected local tag frame export directory")
		}
		frame := map[string]any{"environment": "verified disposable native PostgreSQL clone", "authentication": "synthetic tenant context; actual permission middleware", "catalog": catalog, "tagged": tagged, "archived": archived, "restored": restored, "fifoOutboxCount": outbox}
		encoded, err := json.MarshalIndent(frame, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(directory, "tags-archive-frame.json"), append(encoded, '\n'), 0600); err != nil {
			t.Fatal(err)
		}
	}
}
