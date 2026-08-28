package grupoolx

import "testing"

func TestOfficialTaxonomyAndRoomRequirements(t *testing.T) {
	if got := NormalizePropertyType("Edifício residencial"); got != "Commercial / Edificio Residencial" {
		t.Fatalf("residential building taxonomy = %q", got)
	}
	if got := NormalizePropertyType("Imóvel comercial"); got != "Commercial / Building" {
		t.Fatalf("generic commercial taxonomy = %q", got)
	}
	if got := NormalizePropertyType("Loja"); got != "Commercial / Business" {
		t.Fatalf("store taxonomy = %q", got)
	}
	if got := NormalizePropertyType("Fazenda"); got != "Residential / Agricultural" {
		t.Fatalf("agricultural taxonomy = %q", got)
	}
	if got := NormalizePropertyType("Chácara"); got != "Residential / Farm Ranch" {
		t.Fatalf("farm ranch taxonomy = %q", got)
	}
	for input, want := range map[string]string{
		"Depósito":                "Commercial / Industrial",
		"Armazém":                 "Commercial / Industrial",
		"Motel":                   "Commercial / Hotel",
		"Prédio inteiro":          "Commercial / Edificio Comercial",
		"Andar":                   "Commercial / Corporate Floor",
		"Salão":                   "Commercial / Business",
		"Fazenda/Sítios/Chácaras": "Residential / Agricultural",
	} {
		if got := NormalizePropertyType(input); got != want {
			t.Errorf("taxonomy %q = %q, want %q", input, got, want)
		}
	}
	studio := RoomRequirementsFor("Residential / Studio")
	if studio.MinimumBedrooms != 1 {
		t.Fatalf("studio bedroom requirement = %#v", studio)
	}
	kitnet := RoomRequirementsFor("Residential / Kitnet")
	if kitnet.MinimumBedrooms != 0 || kitnet.MinimumBathrooms != 1 {
		t.Fatalf("kitnet room requirements = %#v", kitnet)
	}
	if business := RoomRequirementsFor("Commercial / Business"); business.MinimumBathrooms != 0 {
		t.Fatalf("business bathroom requirement = %#v", business)
	}
}
