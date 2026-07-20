package portals

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
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
	assertContains(t, xmlBody, `<ListPrice currency="BRL">150000</ListPrice>`)
	assertContains(t, xmlBody, `<RentalPrice currency="BRL" period="Monthly">1500</RentalPrice>`)
	assertContains(t, xmlBody, `<Iptu currency="BRL" period="Monthly">120</Iptu>`)
	assertContains(t, xmlBody, `<LivingArea unit="square metres">82</LivingArea>`)
	assertContains(t, xmlBody, `<Item medium="image" caption="img1" primary="true">https://cdn.vimob.com.br/rj-100.jpg</Item>`)
	assertContains(t, xmlBody, `<VirtualTourLink>https://tour.vimob.com.br/rj-100</VirtualTourLink>`)
	if strings.Contains(xmlBody, "<DisplayAddress>") {
		t.Fatal("displayAddress must be an attribute, not an element")
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

func TestWebhookSecretDigestAndAuthorization(t *testing.T) {
	secret := "594F803B380A41396ED63DCA39503542"
	digest := webhookSecretDigest(secret)
	header := "Basic " + base64.StdEncoding.EncodeToString([]byte("vivareal:"+secret))
	if !validWebhookAuthorization(header, digest) {
		t.Fatal("valid Grupo OLX basic authorization should be accepted")
	}
	if validWebhookAuthorization(header, webhookSecretDigest("wrong")) {
		t.Fatal("invalid secret should be rejected")
	}
	if validWebhookAuthorization("", "") {
		t.Fatal("an unconfigured secret must not authorize a webhook")
	}
}

func TestReportListingIssuesMapsExternalIDs(t *testing.T) {
	issues := reportListingIssues([]any{
		map[string]any{
			"errorMessage": "CEP invalido",
			"externalIds":  []any{"RJ-100", "RJ-101"},
		},
		map[string]any{
			"message":     "Imagem pequena",
			"externalIds": []any{"RJ-100"},
		},
	}, "errorMessage")

	if len(issues["RJ-100"]) != 2 || len(issues["RJ-101"]) != 1 {
		t.Fatalf("unexpected report issues: %#v", issues)
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

func assertContains(t *testing.T, value string, expected string) {
	t.Helper()
	if !strings.Contains(value, expected) {
		t.Fatalf("expected XML to contain %q\n%s", expected, value)
	}
}
