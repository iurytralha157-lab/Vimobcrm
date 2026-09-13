package app

import (
	"os"
	"strings"
	"testing"
)

func TestRoundRobinHistoryRouteUsesDistributionManagementBoundary(t *testing.T) {
	routes, err := os.ReadFile("routes.go")
	if err != nil {
		t.Fatalf("read routes.go: %v", err)
	}
	required := `mux.Handle("GET /v1/round-robins/{id}/history", withPermission(permissions.DistributionManage, http.HandlerFunc(roundRobinHandler.ListHistory)))`
	if !strings.Contains(string(routes), required) {
		t.Fatalf("distribution queue history route must require DistributionManage")
	}
}

func TestRoundRobinHistoryRouteIsDocumentedInOpenAPI(t *testing.T) {
	contract, err := os.ReadFile("../../../../packages/contracts/openapi/v1.yaml")
	if err != nil {
		t.Fatalf("read OpenAPI contract: %v", err)
	}
	text := string(contract)
	for _, fragment := range []string{
		"/v1/round-robins/{id}/history:",
		"#/components/schemas/DistributionQueueHistoryListResponse",
		"DistributionQueueHistoryEvent:",
	} {
		if !strings.Contains(text, fragment) {
			t.Errorf("round-robin history OpenAPI contract is missing %q", fragment)
		}
	}
}
