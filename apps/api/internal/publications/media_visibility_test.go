package publications

import (
	"strings"
	"testing"
)

func TestPublicMediaRequiresLiveTenantConsentStatusAndChannelSite(t *testing.T) {
	query := publicMediaQuerySQL()
	for _, clause := range []string{
		"current_property.organization_id = publication.organization_id",
		"current_property.id = publication.property_id",
		"organization.id = publication.organization_id",
		"coalesce(organization.is_active, false)",
		"publication.channel <> 'site' or coalesce(site.is_active, false)",
		"current_property.autorizado_comercializacao is distinct from false",
		"lower(trim(coalesce(current_property.status, ''))) in ('active', 'ativo', 'available', 'disponivel', 'disponível')",
		"inventory_unit.property_id = current_property.id",
		"publication.desired_state = 'published'",
		"asset.visibility = 'public'",
		"media->>'source_hash'",
		"delivered_job.status = 'succeeded'",
	} {
		if !strings.Contains(query, clause) {
			t.Fatalf("public media query lacks live guard %q", clause)
		}
	}
}

func TestCurrentConsentIsIndependentOfFrozenMediaAndSnapshotHash(t *testing.T) {
	source := readyPublicationSource()
	before, err := siteSnapshotHash(buildSiteSnapshot(source, "https://fixture.example", testPublicationID, 1))
	if err != nil {
		t.Fatal(err)
	}
	source.CommercializationDenied = true
	after, err := siteSnapshotHash(buildSiteSnapshot(source, "https://fixture.example", testPublicationID, 1))
	if err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatal("fixture must demonstrate consent changing outside immutable public payload")
	}
	checks, _, state := evaluateSiteReadiness(source)
	if state != ReadinessBlocked {
		t.Fatal("unchanged published snapshot bypassed current consent")
	}
	for _, check := range checks {
		if check.Code == "commercialization" && !check.Resolved {
			return
		}
	}
	t.Fatal("consent blocker is missing")
}

func TestClosedInventoryBlocksPublicationReadinessAndLegacyObservation(t *testing.T) {
	for _, source := range []publicationSource{readyPublicationSource(), readyGrupoOLXPublicationSource()} {
		source.InventoryOpen = false
		for _, scope := range []publicationScope{sitePublicationScope(), grupoOLXPublicationScope(source.GrupoOLXIntegrationID)} {
			checks, _, state := evaluatePublicationReadiness(scope, source)
			blocked := false
			for _, check := range checks {
				blocked = blocked || (check.Code == "inventory" && !check.Resolved && check.Severity == "error")
			}
			if state != ReadinessBlocked || !blocked {
				t.Fatalf("closed inventory was accepted for %s", scope.Channel)
			}
		}
		source.LegacySitePublished = true
		if legacySitePublicationVisible(sitePublicationScope(), source, nil) {
			t.Fatal("legacy visibility ignored closed hierarchy")
		}
	}
}
