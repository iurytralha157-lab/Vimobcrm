package portals

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestEnsureJSONEOF(t *testing.T) {
	valid := json.NewDecoder(strings.NewReader("{}  \n"))
	var value map[string]any
	if err := valid.Decode(&value); err != nil {
		t.Fatalf("decode valid JSON: %v", err)
	}
	if err := ensureJSONEOF(valid); err != nil {
		t.Fatalf("expected one JSON value to be accepted: %v", err)
	}

	invalid := json.NewDecoder(strings.NewReader("{} {}"))
	if err := invalid.Decode(&value); err != nil {
		t.Fatalf("decode first JSON value: %v", err)
	}
	if err := ensureJSONEOF(invalid); err == nil {
		t.Fatal("expected trailing JSON value to be rejected")
	}
}

func TestBuildVRSyncFeedUsesOfficialAttributes(t *testing.T) {
	integration := publicIntegration{Settings: map[string]any{
		"contact_name":    "Imobiliaria Vimob",
		"contact_email":   "portais@vimob.com.br",
		"contact_phone":   "(22) 99999-0000",
		"detail_base_url": "https://imoveis.vimob.com.br/imovel",
	}}
	property := map[string]any{
		"code":                      "RJ-100",
		"title":                     "Apartamento com vista para o mar",
		"descricao_site":            strings.Repeat("Apartamento amplo e bem localizado. ", 3),
		"tipo_de_negocio":           "venda e locacao",
		"tipo_de_imovel":            "apartamento",
		"preco":                     150000.80,
		"valor_locacao":             1500.75,
		"condominio":                500.90,
		"iptu":                      120.50,
		"area_util":                 82.40,
		"area_total":                95.90,
		"quartos":                   3.0,
		"banheiros":                 2.0,
		"suites":                    1.0,
		"vagas":                     2.0,
		"uf":                        "RJ",
		"cidade":                    "Macae",
		"bairro":                    "Centro",
		"endereco":                  "Rua das Flores",
		"numero":                    "100",
		"cep":                       "27910-000",
		"public_address_visibility": "parcial",
		"latitude":                  -22.376,
		"longitude":                 -41.786,
		"imagem_principal":          "https://cdn.vimob.com.br/rj-100.jpg",
		"image_urls":                []any{"https://cdn.vimob.com.br/rj-100-2.jpg"},
		"tour_virtual":              "https://tour.vimob.com.br/rj-100",
		"metadata":                  map[string]any{"iptu_period": "mensal"},
	}

	body, err := buildVRSyncFeed(integration, []feedListing{{
		PublicationID:   "11111111-1111-4111-8111-111111111111",
		ClientListingID: "RJ-100",
		PublicationType: "PREMIUM",
		Property:        property,
	}})
	if err != nil {
		t.Fatalf("build feed: %v", err)
	}
	xmlBody := string(body)
	assertContains(t, xmlBody, `xsi:schemaLocation="http://www.vivareal.com/schemas/1.0/VRSync http://xml.vivareal.com/vrsync.xsd"`)
	assertContains(t, xmlBody, `<Location displayAddress="Neighborhood">`)
	assertContains(t, xmlBody, `<Country abbreviation="BR">Brasil</Country>`)
	assertContains(t, xmlBody, `<State abbreviation="RJ">Rio de Janeiro</State>`)
	assertContains(t, xmlBody, `<PostalCode>27910000</PostalCode>`)
	assertContains(t, xmlBody, `<ListPrice currency="BRL">150000</ListPrice>`)
	assertContains(t, xmlBody, `<RentalPrice currency="BRL" period="Monthly">1500</RentalPrice>`)
	assertContains(t, xmlBody, `<Iptu currency="BRL" period="Monthly">120</Iptu>`)
	assertContains(t, xmlBody, `<LivingArea unit="square metres">82</LivingArea>`)
	assertContains(t, xmlBody, `<Item medium="image" caption="img1" primary="true">https://cdn.vimob.com.br/rj-100.jpg</Item>`)
	assertContains(t, xmlBody, `<VirtualTourLink>https://tour.vimob.com.br/rj-100</VirtualTourLink>`)
	if strings.Contains(xmlBody, "<DisplayAddress>") {
		t.Fatal("displayAddress must be an attribute, not an element")
	}
	for _, privateAddressField := range []string{"<Address>", "<StreetNumber>", "<Complement>", "<Latitude>", "<Longitude>"} {
		if strings.Contains(xmlBody, privateAddressField) {
			t.Fatalf("partial address visibility leaked %s", privateAddressField)
		}
	}
}

func TestBuildVRSyncFeedIsDeterministicForConditionalGET(t *testing.T) {
	integration := validFeedIntegration()
	integration.FeedPublishedAt = time.Date(2026, 8, 1, 15, 30, 0, 0, time.UTC)
	first, err := buildVRSyncFeed(integration, []feedListing{validFeedListing("active")})
	if err != nil {
		t.Fatal(err)
	}
	second, err := buildVRSyncFeed(integration, []feedListing{validFeedListing("active")})
	if err != nil {
		t.Fatal(err)
	}
	if string(first) != string(second) {
		t.Fatal("unchanged feed state must produce an identical representation for ETag revalidation")
	}
	assertContains(t, string(first), "<PublishDate>2026-08-01T15:30:00Z</PublishDate>")
}

func TestBuildVRSyncFeedMapsCanonicalCondominiumFee(t *testing.T) {
	listing := validFeedListing("active")
	listing.Property["valor_condominio"] = 725.90

	body, err := buildVRSyncFeed(validFeedIntegration(), []feedListing{listing})
	if err != nil {
		t.Fatalf("build feed: %v", err)
	}
	assertContains(t, string(body), `<PropertyAdministrationFee currency="BRL">725</PropertyAdministrationFee>`)
}

func TestIPTUPeriodReadsCanonicalSnapshotScalar(t *testing.T) {
	if got := iptuPeriod(map[string]any{"iptu_period": "mensal"}); got != "Monthly" {
		t.Fatalf("monthly IPTU period = %q", got)
	}
	if got := iptuPeriod(map[string]any{"iptu_period": "anual"}); got != "Yearly" {
		t.Fatalf("yearly IPTU period = %q", got)
	}
}

func TestBuildVRSyncFeedMapsSeasonalCanonicalPeriod(t *testing.T) {
	listing := validFeedListing("active")
	listing.Property["tipo_de_negocio"] = "temporada"
	listing.Property["preco"] = nil
	listing.Property["valor_aluguel"] = 950
	listing.Property["rental_period"] = "weekly"

	body, err := buildVRSyncFeed(validFeedIntegration(), []feedListing{listing})
	if err != nil {
		t.Fatalf("build feed: %v", err)
	}
	assertContains(t, string(body), `<TransactionType>For Rent</TransactionType>`)
	assertContains(t, string(body), `<RentalPrice currency="BRL" period="Weekly">950</RentalPrice>`)
}

func TestSaleRentNeverUsesSalePriceAsRentalPrice(t *testing.T) {
	listing := validFeedListing("active")
	listing.Property["tipo_de_negocio"] = "venda e locacao"
	listing.Property["preco"] = 450000
	delete(listing.Property, "valor_locacao")
	delete(listing.Property, "valor_aluguel")
	errors := validateFeedListing(validFeedIntegration(), listing)
	if !containsValidationError(errors, "Valor de locacao e obrigatorio.") {
		t.Fatalf("sale-only price accepted as rental price: %#v", errors)
	}
	if got := priceForRent(listing.Property, "Sale/Rent"); got != nil {
		t.Fatalf("sale price leaked into RentalPrice: %#v", got)
	}
}

func TestInternalAppraisalIsNotPublishedAsListPrice(t *testing.T) {
	property := map[string]any{"valor_venda_avaliado": 500000}
	if got := priceForSale(property, "For Sale"); got != nil {
		t.Fatalf("internal appraisal leaked into ListPrice: %#v", got)
	}
}

func TestETagMatchesStrongWeakAndWildcardValidators(t *testing.T) {
	for _, value := range []string{`"abc"`, `W/"abc"`, `"other", "abc"`, `*`} {
		if !etagMatches(value, `"abc"`) {
			t.Fatalf("expected %q to match", value)
		}
	}
	if etagMatches(`"other"`, `"abc"`) {
		t.Fatal("different validator must not match")
	}
}

func TestFeedListingLimitNeverAllowsSilentTruncation(t *testing.T) {
	if err := ensureFeedListingLimit(maxGrupoOLXFeedListings); err != nil {
		t.Fatalf("maximum supported feed must be accepted: %v", err)
	}
	if err := ensureFeedListingLimit(maxGrupoOLXFeedListings + 1); !errors.Is(err, ErrFeedListingLimit) {
		t.Fatalf("oversized feed error = %v, want explicit listing limit error", err)
	}
}

func TestValidateFeedListingRejectsIncompleteListing(t *testing.T) {
	integration := publicIntegration{Settings: map[string]any{}}
	errors := validateFeedListing(integration, feedListing{
		ClientListingID: "X",
		PublicationType: "UNSUPPORTED",
		Property: map[string]any{
			"title": "Curto",
		},
	})
	if len(errors) < 8 {
		t.Fatalf("expected comprehensive validation errors, got %#v", errors)
	}
}

func TestValidateFeedListingRejectsEncodedHTMLMarkup(t *testing.T) {
	listing := validFeedListing("active")
	listing.Property["title"] = "Apartamento &lt;b&gt;completo&lt;/b&gt;"
	listing.Property["descricao_site"] = strings.Repeat("Apartamento amplo e bem localizado. ", 2) + "&lt;strong&gt;Destaque&lt;/strong&gt;"

	errors := validateFeedListing(validFeedIntegration(), listing)
	for _, expected := range []string{"Titulo nao pode conter HTML.", "Descricao nao pode conter HTML."} {
		if !containsValidationError(errors, expected) {
			t.Fatalf("missing %q in validation errors %#v", expected, errors)
		}
	}
}

func TestValidateFeedListingAllowsOfficialEncodedDescriptionFormatting(t *testing.T) {
	listing := validFeedListing("active")
	listing.Property["descricao_site"] = strings.Repeat("Apartamento amplo e bem localizado. ", 2) +
		"&lt;br&gt;&lt;b&gt;Destaque&lt;/b&gt; &lt;i&gt;exclusivo&lt;/i&gt; &bull;"

	errors := validateFeedListing(validFeedIntegration(), listing)
	if containsValidationError(errors, "Descricao nao pode conter HTML.") {
		t.Fatalf("official encoded formatting must be accepted: %#v", errors)
	}
}

func TestValidateFeedListingRejectsRawDescriptionHTML(t *testing.T) {
	listing := validFeedListing("active")
	listing.Property["descricao_site"] = strings.Repeat("Apartamento amplo e bem localizado. ", 2) + "<b>Destaque</b>"

	errors := validateFeedListing(validFeedIntegration(), listing)
	if !containsValidationError(errors, "Descricao nao pode conter HTML.") {
		t.Fatalf("raw HTML must be rejected: %#v", errors)
	}
}

func TestValidateFeedListingRejectsUnavailablePropertyStatuses(t *testing.T) {
	unavailableStatuses := []string{
		"draft",
		"reserved",
		"sold",
		"rented",
		"inactive",
		"archived",
		"rascunho",
		"reservado",
		"vendido",
		"alugado",
		"locado",
		"inativo",
		"arquivado",
	}

	for _, status := range unavailableStatuses {
		t.Run(status, func(t *testing.T) {
			errors := validateFeedListing(validFeedIntegration(), validFeedListing(status))
			if !containsValidationError(errors, "Imovel nao esta ativo para publicacao.") {
				t.Fatalf("status %q must not be exported, got errors %#v", status, errors)
			}
		})
	}
}

func TestValidateFeedListingAllowsAvailablePropertyStatuses(t *testing.T) {
	availableStatuses := []string{"active", "available", "ativo", "disponivel"}

	for _, status := range availableStatuses {
		t.Run(status, func(t *testing.T) {
			errors := validateFeedListing(validFeedIntegration(), validFeedListing(status))
			if containsValidationError(errors, "Imovel nao esta ativo para publicacao.") {
				t.Fatalf("status %q must remain eligible for export, got errors %#v", status, errors)
			}
		})
	}
}

func TestMinimumAddressVisibilityIsRejectedAndNeverMappedWithNeighborhoodOrCEP(t *testing.T) {
	listing := validFeedListing("active")
	listing.Property["address_visibility"] = "minimo"
	listing.Property["public_address_visibility"] = "parcial"

	errors := validateFeedListing(validFeedIntegration(), listing)
	if !containsValidationError(errors, "Grupo OLX exige bairro e CEP; selecione endereco parcial ou completo.") {
		t.Fatalf("minimum visibility must be invalid for VRSync: %#v", errors)
	}
	mapped, ok := mapToVRSyncListing(validFeedIntegration(), listing)
	if !ok {
		t.Fatal("mapper unexpectedly rejected the fixture")
	}
	if mapped.Location.Neighborhood != "" || mapped.Location.PostalCode != "" {
		t.Fatalf("minimum visibility leaked neighborhood/CEP: %#v", mapped.Location)
	}
}

func TestLegacyJPEGMediaRemainsDuringMigrationAndPNGIsBlocked(t *testing.T) {
	listing := validFeedListing("active")
	listing.Source = "legacy"
	errors := validateFeedListing(validFeedIntegration(), listing)
	if containsValidationError(errors, "Fotos legadas precisam usar HTTP(S) e extensao JPG/JPEG.") {
		t.Fatalf("historical JPEG fallback was removed before migration: %#v", errors)
	}
	listing.Property["imagem_principal"] = "http://legacy.example.test/photo.jpg"
	errors = validateFeedListing(validFeedIntegration(), listing)
	if containsValidationError(errors, "Fotos legadas precisam usar HTTP(S) e extensao JPG/JPEG.") {
		t.Fatalf("historical HTTP JPEG fallback was removed before migration: %#v", errors)
	}
	listing.Property["imagem_principal"] = "https://cdn.example.test/photo.png"
	errors = validateFeedListing(validFeedIntegration(), listing)
	if !containsValidationError(errors, "Fotos legadas precisam usar HTTP(S) e extensao JPG/JPEG.") {
		t.Fatalf("explicit legacy PNG was exported: %#v", errors)
	}
}

func TestCanonicalFeedRequiresServerVerifiedJPEGProof(t *testing.T) {
	listing := validFeedListing("active")
	listing.Source = "canonical"
	size := int64(4096)
	listing.Media = []feedMediaProof{{
		Kind: "photo", MIMEType: "image/jpeg", FileSizeBytes: &size, ServerVerified: true,
	}}
	if errors := validateFeedListing(validFeedIntegration(), listing); containsValidationError(errors, "Fotos canonicas precisam") {
		t.Fatalf("verified canonical media was rejected: %#v", errors)
	}
	listing.Media[0].ServerVerified = false
	if errors := validateFeedListing(validFeedIntegration(), listing); !containsValidationError(errors, "Fotos canonicas precisam de verificacao server-side do objeto.") {
		t.Fatalf("client-claimed canonical proof was accepted: %#v", errors)
	}
}

func TestFeedPropertyTypeMatchesOfficialExtendedCatalog(t *testing.T) {
	cases := map[string]string{
		"casa de vila":         "Residential / Village House",
		"fazenda":              "Residential / Agricultural",
		"chacara":              "Residential / Farm Ranch",
		"consultorio":          "Commercial / Consultorio",
		"edificio residencial": "Commercial / Edificio Residencial",
		"imovel comercial":     "Commercial / Building",
		"loja":                 "Commercial / Business",
		"garagem":              "Commercial / Garage",
		"hotel":                "Commercial / Hotel",
		"predio":               "Commercial / Building",
		"laje corporativa":     "Commercial / Corporate Floor",
		"terreno comercial":    "Commercial / Land Lot",
		"edificio comercial":   "Commercial / Edificio Comercial",
	}
	for input, expected := range cases {
		if actual := normalizePropertyType(input); actual != expected {
			t.Errorf("property type %q = %q, want %q", input, actual, expected)
		}
	}
}

func TestFarmRanchValidationUsesLotAreaLikeCanonicalReadiness(t *testing.T) {
	listing := validFeedListing("active")
	listing.Property["tipo_de_imovel"] = "fazenda"
	listing.Property["area_util"] = nil
	listing.Property["area_total"] = 5000
	if errors := validateFeedListing(validFeedIntegration(), listing); containsValidationError(errors, "Area total e obrigatoria para este tipo de imovel.") {
		t.Fatalf("Farm Ranch with lot area must be valid: %#v", errors)
	}
	listing.Property["area_total"] = 0
	if errors := validateFeedListing(validFeedIntegration(), listing); !containsValidationError(errors, "Area total e obrigatoria para este tipo de imovel.") {
		t.Fatalf("Farm Ranch without lot area must be rejected: %#v", errors)
	}
}

func TestGlobalWebhookSecretRequiresBasicAuthorization(t *testing.T) {
	secret := "594F803B380A41396ED63DCA39503542"
	header := "Basic " + base64.StdEncoding.EncodeToString([]byte("vivareal:"+secret))
	if !validWebhookAuthorization(header, secret) {
		t.Fatal("valid Grupo OLX basic authorization should be accepted")
	}
	if validWebhookAuthorization(header, "wrong") {
		t.Fatal("invalid secret should be rejected")
	}
	if validWebhookAuthorization("Bearer "+secret, secret) {
		t.Fatal("Grupo OLX webhook secret must be accepted only through Basic authorization")
	}
	if validWebhookAuthorization("", "") {
		t.Fatal("an unconfigured secret must not authorize a webhook")
	}
}

func TestOversizedGrupoOLXProviderIDsUseBoundedIdempotencyKeys(t *testing.T) {
	payload := []byte(`{"originLeadId":"raw-provider-value"}`)
	oversized := strings.Repeat("á", maxGrupoOLXProviderIDRunes+1)
	wantHash := payloadHash(payload)

	if got := normalizeGrupoOLXLeadEventKey(oversized, payload); got != "sha256:"+wantHash {
		t.Fatalf("oversized lead event key = %q", got)
	}
	if got := normalizeGrupoOLXReportID(oversized, payload); got != wantHash {
		t.Fatalf("oversized report id = %q", got)
	}
	if first, second := normalizeGrupoOLXLeadEventKey(oversized, payload), normalizeGrupoOLXLeadEventKey(oversized, payload); first != second {
		t.Fatalf("lead idempotency key is not deterministic: %q != %q", first, second)
	}
	if got := normalizeGrupoOLXReportID(" provider-id ", payload); got != "provider-id" {
		t.Fatalf("bounded report id = %q", got)
	}
}

func TestMCMVLeadMayArriveWithoutListingID(t *testing.T) {
	if !isGrupoOLXMCMVLead(map[string]any{"leadOrigin": "mcmv_olx"}) {
		t.Fatal("official mcmv_olx origin must allow an unlinked lead")
	}
	if !isGrupoOLXMCMVLead(map[string]any{"lead_origin": "MCMV_OLX"}) {
		t.Fatal("legacy casing and field alias should remain compatible")
	}
	if isGrupoOLXMCMVLead(map[string]any{"leadOrigin": "portal"}) {
		t.Fatal("regular portal leads still require a ListingID")
	}
}

func TestMCMVLeadAnalyticsPreserveOfficialFieldsWithoutListingID(t *testing.T) {
	body := map[string]any{
		"leadOrigin": "MCMV_OLX",
		"createdAt":  "2026-08-01T15:04:05-03:00",
		"extraData": map[string]any{
			"leadType": "financing",
			"mcmv":     map[string]any{"income": 4500.0},
		},
	}
	origin, leadType, occurredAt, mcmv := grupoOLXLeadAnalytics(body)
	if origin != "mcmv_olx" || leadType != "financing" || occurredAt != "2026-08-01T18:04:05Z" || mcmv == nil {
		t.Fatalf("MCMV analytics = origin=%q type=%q occurred=%q mcmv=%#v", origin, leadType, occurredAt, mcmv)
	}
}

func TestOfficialLeadPhoneAlwaysPrefixesDDD(t *testing.T) {
	got := normalizeGrupoOLXLeadPhone(map[string]any{"ddd": "11", "phone": "119876543"})
	if got != "11119876543" {
		t.Fatalf("official phone normalization = %q", got)
	}
}

func TestImportReportRequiresOfficialObjectShape(t *testing.T) {
	valid := map[string]any{
		"type": "FEEDS_INTEGRATION_REPORT",
		"details": map[string]any{
			"date": "2026-08-01T15:04:05Z", "total": 1.0, "created": 1.0,
			"updated": 0.0, "deleted": 0.0, "unchanged": 0.0,
			"error": 0.0, "warning": 0.0,
		},
	}
	if !validGrupoOLXImportReportPayload(valid) {
		t.Fatal("official report shape was rejected")
	}
	for _, invalid := range []map[string]any{
		nil,
		{},
		{"type": "UNKNOWN", "details": valid["details"]},
		{"type": "FEEDS_INTEGRATION_REPORT", "details": map[string]any{}},
		{"type": "FEEDS_INTEGRATION_REPORT", "details": map[string]any{
			"date": "2026-08-01T15:04:05Z", "total": "1", "created": 1.0,
			"updated": 0.0, "deleted": 0.0, "unchanged": 0.0, "error": false, "warning": 0.0,
		}},
	} {
		if validGrupoOLXImportReportPayload(invalid) {
			t.Fatalf("invalid report shape accepted: %#v", invalid)
		}
	}
}

func TestImportReportIssueExpansionIsBoundedAtFeedCapacity(t *testing.T) {
	externalIDs := make([]any, maxGrupoOLXReportListings)
	for index := range externalIDs {
		externalIDs[index] = fmt.Sprintf("listing-%05d", index)
	}
	issues, err := reportListingIssues([]any{map[string]any{
		"errorMessage": "invalid listing", "externalIds": externalIDs,
	}}, "errorMessage")
	if err != nil || len(issues) != maxGrupoOLXReportListings {
		t.Fatalf("50k report issues = %d, %v", len(issues), err)
	}
	externalIDs = append(externalIDs, "listing-overflow")
	if _, err := reportListingIssues([]any{map[string]any{
		"errorMessage": "invalid listing", "externalIds": externalIDs,
	}}, "errorMessage"); err == nil {
		t.Fatal("report above the 50k feed capacity must be rejected")
	}
}

func TestReportListingIssuesMapsExternalIDs(t *testing.T) {
	issues, err := reportListingIssues([]any{
		map[string]any{
			"errorMessage": "CEP invalido",
			"externalIds":  []any{"RJ-100", "RJ-101"},
		},
		map[string]any{
			"message":     "Imagem pequena",
			"externalIds": []any{"RJ-100"},
		},
	}, "errorMessage")
	if err != nil {
		t.Fatal(err)
	}

	if len(issues["RJ-100"]) != 2 || len(issues["RJ-101"]) != 1 {
		t.Fatalf("unexpected report issues: %#v", issues)
	}
}

func TestCanonicalImportReportRequiresCurrentVersionTimestampFence(t *testing.T) {
	publishedAt := time.Date(2026, 8, 1, 15, 30, 0, 0, time.UTC)
	before := publishedAt.Add(-time.Second)
	after := publishedAt.Add(time.Second)
	if reportCanAnnotateCanonical(nil, publishedAt) {
		t.Fatal("missing provider timestamp must not downgrade canonical state")
	}
	if reportCanAnnotateCanonical(&before, publishedAt) {
		t.Fatal("stale provider report must not annotate a newer published version")
	}
	if !reportCanAnnotateCanonical(&after, publishedAt) {
		t.Fatal("current provider report should annotate the matching published version")
	}
	parsed := parsePortalReportTimestamp("2026-08-01T15:30:01Z")
	if parsed == nil || !parsed.Equal(after) {
		t.Fatalf("parsed report timestamp = %v", parsed)
	}
	officialWithoutOffset := parsePortalReportTimestamp("2020-09-30T19:21:13")
	if officialWithoutOffset == nil || !officialWithoutOffset.Equal(time.Date(2020, 9, 30, 19, 21, 13, 0, time.UTC)) {
		t.Fatalf("official offset-less report date must use conservative UTC fence, got %v", officialWithoutOffset)
	}
}

func TestImportChecksAreStrictDeduplicatedAndLengthBounded(t *testing.T) {
	message := strings.Repeat("x", 1200)
	checks := mergePortalIssueChecks(nil, []string{message, message}, "warning", "grupo_olx_import_warning", "Aviso")
	if len(checks) != 1 {
		t.Fatalf("checks = %#v", checks)
	}
	check := checks[0]
	if check.Code == "" || check.Label == "" || check.Severity != "warning" || check.Resolved || check.Message == nil {
		t.Fatalf("strict check = %#v", check)
	}
	if len([]rune(*check.Message)) != 1000 {
		t.Fatalf("message length = %d", len([]rune(*check.Message)))
	}
}

func TestValidFeedClearsOnlyPriorAdapterValidationChecks(t *testing.T) {
	checks := []portalPublicationCheck{
		{Code: "grupo_olx_feed_validation_title", Severity: "error"},
		{Code: "grupo_olx_import_warning_address", Severity: "warning"},
		{Code: "grupo_olx_feed_validation_photo", Severity: "error"},
	}
	got := removePortalChecksByPrefix(checks, "grupo_olx_feed_validation")
	if len(got) != 1 || got[0].Code != "grupo_olx_import_warning_address" {
		t.Fatalf("remaining validation checks = %#v", got)
	}
}

func TestOptionalStringDistinguishesOmittedAndClearedValues(t *testing.T) {
	var omitted GrupoOLXSettingsRequest
	if err := json.Unmarshal([]byte(`{}`), &omitted); err != nil {
		t.Fatal(err)
	}
	if omitted.DefaultPipelineID.Set {
		t.Fatal("omitted field must remain unset")
	}

	var cleared GrupoOLXSettingsRequest
	if err := json.Unmarshal([]byte(`{"defaultPipelineId":null,"defaultStageId":""}`), &cleared); err != nil {
		t.Fatal(err)
	}
	if !cleared.DefaultPipelineID.Set || cleared.DefaultPipelineID.Value != nil {
		t.Fatal("explicit null must clear the pipeline")
	}
	if !cleared.DefaultStageID.Set || cleared.DefaultStageID.Value != nil {
		t.Fatal("empty string must clear the stage")
	}
}

func validFeedIntegration() publicIntegration {
	return publicIntegration{Settings: map[string]any{
		"contact_name":  "Imobiliaria Vimob",
		"contact_email": "portais@vimob.com.br",
	}}
}

func validFeedListing(status string) feedListing {
	return feedListing{
		ClientListingID: "RJ-100",
		PublicationType: "STANDARD",
		Property: map[string]any{
			"status":           status,
			"title":            "Apartamento completo",
			"descricao_site":   strings.Repeat("Apartamento amplo e bem localizado. ", 3),
			"tipo_de_negocio":  "venda",
			"tipo_de_imovel":   "apartamento",
			"preco":            450000,
			"area_util":        82,
			"quartos":          2,
			"banheiros":        1,
			"cidade":           "Macae",
			"uf":               "RJ",
			"bairro":           "Centro",
			"cep":              "27910-000",
			"imagem_principal": "https://cdn.vimob.com.br/rj-100.jpg",
		},
	}
}

func containsValidationError(errors []string, expected string) bool {
	for _, value := range errors {
		if value == expected {
			return true
		}
	}
	return false
}

func assertContains(t *testing.T, value string, expected string) {
	t.Helper()
	if !strings.Contains(value, expected) {
		t.Fatalf("expected XML to contain %q\n%s", expected, value)
	}
}
