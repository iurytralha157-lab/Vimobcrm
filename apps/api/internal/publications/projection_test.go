package publications

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

const (
	testPublicationID = "11111111-1111-1111-1111-111111111111"
	testAssetID       = "22222222-2222-2222-2222-222222222222"
)

func TestSiteSnapshotKeepsPrivateAssetOriginOutOfPayload(t *testing.T) {
	source := readyPublicationSource()
	source.Property["owner_name"] = "Private Owner"
	source.Property["owner_phone"] = "+55 11 99999-9999"
	source.Assets = []sourceAsset{{
		ID:          testAssetID,
		AssetType:   "photo",
		Visibility:  "public",
		StoragePath: "organizations/private/property/photo.jpg",
		SortOrder:   1,
		IsPrimary:   true,
	}}

	snapshot := buildSiteSnapshot(source, "https://api.example.com", testPublicationID, 3)
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}
	text := string(encoded)
	for _, forbidden := range []string{"organizations/private", "Private Owner", "+55 11"} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("snapshot leaked %q: %s", forbidden, text)
		}
	}
	if len(snapshot.Media) != 1 {
		t.Fatalf("media length = %d, want 1", len(snapshot.Media))
	}
	media := snapshot.Media[0]
	if media.URL != "https://api.example.com/v1/public/property-publications/11111111-1111-1111-1111-111111111111/versions/3/assets/22222222-2222-2222-2222-222222222222" {
		t.Fatalf("stable media URL = %q", media.URL)
	}
	if media.SourceHash != assetSourceHash("", source.Assets[0].StoragePath, "") || len(media.SourceHash) != 64 {
		t.Fatalf("source hash = %q", media.SourceHash)
	}
}

func TestSnapshotHashChangesWhenAssetContentChangesAtSamePath(t *testing.T) {
	source := readyPublicationSource()
	source.Assets = []sourceAsset{{
		ID: testAssetID, AssetType: "photo", Visibility: "public", StoragePath: "same/photo.jpg",
		IsPrimary: true, ChecksumSHA256: strings.Repeat("a", 64),
	}}
	first := buildSiteSnapshot(source, "https://api.example.com", testPublicationID, 1)
	firstHash, err := siteSnapshotHash(first)
	if err != nil {
		t.Fatal(err)
	}
	source.Assets[0].ChecksumSHA256 = strings.Repeat("b", 64)
	second := buildSiteSnapshot(source, "https://api.example.com", testPublicationID, 1)
	secondHash, err := siteSnapshotHash(second)
	if err != nil {
		t.Fatal(err)
	}
	if firstHash == secondHash {
		t.Fatal("same path with different content checksum must create a new snapshot hash")
	}
	if second.Media[0].SourceHash != strings.Repeat("b", 64) {
		t.Fatalf("media source hash = %q", second.Media[0].SourceHash)
	}
}

func TestNonPublicPropertyAssetPreventsLegacyPhotoFallbackLeak(t *testing.T) {
	source := readyGrupoOLXPublicationSource()
	source.Property["imagem_principal"] = "https://legacy.example/private-photo.jpg"
	source.Property["fotos"] = []string{"https://legacy.example/private-photo.jpg"}
	source.Assets = []sourceAsset{{
		ID: testAssetID, AssetType: "photo", Visibility: "confidential", ExternalURL: "https://private.example/photo.jpg",
	}}

	snapshot := buildGrupoOLXSnapshot(source, "https://api.example.com", testPublicationID, 1)
	if len(snapshot.Media) != 0 || len(stringSlice(snapshot.Property["fotos"])) != 0 {
		t.Fatalf("non-public asset leaked through legacy fallback: %#v", snapshot)
	}
	checks, _, state := evaluateGrupoOLXReadiness(source)
	if state != ReadinessBlocked || findCheck(checks, "grupo_olx_photo").Resolved {
		t.Fatalf("non-public-only media must block readiness: %q %#v", state, checks)
	}
}

func TestGrupoOLXCanonicalPublicationRejectsLegacyOnlyMedia(t *testing.T) {
	source := readyGrupoOLXPublicationSource()
	source.Assets = nil
	source.Property["imagem_principal"] = "https://legacy.example/photo.jpg"
	source.Property["fotos"] = []string{"https://legacy.example/photo.jpg"}

	checks, _, state := evaluateGrupoOLXReadiness(source)
	if state != ReadinessBlocked {
		t.Fatalf("legacy-only canonical readiness = %q, want blocked", state)
	}
	if check := findCheck(checks, "grupo_olx_photo"); check == nil || check.Resolved {
		t.Fatalf("canonical photo proof check = %#v", check)
	}

	snapshot := buildGrupoOLXSnapshot(source, "https://api.example.com", testPublicationID, 1)
	if len(snapshot.Media) != 0 || len(stringSlice(snapshot.Property["fotos"])) != 0 || snapshot.Property["imagem_principal"] != nil {
		t.Fatalf("legacy media was frozen into canonical snapshot: %#v", snapshot)
	}
}

func TestGrupoOLXCanonicalPublicationRequiresJPEGWithKnownBoundedSize(t *testing.T) {
	source := readyGrupoOLXPublicationSource()
	source.Assets[0].MIMEType = ""
	source.Assets[0].FileSizeBytes = nil

	checks, _, state := evaluateGrupoOLXReadiness(source)
	if state != ReadinessBlocked {
		t.Fatalf("unproved canonical media readiness = %q, want blocked", state)
	}
	for _, code := range []string{"grupo_olx_photo_jpeg", "grupo_olx_photo_size"} {
		if check := findCheck(checks, code); check == nil || check.Resolved {
			t.Fatalf("%s check = %#v", code, check)
		}
	}
}

func TestGrupoOLXCanonicalPublicationRejectsClientClaimedExternalMediaProof(t *testing.T) {
	source := readyGrupoOLXPublicationSource()
	source.Assets[0].StoragePath = ""
	source.Assets[0].ExternalURL = "https://external.example/fraud.png"
	source.Assets[0].MIMEType = "image/jpeg"
	claimedSize := int64(1024)
	source.Assets[0].FileSizeBytes = &claimedSize

	checks, _, state := evaluateGrupoOLXReadiness(source)
	if state != ReadinessBlocked {
		t.Fatalf("client-claimed external proof readiness = %q, want blocked", state)
	}
	if check := findCheck(checks, "grupo_olx_photo_verified"); check == nil || check.Resolved {
		t.Fatalf("server verification check = %#v", check)
	}
	snapshot := buildGrupoOLXSnapshot(source, "https://api.example.com", testPublicationID, 1)
	if len(snapshot.Media) != 1 || snapshot.Media[0].ServerVerified {
		t.Fatalf("external media was marked server verified: %#v", snapshot.Media)
	}
}

func TestSiteSnapshotExcludesExactAddressWhileGrupoOLXSnapshotKeepsBackendFeedFields(t *testing.T) {
	source := readyGrupoOLXPublicationSource()
	source.Property["endereco"] = "Rua Privada"
	source.Property["numero"] = "123"
	source.Property["complemento"] = "Apto 45"
	source.Property["cep"] = "01001-000"
	source.Property["latitude"] = -23.5505
	source.Property["longitude"] = -46.6333
	source.Property["public_address_visibility"] = "parcial"

	site := buildSiteSnapshot(source, "https://api.example.com", testPublicationID, 1)
	grupoOLX := buildGrupoOLXSnapshot(source, "https://api.example.com", testPublicationID, 1)
	for _, key := range []string{"endereco", "numero", "complemento", "cep", "latitude", "longitude"} {
		if _, exists := site.Property[key]; exists {
			t.Fatalf("site snapshot leaked exact address field %q", key)
		}
		if _, exists := grupoOLX.Property[key]; !exists {
			t.Fatalf("Grupo OLX backend snapshot is missing feed field %q", key)
		}
	}
	if site.Property["public_address_visibility"] != "parcial" {
		t.Fatalf("site privacy marker = %#v", site.Property["public_address_visibility"])
	}
}

func TestSiteSnapshotAppliesAllAddressPrivacyModes(t *testing.T) {
	source := readyPublicationSource()
	for key, value := range map[string]any{
		"pais": "Brasil", "endereco": "Rua Privada", "numero": "123", "complemento": "Apto 45",
		"cep": "01001-000", "latitude": -23.5505, "longitude": -46.6333,
	} {
		source.Property[key] = value
	}

	tests := []struct {
		mode    string
		present []string
		absent  []string
	}{
		{mode: "minimo", present: []string{"cidade", "estado"}, absent: []string{"bairro", "endereco", "numero", "complemento", "cep", "latitude", "longitude"}},
		{mode: "parcial", present: []string{"bairro", "cidade", "estado"}, absent: []string{"endereco", "numero", "complemento", "cep", "latitude", "longitude"}},
		{mode: "completo", present: []string{"bairro", "cidade", "estado", "pais", "endereco", "numero", "complemento", "cep", "latitude", "longitude"}},
	}
	for _, test := range tests {
		t.Run(test.mode, func(t *testing.T) {
			source.Property["public_address_visibility"] = test.mode
			snapshot := buildSiteSnapshot(source, "https://api.example.com", testPublicationID, 1)
			if snapshot.Property["public_address_visibility"] != test.mode {
				t.Fatalf("privacy marker = %#v", snapshot.Property["public_address_visibility"])
			}
			for _, key := range test.present {
				if _, ok := snapshot.Property[key]; !ok {
					t.Fatalf("%s mode is missing %q", test.mode, key)
				}
			}
			for _, key := range test.absent {
				if _, ok := snapshot.Property[key]; ok {
					t.Fatalf("%s mode leaked %q", test.mode, key)
				}
			}
			for _, forbidden := range []string{"owner_name", "owner_phone", "storage_path"} {
				if _, ok := snapshot.Property[forbidden]; ok {
					t.Fatalf("site snapshot leaked internal field %q", forbidden)
				}
			}
		})
	}
}

func TestGrupoOLXReadinessAndSnapshotUseCanonicalAccountConfiguration(t *testing.T) {
	source := readyGrupoOLXPublicationSource()
	checks, score, state := evaluateGrupoOLXReadiness(source)
	if state != ReadinessReady || score != 100 {
		t.Fatalf("Grupo OLX readiness = %q/%d, checks %#v", state, score, checks)
	}
	snapshot := buildGrupoOLXSnapshot(source, "https://api.example.com", testPublicationID, 4)
	if snapshot.ChannelConfig.ClientListingID != "AP-10" || snapshot.ChannelConfig.PublicationType != "PREMIUM" {
		t.Fatalf("channel config = %#v", snapshot.ChannelConfig)
	}
	if len(snapshot.Media) != 1 || !snapshot.Media[0].Primary {
		t.Fatalf("versioned media = %#v", snapshot.Media)
	}
	if snapshot.Property["finalidade"] != "venda" {
		t.Fatalf("canonical transaction = %#v", snapshot.Property["finalidade"])
	}
}

func TestGrupoOLXSnapshotPropagatesCanonicalRentalPeriod(t *testing.T) {
	source := readyGrupoOLXPublicationSource()
	source.Property["finalidade"] = "temporada"
	source.Offers = []sourceOffer{{OfferType: "seasonal", Status: "active", Price: 950, PricePeriod: "weekly"}}

	snapshot := buildGrupoOLXSnapshot(source, "https://api.example.com", testPublicationID, 2)
	if snapshot.Property["valor_aluguel"] != float64(950) || snapshot.Property["rental_period"] != "weekly" {
		t.Fatalf("canonical rental projection = %#v", snapshot.Property)
	}
	if snapshot.Property["finalidade"] != "locacao" {
		t.Fatalf("seasonal transaction = %#v", snapshot.Property["finalidade"])
	}
}

func TestCanonicalRentOfferTakesPriorityOverSeasonal(t *testing.T) {
	property := map[string]any{}
	offers := []sourceOffer{
		{OfferType: "rent", Status: "active", Price: 3200, PricePeriod: "monthly"},
		{OfferType: "seasonal", Status: "active", Price: 950, PricePeriod: "weekly"},
	}
	applyCanonicalOffers(property, offers)
	if property["valor_aluguel"] != float64(3200) || property["rental_period"] != "monthly" {
		t.Fatalf("rent priority projection = %#v", property)
	}
	if got := grupoOLXRentPrice(property, offers); got != 3200 {
		t.Fatalf("Grupo OLX rent price = %v, want 3200", got)
	}
}

func TestCanonicalSnapshotKeepsOnlySafeIPTUPeriodScalar(t *testing.T) {
	source := readyGrupoOLXPublicationSource()
	source.Property["iptu_period"] = "mensal"
	source.Property["metadata"] = map[string]any{"private_note": "must not leak"}
	snapshot := buildGrupoOLXSnapshot(source, "https://api.example.com", testPublicationID, 1)
	if snapshot.Property["iptu_period"] != "mensal" {
		t.Fatalf("IPTU period scalar = %#v", snapshot.Property["iptu_period"])
	}
	if _, exists := snapshot.Property["metadata"]; exists {
		t.Fatal("property metadata must not be copied into a public snapshot")
	}
}

func TestCanonicalSnapshotDefaultsMissingIPTUPeriodToMonthly(t *testing.T) {
	source := readyGrupoOLXPublicationSource()
	delete(source.Property, "iptu_period")
	snapshot := buildGrupoOLXSnapshot(source, "https://api.example.com", testPublicationID, 1)
	if snapshot.Property["iptu_period"] != "mensal" {
		t.Fatalf("default IPTU period = %#v, want mensal", snapshot.Property["iptu_period"])
	}
}

func TestGrupoOLXReadinessBlocksInvalidProduct(t *testing.T) {
	source := readyGrupoOLXPublicationSource()
	source.GrupoOLXPublicationType = "UNSUPPORTED"
	checks, _, state := evaluateGrupoOLXReadiness(source)
	if state != ReadinessBlocked {
		t.Fatalf("readiness = %q, want blocked", state)
	}
	if check := findCheck(checks, "grupo_olx_product"); check == nil || check.Resolved {
		t.Fatalf("product check = %#v", check)
	}
}

func TestGrupoOLXReadinessRejectsEncodedHTMLInDescription(t *testing.T) {
	source := readyGrupoOLXPublicationSource()
	source.Property["descricao"] = strings.Repeat("Apartamento amplo e bem localizado. ", 2) + "&lt;strong&gt;Destaque&lt;/strong&gt;"

	checks, _, state := evaluateGrupoOLXReadiness(source)
	if state != ReadinessBlocked {
		t.Fatalf("readiness = %q, want blocked", state)
	}
	if check := findCheck(checks, "grupo_olx_description"); check == nil || check.Resolved {
		t.Fatalf("description check = %#v", check)
	}
}

func TestGrupoOLXReadinessAllowsOfficialEncodedDescriptionFormatting(t *testing.T) {
	source := readyGrupoOLXPublicationSource()
	source.Property["descricao"] = strings.Repeat("Apartamento amplo e bem localizado. ", 2) +
		"&lt;br&gt;&lt;b&gt;Destaque&lt;/b&gt; &lt;i&gt;exclusivo&lt;/i&gt; &bull;"

	checks, _, state := evaluateGrupoOLXReadiness(source)
	if state != ReadinessReady {
		t.Fatalf("readiness = %q, checks %#v", state, checks)
	}
}

func TestGrupoOLXReadinessRejectsRawDescriptionHTML(t *testing.T) {
	source := readyGrupoOLXPublicationSource()
	source.Property["descricao"] = strings.Repeat("Apartamento amplo e bem localizado. ", 2) + "<b>Destaque</b>"

	checks, _, state := evaluateGrupoOLXReadiness(source)
	if state != ReadinessBlocked || findCheck(checks, "grupo_olx_description").Resolved {
		t.Fatalf("raw HTML must be blocked: %q %#v", state, checks)
	}
}

func TestGrupoOLXReadinessRejectsMinimumAddressVisibility(t *testing.T) {
	source := readyGrupoOLXPublicationSource()
	source.Property["address_visibility"] = "minimo"
	source.Property["public_address_visibility"] = "parcial"

	checks, _, state := evaluateGrupoOLXReadiness(source)
	if state != ReadinessBlocked {
		t.Fatalf("readiness = %q, want blocked", state)
	}
	if check := findCheck(checks, "grupo_olx_address_visibility"); check == nil || check.Resolved {
		t.Fatalf("address visibility check = %#v", check)
	}
}

func TestGrupoOLXPropertyTypeCoversOfficialExtendedCatalog(t *testing.T) {
	cases := map[string]string{
		"casa de vila":         "Residential / Village House",
		"fazenda":              "Residential / Agricultural",
		"chacara":              "Residential / Farm Ranch",
		"consultorio":          "Commercial / Consultorio",
		"edificio residencial": "Commercial / Edificio Residencial",
		"garagem":              "Commercial / Garage",
		"hotel":                "Commercial / Hotel",
		"predio":               "Commercial / Building",
		"laje corporativa":     "Commercial / Corporate Floor",
		"terreno comercial":    "Commercial / Land Lot",
		"edificio comercial":   "Commercial / Edificio Comercial",
	}
	for input, expected := range cases {
		if actual := grupoOLXPropertyType(input); actual != expected {
			t.Errorf("property type %q = %q, want %q", input, actual, expected)
		}
	}
}

func TestPublicationPreviewHonorsFrontendLengthContract(t *testing.T) {
	property := map[string]any{
		"titulo":    strings.Repeat("T", 5000),
		"descricao": strings.Repeat("D", 12000),
		"bairro":    strings.Repeat("B", 1200),
		"cidade":    "Cidade",
		"estado":    "SP",
	}
	preview := buildPreview(property, "")
	if preview.Title == nil || len([]rune(*preview.Title)) != 4000 {
		t.Fatalf("title length = %v", preview.Title)
	}
	if preview.Description == nil || len([]rune(*preview.Description)) != 10000 {
		t.Fatalf("description length = %v", preview.Description)
	}
	if preview.Address == nil || len([]rune(*preview.Address)) != 1000 {
		t.Fatalf("address length = %v", preview.Address)
	}
}

func TestSiteSnapshotHashDetectsAssetOriginChangesWithoutPropertyTimestamp(t *testing.T) {
	source := readyPublicationSource()
	source.Assets = []sourceAsset{{
		ID: testAssetID, AssetType: "photo", Visibility: "public", StoragePath: "one.jpg", IsPrimary: true,
	}}
	first, err := siteSnapshotHash(buildSiteSnapshot(source, "https://api.example.com", testPublicationID, 1))
	if err != nil {
		t.Fatalf("first hash: %v", err)
	}
	source.Assets[0].StoragePath = "two.jpg"
	second, err := siteSnapshotHash(buildSiteSnapshot(source, "https://api.example.com", testPublicationID, 1))
	if err != nil {
		t.Fatalf("second hash: %v", err)
	}
	if first == second {
		t.Fatal("snapshot hash did not change with the asset origin")
	}
}

func TestSiteReadinessTreatsOperationalRelationshipsAsWarnings(t *testing.T) {
	source := readyPublicationSource()
	source.OwnerPresent = false
	source.ResponsiblePresent = false
	checks, _, state := evaluateSiteReadiness(source)
	if state != ReadinessReady {
		t.Fatalf("readiness = %q, want ready", state)
	}
	for _, code := range []string{"owner", "responsible"} {
		check := findCheck(checks, code)
		if check == nil || check.Severity != "warning" || check.Resolved {
			t.Fatalf("%s check = %#v, want unresolved warning", code, check)
		}
	}
}

func TestSiteReadinessBlocksIncompatiblePurpose(t *testing.T) {
	source := readyPublicationSource()
	source.Property["finalidade"] = "locacao"
	source.Offers = []sourceOffer{{OfferType: "sale", Status: "active", Price: 500000}}
	checks, _, state := evaluateSiteReadiness(source)
	if state != ReadinessBlocked {
		t.Fatalf("readiness = %q, want blocked", state)
	}
	if check := findCheck(checks, "purpose"); check == nil || check.Resolved {
		t.Fatalf("purpose check = %#v, want unresolved", check)
	}
}

func TestPropertyPublicURLUsesVerifiedDomainAndSubdomainFallback(t *testing.T) {
	if got := propertyPublicURL("https://app.example.com", "imoveis.example.com", "acme", "AP 10"); got != "https://imoveis.example.com/imovel/AP%2010" {
		t.Fatalf("verified domain URL = %q", got)
	}
	if got := propertyPublicURL("https://app.example.com/", "", "acme", "AP 10"); got != "https://app.example.com/sites/acme/imovel/AP%2010" {
		t.Fatalf("subdomain fallback URL = %q", got)
	}
}

func readyPublicationSource() publicationSource {
	return publicationSource{
		Property: map[string]any{
			"id":          "33333333-3333-3333-3333-333333333333",
			"codigo":      "AP-10",
			"titulo":      "Apartamento central",
			"descricao":   "Descricao publica suficiente.",
			"tipo_imovel": "apartamento",
			"finalidade":  "venda",
			"bairro":      "Centro",
			"cidade":      "Sao Paulo",
			"estado":      "SP",
			"valor_venda": 500000.0,
		},
		UpdatedAt:          time.Date(2026, 8, 1, 12, 30, 0, 0, time.UTC),
		Status:             "active",
		OwnerPresent:       true,
		ResponsiblePresent: true,
		Offers:             []sourceOffer{{OfferType: "sale", Status: "active", Price: 500000}},
		Assets: []sourceAsset{{
			ID: testAssetID, AssetType: "photo", Visibility: "public", ExternalURL: "https://cdn.example.com/photo.jpg", IsPrimary: true,
		}},
		SiteActive:       true,
		SiteModuleActive: true,
		SitePublicURL:    "https://app.example.com/sites/acme/imovel/AP-10",
	}
}

func readyGrupoOLXPublicationSource() publicationSource {
	source := readyPublicationSource()
	source.Assets[0].StoragePath = "orgs/test/properties/test/photo.jpg"
	source.Assets[0].ExternalURL = ""
	source.Property["descricao"] = strings.Repeat("Apartamento amplo e bem localizado. ", 3)
	source.Property["cep"] = "01001-000"
	source.Property["area_construida"] = 82.0
	source.Property["quartos"] = 2.0
	source.Property["banheiros"] = 1.0
	source.Assets[0].MIMEType = "image/jpeg"
	source.Assets[0].FileName = "apartamento.jpg"
	fileSize := int64(4096)
	source.Assets[0].FileSizeBytes = &fileSize
	source.GrupoOLXIntegrationID = "55555555-5555-4555-8555-555555555555"
	source.GrupoOLXStatus = "connected"
	source.GrupoOLXActive = true
	source.GrupoOLXModuleActive = true
	source.GrupoOLXSettings = map[string]any{
		"contact_name":    "Imobiliaria Vimob",
		"contact_email":   "portais@vimob.com.br",
		"detail_base_url": "https://imoveis.example.com/imovel",
	}
	source.GrupoOLXClientListingID = "AP-10"
	source.GrupoOLXPublicationType = "PREMIUM"
	source.GrupoOLXPublicURL = "https://imoveis.example.com/imovel/AP-10"
	return source
}

func findCheck(checks []Check, code string) *Check {
	for index := range checks {
		if checks[index].Code == code {
			return &checks[index]
		}
	}
	return nil
}
