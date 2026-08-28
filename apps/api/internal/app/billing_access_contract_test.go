package app

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

func TestAuthenticatedRouteBillingGateContract(t *testing.T) {
	source, err := os.ReadFile("app.go")
	if err != nil {
		t.Fatalf("read app.go: %v", err)
	}
	appSource := string(source)

	const allowlistStart = "billingAccessAllowlist := tenant.NewBillingAccessAllowlist("
	start := strings.Index(appSource, allowlistStart)
	if start < 0 {
		t.Fatal("billing access allowlist is not declared")
	}
	end := strings.Index(appSource[start:], "\n\t)")
	if end < 0 {
		t.Fatal("billing access allowlist declaration is incomplete")
	}

	routePattern := regexp.MustCompile(`"([A-Z]+ /v1/[^"]+)"`)
	matches := routePattern.FindAllStringSubmatch(appSource[start:start+end], -1)
	got := make(map[string]struct{}, len(matches))
	for _, match := range matches {
		got[match[1]] = struct{}{}
	}

	expected := []string{
		"GET /v1/me",
		"GET /v1/me/profile",
		"POST /v1/me/switch-organization",
		"GET /v1/user-organizations",
		"POST /v1/telemetry/errors",
		"GET /v1/admin/error-events",
		"POST /v1/admin/error-events/{id}/resolve",
		"GET /v1/subscription-plans/active",
		"GET /v1/settings/subscription",
		"POST /v1/settings/subscription/payments/{id}/refresh",
		"PATCH /v1/settings/subscription/billing",
		"PATCH /v1/settings/subscription/plan",
		"POST /v1/settings/subscription/charge",
		"GET /v1/home/notices",
		"GET /v1/home/publications",
		"POST /v1/home/assistant",
		"GET /v1/help/articles",
		"GET /v1/help/articles/{slug}",
		"POST /v1/help/search",
	}
	if len(got) != len(expected) {
		t.Fatalf("billing allowlist has %d routes, want %d: %v", len(got), len(expected), got)
	}
	for _, route := range expected {
		if _, ok := got[route]; !ok {
			t.Errorf("billing allowlist is missing %q", route)
		}
	}

	if !strings.Contains(appSource, "tenant.RequireBillingAccess(billingAccessAllowlist, handler)") {
		t.Fatal("authenticated tenant pipeline is not wrapped by the billing access gate")
	}
}
