package portals

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"html"
	"math"
	"net/url"
	"path"
	"regexp"
	"strings"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/grupoolx"
)

type feedListing struct {
	PublicationID    string           `json:"publication_id"`
	PropertyID       string           `json:"property_id"`
	Source           string           `json:"source"`
	VersionID        string           `json:"version_id"`
	PublishedVersion int64            `json:"published_version"`
	PayloadHash      string           `json:"payload_hash"`
	ClientListingID  string           `json:"client_listing_id"`
	PublicationType  string           `json:"publication_type"`
	Property         map[string]any   `json:"property"`
	Media            []feedMediaProof `json:"media"`
}

type feedMediaProof struct {
	Kind           string `json:"kind"`
	MIMEType       string `json:"mime_type"`
	FileSizeBytes  *int64 `json:"file_size_bytes"`
	ServerVerified bool   `json:"server_verified"`
}

type vrSyncFeed struct {
	XMLName        xml.Name       `xml:"ListingDataFeed"`
	XMLNS          string         `xml:"xmlns,attr"`
	XMLNSXSI       string         `xml:"xmlns:xsi,attr"`
	SchemaLocation string         `xml:"xsi:schemaLocation,attr"`
	Header         vrSyncHeader   `xml:"Header"`
	Listings       vrSyncListings `xml:"Listings"`
}

type vrSyncHeader struct {
	Provider    string `xml:"Provider"`
	Email       string `xml:"Email,omitempty"`
	ContactName string `xml:"ContactName,omitempty"`
	PublishDate string `xml:"PublishDate"`
	Telephone   string `xml:"Telephone,omitempty"`
}

type vrSyncListings struct {
	Listing []vrSyncListing `xml:"Listing"`
}

type vrSyncListing struct {
	ListingID       string            `xml:"ListingID"`
	Title           string            `xml:"Title"`
	TransactionType string            `xml:"TransactionType"`
	PublicationType string            `xml:"PublicationType,omitempty"`
	DetailViewURL   string            `xml:"DetailViewUrl,omitempty"`
	VirtualTourLink string            `xml:"VirtualTourLink,omitempty"`
	Details         vrSyncDetails     `xml:"Details"`
	Location        vrSyncLocation    `xml:"Location"`
	Media           *vrSyncMedia      `xml:"Media,omitempty"`
	ContactInfo     vrSyncContactInfo `xml:"ContactInfo"`
}

type vrSyncDetails struct {
	PropertyType              string       `xml:"PropertyType"`
	Description               string       `xml:"Description"`
	ListPrice                 *vrSyncMoney `xml:"ListPrice,omitempty"`
	RentalPrice               *vrSyncMoney `xml:"RentalPrice,omitempty"`
	PropertyAdministrationFee *vrSyncMoney `xml:"PropertyAdministrationFee,omitempty"`
	Iptu                      *vrSyncMoney `xml:"Iptu,omitempty"`
	LivingArea                *vrSyncArea  `xml:"LivingArea,omitempty"`
	LotArea                   *vrSyncArea  `xml:"LotArea,omitempty"`
	Bedrooms                  *int         `xml:"Bedrooms,omitempty"`
	Bathrooms                 *int         `xml:"Bathrooms,omitempty"`
	Suites                    *int         `xml:"Suites,omitempty"`
	Garage                    *int         `xml:"Garage,omitempty"`
	Features                  []string     `xml:"Features>Feature,omitempty"`
}

type vrSyncMoney struct {
	Currency string `xml:"currency,attr"`
	Period   string `xml:"period,attr,omitempty"`
	Value    int64  `xml:",chardata"`
}

type vrSyncArea struct {
	Unit  string `xml:"unit,attr"`
	Value int64  `xml:",chardata"`
}

type vrSyncLocation struct {
	DisplayAddress string           `xml:"displayAddress,attr"`
	Country        vrSyncRegionName `xml:"Country"`
	State          vrSyncRegionName `xml:"State"`
	City           string           `xml:"City"`
	Neighborhood   string           `xml:"Neighborhood,omitempty"`
	Address        string           `xml:"Address,omitempty"`
	StreetNumber   string           `xml:"StreetNumber,omitempty"`
	Complement     string           `xml:"Complement,omitempty"`
	PostalCode     string           `xml:"PostalCode,omitempty"`
	Latitude       *float64         `xml:"Latitude,omitempty"`
	Longitude      *float64         `xml:"Longitude,omitempty"`
}

type vrSyncRegionName struct {
	Abbreviation string `xml:"abbreviation,attr"`
	Value        string `xml:",chardata"`
}

type vrSyncMedia struct {
	Items []vrSyncMediaItem `xml:"Item"`
}

type vrSyncMediaItem struct {
	Medium  string `xml:"medium,attr"`
	Caption string `xml:"caption,attr,omitempty"`
	Primary bool   `xml:"primary,attr,omitempty"`
	Value   string `xml:",chardata"`
}

type vrSyncContactInfo struct {
	Name      string `xml:"Name,omitempty"`
	Email     string `xml:"Email,omitempty"`
	Website   string `xml:"Website,omitempty"`
	Telephone string `xml:"Telephone,omitempty"`
}

func buildVRSyncFeed(integration publicIntegration, items []feedListing) ([]byte, error) {
	publishDate := integration.FeedPublishedAt.UTC().Format(time.RFC3339)
	if integration.FeedPublishedAt.IsZero() {
		publishDate = nowISO()
	}
	feed := vrSyncFeed{
		XMLNS:          "http://www.vivareal.com/schemas/1.0/VRSync",
		XMLNSXSI:       "http://www.w3.org/2001/XMLSchema-instance",
		SchemaLocation: "http://www.vivareal.com/schemas/1.0/VRSync http://xml.vivareal.com/vrsync.xsd",
		Header: vrSyncHeader{
			Provider:    "Vimob CRM",
			Email:       textFromSettings(integration.Settings, "contact_email"),
			ContactName: textFromSettings(integration.Settings, "contact_name"),
			PublishDate: publishDate,
			Telephone:   onlyDigits(textFromSettings(integration.Settings, "contact_phone")),
		},
		Listings: vrSyncListings{Listing: []vrSyncListing{}},
	}

	for _, item := range items {
		listing, ok := mapToVRSyncListing(integration, item)
		if ok {
			feed.Listings.Listing = append(feed.Listings.Listing, listing)
		}
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

func mapToVRSyncListing(integration publicIntegration, item feedListing) (vrSyncListing, bool) {
	property := item.Property
	title := trimMax(firstPropertyText(property, "title", "titulo"), 100)
	description := firstPropertyText(property, "descricao_site", "status_descritivo", "descricao")
	if description == "" {
		description = title
	}
	transactionType := normalizeTransactionType(firstPropertyText(property, "tipo_de_negocio", "finalidade"))
	images := propertyImages(property)
	mediaItems := make([]vrSyncMediaItem, 0, len(images)+1)
	for index, image := range images {
		mediaItems = append(mediaItems, vrSyncMediaItem{
			Medium:  "image",
			Caption: fmt.Sprintf("img%d", index+1),
			Primary: index == 0,
			Value:   image,
		})
	}
	if video := firstPropertyText(property, "video_imovel"); isYouTubeURL(video) {
		mediaItems = append(mediaItems, vrSyncMediaItem{Medium: "video", Value: video})
	}
	tour := firstPropertyText(property, "tour_virtual")
	if !isHTTPSURL(tour) {
		tour = ""
	}

	details := vrSyncDetails{
		PropertyType:              normalizePropertyType(firstPropertyText(property, "tipo_de_imovel", "tipo", "tipo_imovel")),
		Description:               html.UnescapeString(description),
		ListPrice:                 moneyValue(priceForSale(property, transactionType), ""),
		RentalPrice:               moneyValue(priceForRent(property, transactionType), rentalPeriod(property)),
		PropertyAdministrationFee: moneyValue(positiveFloatPointer(firstPropertyNumber(property, "condominio", "valor_condominio")), ""),
		Iptu:                      moneyValue(positiveFloatPointer(firstPropertyNumber(property, "iptu", "valor_itr")), iptuPeriod(property)),
		LivingArea:                areaValue(firstPropertyNumber(property, "area_util", "area_construida")),
		LotArea:                   areaValue(firstPropertyNumber(property, "area_total")),
		Bedrooms:                  positiveIntPointer(firstPropertyNumber(property, "quartos")),
		Bathrooms:                 positiveIntPointer(firstPropertyNumber(property, "banheiros")),
		Suites:                    positiveIntPointer(firstPropertyNumber(property, "suites")),
		Garage:                    positiveIntPointer(firstPropertyNumber(property, "vagas")),
		Features:                  normalizedFeatures(propertyStringSlice(property, "detalhes_extras", "proximidades", "marcadores")),
	}
	stateAbbreviation := strings.ToUpper(firstPropertyText(property, "uf", "estado"))
	addressVisibility := firstPropertyText(property, "address_visibility", "public_address_visibility")
	location := vrSyncLocation{
		DisplayAddress: normalizeDisplayAddress(addressVisibility),
		Country:        vrSyncRegionName{Abbreviation: "BR", Value: "Brasil"},
		State:          vrSyncRegionName{Abbreviation: stateAbbreviation, Value: brazilianStateName(stateAbbreviation)},
		City:           firstPropertyText(property, "cidade"),
		Neighborhood:   firstPropertyText(property, "bairro"),
		Address:        firstPropertyText(property, "endereco"),
		StreetNumber:   firstPropertyText(property, "numero"),
		Complement:     firstPropertyText(property, "complemento"),
		PostalCode:     onlyDigits(firstPropertyText(property, "cep")),
		Latitude:       coordinatePointer(firstPropertyNumber(property, "latitude")),
		Longitude:      coordinatePointer(firstPropertyNumber(property, "longitude")),
	}
	applyPublicAddressVisibility(&location, addressVisibility)
	website := textFromSettings(integration.Settings, "detail_base_url")
	contact := vrSyncContactInfo{
		Name:      textFromSettings(integration.Settings, "contact_name"),
		Email:     textFromSettings(integration.Settings, "contact_email"),
		Website:   website,
		Telephone: onlyDigits(textFromSettings(integration.Settings, "contact_phone")),
	}
	detailURL := textFromSettings(integration.Settings, "detail_base_url")
	if detailURL != "" {
		detailURL = strings.TrimRight(detailURL, "/") + "/" + url.PathEscape(firstPropertyText(property, "code", "codigo"))
	}

	var media *vrSyncMedia
	if len(mediaItems) > 0 {
		media = &vrSyncMedia{Items: mediaItems}
	}

	return vrSyncListing{
		ListingID:       item.ClientListingID,
		Title:           title,
		TransactionType: transactionType,
		PublicationType: normalizePublicationType(item.PublicationType),
		DetailViewURL:   detailURL,
		VirtualTourLink: tour,
		Details:         details,
		Location:        location,
		Media:           media,
		ContactInfo:     contact,
	}, true
}

func validateFeedListing(integration publicIntegration, item feedListing) []string {
	property := item.Property
	errors := []string{}
	title := firstPropertyText(property, "title", "titulo")
	if len([]rune(title)) < 10 || len([]rune(title)) > 100 {
		errors = append(errors, "Titulo precisa ter entre 10 e 100 caracteres.")
	}
	if feedTitleHasMarkup(title) {
		errors = append(errors, "Titulo nao pode conter HTML.")
	}
	if normalizeTransactionType(firstPropertyText(property, "tipo_de_negocio", "finalidade")) == "" {
		errors = append(errors, "Tipo de negocio e obrigatorio.")
	}
	if normalizePropertyType(firstPropertyText(property, "tipo_de_imovel", "tipo", "tipo_imovel")) == "" {
		errors = append(errors, "Tipo de imovel e obrigatorio.")
	}
	status := normalizeText(firstPropertyText(property, "status"))
	if isUnavailablePortalPropertyStatus(status) {
		errors = append(errors, "Imovel nao esta ativo para publicacao.")
	}
	description := firstPropertyText(property, "descricao_site", "status_descritivo", "descricao")
	if len([]rune(strings.TrimSpace(description))) < 50 || len([]rune(strings.TrimSpace(description))) > 3000 {
		errors = append(errors, "Descricao precisa ter entre 50 e 3000 caracteres.")
	}
	if feedDescriptionHasDisallowedMarkup(description) {
		errors = append(errors, "Descricao nao pode conter HTML.")
	}
	if firstPropertyText(property, "cidade") == "" || firstPropertyText(property, "uf", "estado") == "" || firstPropertyText(property, "bairro") == "" {
		errors = append(errors, "Cidade, UF e bairro sao obrigatorios.")
	}
	if len(onlyDigits(firstPropertyText(property, "cep"))) != 8 {
		errors = append(errors, "CEP com 8 digitos e obrigatorio.")
	}
	if minimumFeedAddressVisibility(firstPropertyText(property, "address_visibility", "public_address_visibility")) {
		errors = append(errors, "Grupo OLX exige bairro e CEP; selecione endereco parcial ou completo.")
	}
	if len(propertyImages(property)) == 0 {
		errors = append(errors, "Pelo menos uma foto e obrigatoria.")
	}
	if item.Source == "legacy" {
		for _, imageURL := range propertyImages(property) {
			parsed, parseErr := url.Parse(imageURL)
			extension := ""
			if parseErr == nil {
				extension = strings.ToLower(path.Ext(parsed.Path))
			}
			if parseErr != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || (extension != ".jpg" && extension != ".jpeg") {
				errors = append(errors, "Fotos legadas precisam usar HTTP(S) e extensao JPG/JPEG.")
				break
			}
		}
	}
	if item.Source == "canonical" {
		photoProofs := 0
		for _, media := range item.Media {
			if media.Kind != "photo" {
				continue
			}
			photoProofs++
			if !media.ServerVerified {
				errors = append(errors, "Fotos canonicas precisam de verificacao server-side do objeto.")
			}
			if !strings.EqualFold(media.MIMEType, "image/jpeg") && !strings.EqualFold(media.MIMEType, "image/jpg") {
				errors = append(errors, "Fotos precisam ter MIME JPEG comprovado.")
			}
			if media.FileSizeBytes == nil || *media.FileSizeBytes <= 0 || *media.FileSizeBytes > 7*1024*1024 {
				errors = append(errors, "Fotos precisam ter tamanho comprovado de ate 7 MB.")
			}
		}
		if photoProofs == 0 {
			errors = append(errors, "Fotos canonicas precisam de prova imutavel de MIME e tamanho.")
		}
	}
	transactionType := normalizeTransactionType(firstPropertyText(property, "tipo_de_negocio", "finalidade"))
	if (transactionType == "For Sale" || transactionType == "Sale/Rent") && priceForSale(property, transactionType) == nil {
		errors = append(errors, "Preco de venda e obrigatorio.")
	}
	if (transactionType == "For Rent" || transactionType == "Sale/Rent") && priceForRent(property, transactionType) == nil {
		errors = append(errors, "Valor de locacao e obrigatorio.")
	}
	propertyType := normalizePropertyType(firstPropertyText(property, "tipo_de_imovel", "tipo", "tipo_imovel"))
	roomRequirements := grupoolx.RoomRequirementsFor(propertyType)
	if roomRequirements.MinimumBedrooms > 0 && firstPropertyNumber(property, "quartos") < float64(roomRequirements.MinimumBedrooms) {
		errors = append(errors, "Quartos sao obrigatorios para este tipo de imovel.")
	}
	if roomRequirements.MinimumBathrooms > 0 && firstPropertyNumber(property, "banheiros") < float64(roomRequirements.MinimumBathrooms) {
		errors = append(errors, "Banheiros sao obrigatorios para este tipo de imovel.")
	}
	if requiresLotArea(propertyType) {
		if firstPropertyNumber(property, "area_total") <= 0 {
			errors = append(errors, "Area total e obrigatoria para este tipo de imovel.")
		}
	} else if firstPropertyNumber(property, "area_util", "area_construida") <= 0 {
		errors = append(errors, "Area util e obrigatoria.")
	}
	if strings.TrimSpace(textFromSettings(integration.Settings, "contact_name")) == "" || strings.TrimSpace(textFromSettings(integration.Settings, "contact_email")) == "" {
		errors = append(errors, "Nome e e-mail de contato da imobiliaria sao obrigatorios.")
	}
	if !validPublicationType(item.PublicationType) {
		errors = append(errors, "Tipo de publicacao invalido.")
	}
	if listingLength := len([]rune(strings.TrimSpace(item.ClientListingID))); listingLength < 1 || listingLength > 50 {
		errors = append(errors, "ListingID precisa ter entre 1 e 50 caracteres.")
	}
	return errors
}

var allowedFeedDescriptionTag = regexp.MustCompile(`(?i)</?(?:b|i)>|<br\s*/?>`)

func feedTitleHasMarkup(value string) bool {
	return strings.ContainsAny(html.UnescapeString(value), "<>")
}

func feedDescriptionHasDisallowedMarkup(value string) bool {
	if strings.ContainsAny(value, "<>") {
		return true
	}
	decoded := html.UnescapeString(value)
	withoutAllowedTags := allowedFeedDescriptionTag.ReplaceAllString(decoded, "")
	return strings.ContainsAny(withoutAllowedTags, "<>")
}

func isUnavailablePortalPropertyStatus(status string) bool {
	switch normalizeText(status) {
	case "draft", "reserved", "sold", "rented", "inactive", "archived",
		"rascunho", "reservado", "vendido", "alugado", "locado", "inativo", "arquivado":
		return true
	default:
		return false
	}
}

func normalizeTransactionType(value string) string {
	normalized := normalizeText(value)
	hasSale := strings.Contains(normalized, "venda") || strings.Contains(normalized, "sale")
	hasRent := strings.Contains(normalized, "locacao") || strings.Contains(normalized, "aluguel") ||
		strings.Contains(normalized, "rent") || strings.Contains(normalized, "temporada") || strings.Contains(normalized, "seasonal")
	switch {
	case hasSale && hasRent:
		return "Sale/Rent"
	case hasSale:
		return "For Sale"
	case hasRent:
		return "For Rent"
	default:
		return ""
	}
}

func normalizePropertyType(value string) string {
	return grupoolx.NormalizePropertyType(value)
}

func legacyNormalizePropertyType(value string) string {
	normalized := normalizeText(value)
	switch {
	case strings.Contains(normalized, "condominio") && strings.Contains(normalized, "casa"):
		return "Residential / Condo"
	case strings.Contains(normalized, "casa de vila"), strings.Contains(normalized, "village house"):
		return "Residential / Village House"
	case strings.Contains(normalized, "sobrado"):
		return "Residential / Sobrado"
	case strings.Contains(normalized, "casa"):
		return "Residential / Home"
	case strings.Contains(normalized, "cobertura"):
		return "Residential / Penthouse"
	case strings.Contains(normalized, "flat"):
		return "Residential / Flat"
	case strings.Contains(normalized, "kitnet"), strings.Contains(normalized, "conjugado"):
		return "Residential / Kitnet"
	case strings.Contains(normalized, "studio"):
		return "Residential / Studio"
	case strings.Contains(normalized, "loft"):
		return "Residential / Loft"
	case strings.Contains(normalized, "apart"):
		return "Residential / Apartment"
	case strings.Contains(normalized, "edificio residencial"), strings.Contains(normalized, "predio residencial"):
		return "Commercial / Edificio Residencial"
	case (strings.Contains(normalized, "terreno") || strings.Contains(normalized, "lote")) && strings.Contains(normalized, "comercial"):
		return "Commercial / Land Lot"
	case strings.Contains(normalized, "terreno"), strings.Contains(normalized, "lote"):
		return "Residential / Land Lot"
	case strings.Contains(normalized, "consultorio"):
		return "Commercial / Consultorio"
	case strings.Contains(normalized, "laje corporativa"), strings.Contains(normalized, "andar corporativo"), strings.Contains(normalized, "corporate floor"):
		return "Commercial / Corporate Floor"
	case strings.Contains(normalized, "edificio comercial"), strings.Contains(normalized, "predio comercial"):
		return "Commercial / Edificio Comercial"
	case strings.Contains(normalized, "garagem"), strings.Contains(normalized, "garage"):
		return "Commercial / Garage"
	case strings.Contains(normalized, "hotel"), strings.Contains(normalized, "pousada"):
		return "Commercial / Hotel"
	case strings.Contains(normalized, "sala"), strings.Contains(normalized, "conjunto"):
		return "Commercial / Office"
	case strings.Contains(normalized, "loja"), strings.Contains(normalized, "ponto comercial"), strings.Contains(normalized, "box"):
		return "Commercial / Business"
	case strings.Contains(normalized, "galpao"):
		return "Commercial / Industrial"
	case strings.Contains(normalized, "fazenda"), strings.Contains(normalized, "sitio"), strings.Contains(normalized, "chacara"), strings.Contains(normalized, "farm"), strings.Contains(normalized, "ranch"):
		return "Residential / Farm Ranch"
	case strings.Contains(normalized, "imovel comercial"):
		return "Commercial / Building"
	case strings.Contains(normalized, "edificio"), strings.Contains(normalized, "predio"), strings.Contains(normalized, "building"):
		return "Commercial / Building"
	default:
		return ""
	}
}

func normalizeDisplayAddress(value string) string {
	normalized := normalizeText(value)
	switch {
	case strings.Contains(normalized, "hidden"), strings.Contains(normalized, "bairro"), strings.Contains(normalized, "partial"), strings.Contains(normalized, "parcial"):
		return "Neighborhood"
	case strings.Contains(normalized, "street"), strings.Contains(normalized, "rua"):
		return "Street"
	default:
		return "All"
	}
}

func applyPublicAddressVisibility(location *vrSyncLocation, value string) {
	if location == nil {
		return
	}
	normalized := normalizeText(value)
	if normalized == "completo" || normalized == "complete" || normalized == "all" {
		return
	}
	if minimumFeedAddressVisibility(normalized) {
		location.DisplayAddress = "City"
		location.Neighborhood = ""
		location.PostalCode = ""
		location.Address = ""
		location.StreetNumber = ""
		location.Complement = ""
		location.Latitude = nil
		location.Longitude = nil
		return
	}
	// Partial/minimum visibility never sends the street-level fields to the
	// provider. PostalCode remains because VRSync requires it for ingestion;
	// displayAddress instructs the portal to expose only the neighborhood.
	location.DisplayAddress = "Neighborhood"
	location.Address = ""
	location.StreetNumber = ""
	location.Complement = ""
	location.Latitude = nil
	location.Longitude = nil
}

func minimumFeedAddressVisibility(value string) bool {
	switch normalizeText(value) {
	case "minimo", "minimum", "city", "cidade":
		return true
	default:
		return false
	}
}

func validPublicationType(value string) bool {
	switch normalizePublicationType(value) {
	case "STANDARD", "PREMIUM", "SUPER_PREMIUM", "PREMIERE_1", "PREMIERE_2", "TRIPLE":
		return true
	default:
		return false
	}
}

func requiresLotArea(propertyType string) bool {
	return grupoolx.RequiresLotArea(propertyType)
}

func legacyRequiresLotArea(propertyType string) bool {
	return strings.Contains(propertyType, "Land Lot") ||
		strings.Contains(propertyType, "Farm Ranch") ||
		strings.Contains(propertyType, "Industrial")
}

func moneyValue(value *float64, period string) *vrSyncMoney {
	if value == nil || *value <= 0 || !isFiniteFloat(*value) {
		return nil
	}
	return &vrSyncMoney{
		Currency: "BRL",
		Period:   period,
		Value:    int64(math.Trunc(*value)),
	}
}

func areaValue(value float64) *vrSyncArea {
	if value <= 0 || !isFiniteFloat(value) {
		return nil
	}
	return &vrSyncArea{Unit: "square metres", Value: int64(math.Trunc(value))}
}

func rentalPeriod(property map[string]any) string {
	value := normalizeText(firstPropertyText(property, "rental_period"))
	if value == "" {
		value = normalizeText(metadataText(property, "rental_period"))
	}
	switch value {
	case "diario", "diaria", "daily":
		return "Daily"
	case "semanal", "weekly":
		return "Weekly"
	case "trimestral", "quarterly":
		return "Quarterly"
	case "anual", "yearly":
		return "Yearly"
	default:
		return "Monthly"
	}
}

func iptuPeriod(property map[string]any) string {
	value := normalizeText(firstPropertyText(property, "iptu_period"))
	if value == "" {
		value = normalizeText(metadataText(property, "iptu_period"))
	}
	if value == "mensal" || value == "monthly" {
		return "Monthly"
	}
	return "Yearly"
}

func metadataText(property map[string]any, key string) string {
	metadata, ok := property["metadata"].(map[string]any)
	if !ok {
		return ""
	}
	return firstText(metadata, key)
}

func brazilianStateName(abbreviation string) string {
	states := map[string]string{
		"AC": "Acre", "AL": "Alagoas", "AP": "Amapa", "AM": "Amazonas",
		"BA": "Bahia", "CE": "Ceara", "DF": "Distrito Federal", "ES": "Espirito Santo",
		"GO": "Goias", "MA": "Maranhao", "MT": "Mato Grosso", "MS": "Mato Grosso do Sul",
		"MG": "Minas Gerais", "PA": "Para", "PB": "Paraiba", "PR": "Parana",
		"PE": "Pernambuco", "PI": "Piaui", "RJ": "Rio de Janeiro", "RN": "Rio Grande do Norte",
		"RS": "Rio Grande do Sul", "RO": "Rondonia", "RR": "Roraima", "SC": "Santa Catarina",
		"SP": "Sao Paulo", "SE": "Sergipe", "TO": "Tocantins",
	}
	if name := states[strings.ToUpper(strings.TrimSpace(abbreviation))]; name != "" {
		return name
	}
	return strings.ToUpper(strings.TrimSpace(abbreviation))
}

func normalizedFeatures(values []string) []string {
	translations := map[string]string{
		"academia": "Gym", "alarme": "Alarm System", "aquecimento": "Heating",
		"ar condicionado": "Cooling", "churrasqueira": "BBQ", "elevador": "Elevator",
		"garagem": "Parking Garage", "interfone": "Intercom", "jardim": "Garden Area",
		"mobiliado": "Furnished", "piscina": "Pool", "playground": "Playground",
		"portaria 24 horas": "Security Guard on Duty", "quintal": "Backyard",
		"salao de festas": "Party Room", "sauna": "Sauna", "varanda": "Balcony",
	}
	seen := map[string]bool{}
	result := []string{}
	for _, value := range values {
		mapped := translations[normalizeText(value)]
		if mapped != "" && !seen[mapped] {
			seen[mapped] = true
			result = append(result, mapped)
		}
	}
	return result
}

func priceForSale(property map[string]any, transactionType string) *float64 {
	if transactionType != "For Sale" && transactionType != "Sale/Rent" {
		return nil
	}
	return positiveFloatPointer(firstPropertyNumber(property, "preco", "valor_venda"))
}

func priceForRent(property map[string]any, transactionType string) *float64 {
	if transactionType != "For Rent" && transactionType != "Sale/Rent" {
		return nil
	}
	if transactionType == "For Rent" {
		return positiveFloatPointer(firstPropertyNumber(property, "valor_locacao", "valor_aluguel", "preco"))
	}
	return positiveFloatPointer(firstPropertyNumber(property, "valor_locacao", "valor_aluguel"))
}

func propertyImages(property map[string]any) []string {
	seen := map[string]bool{}
	images := []string{}
	add := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" || !isURL(value) || seen[value] {
			return
		}
		seen[value] = true
		images = append(images, value)
	}
	add(firstPropertyText(property, "imagem_principal"))
	for _, key := range []string{"image_urls", "fotos"} {
		switch typed := property[key].(type) {
		case []any:
			for _, item := range typed {
				if text, ok := item.(string); ok {
					add(text)
				}
			}
		case []string:
			for _, item := range typed {
				add(item)
			}
		case string:
			add(typed)
		}
	}
	if len(images) > 30 {
		return images[:30]
	}
	return images
}

func firstPropertyText(property map[string]any, keys ...string) string {
	return firstText(property, keys...)
}

func firstPropertyNumber(property map[string]any, keys ...string) float64 {
	for _, key := range keys {
		switch typed := property[key].(type) {
		case float64:
			if isFiniteFloat(typed) {
				return typed
			}
		case int:
			return float64(typed)
		case string:
			var value float64
			if _, err := fmt.Sscanf(strings.ReplaceAll(typed, ",", "."), "%f", &value); err == nil && isFiniteFloat(value) {
				return value
			}
		}
	}
	return 0
}

func positiveFloatPointer(value float64) *float64 {
	if value <= 0 || !isFiniteFloat(value) {
		return nil
	}
	return &value
}

func positiveIntPointer(value float64) *int {
	if value <= 0 || !isFiniteFloat(value) {
		return nil
	}
	intValue := int(math.Round(value))
	return &intValue
}

func isFiniteFloat(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func coordinatePointer(value float64) *float64 {
	if value == 0 || !isFiniteFloat(value) {
		return nil
	}
	return &value
}

func propertyStringSlice(property map[string]any, keys ...string) []string {
	seen := map[string]bool{}
	items := []string{}
	for _, key := range keys {
		if values, ok := property[key].([]any); ok {
			for _, value := range values {
				if text, ok := value.(string); ok {
					text = strings.TrimSpace(text)
					if text != "" && !seen[text] {
						seen[text] = true
						items = append(items, text)
					}
				}
			}
		}
	}
	if len(items) > 100 {
		return items[:100]
	}
	return items
}

func textFromSettings(settings map[string]any, key string) string {
	if settings == nil {
		return ""
	}
	if value, ok := settings[key].(string); ok {
		return strings.TrimSpace(value)
	}
	return ""
}

func trimMax(value string, max int) string {
	value = strings.TrimSpace(value)
	if len([]rune(value)) <= max {
		return value
	}
	runes := []rune(value)
	return strings.TrimSpace(string(runes[:max]))
}

func isURL(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	return err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host != ""
}

func isHTTPSURL(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	return err == nil && parsed.Scheme == "https" && parsed.Host != ""
}

func isYouTubeURL(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Scheme != "https" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return host == "youtube.com" || host == "www.youtube.com" || host == "m.youtube.com" || host == "youtu.be" || host == "www.youtu.be"
}

func normalizeText(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	replacer := strings.NewReplacer(
		"á", "a", "à", "a", "ã", "a", "â", "a",
		"é", "e", "ê", "e",
		"í", "i",
		"ó", "o", "ô", "o", "õ", "o",
		"ú", "u",
		"ç", "c",
	)
	return replacer.Replace(value)
}
