package properties

import "testing"

func TestPropertyReferencesCoverTenantBoundRelationships(t *testing.T) {
	expected := map[string]bool{
		"owner_id":            false,
		"city_id":             false,
		"neighborhood_id":     false,
		"condominium_id":      false,
		"property_type_id":    false,
		"created_by":          true,
		"responsible_user_id": true,
		"corretor_id":         true,
	}

	if len(propertyReferences) != len(expected) {
		t.Fatalf("propertyReferences has %d entries, want %d", len(propertyReferences), len(expected))
	}
	for _, reference := range propertyReferences {
		userScope, exists := expected[reference.field]
		if !exists {
			t.Fatalf("unexpected tenant-bound reference %s", reference.field)
		}
		if reference.userScope != userScope {
			t.Fatalf("reference %s userScope = %v, want %v", reference.field, reference.userScope, userScope)
		}
	}
}

func TestOptionalReferenceIDIgnoresNullAndWhitespace(t *testing.T) {
	if optionalReferenceID(nil) != "" || optionalReferenceID("   ") != "" {
		t.Fatal("empty references must be ignored")
	}
	if optionalReferenceID(" 9dff5953-5270-40ff-966d-39fb4021e07e ") != "9dff5953-5270-40ff-966d-39fb4021e07e" {
		t.Fatal("reference ids must be trimmed")
	}
}
