package app

import (
	"strings"
	"testing"
)

func TestHomeNoticesRouteUsesOrganizationBoundary(t *testing.T) {
	appSource := readAppWiringSource(t)
	for _, required := range []string{
		`homenotices.NewHandler(homenotices.NewRepository(postgres))`,
		`mux.Handle("GET /v1/home/notices", withOrganization(http.HandlerFunc(homeNoticesHandler.Notices)))`,
	} {
		if !strings.Contains(appSource, required) {
			t.Errorf("app wiring is missing %q", required)
		}
	}
	if strings.Contains(appSource, `mux.Handle("GET /v1/home/focus"`) {
		t.Fatal("retired Home focus route is still registered")
	}
}
