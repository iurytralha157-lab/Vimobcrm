package app

import (
	"os"
	"strings"
	"testing"
)

func TestLeadCreateRouteDefersCreateVersusImportPermissionToValidatedInput(t *testing.T) {
	raw, err := os.ReadFile("app.go")
	if err != nil {
		t.Fatalf("read app.go: %v", err)
	}
	source := string(raw)

	if !strings.Contains(source, `mux.Handle("POST /v1/leads", withOrganization(http.HandlerFunc(leadsHandler.Create)))`) {
		t.Fatal("lead create route must let the repository distinguish lead_create from lead_import after validating importMode")
	}
	if strings.Contains(source, `mux.Handle("POST /v1/leads", withPermission(permissions.LeadCreate`) {
		t.Fatal("lead_create middleware blocks authorized lead_import requests before importMode can be validated")
	}
}
