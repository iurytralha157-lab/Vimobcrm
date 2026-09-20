package site

import (
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
)

func TestDomainVerificationRejectsInternalDestinations(t *testing.T) {
	for _, value := range []string{"127.0.0.1", "10.0.0.10", "169.254.169.254", "100.64.0.1", "::1"} {
		if isAllowedVerificationIP(net.ParseIP(value)) {
			t.Fatalf("verification must reject internal address %s", value)
		}
	}
}

func TestDomainVerificationAcceptsValidPublicDomain(t *testing.T) {
	for _, value := range []string{"imobiliaria.com.br", "www.exemplo.com", "xn--imobiliria-73a.com.br"} {
		if !isValidPublicDomain(value) {
			t.Fatalf("expected valid public domain: %s", value)
		}
	}
}

func TestDomainVerificationRejectsUnsafeHostnames(t *testing.T) {
	for _, value := range []string{"localhost", "https://example.com", "example.com:443", "-example.com", "127.0.0.1"} {
		if isValidPublicDomain(value) {
			t.Fatalf("expected invalid verification hostname: %s", value)
		}
	}
}

func TestSanitizeSitePayloadValidatesPublicAddress(t *testing.T) {
	payload, err := sanitizeSitePayload(map[string]any{
		"subdomain":     " Imobiliaria-Centro ",
		"custom_domain": " WWW.Exemplo.com.br ",
	})
	if err != nil {
		t.Fatalf("expected valid site address: %v", err)
	}
	if payload["subdomain"] != "imobiliaria-centro" || payload["custom_domain"] != "www.exemplo.com.br" {
		t.Fatalf("site address was not normalized: %#v", payload)
	}

	for _, input := range []map[string]any{
		{"subdomain": "ab"},
		{"subdomain": "-imobiliaria"},
		{"custom_domain": "https://exemplo.com"},
		{"custom_domain": "localhost"},
		{"custom_domain": "127.0.0.1"},
	} {
		if _, err := sanitizeSitePayload(input); err == nil {
			t.Fatalf("expected invalid site address to be rejected: %#v", input)
		}
	}
}

func TestEnrichTrackingLocationFromInfrastructureHeaders(t *testing.T) {
	request := PublicTrackingRequest{}
	header := http.Header{
		"X-Vercel-Ip-Latitude":       []string{"-23.5505"},
		"X-Vercel-Ip-Longitude":      []string{"-46.6333"},
		"X-Vercel-Ip-City":           []string{"S%C3%A3o+Paulo"},
		"X-Vercel-Ip-Country-Region": []string{"SP"},
		"X-Vercel-Ip-Country":        []string{"BR"},
	}

	enrichTrackingLocation(&request, header)

	if request.Metadata["city"] != "São Paulo" || request.Metadata["region"] != "SP" || request.Metadata["country"] != "BR" {
		t.Fatalf("unexpected location metadata: %#v", request.Metadata)
	}
	if request.Metadata["lat"] != -23.5505 || request.Metadata["lng"] != -46.6333 {
		t.Fatalf("unexpected coordinates: %#v", request.Metadata)
	}
	if !request.LocationEnriched {
		t.Fatal("infrastructure location must be marked as server-enriched")
	}
}

func TestEnrichTrackingLocationRejectsInvalidCoordinates(t *testing.T) {
	request := PublicTrackingRequest{Metadata: map[string]any{"timezone": "America/Sao_Paulo"}}
	header := http.Header{
		"X-Vercel-Ip-Latitude":  []string{"999"},
		"X-Vercel-Ip-Longitude": []string{"-46.6333"},
	}

	enrichTrackingLocation(&request, header)
	if _, exists := request.Metadata["lat"]; exists {
		t.Fatalf("invalid coordinate should not be stored: %#v", request.Metadata)
	}
}

func TestEnrichTrackingLocationKeepsCountryWithoutCoordinates(t *testing.T) {
	request := PublicTrackingRequest{}
	header := http.Header{"Cf-Ipcountry": []string{"BR"}}

	enrichTrackingLocation(&request, header)

	if request.Metadata["country"] != "BR" {
		t.Fatalf("country-only location should be stored: %#v", request.Metadata)
	}
	if _, exists := request.Metadata["lat"]; exists {
		t.Fatalf("missing coordinates should not be invented: %#v", request.Metadata)
	}
}

func TestEnrichTrackingLocationInfersCountryFromBrowserMetadata(t *testing.T) {
	request := PublicTrackingRequest{Metadata: map[string]any{
		"timezone": "America/Sao_Paulo",
		"locale":   "pt-BR",
	}}

	enrichTrackingLocation(&request, http.Header{})

	if request.Metadata["country"] != "BR" {
		t.Fatalf("browser metadata should provide a country fallback: %#v", request.Metadata)
	}
}

func TestPublicTrackingCannotForgeAuthoritativeFormConversion(t *testing.T) {
	t.Parallel()

	if isAllowedPublicTrackingEvent("form_submit") {
		t.Fatal("public tracking must not accept form_submit; CreatePublicContact records the authoritative conversion")
	}
	for _, eventType := range []string{"pageview", "session_start", "property_search", "whatsapp_click", "cta_click"} {
		if !isAllowedPublicTrackingEvent(eventType) {
			t.Fatalf("expected public tracking event %q to remain allowed", eventType)
		}
	}
}

func TestPublicPropertyJSONGatesExactLocationByVisibility(t *testing.T) {
	query := publicPropertyJSONSQL()

	for _, field := range []string{
		"'quadra'",
		"'lote'",
		"'condominio_nome'",
		"'metadata'",
		"'valor_venda_avaliado'",
		"'valor_locacao_avaliado'",
	} {
		if strings.Contains(query, field) {
			t.Fatalf("public property payload exposes exact location field %s", field)
		}
	}

	for _, field := range []string{"'public_address_visibility'", "'bairro'", "'cidade'", "'estado'"} {
		if !strings.Contains(query, field) {
			t.Fatalf("public property payload should preserve approximate location field %s", field)
		}
	}
	visibility := publicAddressVisibilitySQL("p")
	for _, field := range []string{"endereco", "numero", "complemento", "cep", "latitude", "longitude"} {
		expected := "'" + field + "', case when " + visibility + " = 'completo'"
		if !strings.Contains(query, expected) {
			t.Fatalf("exact field %q is not gated by complete visibility", field)
		}
	}
	if !strings.Contains(query, "'bairro', case when "+visibility+" = 'minimo' then null") {
		t.Fatal("minimum visibility can leak neighborhood")
	}
}

func TestPublicPropertyOutputRedactsLegacySnapshotAppraisals(t *testing.T) {
	legacySnapshot := map[string]any{
		"titulo":                    "Imovel publico",
		"public_address_visibility": "parcial",
		"condominio_nome":           "Residencial Privado",
		"valor_venda_avaliado":      780000,
		"valor_locacao_avaliado":    4200,
	}
	redactPublicPropertyInternalValues(legacySnapshot)

	for _, field := range []string{"valor_venda_avaliado", "valor_locacao_avaliado", "condominio_nome"} {
		if _, exists := legacySnapshot[field]; exists {
			t.Fatalf("legacy public snapshot retained internal appraisal field %q: %#v", field, legacySnapshot)
		}
		if field != "condominio_nome" && !strings.Contains(publicPropertyOutputSQL(), "- '"+field+"'") {
			t.Fatalf("public snapshot SQL does not redact historical field %q: %s", field, publicPropertyOutputSQL())
		}
	}
	if !strings.Contains(publicPropertyOutputSQL(), "else publication_snapshot.payload") ||
		!strings.Contains(publicPropertyOutputSQL(), "- 'condominio_nome'") {
		t.Fatalf("public snapshot SQL does not fail closed for condominium privacy: %s", publicPropertyOutputSQL())
	}
	if legacySnapshot["titulo"] != "Imovel publico" {
		t.Fatalf("public redaction changed a safe field: %#v", legacySnapshot)
	}
}

func TestPublicSnapshotCondominiumRequiresCanonicalCompleteVisibility(t *testing.T) {
	for _, visibility := range []any{nil, "", "parcial", "minimo", "full", "COMPLETE"} {
		property := map[string]any{
			"public_address_visibility": visibility,
			"condominio_nome":           "Residencial Privado",
		}
		redactPublicPropertyInternalValues(property)
		if _, exists := property["condominio_nome"]; exists {
			t.Fatalf("visibility %#v retained condominium name", visibility)
		}
	}

	property := map[string]any{
		"public_address_visibility": " Completo ",
		"condominio_nome":           "Residencial Público",
	}
	redactPublicPropertyInternalValues(property)
	if property["condominio_nome"] != "Residencial Público" {
		t.Fatalf("canonical complete visibility lost condominium name: %#v", property)
	}

	condominiumSQL := publicPropertyTextSQL("condominio_nome", "p.condominio_nome")
	if !strings.Contains(condominiumSQL, publicSnapshotHasCompleteAddressSQL()) ||
		strings.Contains(condominiumSQL, "p.condominio_nome") {
		t.Fatalf("condominium projection is not frozen and fail-closed: %s", condominiumSQL)
	}
}

func TestPublicPropertySearchCannotProbeExactLocation(t *testing.T) {
	args := []any{"organization-id"}
	clauses := strings.Join(publicPropertyWhereClauses(url.Values{
		"search":     []string{"local secreto"},
		"condominio": []string{"condominio secreto"},
	}, "", &args), " ")

	for _, fragment := range []string{"p.endereco", "p.condominium_id", "property_condominiums"} {
		if strings.Contains(clauses, fragment) {
			t.Fatalf("public property search can probe exact location through %s", fragment)
		}
	}
	if !strings.Contains(clauses, "publication_snapshot.payload->>'condominio_nome'") || !strings.Contains(clauses, "else null::text") {
		t.Fatalf("condominium filter must use only the frozen publication value: %s", clauses)
	}
	if args[len(args)-1] != "condominio secreto" {
		t.Fatalf("condominium filter argument = %#v", args[len(args)-1])
	}
}

func TestPublicCondominiumOptionsNeverJoinTheLiveCatalog(t *testing.T) {
	raw, err := os.ReadFile("repository_public_properties.go")
	if err != nil {
		t.Fatalf("read repository: %v", err)
	}
	repository := string(raw)
	start := strings.Index(repository, "func (repo Repository) listPublicCondominiums(")
	if start < 0 {
		t.Fatal("could not find listPublicCondominiums")
	}
	end := strings.Index(repository[start:], "func (repo Repository) listPublicPropertyPurposes(")
	if end < 0 {
		t.Fatal("could not isolate listPublicCondominiums")
	}
	listCondominiums := repository[start : start+end]
	if strings.Contains(listCondominiums, "property_condominiums") || strings.Contains(listCondominiums, "p.condominium_id") {
		t.Fatal("public condominium options must not derive from the live property catalog")
	}
	if !strings.Contains(listCondominiums, `publicPropertyTextSQL("condominio_nome", "null::text")`) {
		t.Fatal("public condominium options must derive from the frozen publication snapshot")
	}

	filterOptionsStart := strings.Index(repository, "func (repo Repository) listPublicPropertyFilterOptions(")
	if filterOptionsStart < 0 {
		t.Fatal("could not find listPublicPropertyFilterOptions")
	}
	filterOptions := repository[filterOptionsStart:]
	if strings.Contains(filterOptions, "property_condominiums") || strings.Contains(filterOptions, "p.condominium_id") {
		t.Fatal("combined public filter options must not derive from the live property catalog")
	}
	if !strings.Contains(filterOptions, `publicPropertyTextSQL("condominio_nome", "null::text")`) ||
		!strings.Contains(filterOptions, "p.public_condominio") {
		t.Fatal("combined public filter options must derive from the frozen publication snapshot")
	}
}

func TestPublicContactReentryKeepsTheLeadLockAtTheTransactionTail(t *testing.T) {
	raw, err := os.ReadFile("repository_public_contact.go")
	if err != nil {
		t.Fatalf("read repository: %v", err)
	}
	repository := string(raw)
	start := strings.Index(repository, "func (repo Repository) CreatePublicContact(")
	if start < 0 {
		t.Fatal("could not find CreatePublicContact")
	}
	end := strings.Index(repository[start:], "func phoneDigits(")
	if end < 0 {
		t.Fatal("could not isolate CreatePublicContact")
	}
	createContact := repository[start : start+end]

	for _, forbidden := range []string{"pg_advisory_xact_lock", "limit 1 for update"} {
		if strings.Contains(strings.ToLower(createContact), forbidden) {
			t.Fatalf("public contact still serializes the full transaction through %q", forbidden)
		}
	}
	for _, required := range []string{
		"on conflict do nothing",
		"tag.RowsAffected() != 1",
		"publicingress.Allow(",
		"distribution.ResolveIntakeDestination(",
		"distribution.Distribute(",
		"RoundRobinID:       intakeDestination.RoundRobinID",
		"RoundRobinResolved: intakeDestination.Resolved",
		"distribution.PreserveAssigneeForIntake(reentry, intakeDestination)",
		"to_regclass('public.leads_org_phone_unique')",
		"($4::boolean or intake_scope_key=$3)",
		"origin_round_robin_id",
	} {
		if !strings.Contains(createContact, required) {
			t.Fatalf("public contact is missing concurrency contract %q", required)
		}
	}
	if count := strings.Count(createContact, "and btrim(phone) <> ''"); count != 2 {
		t.Fatalf("normalized-phone lookups matching the partial unique index = %d, want 2", count)
	}
	if count := strings.Count(createContact, "($4::boolean or intake_scope_key=$3)"); count != 2 {
		t.Fatalf("rollout-aware lead identity lookups = %d, want 2", count)
	}

	analyticsWrite := strings.Index(createContact, "insert into public.site_analytics_events")
	rateLimit := strings.Index(createContact, "publicingress.Allow(")
	routingResolution := strings.Index(createContact, "distribution.ResolveIntakeDestination(")
	legacyProbe := strings.Index(createContact, "to_regclass('public.leads_org_phone_unique')")
	identityLock := strings.Index(createContact, "lockPublicContactLeadIntakeIdentity(")
	phoneLookup := strings.Index(createContact, "select id::text from public.leads")
	reentryUpdate := strings.LastIndex(createContact, "update public.leads set")
	distributionCall := strings.Index(createContact, "distribution.Distribute(")
	idempotentReturn := strings.Index(createContact, `"idempotent": true`)
	if analyticsWrite < 0 || rateLimit < 0 || routingResolution < 0 || legacyProbe < 0 || identityLock < 0 || phoneLookup < 0 || reentryUpdate < 0 || distributionCall < 0 || idempotentReturn < 0 {
		t.Fatal("could not locate public contact transaction phases")
	}
	if idempotentReturn >= rateLimit {
		t.Fatal("idempotent retries must return before consuming a public ingress budget")
	}
	if !(analyticsWrite < reentryUpdate && reentryUpdate < distributionCall) {
		t.Fatalf(
			"lead lock order is unsafe: analytics=%d reentry_update=%d distribution=%d",
			analyticsWrite,
			reentryUpdate,
			distributionCall,
		)
	}
	if !(routingResolution < legacyProbe && legacyProbe < identityLock && identityLock < phoneLookup) {
		t.Fatalf(
			"queue identity was not frozen before phone identity: routing=%d legacy=%d lock=%d lookup=%d",
			routingResolution,
			legacyProbe,
			identityLock,
			phoneLookup,
		)
	}
}

func TestPublicPropertyEligibilityMakesCanonicalStateAuthoritative(t *testing.T) {
	eligibility := publicPropertyEligibilitySQL()
	for _, required := range []string{
		"publication_snapshot.payload is not null",
		"coalesce(p.published_on_site, false) = true",
		"not exists",
		"publication_state.channel = 'site'",
	} {
		if !strings.Contains(strings.ToLower(eligibility), strings.ToLower(required)) {
			t.Fatalf("eligibility is missing %q: %s", required, eligibility)
		}
	}
	if !strings.Contains(publicPropertySnapshotJoinSQL(), "version.payload->'property'") {
		t.Fatal("public property projection does not read the immutable version payload")
	}
	if output := publicPropertyOutputSQL(); !strings.Contains(output, "when publication_snapshot.payload is not null then") ||
		!strings.Contains(output, "publication_snapshot.payload - 'valor_venda_avaliado' - 'valor_locacao_avaliado'") ||
		!strings.Contains(output, "else "+publicPropertyJSONSQL()) {
		t.Fatalf("public output does not prefer and sanitize the central snapshot: %s", output)
	}
}

func TestPublicPropertyCodeLookupUsesVersionedSnapshot(t *testing.T) {
	raw, err := os.ReadFile("repository_public_properties.go")
	if err != nil {
		t.Fatalf("read repository: %v", err)
	}
	repository := string(raw)
	start := strings.Index(repository, "func (repo Repository) getPublicProperty(")
	if start < 0 {
		t.Fatal("could not find getPublicProperty")
	}
	end := strings.Index(repository[start:], "func (repo Repository) listPublicPropertyTypes(")
	if end < 0 {
		t.Fatal("could not isolate getPublicProperty")
	}
	getProperty := repository[start : start+end]
	for _, required := range []string{
		"publicPropertyOutputSQL()",
		"publicPropertySnapshotJoinSQL()",
		"publicPropertyTextSQL(\"codigo\", \"p.code\")",
	} {
		if !strings.Contains(getProperty, required) {
			t.Fatalf("snapshot property lookup is missing %q", required)
		}
	}
}
