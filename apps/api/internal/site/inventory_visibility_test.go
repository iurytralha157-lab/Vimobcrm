package site

import (
	"strings"
	"testing"

	propertiesdomain "github.com/vimob-crm/vimob-crm/apps/api/internal/properties"
)

func TestPublicSitePropertyReadersGuardClosedInventoryAcrossPublicationSources(t *testing.T) {
	for name, sql := range map[string]string{
		"list and detail": publicPropertyEligibilitySQL(),
		"standalone":      publicPropertyStandaloneEligibilitySQL("p"),
	} {
		if !strings.Contains(sql, propertiesdomain.PropertyInventoryOpenSQL("p")) {
			t.Fatalf("%s reader bypassed linked inventory hierarchy", name)
		}
	}
	list := publicPropertyEligibilitySQL()
	if strings.Index(list, "property_development_units") > strings.Index(list, "publication_snapshot.payload") {
		t.Fatal("inventory must guard immutable snapshots and legacy listing together")
	}
}
