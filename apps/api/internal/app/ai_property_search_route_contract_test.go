package app

import (
	"os"
	"strings"
	"testing"
)

func TestAIRunRouteRequiresAIAndPropertyPermissions(t *testing.T) {
	raw, err := os.ReadFile("routes.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	routeStart := strings.Index(source, `"POST /v1/ai/run"`)
	if routeStart < 0 {
		t.Fatal("AI run route is missing")
	}
	routeEnd := strings.Index(source[routeStart:], `"GET /v1/schedule/capabilities"`)
	if routeEnd < 0 {
		t.Fatal("could not isolate AI run route")
	}
	route := source[routeStart : routeStart+routeEnd]
	for _, required := range []string{
		"permissions.SettingsAI",
		"tenant.RequireAnyPermission",
		"permissions.PropertyView",
		"permissions.PropertyManage",
	} {
		if !strings.Contains(route, required) {
			t.Fatalf("AI run route lost permission guard %q: %s", required, route)
		}
	}
}
