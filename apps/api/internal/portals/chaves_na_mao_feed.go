package portals

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"
)

// These structures intentionally do not use omitempty. The public Chaves na
// Mao specification requires every tag to be present and case-sensitive, even
// when an optional value is empty.
type chavesNaMaoFeed struct {
	XMLName xml.Name            `xml:"Document"`
	Imoveis chavesNaMaoListings `xml:"imoveis"`
}

type chavesNaMaoListings struct {
	Imoveis []chavesNaMaoListing `xml:"imovel"`
}

type chavesNaMaoListing struct {
	Referencia             string            `xml:"referencia"`
	CodigoCliente          string            `xml:"codigo_cliente"`
	LinkCliente            string            `xml:"link_cliente"`
	Titulo                 string            `xml:"titulo"`
	Transacao              string            `xml:"transacao"`
	Transacao2             string            `xml:"transacao2"`
	Finalidade             string            `xml:"finalidade"`
	Finalidade2            string            `xml:"finalidade2"`
	Destaque               string            `xml:"destaque"`
	Tipo                   string            `xml:"tipo"`
	Tipo2                  string            `xml:"tipo2"`
	Valor                  string            `xml:"valor"`
	ValorLocacao           string            `xml:"valor_locacao"`
	ValorIPTU              string            `xml:"valor_iptu"`
	ValorCondominio        string            `xml:"valor_condominio"`
	AreaTotal              string            `xml:"area_total"`
	AreaUtil               string            `xml:"area_util"`
	Conservacao            string            `xml:"conservacao"`
	Quartos                string            `xml:"quartos"`
	Suites                 string            `xml:"suites"`
	Garagem                string            `xml:"garagem"`
	Banheiro               string            `xml:"banheiro"`
	Closet                 string            `xml:"closet"`
	Salas                  string            `xml:"salas"`
	Despensa               string            `xml:"despensa"`
	Bar                    string            `xml:"bar"`
	Cozinha                string            `xml:"cozinha"`
	QuartoEmpregada        string            `xml:"quarto_empregada"`
	Escritorio             string            `xml:"escritorio"`
	AreaServico            string            `xml:"area_servico"`
	Lareira                string            `xml:"lareira"`
	Varanda                string            `xml:"varanda"`
	Lavanderia             string            `xml:"lavanderia"`
	AceitaPet              string            `xml:"aceita_pet"`
	Estado                 string            `xml:"estado"`
	Cidade                 string            `xml:"cidade"`
	Bairro                 string            `xml:"bairro"`
	CEP                    string            `xml:"cep"`
	Endereco               string            `xml:"endereco"`
	Numero                 string            `xml:"numero"`
	Complemento            string            `xml:"complemento"`
	EsconderEnderecoImovel string            `xml:"esconder_endereco_imovel"`
	Descritivo             chavesNaMaoCDATA  `xml:"descritivo"`
	FotosImovel            chavesNaMaoPhotos `xml:"fotos_imovel"`
	DataAtualizacao        string            `xml:"data_atualizacao"`
	Latitude               string            `xml:"latitude"`
	Longitude              string            `xml:"longitude"`
	Video                  string            `xml:"video"`
	Tour360                string            `xml:"tour_360"`
	AreaComum              chavesNaMaoItems  `xml:"area_comum"`
	AreaPrivativa          chavesNaMaoItems  `xml:"area_privativa"`
	AceitaTroca            string            `xml:"aceita_troca"`
	PeriodoLocacao         string            `xml:"periodo_locacao"`
}

type chavesNaMaoPhotos struct {
	Fotos []chavesNaMaoPhoto `xml:"foto"`
}

type chavesNaMaoPhoto struct {
	URL             string `xml:"url"`
	DataAtualizacao string `xml:"data_atualizacao"`
}

type chavesNaMaoItems struct {
	Items []string `xml:"item"`
}

type chavesNaMaoCDATA struct {
	Value string `xml:",cdata"`
}

func buildChavesNaMaoFeed(integration publicIntegration, items []feedListing) ([]byte, error) {
	feed := chavesNaMaoFeed{Imoveis: chavesNaMaoListings{Imoveis: []chavesNaMaoListing{}}}
	for _, item := range items {
		feed.Imoveis.Imoveis = append(feed.Imoveis.Imoveis, mapToChavesNaMaoListing(integration, item))
	}

	var buffer bytes.Buffer
	buffer.WriteString(xml.Header)
	encoder := xml.NewEncoder(&buffer)
	encoder.Indent("", "  ")
	if err := encoder.Encode(feed); err != nil {
		return nil, err
	}
	if err := encoder.Flush(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func mapToChavesNaMaoListing(integration publicIntegration, item feedListing) chavesNaMaoListing {
	property := item.Property
	transaction := normalizeTransactionType(firstPropertyText(property, "tipo_de_negocio"))
	primaryTransaction, secondaryTransaction := chavesNaMaoTransactions(transaction)
	purpose, propertyType := chavesNaMaoPurposeAndType(
		firstPropertyText(property, "finalidade", "finalidade_uso"),
		firstPropertyText(property, "tipo_de_imovel", "tipo", "tipo_imovel"),
	)
	updatedAt := chavesNaMaoDate(firstPropertyText(property, "updated_at", "created_at"))
	images := chavesNaMaoImages(property)
	photos := make([]chavesNaMaoPhoto, 0, len(images))
	for _, imageURL := range images {
		photos = append(photos, chavesNaMaoPhoto{URL: imageURL, DataAtualizacao: updatedAt})
	}

	detailURL := ""
	if baseURL := textFromSettings(integration.Settings, "detail_base_url"); baseURL != "" {
		identifier := firstPropertyText(property, "code", "codigo")
		if identifier == "" {
			identifier = item.ClientListingID
		}
		detailURL = strings.TrimRight(baseURL, "/") + "/" + url.PathEscape(identifier)
	}

	visibility := normalizeText(firstPropertyText(property, "public_address_visibility", "address_visibility"))
	hideAddress := visibility != "completo" && visibility != "complete" && visibility != "all"
	address := trimMax(firstPropertyText(property, "endereco"), 200)
	number := trimMax(firstPropertyText(property, "numero"), 10)
	complement := trimMax(firstPropertyText(property, "complemento"), 20)
	postalCode := trimMax(firstPropertyText(property, "cep"), 9)
	latitude := chavesNaMaoDecimal(firstPropertyNumber(property, "latitude"))
	longitude := chavesNaMaoDecimal(firstPropertyNumber(property, "longitude"))
	if hideAddress {
		address, number, complement, latitude, longitude = "", "", "", "", ""
		if minimumFeedAddressVisibility(visibility) {
			postalCode = ""
		}
	}

	salePrice := priceForSale(property, transaction)
	rentPrice := priceForRent(property, transaction)
	value := ""
	valueRent := ""
	if primaryTransaction == "V" && salePrice != nil {
		value = chavesNaMaoDecimal(*salePrice)
		if secondaryTransaction == "L" && rentPrice != nil {
			valueRent = chavesNaMaoDecimal(*rentPrice)
		}
	} else if primaryTransaction == "L" && rentPrice != nil {
		value = chavesNaMaoDecimal(*rentPrice)
	}

	video := firstPropertyText(property, "video_imovel")
	if !isYouTubeURL(video) {
		video = ""
	}
	tour := firstPropertyText(property, "tour_virtual")
	if !isHTTPSURL(tour) {
		tour = ""
	}

	return chavesNaMaoListing{
		Referencia:             item.ClientListingID,
		CodigoCliente:          trimMax(firstPropertyText(property, "code", "codigo"), 50),
		LinkCliente:            detailURL,
		Titulo:                 trimMax(firstPropertyText(property, "title", "titulo"), 200),
		Transacao:              primaryTransaction,
		Transacao2:             secondaryTransaction,
		Finalidade:             purpose,
		Finalidade2:            "",
		Destaque:               chavesNaMaoFeatured(property, item.PublicationType),
		Tipo:                   propertyType,
		Tipo2:                  "",
		Valor:                  value,
		ValorLocacao:           valueRent,
		ValorIPTU:              chavesNaMaoDecimal(firstPropertyNumber(property, "iptu", "valor_itr")),
		ValorCondominio:        chavesNaMaoDecimal(firstPropertyNumber(property, "condominio", "valor_condominio")),
		AreaTotal:              chavesNaMaoDecimal(firstPropertyNumber(property, "area_total")),
		AreaUtil:               chavesNaMaoDecimal(firstPropertyNumber(property, "area_util", "area_construida")),
		Conservacao:            trimMax(metadataText(property, "conservacao"), 100),
		Quartos:                chavesNaMaoInteger(property, "quartos"),
		Suites:                 chavesNaMaoInteger(property, "suites"),
		Garagem:                chavesNaMaoInteger(property, "vagas", "garagem"),
		Banheiro:               chavesNaMaoInteger(property, "banheiros", "banheiro"),
		Closet:                 chavesNaMaoInteger(property, "closet"),
		Salas:                  chavesNaMaoInteger(property, "salas"),
		Despensa:               chavesNaMaoInteger(property, "despensa"),
		Bar:                    chavesNaMaoInteger(property, "bar"),
		Cozinha:                chavesNaMaoInteger(property, "cozinha"),
		QuartoEmpregada:        chavesNaMaoInteger(property, "quarto_empregada"),
		Escritorio:             chavesNaMaoInteger(property, "escritorio"),
		AreaServico:            chavesNaMaoInteger(property, "area_servico"),
		Lareira:                chavesNaMaoInteger(property, "lareira"),
		Varanda:                chavesNaMaoInteger(property, "varanda"),
		Lavanderia:             chavesNaMaoInteger(property, "lavanderia"),
		AceitaPet:              chavesNaMaoBoolean(property, "regra_pet", "aceita_pet"),
		Estado:                 strings.ToUpper(trimMax(firstPropertyText(property, "uf", "estado"), 2)),
		Cidade:                 firstPropertyText(property, "cidade"),
		Bairro:                 firstPropertyText(property, "bairro"),
		CEP:                    postalCode,
		Endereco:               address,
		Numero:                 number,
		Complemento:            complement,
		EsconderEnderecoImovel: map[bool]string{true: "1", false: "0"}[hideAddress],
		Descritivo:             chavesNaMaoCDATA{Value: trimMax(firstPropertyText(property, "descricao_site", "descricao"), 3000)},
		FotosImovel:            chavesNaMaoPhotos{Fotos: photos},
		DataAtualizacao:        updatedAt,
		Latitude:               latitude,
		Longitude:              longitude,
		Video:                  video,
		Tour360:                tour,
		AreaComum:              chavesNaMaoItems{Items: chavesNaMaoMetadataItems(property, "area_comum")},
		AreaPrivativa:          chavesNaMaoItems{Items: chavesNaMaoMetadataItems(property, "area_privativa")},
		AceitaTroca:            chavesNaMaoBoolean(property, "aceita_permuta", "aceita_troca"),
		PeriodoLocacao:         chavesNaMaoRentalPeriod(property, transaction),
	}
}

func validateChavesNaMaoListing(integration publicIntegration, item feedListing) []string {
	property := item.Property
	errors := []string{}
	reference := strings.TrimSpace(item.ClientListingID)
	if len([]rune(reference)) < 1 || len([]rune(reference)) > 50 {
		errors = append(errors, "Referencia precisa ter entre 1 e 50 caracteres.")
	}
	transaction := normalizeTransactionType(firstPropertyText(property, "tipo_de_negocio"))
	primary, secondary := chavesNaMaoTransactions(transaction)
	if primary == "" {
		errors = append(errors, "Tipo de negocio precisa ser venda ou locacao.")
	}
	purpose, propertyType := chavesNaMaoPurposeAndType(
		firstPropertyText(property, "finalidade", "finalidade_uso"),
		firstPropertyText(property, "tipo_de_imovel", "tipo", "tipo_imovel"),
	)
	if purpose == "" {
		errors = append(errors, "Finalidade do imovel precisa ser residencial, comercial ou rural.")
	}
	if propertyType == "" {
		errors = append(errors, "Tipo de imovel nao pertence a taxonomia publica do Chaves na Mao.")
	}
	if isUnavailablePortalPropertyStatus(firstPropertyText(property, "status")) {
		errors = append(errors, "Imovel nao esta ativo para publicacao.")
	}
	if state := strings.ToUpper(strings.TrimSpace(firstPropertyText(property, "uf", "estado"))); len(state) != 2 || brazilianStateName(state) == state {
		errors = append(errors, "UF brasileira valida e obrigatoria.")
	}
	if firstPropertyText(property, "cidade") == "" || firstPropertyText(property, "bairro") == "" {
		errors = append(errors, "Cidade e bairro sao obrigatorios.")
	}
	description := strings.TrimSpace(firstPropertyText(property, "descricao_site", "descricao"))
	if len([]rune(description)) < 1 || len([]rune(description)) > 3000 {
		errors = append(errors, "Descricao precisa ter entre 1 e 3000 caracteres.")
	}
	if primary == "V" && priceForSale(property, transaction) == nil {
		errors = append(errors, "Valor de venda e obrigatorio.")
	}
	if primary == "L" && priceForRent(property, transaction) == nil {
		errors = append(errors, "Valor de locacao e obrigatorio.")
	}
	if secondary == "L" && priceForRent(property, transaction) == nil {
		errors = append(errors, "Valor de locacao e obrigatorio quando ha duas transacoes.")
	}
	if !validChavesNaMaoPublicationType(item.PublicationType) {
		errors = append(errors, "Destaque do Chaves na Mao precisa ser STANDARD ou FEATURED.")
	}
	for _, imageURL := range propertyImages(property) {
		if !validChavesNaMaoImageURL(imageURL) {
			errors = append(errors, "Fotos precisam usar URL publica HTTP(S) com extensao JPG, JPEG ou WEBP.")
			break
		}
	}
	if baseURL := textFromSettings(integration.Settings, "detail_base_url"); baseURL != "" && !isHTTPSURL(baseURL) {
		errors = append(errors, "URL base do site precisa usar HTTPS.")
	}
	return errors
}

func chavesNaMaoTransactions(transaction string) (string, string) {
	switch transaction {
	case "For Sale":
		return "V", ""
	case "For Rent":
		return "L", ""
	case "Sale/Rent":
		return "V", "L"
	default:
		return "", ""
	}
}

func chavesNaMaoPurposeAndType(purposeValue string, typeValue string) (string, string) {
	purposeNormalized := normalizeText(purposeValue)
	typeNormalized := normalizeText(typeValue)
	purpose := "RE"
	switch {
	case strings.Contains(purposeNormalized, "rural"):
		purpose = "RU"
	case strings.Contains(purposeNormalized, "comercial"):
		purpose = "CO"
	case purposeNormalized != "" && !strings.Contains(purposeNormalized, "resid"):
		return "", ""
	case strings.Contains(typeNormalized, "comercial"), strings.Contains(typeNormalized, "loja"),
		strings.Contains(typeNormalized, "galpao"), strings.Contains(typeNormalized, "deposito"),
		strings.Contains(typeNormalized, "sala"), strings.Contains(typeNormalized, "conjunto"),
		strings.Contains(typeNormalized, "predio"), strings.Contains(typeNormalized, "edificio"),
		strings.Contains(typeNormalized, "garagem"), strings.Contains(typeNormalized, "fazenda"):
		purpose = "CO"
	}

	if purpose == "CO" {
		switch {
		case strings.Contains(typeNormalized, "casa"), strings.Contains(typeNormalized, "sobrado"):
			return purpose, "Casa / Sobrado Comercial"
		case strings.Contains(typeNormalized, "sala"), strings.Contains(typeNormalized, "conjunto"),
			strings.Contains(typeNormalized, "escritorio"), strings.Contains(typeNormalized, "consultorio"),
			strings.Contains(typeNormalized, "laje"):
			return purpose, "Conj. Comercial / Sala"
		case strings.Contains(typeNormalized, "fazenda"):
			return purpose, "Fazenda"
		case strings.Contains(typeNormalized, "galpao"), strings.Contains(typeNormalized, "deposito"), strings.Contains(typeNormalized, "industrial"):
			return purpose, "Galpão / Depósito"
		case strings.Contains(typeNormalized, "garagem"):
			return purpose, "Garagem"
		case strings.Contains(typeNormalized, "loja"), strings.Contains(typeNormalized, "ponto"), strings.Contains(typeNormalized, "box"):
			return purpose, "Ponto Comercial"
		case strings.Contains(typeNormalized, "predio"), strings.Contains(typeNormalized, "edificio"), strings.Contains(typeNormalized, "building"):
			return purpose, "Prédio"
		case strings.Contains(typeNormalized, "terreno"), strings.Contains(typeNormalized, "lote"):
			return purpose, "Terreno comercial"
		default:
			return purpose, ""
		}
	}
	if purpose == "RU" {
		switch {
		case strings.Contains(typeNormalized, "fazenda"):
			return purpose, "Fazenda"
		case strings.Contains(typeNormalized, "sitio"), strings.Contains(typeNormalized, "chacara"):
			return purpose, "Sítio / Chácara"
		default:
			return purpose, ""
		}
	}

	switch {
	case strings.Contains(typeNormalized, "condominio") && (strings.Contains(typeNormalized, "casa") || strings.Contains(typeNormalized, "sobrado")):
		return purpose, "Casa / Sobrado em Condomínio"
	case strings.Contains(typeNormalized, "casa"), strings.Contains(typeNormalized, "sobrado"):
		return purpose, "Casa / Sobrado"
	case strings.Contains(typeNormalized, "cobertura"):
		return purpose, "Cobertura"
	case strings.Contains(typeNormalized, "flat"):
		return purpose, "Flat"
	case strings.Contains(typeNormalized, "kitnet"), strings.Contains(typeNormalized, "studio"):
		return purpose, "Kitnet / Stúdio"
	case strings.Contains(typeNormalized, "loft"):
		return purpose, "Loft"
	case strings.Contains(typeNormalized, "apart"):
		return purpose, "Apartamento"
	case strings.Contains(typeNormalized, "sitio"), strings.Contains(typeNormalized, "chacara"):
		return purpose, "Sítio / Chácara"
	case strings.Contains(typeNormalized, "condominio") && (strings.Contains(typeNormalized, "terreno") || strings.Contains(typeNormalized, "lote")):
		return purpose, "Terreno em Condomínio"
	case strings.Contains(typeNormalized, "terreno"), strings.Contains(typeNormalized, "lote"):
		return purpose, "Terreno / Lote"
	default:
		return purpose, ""
	}
}

func validChavesNaMaoPublicationType(value string) bool {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "", "STANDARD", "FEATURED":
		return true
	default:
		return false
	}
}

func normalizeChavesNaMaoPublicationType(value string) string {
	if strings.EqualFold(strings.TrimSpace(value), "FEATURED") {
		return "FEATURED"
	}
	return "STANDARD"
}

func chavesNaMaoFeatured(property map[string]any, publicationType string) string {
	if normalizeChavesNaMaoPublicationType(publicationType) == "FEATURED" ||
		chavesNaMaoBool(property, "destaque", "super_destaque", "is_featured") {
		return "1"
	}
	return "0"
}

func chavesNaMaoBool(property map[string]any, keys ...string) bool {
	for _, key := range keys {
		value, ok := property[key]
		if !ok {
			if metadata, metadataOK := property["metadata"].(map[string]any); metadataOK {
				value, ok = metadata[key]
			}
		}
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case bool:
			if typed {
				return true
			}
		case float64:
			if typed != 0 {
				return true
			}
		case string:
			switch normalizeText(typed) {
			case "1", "true", "sim", "yes":
				return true
			}
		}
	}
	return false
}

func chavesNaMaoBoolean(property map[string]any, keys ...string) string {
	if chavesNaMaoBool(property, keys...) {
		return "1"
	}
	return "0"
}

func chavesNaMaoInteger(property map[string]any, keys ...string) string {
	value := firstPropertyNumber(property, keys...)
	if value <= 0 {
		for _, key := range keys {
			if metadata, ok := property["metadata"].(map[string]any); ok {
				value = firstPropertyNumber(metadata, key)
				if value > 0 {
					break
				}
			}
		}
	}
	if value <= 0 {
		return ""
	}
	return strconv.Itoa(int(value))
}

func chavesNaMaoDecimal(value float64) string {
	if value <= 0 || !isFiniteFloat(value) {
		return ""
	}
	return strconv.FormatFloat(value, 'f', -1, 64)
}

func chavesNaMaoDate(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02 15:04:05"} {
		parsed, err := time.Parse(layout, value)
		if err == nil {
			return parsed.UTC().Format("2006-01-02 15:04:05")
		}
	}
	return ""
}

func chavesNaMaoImages(property map[string]any) []string {
	images := propertyImages(property)
	result := make([]string, 0, len(images))
	for _, imageURL := range images {
		if validChavesNaMaoImageURL(imageURL) {
			result = append(result, imageURL)
		}
	}
	if len(result) > 30 {
		return result[:30]
	}
	return result
}

func validChavesNaMaoImageURL(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil {
		return false
	}
	switch strings.ToLower(path.Ext(parsed.Path)) {
	case ".jpg", ".jpeg", ".webp":
		return true
	default:
		return false
	}
}

func chavesNaMaoMetadataItems(property map[string]any, key string) []string {
	metadata, ok := property["metadata"].(map[string]any)
	if !ok {
		return []string{}
	}
	values := []string{}
	switch typed := metadata[key].(type) {
	case []any:
		for _, raw := range typed {
			if value, ok := raw.(string); ok && strings.TrimSpace(value) != "" {
				values = append(values, trimMax(value, 100))
			}
		}
	case []string:
		for _, value := range typed {
			if strings.TrimSpace(value) != "" {
				values = append(values, trimMax(value, 100))
			}
		}
	}
	if len(values) > 100 {
		return values[:100]
	}
	return values
}

func chavesNaMaoRentalPeriod(property map[string]any, transaction string) string {
	if transaction != "For Rent" && transaction != "Sale/Rent" {
		return ""
	}
	switch normalizeText(firstPropertyText(property, "rental_period") + " " + metadataText(property, "rental_period")) {
	case "diario", "diaria", "daily", "por dia":
		return "2"
	case "semanal", "weekly", "por semana":
		return "4"
	case "anual", "yearly", "por ano":
		return "3"
	default:
		return "1"
	}
}

func ensureChavesNaMaoFeedLimit(count int) error {
	if count > maxChavesNaMaoListings {
		return fmt.Errorf("%w: maximum=%d", ErrChavesNaMaoListingLimit, maxChavesNaMaoListings)
	}
	return nil
}
