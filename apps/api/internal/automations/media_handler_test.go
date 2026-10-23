package automations

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestStorageSearchRunsBeforePagingAndKeepsOrganizationPrefix(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
		}
		if payload["search"] != "campanha" || payload["prefix"] != "organization/image" || payload["limit"] != float64(51) || payload["offset"] != float64(100) {
			t.Errorf("scoped search payload: %v", payload)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{"name":"campanha.png"}]`))
	}))
	defer server.Close()
	client := newStorageClient(StorageConfig{ProjectURL: server.URL, APIKey: "synthetic-test-key"})
	objects, err := client.list(context.Background(), "automation-media", "organization/image", 51, 100, " campanha ")
	if err != nil || len(objects) != 1 || objects[0].Name != "campanha.png" {
		t.Fatalf("storage search: %v, %v", objects, err)
	}
}

func TestGetAutomationMediaPage(t *testing.T) {
	tests := []struct {
		name       string
		query      string
		wantLimit  int
		wantOffset int
		wantError  bool
	}{
		{name: "defaults", wantLimit: 50, wantOffset: 0},
		{name: "explicit page", query: "?limit=100&offset=250", wantLimit: 100, wantOffset: 250},
		{name: "limit too large", query: "?limit=101", wantError: true},
		{name: "negative offset", query: "?offset=-1", wantError: true},
		{name: "invalid number", query: "?limit=abc", wantError: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest("GET", "/v1/automation-media"+test.query, nil)
			limit, offset, err := getAutomationMediaPage(request)
			if test.wantError {
				if !errors.Is(err, ErrInvalidInput) {
					t.Fatalf("error = %v, want ErrInvalidInput", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("getAutomationMediaPage() error = %v", err)
			}
			if limit != test.wantLimit || offset != test.wantOffset {
				t.Fatalf("page = (%d, %d), want (%d, %d)", limit, offset, test.wantLimit, test.wantOffset)
			}
		})
	}
}

func TestCanViewAutomationsIncludesEditPermission(t *testing.T) {
	if !canViewAutomations(tenant.Context{Permissions: []string{"automations_edit"}}) {
		t.Fatal("automations_edit must imply read access")
	}
	if !canViewAutomations(tenant.Context{Permissions: []string{"automations_view"}}) {
		t.Fatal("automations_view must allow read access")
	}
	if canViewAutomations(tenant.Context{Permissions: []string{"leads_view"}}) {
		t.Fatal("unrelated permission must not allow automation reads")
	}
}
