package admin

import (
	"reflect"
	"testing"
)

func TestOrganizationModulesWithCoreNormalizesLegacyCRMKeys(t *testing.T) {
	got := organizationModulesWithCore([]string{
		"pipelines",
		"contacts",
		"dashboard",
		"whatsapp",
		"campaigns",
	})
	want := []string{"crm", "whatsapp", "round_robin", "campaigns"}

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("organizationModulesWithCore() = %v, want %v", got, want)
	}
}

func TestOrganizationModulesWithCoreDoesNotAddMarketing(t *testing.T) {
	got := organizationModulesWithCore([]string{"agenda"})
	want := []string{"crm", "whatsapp", "round_robin", "agenda"}

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("organizationModulesWithCore() = %v, want %v", got, want)
	}
}

func TestCoreOrganizationModulesCannotBeDisabled(t *testing.T) {
	for _, moduleName := range []string{"crm", "whatsapp", "round_robin", "pipelines", "contacts"} {
		if !isCoreOrganizationModule(moduleName) {
			t.Fatalf("expected %q to resolve to a core module", moduleName)
		}
	}
	if isCoreOrganizationModule("campaigns") {
		t.Fatal("campaigns must remain optional")
	}
}
