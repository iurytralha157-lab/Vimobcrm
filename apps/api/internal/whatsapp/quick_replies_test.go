package whatsapp

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestQuickReplyValidationPreservesContentAndNormalizesASCIIShortcut(t *testing.T) {
	for _, shortcut := range []string{"hello", " /HeLLo-12_3 ", strings.Repeat("A", 40)} {
		content := "  Olá 👋\n\nVisita às 14h.  "
		input, err := (QuickReplyRequest{Shortcut: shortcut, Content: content}).Validate()
		if err != nil || input.Content != content || input.Shortcut != strings.ToLower(strings.TrimPrefix(strings.TrimSpace(shortcut), "/")) {
			t.Fatalf("input=%+v err=%v", input, err)
		}
	}
	for _, content := range []string{strings.Repeat("a", 4000), strings.Repeat("🧡", 4000)} {
		input, err := (QuickReplyRequest{Shortcut: "limit", Content: content}).Validate()
		if err != nil || input.Content != content {
			t.Fatalf("4000-rune content was changed or rejected: %v", err)
		}
	}
}

func TestQuickReplyValidationRejectsInvalidWithoutTruncation(t *testing.T) {
	for _, shortcut := range []string{"", "/", "//hello", "hello world", "_hello", "-hello", "hello/", "é", "Kelvin", "İ", strings.Repeat("a", 41)} {
		if _, err := (QuickReplyRequest{Shortcut: shortcut, Content: "valid"}).Validate(); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("invalid shortcut accepted: %q", shortcut)
		}
	}
	for _, content := range []string{"", " \t\r\n", "\u00a0\u2003", "a\x00b", strings.Repeat("a", 4001), strings.Repeat("🧡", 4001), string([]byte{0xff})} {
		if _, err := (QuickReplyRequest{Shortcut: "valid", Content: content}).Validate(); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("invalid content accepted (bytes=%d)", len(content))
		}
	}
}

func TestQuickReplyPatchRequiresPresentNonNullFields(t *testing.T) {
	for _, body := range []string{`{}`, `null`, `{"shortcut":null,"content":"valid"}`, `{"shortcut":"valid","content":null}`, `{"content":3}`} {
		var request QuickReplyPatchRequest
		err := json.Unmarshal([]byte(body), &request)
		if err == nil {
			_, err = request.Validate()
		}
		if err == nil {
			t.Errorf("invalid patch accepted: %s", body)
		}
	}
	for _, body := range []string{`{"shortcut":"/VISITA"}`, `{"content":"  linha\n🧡  "}`} {
		var request QuickReplyPatchRequest
		if err := json.Unmarshal([]byte(body), &request); err != nil {
			t.Fatal(err)
		}
		input, err := request.Validate()
		if err != nil || input.ShortcutSet == input.ContentSet {
			t.Fatalf("single-field patch failed: %+v %v", input, err)
		}
	}
}

func quickReplyUnitActor() tenant.Context {
	return tenant.Context{OrganizationID: "90000000-0000-4000-8000-000000000001", UserID: "90000000-0000-4000-8000-000000000002",
		Permissions: []string{permissions.WhatsAppView, permissions.WhatsAppOperate}, MemberRole: "user"}
}

func TestQuickReplyHandlersRejectMissingIdentityAndPermissionsBeforeDatabase(t *testing.T) {
	for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodPatch, http.MethodDelete} {
		for _, mutation := range []string{"absent", "owner", "organization", "permission"} {
			t.Run(method+"/"+mutation, func(t *testing.T) {
				actor := quickReplyUnitActor()
				switch mutation {
				case "owner":
					actor.UserID = ""
				case "organization":
					actor.OrganizationID = ""
				case "permission":
					actor.Permissions = nil
				}
				r := httptest.NewRequest(method, "/v1/whatsapp/quick-replies", strings.NewReader("{"))
				if mutation != "absent" {
					r = r.WithContext(tenant.ContextWithTenant(r.Context(), actor))
				}
				w := httptest.NewRecorder()
				serveQuickReplyUnit(Handler{}, method, w, r)
				if w.Code != http.StatusForbidden || w.Header().Get("Cache-Control") != "no-store" {
					t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
				}
			})
		}
	}
}

func TestQuickReplyHandlersRejectOwnershipInjectionAndTrailingJSON(t *testing.T) {
	for _, method := range []string{http.MethodPost, http.MethodPatch} {
		for _, body := range []string{`{"shortcut":"ok","content":"valid","organization_id":"other"}`, `{"shortcut":"ok","content":"valid","user_id":"other"}`, `{"shortcut":"ok","content":"valid","id":"other"}`, `{"shortcut":"ok","content":"valid"} {}`, `{"shortcut":"ok","content":" "}`, `{"shortcut":"ok","content":null}`} {
			r := httptest.NewRequest(method, "/v1/whatsapp/quick-replies", strings.NewReader(body))
			r = r.WithContext(tenant.ContextWithTenant(r.Context(), quickReplyUnitActor()))
			w := httptest.NewRecorder()
			serveQuickReplyUnit(Handler{}, method, w, r)
			if w.Code != http.StatusBadRequest {
				t.Fatalf("%s body=%s status=%d", method, body, w.Code)
			}
		}
	}
}

func serveQuickReplyUnit(handler Handler, method string, w http.ResponseWriter, r *http.Request) {
	switch method {
	case http.MethodGet:
		handler.ListQuickReplies(w, r)
	case http.MethodPost:
		handler.CreateQuickReply(w, r)
	case http.MethodPatch:
		handler.UpdateQuickReply(w, r)
	case http.MethodDelete:
		handler.DeleteQuickReply(w, r)
	}
}

func TestQuickReplyDatabaseErrorsAreClassifiedWithoutLeakingContent(t *testing.T) {
	for _, scenario := range []struct {
		source, want error
		status       int
		code         string
	}{
		{pgx.ErrNoRows, ErrQuickReplyNotFound, 404, "whatsapp_quick_reply_not_found"},
		{&pgconn.PgError{Code: "23505", ConstraintName: "whatsapp_quick_replies_owner_shortcut_key"}, ErrQuickReplyConflict, 409, "whatsapp_quick_reply_shortcut_conflict"},
		{&pgconn.PgError{Code: "23514", ConstraintName: "whatsapp_quick_replies_owner_limit"}, ErrQuickReplyLimit, 409, "whatsapp_quick_reply_limit_reached"},
	} {
		err := quickReplyDatabaseError(scenario.source)
		if !errors.Is(err, scenario.want) {
			t.Fatal(err)
		}
		w := httptest.NewRecorder()
		writeQuickReplyError(w, httptest.NewRequest("GET", "/", nil), err)
		if w.Code != scenario.status || !strings.Contains(w.Body.String(), scenario.code) {
			t.Fatal(w.Body.String())
		}
	}
	w := httptest.NewRecorder()
	writeQuickReplyError(w, httptest.NewRequest("GET", "/", nil), &pgconn.PgError{Code: "23514", Detail: "PRIVATE SYNTHETIC CONTENT"})
	if w.Code != 500 || strings.Contains(w.Body.String(), "PRIVATE SYNTHETIC CONTENT") {
		t.Fatal(w.Body.String())
	}
}
