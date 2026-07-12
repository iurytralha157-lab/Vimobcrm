package automations

import (
	"errors"
	"net/http/httptest"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

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
