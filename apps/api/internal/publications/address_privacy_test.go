package publications

import "testing"

func TestSitePublicationMinimumAliasesAndUnknownPrivacyMaskLocation(t *testing.T) {
	for _, visibility := range []string{"Mínimo", "minimal", "minimum", "unknown", ""} {
		source := map[string]any{"public_address_visibility": visibility, "bairro": "PRIVATE", "cidade": "Curitiba", "endereco": "PRIVATE", "numero": "123", "cep": "12345678"}
		public := sanitizePublicProperty(source)
		for _, key := range []string{"bairro", "endereco", "numero", "cep"} {
			if _, exists := public[key]; exists {
				t.Fatalf("privacy %q exposed %s", visibility, key)
			}
		}
		if public["cidade"] != "Curitiba" || public["public_address_visibility"] != "minimo" {
			t.Fatalf("privacy projection changed safe city: %#v", public)
		}
	}
	for _, visibility := range []string{"completo", " Full ", "complete"} {
		public := sanitizePublicProperty(map[string]any{"public_address_visibility": visibility, "endereco": "Chosen public street", "bairro": "Chosen neighborhood"})
		if public["endereco"] != "Chosen public street" || public["bairro"] != "Chosen neighborhood" {
			t.Fatalf("known complete privacy %q lost chosen location", visibility)
		}
	}
}

func TestMinimumPrivateNeighborhoodDoesNotChangePublishedSnapshotHash(t *testing.T) {
	source := readyPublicationSource()
	source.Property["public_address_visibility"] = "minimo"
	source.Property["bairro"] = "PRIVATE ONE"
	const publicationID = "11111111-1111-4111-8111-111111111111"
	before, err := siteSnapshotHash(buildSiteSnapshot(source, "https://fixture.example", publicationID, 1))
	if err != nil {
		t.Fatal(err)
	}
	source.Property["bairro"] = "PRIVATE TWO"
	after, err := siteSnapshotHash(buildSiteSnapshot(source, "https://fixture.example", publicationID, 1))
	if err != nil || before != after {
		t.Fatalf("minimum snapshot/hash reveals private neighborhood changes: %v", err)
	}
	source.Property["public_address_visibility"] = "parcial"
	partial, err := siteSnapshotHash(buildSiteSnapshot(source, "https://fixture.example", publicationID, 1))
	if err != nil || partial == before {
		t.Fatalf("chosen public neighborhood did not change snapshot: %v", err)
	}
}
