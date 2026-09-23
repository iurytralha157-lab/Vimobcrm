package meta

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// A Lead Forms connection must not depend on unrelated Graph assets. The same
// Page token used to discover the Page must open forms and subscribe leadgen.
func TestOAuthLeadFormsPortfolioConnectsWithoutAdsOrInstagramDiscovery(t *testing.T) {
	const pageToken = "page-token-123456789012"
	var adAccountRequests atomic.Int32
	var formRequests atomic.Int32
	var leadgenSubscriptions atomic.Int32
	var subscriptionReads atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v25.0/debug_token":
			writeOAuthTestJSON(w, map[string]any{"data": map[string]any{
				"is_valid": true, "app_id": "123456789", "user_id": "9001",
				"expires_at": time.Now().Add(time.Hour).Unix(),
				"scopes":     []string{"public_profile", "pages_show_list", "pages_read_engagement", "pages_manage_metadata", "pages_manage_ads", "leads_retrieval"},
			}})
		case "/v25.0/me":
			writeOAuthTestJSON(w, map[string]any{"id": "9001", "name": "Lead Ads administrator"})
		case "/v25.0/me/accounts":
			if strings.Contains(r.URL.Query().Get("fields"), "instagram") {
				t.Errorf("Lead Forms Page discovery requested Instagram fields: %q", r.URL.Query().Get("fields"))
			}
			writeOAuthTestJSON(w, map[string]any{"data": []map[string]any{{
				"id": "7001", "name": "Page", "access_token": pageToken,
			}}})
		case "/v25.0/me/adaccounts":
			adAccountRequests.Add(1)
			w.WriteHeader(http.StatusForbidden)
			writeOAuthTestJSON(w, map[string]any{"error": map[string]any{"code": 200}})
		case "/v25.0/7001/leadgen_forms":
			formRequests.Add(1)
			if r.Header.Get("Authorization") != "Bearer "+pageToken {
				t.Error("Lead Forms must use the Page token")
			}
			writeOAuthTestJSON(w, map[string]any{"data": []map[string]any{{"id": "form-1"}}})
		case "/v25.0/7001/subscribed_apps":
			if r.Method == http.MethodGet {
				subscriptionReads.Add(1)
				data := []map[string]any{}
				if leadgenSubscriptions.Load() > 0 {
					data = append(data, map[string]any{"id": "123456789", "subscribed_fields": []string{"leadgen"}})
				}
				writeOAuthTestJSON(w, map[string]any{"data": data})
				break
			}
			_ = r.ParseForm()
			if r.Method != http.MethodPost || r.Form.Get("subscribed_fields") != "leadgen" {
				t.Errorf("subscription method/fields = %s %q", r.Method, r.Form.Get("subscribed_fields"))
			}
			leadgenSubscriptions.Add(1)
			writeOAuthTestJSON(w, map[string]any{"success": true})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	graph := newOAuthTestGraph(t, server.URL, "123456789", "test-app-secret-value")
	service := oauthService{graph: graph}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	debug, identity, pages, err := service.loadOAuthPortfolio(ctx, "user-token-123456789012")
	if err != nil || debug.UserID != identity.ID || len(pages) != 1 {
		t.Fatalf("Lead Forms portfolio = (%#v, %#v, %#v, %v)", debug, identity, pages, err)
	}
	if err := graph.validatePageLeadFormsAccess(ctx, pages[0]); err != nil {
		t.Fatalf("form access: %v", err)
	}
	if messaging, err := graph.ensurePageLeadgenSubscription(ctx, pages[0]); err != nil || messaging {
		t.Fatalf("leadgen subscription = (%v, %v)", messaging, err)
	}
	if adAccountRequests.Load() != 0 || formRequests.Load() != 1 || leadgenSubscriptions.Load() != 1 || subscriptionReads.Load() != 2 {
		t.Fatalf("Graph calls = ad accounts %d, forms %d, leadgen %d, readbacks %d", adAccountRequests.Load(), formRequests.Load(), leadgenSubscriptions.Load(), subscriptionReads.Load())
	}
}

func TestOAuthLeadgenSubscriptionReadsMetaBeforeAndAfterAnyWrite(t *testing.T) {
	app := func(fields ...string) map[string]any {
		return map[string]any{"id": "123456789", "subscribed_fields": fields}
	}
	tests := []struct {
		name          string
		before        []map[string]any
		after         []map[string]any
		wantGets      int32
		wantPosts     int32
		wantMessaging bool
		wantError     string
	}{
		{"already subscribed", []map[string]any{app("leadgen", "messages")}, nil, 1, 0, true, ""},
		{"missing app subscribes and verifies", []map[string]any{{"id": "other-app", "subscribed_fields": []string{"messages"}}}, []map[string]any{app("leadgen")}, 2, 1, false, ""},
		{"messaging must not be replaced", []map[string]any{app("messages")}, nil, 1, 0, false, "meta_leadgen_subscription_missing"},
		{"successful POST without leadgen readback is rejected", nil, []map[string]any{app("messages")}, 2, 1, false, "meta_webhook_subscription_unverified"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			const pageToken = "page-token-123456789012"
			var gets atomic.Int32
			var posts atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/v25.0/7001/subscribed_apps" {
					http.NotFound(w, r)
					return
				}
				assertOAuthBearerAndProof(t, r, pageToken, "test-app-secret-value")
				switch r.Method {
				case http.MethodGet:
					if r.URL.Query().Get("fields") != "id,subscribed_fields" {
						t.Errorf("subscription fields query = %q", r.URL.RawQuery)
					}
					read := gets.Add(1)
					data := tt.before
					if read > 1 {
						data = tt.after
					}
					writeOAuthTestJSON(w, map[string]any{"data": data})
				case http.MethodPost:
					posts.Add(1)
					_ = r.ParseForm()
					if r.Form.Get("subscribed_fields") != "leadgen" {
						t.Errorf("subscription POST fields = %q", r.Form.Get("subscribed_fields"))
					}
					writeOAuthTestJSON(w, map[string]any{"success": true})
				default:
					t.Errorf("unexpected method %s", r.Method)
				}
			}))
			defer server.Close()

			graph := newOAuthTestGraph(t, server.URL, "123456789", "test-app-secret-value")
			messaging, err := graph.ensurePageLeadgenSubscription(context.Background(), oauthPage{ID: "7001", AccessToken: pageToken})
			if tt.wantError == "" {
				if err != nil || messaging != tt.wantMessaging {
					t.Fatalf("subscription = (messaging %v, %v)", messaging, err)
				}
			} else if oauthErrorCode(err) != tt.wantError {
				t.Fatalf("subscription error = %v, want %s", err, tt.wantError)
			}
			if gets.Load() != tt.wantGets || posts.Load() != tt.wantPosts {
				t.Fatalf("Graph calls = GET %d, POST %d; want GET %d, POST %d", gets.Load(), posts.Load(), tt.wantGets, tt.wantPosts)
			}
		})
	}
}

func TestOAuthLeadFormsConfirmationRefreshesOnlyTheSelectedPage(t *testing.T) {
	tests := []struct {
		name      string
		pageID    string
		response  map[string]any
		wantError string
	}{
		{"valid Page", "7001", map[string]any{"id": "7001", "name": "Page", "access_token": "page-token-123456789012"}, ""},
		{"wrong Page", "7001", map[string]any{"id": "7002", "name": "Other Page", "access_token": "page-token-123456789012"}, "meta_page_not_accessible"},
		{"missing Page token", "7001", map[string]any{"id": "7001", "name": "Page"}, "meta_page_not_accessible"},
		{"invalid Page ID", "not-a-page", nil, "invalid_meta_page_id"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				if r.URL.Path != "/v25.0/7001" || r.URL.Query().Get("fields") != "id,name,access_token,picture.width(200).height(200){url}" {
					t.Errorf("confirmation requested unrelated Graph asset: %s?%s", r.URL.Path, r.URL.RawQuery)
				}
				if r.Header.Get("Authorization") != "Bearer user-token-123456789012" {
					t.Error("selected Page must be refreshed with the server-held user token")
				}
				writeOAuthTestJSON(w, tt.response)
			}))
			defer server.Close()

			graph := newOAuthTestGraph(t, server.URL, "123456789", "test-app-secret-value")
			page, err := graph.fetchLeadFormsPage(context.Background(), "user-token-123456789012", tt.pageID)
			if tt.wantError == "" {
				if err != nil || page.ID != tt.pageID || page.AccessToken == "" {
					t.Fatalf("selected Page = (%#v, %v)", page, err)
				}
			} else if oauthErrorCode(err) != tt.wantError {
				t.Fatalf("selected Page error = %v, want %s", err, tt.wantError)
			}
			wantRequests := int32(1)
			if tt.pageID == "not-a-page" {
				wantRequests = 0
			}
			if requests.Load() != wantRequests {
				t.Fatalf("Graph requests = %d, want %d", requests.Load(), wantRequests)
			}
		})
	}
}
