package portals

import (
	"strings"
	"testing"
)

func validChavesNaMaoFeedListing() feedListing {
	return feedListing{
		PublicationID:   "10000000-0000-0000-0000-000000000001",
		PropertyID:      "20000000-0000-0000-0000-000000000001",
		Source:          "legacy",
		ClientListingID: "AP-01",
		PublicationType: "FEATURED",
		Property: map[string]any{
			"code":                      "AP01",
			"title":                     "Apartamento com varanda",
			"descricao_site":            "Descrição pública do imóvel.",
			"status_descritivo":         "AN: informação interna",
			"tipo_de_negocio":           "Venda e Locação",
			"finalidade":                "Residencial",
			"tipo_de_imovel":            "Apartamento",
			"status":                    "ativo",
			"preco":                     210000.0,
			"valor_locacao":             1800.0,
			"condominio":                560.0,
			"iptu":                      120.0,
			"area_total":                70.0,
			"area_util":                 52.0,
			"quartos":                   2.0,
			"suites":                    1.0,
			"banheiros":                 2.0,
			"vagas":                     1.0,
			"regra_pet":                 true,
			"aceita_permuta":            true,
			"uf":                        "PR",
			"cidade":                    "Curitiba",
			"bairro":                    "Novo Mundo",
			"cep":                       "81000-000",
			"endereco":                  "Rua Exemplo",
			"numero":                    "250",
			"complemento":               "apto 12",
			"public_address_visibility": "parcial",
			"imagem_principal":          "https://cdn.example.com/ap01.webp",
			"video_imovel":              "https://www.youtube.com/watch?v=abc123",
			"tour_virtual":              "https://tour.example.com/ap01",
			"updated_at":                "2026-09-08T10:20:30-03:00",
		},
	}
}

func TestBuildChavesNaMaoFeedUsesOfficialShapeAndDoesNotLeakInternalDescription(t *testing.T) {
	integration := publicIntegration{Settings: map[string]any{
		"detail_base_url": "https://imobiliaria.example.com/imoveis",
	}}
	body, err := buildChavesNaMaoFeed(integration, []feedListing{validChavesNaMaoFeedListing()})
	if err != nil {
		t.Fatalf("buildChavesNaMaoFeed returned error: %v", err)
	}
	xmlText := string(body)
	for _, expected := range []string{
		`<?xml version="1.0" encoding="UTF-8"?>`,
		"<Document>", "<imoveis>", "<imovel>",
		"<referencia>AP-01</referencia>",
		"<transacao>V</transacao>", "<transacao2>L</transacao2>",
		"<finalidade>RE</finalidade>", "<tipo>Apartamento</tipo>",
		"<destaque>1</destaque>", "<valor>210000</valor>",
		"<valor_locacao>1800</valor_locacao>",
		"<aceita_pet>1</aceita_pet>", "<aceita_troca>1</aceita_troca>",
		"<esconder_endereco_imovel>1</esconder_endereco_imovel>",
		"<endereco></endereco>", "<numero></numero>",
		"<descritivo><![CDATA[Descrição pública do imóvel.]]></descritivo>",
		"<url>https://cdn.example.com/ap01.webp</url>",
		"<data_atualizacao>2026-09-08 13:20:30</data_atualizacao>",
		"<area_comum></area_comum>", "<area_privativa></area_privativa>",
	} {
		if !strings.Contains(xmlText, expected) {
			t.Fatalf("expected XML to contain %q; got:\n%s", expected, xmlText)
		}
	}
	if strings.Contains(xmlText, "informação interna") || strings.Contains(xmlText, "status_descritivo") {
		t.Fatalf("feed leaked internal descriptive status: %s", xmlText)
	}

	orderedTags := []string{
		"<referencia>", "<codigo_cliente>", "<link_cliente>", "<titulo>",
		"<transacao>", "<transacao2>", "<finalidade>", "<finalidade2>",
		"<destaque>", "<tipo>", "<tipo2>", "<valor>", "<valor_locacao>",
		"<valor_iptu>", "<valor_condominio>", "<area_total>", "<area_util>",
		"<conservacao>", "<quartos>", "<suites>", "<garagem>", "<banheiro>",
		"<closet>", "<salas>", "<despensa>", "<bar>", "<cozinha>",
		"<quarto_empregada>", "<escritorio>", "<area_servico>", "<lareira>",
		"<varanda>", "<lavanderia>", "<aceita_pet>", "<estado>", "<cidade>",
		"<bairro>", "<cep>", "<endereco>", "<numero>", "<complemento>",
		"<esconder_endereco_imovel>", "<descritivo>", "<fotos_imovel>",
		"<data_atualizacao>", "<latitude>", "<longitude>", "<video>", "<tour_360>",
		"<area_comum>", "<area_privativa>", "<aceita_troca>", "<periodo_locacao>",
	}
	lastIndex := -1
	for _, tag := range orderedTags {
		index := strings.Index(xmlText, tag)
		if index < 0 {
			t.Fatalf("required official tag %s is missing", tag)
		}
		if index <= lastIndex {
			t.Fatalf("tag %s is out of official order", tag)
		}
		lastIndex = index
	}
}

func TestValidateChavesNaMaoListingRejectsUnsupportedTaxonomyAndImages(t *testing.T) {
	listing := validChavesNaMaoFeedListing()
	listing.Property["tipo_de_imovel"] = "Castelo"
	listing.Property["imagem_principal"] = "https://cdn.example.com/ap01.png"
	errors := validateChavesNaMaoListing(publicIntegration{}, listing)
	joined := strings.Join(errors, " ")
	if !strings.Contains(joined, "taxonomia publica") {
		t.Fatalf("expected taxonomy validation error, got %v", errors)
	}
	if !strings.Contains(joined, "JPG, JPEG ou WEBP") {
		t.Fatalf("expected image extension validation error, got %v", errors)
	}
}

func TestChavesNaMaoPurposeAndTypeUsesExactPublishedValues(t *testing.T) {
	tests := []struct {
		purpose string
		kind    string
		wantP   string
		wantT   string
	}{
		{"Residencial", "Casa em condomínio", "RE", "Casa / Sobrado em Condomínio"},
		{"Residencial", "Studio", "RE", "Kitnet / Stúdio"},
		{"Comercial", "Sala comercial", "CO", "Conj. Comercial / Sala"},
		{"Comercial", "Galpão", "CO", "Galpão / Depósito"},
		{"Comercial", "Terreno", "CO", "Terreno comercial"},
		{"Rural", "Fazenda", "RU", "Fazenda"},
	}
	for _, test := range tests {
		gotPurpose, gotType := chavesNaMaoPurposeAndType(test.purpose, test.kind)
		if gotPurpose != test.wantP || gotType != test.wantT {
			t.Fatalf("%s/%s: got %s/%s, want %s/%s", test.purpose, test.kind, gotPurpose, gotType, test.wantP, test.wantT)
		}
	}
}

func TestEnsureChavesNaMaoFeedLimitFailsClosed(t *testing.T) {
	if err := ensureChavesNaMaoFeedLimit(maxChavesNaMaoListings); err != nil {
		t.Fatalf("limit should accept exact maximum: %v", err)
	}
	if err := ensureChavesNaMaoFeedLimit(maxChavesNaMaoListings + 1); !errorsIs(err, ErrChavesNaMaoListingLimit) {
		t.Fatalf("limit should fail closed with typed error, got %v", err)
	}
}

func errorsIs(err error, target error) bool {
	for err != nil {
		if err == target {
			return true
		}
		type unwrapper interface{ Unwrap() error }
		wrapped, ok := err.(unwrapper)
		if !ok {
			return false
		}
		err = wrapped.Unwrap()
	}
	return false
}
