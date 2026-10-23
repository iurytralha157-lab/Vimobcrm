package leads

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestLeadMetaFilterTuplesPreserveLegacyAndOpaqueParentIdentity(t *testing.T) {
	campaigns := map[string]LeadMetaCampaignOption{}
	adsets := map[string]LeadMetaAdsetOption{}
	ads := map[string]LeadMetaAdOption{}
	for _, row := range [][6]string{
		{"Venda-A", "", "Centro", "", "Anúncio", ""},
		{"Venda", "", "A-Centro", "", "Anúncio", ""},
		{"Campanha", "campaign", "Conjunto A", "set-A", "Imóvel", "ad"},
		{"Campanha", "campaign", "Conjunto", "set", "A-Imóvel", "A-ad"},
	} {
		collectLeadMetaFilterOptions(campaigns, adsets, ads, row[0], row[1], row[2], row[3], row[4], row[5])
	}
	if len(campaigns) != 3 || len(adsets) != 4 || len(ads) != 4 {
		t.Fatalf("distinct parent tuples were lost: %#v / %#v / %#v", campaigns, adsets, ads)
	}
	if adsets[leadMetaFilterTupleKey("Venda-A", "Centro")].CampaignID != "Venda-A" || adsets[leadMetaFilterTupleKey("Venda", "A-Centro")].CampaignID != "Venda" {
		t.Fatal("legacy names no longer identify their original campaign")
	}
	if ads[leadMetaFilterTupleKey("campaign", "set-A", "ad")].AdsetID != "set-A" || ads[leadMetaFilterTupleKey("campaign", "set", "A-ad")].AdsetID != "set" {
		t.Fatal("an ad was reassigned to a different parent")
	}
	// Repeated delivery of the same tuple must still deduplicate.
	collectLeadMetaFilterOptions(campaigns, adsets, ads, "Venda-A", "", "Centro", "", "Anúncio", "")
	if len(adsets) != 4 || len(ads) != 4 {
		t.Fatal("the same tuple was duplicated")
	}
	values := []string{`opaque-"campaign"`, "conjunto, com vírgula", "anúncio-ç"}
	var decoded []string
	if err := json.Unmarshal([]byte(leadMetaFilterTupleKey(values...)), &decoded); err != nil || !reflect.DeepEqual(decoded, values) {
		t.Fatalf("tuple identity was changed: %#v / %v", decoded, err)
	}
}
