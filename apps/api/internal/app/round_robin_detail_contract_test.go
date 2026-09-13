package app

import (
	"os"
	"strings"
	"testing"
)

func TestRoundRobinDetailRouteUsesDistributionManagementBoundary(t *testing.T) {
	routes, err := os.ReadFile("routes.go")
	if err != nil {
		t.Fatalf("read routes.go: %v", err)
	}
	required := `mux.Handle("GET /v1/round-robins/{id}", withPermission(permissions.DistributionManage, http.HandlerFunc(roundRobinHandler.Get)))`
	if !strings.Contains(string(routes), required) {
		t.Fatal("distribution queue detail route must require DistributionManage")
	}
}

func TestRoundRobinDetailRouteIsDocumentedInOpenAPI(t *testing.T) {
	contract, err := os.ReadFile("../../../../packages/contracts/openapi/v1.yaml")
	if err != nil {
		t.Fatalf("read OpenAPI contract: %v", err)
	}
	text := string(contract)
	for _, fragment := range []string{
		"/v1/round-robins/{id}:",
		"summary: Get a visible round-robin queue",
		"#/components/schemas/RoundRobinResponse",
		"RoundRobinResponse:",
	} {
		if !strings.Contains(text, fragment) {
			t.Errorf("round-robin detail OpenAPI contract is missing %q", fragment)
		}
	}
}
