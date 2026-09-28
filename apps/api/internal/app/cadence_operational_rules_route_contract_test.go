package app

import (
	"os"
	"strings"
	"testing"
)

func TestStageOperationalRulesUpdateRouteAcceptsEitherManagementPermissionWithinOrganization(t *testing.T) {
	routes, err := os.ReadFile("routes.go")
	if err != nil {
		t.Fatalf("read routes.go: %v", err)
	}

	required := `mux.Handle("PUT /v1/stages/{id}/operational-rules", withOrganization(tenant.RequireAnyPermission(
		[]string{permissions.PipelineManage, permissions.AutomationsManage},
		http.HandlerFunc(cadencesHandler.UpsertOperationalRules),
	)))`
	if !strings.Contains(string(routes), required) {
		t.Fatal("stage operational rules update must keep organization context and accept pipeline or automation management")
	}
}
