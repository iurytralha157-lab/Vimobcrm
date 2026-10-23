package portals

import (
	"context"
	"strings"
	"testing"
)

func TestSuspendedOrganizationDrainsFeedWithoutLoadingPropertyContent(t *testing.T) {
	integration := publicIntegration{OrganizationActive: false, IsActive: true, Status: "connected", ModuleEnabled: true,
		Settings: map[string]any{"contact_name": "Synthetic agency", "contact_email": "agency@example.test"}}
	loaded := 0
	load := func(context.Context, publicIntegration) (feedSelection, error) {
		loaded++
		return feedSelection{Listings: []feedListing{{PropertyID: "confidential-property"}}}, nil
	}
	selection, active, err := selectGrupoOLXFeed(context.Background(), integration, load)
	if err != nil || active || loaded != 0 || len(selection.Listings) != 0 {
		t.Fatalf("suspended organization loaded feed content: %#v active=%t loaded=%d err=%v", selection, active, loaded, err)
	}
	xml, err := buildVRSyncFeed(integration, selection.Listings)
	if err != nil || strings.Contains(string(xml), "confidential-property") || strings.Contains(string(xml), "<Listing>") {
		t.Fatalf("drain feed exposed property content: %s, %v", xml, err)
	}
	integration.OrganizationActive = true
	_, active, err = selectGrupoOLXFeed(context.Background(), integration, load)
	if err != nil || !active || loaded != 1 {
		t.Fatalf("active organization failed its control: active=%t loaded=%d err=%v", active, loaded, err)
	}
}

func TestFeedMinimumAndUnknownPrivacyNeverExposeAddress(t *testing.T) {
	for _, value := range []string{" Mínimo ", "minimal", "unknown", ""} {
		location := vrSyncLocation{Neighborhood: "PRIVATE", PostalCode: "12345678", Address: "PRIVATE", StreetNumber: "123"}
		applyPublicAddressVisibility(&location, value)
		if !minimumFeedAddressVisibility(value) || location.Neighborhood != "" || location.PostalCode != "" || location.Address != "" || location.StreetNumber != "" {
			t.Fatalf("privacy %q exposed location %#v", value, location)
		}
	}
	for _, value := range []string{"completo", "full", "complete", "all"} {
		location := vrSyncLocation{Address: "Chosen public street"}
		applyPublicAddressVisibility(&location, value)
		if location.Address == "" {
			t.Fatalf("known complete choice %q lost its selected street", value)
		}
	}
}
