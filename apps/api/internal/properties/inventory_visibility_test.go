package properties

import (
	"strings"
	"testing"
)

func TestPropertyPublishedProjectionRequiresCurrentInventoryEvenForLegacyFallback(t *testing.T) {
	predicate := propertyPublishedOnSiteSQL("p", "site_publication")
	if !strings.Contains(predicate, PropertyInventoryOpenSQL("p")) {
		t.Fatal("published projection could expose a historically closed linked property")
	}
	guardPosition := strings.Index(predicate, "property_development_units")
	canonicalPosition := strings.Index(predicate, "and case")
	if guardPosition < 0 || canonicalPosition < guardPosition {
		t.Fatal("inventory guard must protect canonical publication and legacy fallback together")
	}
}
