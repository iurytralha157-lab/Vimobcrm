package portals

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"html"
	"math"
	"net/url"
	"strings"
)

type feedListing struct {
	PublicationID   string         `json:"publication_id"`
	ClientListingID string         `json:"client_listing_id"`
	PublicationType string         `json:"publication_type"`
	Property        map[string]any `json:"property"`
}

type vrSyncFeed struct {
	XMLName  xml.Name       `xml:"ListingDataFeed"`
	XMLNS    string         `xml:"xmlns,attr"`
	XMLNSXSI string         `xml:"xmlns:xsi,attr"`
	Header   vrSyncHeader   `xml:"Header"`
	Listings vrSyncListings `xml:"Listings"`
}

type vrSyncHeader struct {
	Provider    string `xml:"Provider"`
	Email       string `xml:"Email,omitempty"`
	ContactName string `xml:"ContactName,omitempty"`
	PublishDate string `xml:"PublishDate"`
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
	Details         vrSyncDetails     `xml:"Details"`
	Location        vrSyncLocation    `xml:"Location"`
	Media           *vrSyncMedia      `xml:"Media,omitempty"`
	ContactInfo     vrSyncContactInfo `xml:"ContactInfo"`
}

type vrSyncDetails struct {
	PropertyType              string   `xml:"PropertyType"`
	Description               string   `xml:"Description"`
	ListPrice                 *float64 `xml:"ListPrice,omitempty"`
	RentalPrice               *float64 `xml:"RentalPrice,omitempty"`
	PropertyAdministrationFee *float64 `xml:"PropertyAdministrationFee,omitempty"`
	YearlyTax                 *float64 `xml:"YearlyTax,omitempty"`
	LivingArea                *float64 `xml:"LivingArea,omitempty"`
	LotArea                   *float64 `xml:"LotArea,omitempty"`
	Bedrooms                  *int     `xml:"Bedrooms,omitempty"`
	Bathrooms                 *int     `xml:"Bathrooms,omitempty"`
	Suites                    *int     `xml:"Suites,omitempty"`
	Garage                    *int     `xml:"Garage,omitempty"`
	Features                  []string `xml:"Features>Feature,omitempty"`
}

type vrSyncLocation struct {
	Country        string   `xml:"Country"`
	State          string   `xml:"State"`
	City           string   `xml:"City"`
	Neighborhood   string   `xml:"Neighborhood,omitempty"`
	Address        string   `xml:"Address,omitempty"`
	StreetNumber   string   `xml:"StreetNumber,omitempty"`
	Complement     string   `xml:"Complement,omitempty"`
	PostalCode     string   `xml:"PostalCode,omitempty"`
	Latitude       *float64 `xml:"Latitude,omitempty"`
	Longitude      *float64 `xml:"Longitude,omitempty"`
	DisplayAddress string   `xml:"DisplayAddress,omitempty"`
}

type vrSyncMedia struct {
	Items []vrSyncMediaItem `xml:"Item"`
}

type vrSyncMediaItem struct {
	Medium string `xml:"medium,attr"`
	Value  string `xml:",chardata"`
}

type vrSyncContactInfo struct {
	Name      string `xml:"Name,omitempty"`
	Email     string `xml:"Email,omitempty"`
	Telephone string `xml:"Telephone,omitempty"`
}

func buildVRSyncFeed(integration publicIntegration, items []feedListing) ([]byte, error) {
	feed := vrSyncFeed{
		XMLNS:    "http://www.vivareal.com/schemas/1.0/VRSync",
		XMLNSXSI: "http://www.w3.org/2001/XMLSchema-instance",
		Header: vrSyncHeader{
			Provider:    "Vimob CRM",
			Email:       textFromSettings(integration.Settings, "contact_email"),
			ContactName: textFromSettings(integration.Settings, "contact_name"),
			PublishDate: nowISO(),
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
	title := trimMax(firstPropertyText(property, "title"), 100)
	description := firstPropertyText(property, "descricao_site", "status_descritivo")
	if description == "" {
		description = title
	}
	transactionType := normalizeTransactionType(firstPropertyText(property, "tipo_de_negocio", "finalidade"))
	images := propertyImages(property)
	mediaItems := make([]vrSyncMediaItem, 0, len(images)+2)
	for _, image := range images {
		mediaItems = append(mediaItems, vrSyncMediaItem{Medium: "image", Value: image})
	}
	if video := firstPropertyText(property, "video_imovel"); isURL(video) {
		mediaItems = append(mediaItems, vrSyncMediaItem{Medium: "video", Value: video})
	}
	if tour := firstPropertyText(property, "tour_virtual"); isURL(tour) {
		mediaItems = append(mediaItems, vrSyncMediaItem{Medium: "virtualtour", Value: tour})
	}

	details := vrSyncDetails{
		PropertyType:              normalizePropertyType(firstPropertyText(property, "tipo_de_imovel")),
		Description:               html.UnescapeString(description),
		ListPrice:                 priceForSale(property, transactionType),
		RentalPrice:               priceForRent(property, transactionType),
		PropertyAdministrationFee: positiveFloatPointer(firstPropertyNumber(property, "condominio")),
		YearlyTax:                 positiveFloatPointer(firstPropertyNumber(property, "iptu", "valor_itr")),
		LivingArea:                positiveFloatPointer(firstPropertyNumber(property, "area_util")),
		LotArea:                   positiveFloatPointer(firstPropertyNumber(property, "area_total")),
		Bedrooms:                  positiveIntPointer(firstPropertyNumber(property, "quartos")),
		Bathrooms:                 positiveIntPointer(firstPropertyNumber(property, "banheiros")),
		Suites:                    positiveIntPointer(firstPropertyNumber(property, "suites")),
		Garage:                    positiveIntPointer(firstPropertyNumber(property, "vagas")),
		Features:                  propertyStringSlice(property, "detalhes_extras", "proximidades", "marcadores"),
	}
	location := vrSyncLocation{
		Country:        "BR",
		State:          strings.ToUpper(firstPropertyText(property, "uf")),
		City:           firstPropertyText(property, "cidade"),
		Neighborhood:   firstPropertyText(property, "bairro"),
		Address:        firstPropertyText(property, "endereco"),
		StreetNumber:   firstPropertyText(property, "numero"),
		Complement:     firstPropertyText(property, "complemento"),
		PostalCode:     onlyDigits(firstPropertyText(property, "cep")),
		Latitude:       coordinatePointer(firstPropertyNumber(property, "latitude")),
		Longitude:      coordinatePointer(firstPropertyNumber(property, "longitude")),
		DisplayAddress: normalizeDisplayAddress(firstPropertyText(property, "public_address_visibility", "address_visibility")),
	}
	contact := vrSyncContactInfo{
		Name:      textFromSettings(integration.Settings, "contact_name"),
		Email:     textFromSettings(integration.Settings, "contact_email"),
		Telephone: onlyDigits(textFromSettings(integration.Settings, "contact_phone")),
	}
	detailURL := textFromSettings(integration.Settings, "detail_base_url")
	if detailURL != "" {
		detailURL = strings.TrimRight(detailURL, "/") + "/" + url.PathEscape(firstPropertyText(property, "code"))
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
		Details:         details,
		Location:        location,
		Media:           media,
		ContactInfo:     contact,
	}, true
}

func validateFeedListing(item feedListing) []string {
	property := item.Property
	errors := []string{}
	title := firstPropertyText(property, "title")
	if len([]rune(title)) < 10 || len([]rune(title)) > 100 {
		errors = append(errors, "Titulo precisa ter entre 10 e 100 caracteres.")
	}
	if normalizeTransactionType(firstPropertyText(property, "tipo_de_negocio", "finalidade")) == "" {
		errors = append(errors, "Tipo de negocio e obrigatorio.")
	}
	if normalizePropertyType(firstPropertyText(property, "tipo_de_imovel")) == "" {
		errors = append(errors, "Tipo de imovel e obrigatorio.")
	}
	if firstPropertyText(property, "cidade") == "" || firstPropertyText(property, "uf") == "" {
		errors = append(errors, "Cidade e UF sao obrigatorios.")
	}
	if len(propertyImages(property)) == 0 {
		errors = append(errors, "Pelo menos uma foto e obrigatoria.")
	}
	transactionType := normalizeTransactionType(firstPropertyText(property, "tipo_de_negocio", "finalidade"))
	if transactionType == "For Sale" && priceForSale(property, transactionType) == nil {
		errors = append(errors, "Preco de venda e obrigatorio.")
	}
	if transactionType == "For Rent" && priceForRent(property, transactionType) == nil {
		errors = append(errors, "Valor de locacao e obrigatorio.")
	}
	return errors
}

func normalizeTransactionType(value string) string {
	normalized := normalizeText(value)
	switch {
	case strings.Contains(normalized, "venda") && strings.Contains(normalized, "locacao"):
		return "Sale/Rent"
	case strings.Contains(normalized, "venda") && strings.Contains(normalized, "aluguel"):
		return "Sale/Rent"
	case strings.Contains(normalized, "venda"):
		return "For Sale"
	case strings.Contains(normalized, "locacao"), strings.Contains(normalized, "aluguel"):
		return "For Rent"
	default:
		return ""
	}
}

func normalizePropertyType(value string) string {
	normalized := normalizeText(value)
	switch {
	case strings.Contains(normalized, "apart"):
		return "Residential / Apartment"
	case strings.Contains(normalized, "casa"), strings.Contains(normalized, "sobrado"):
		return "Residential / Home"
	case strings.Contains(normalized, "terreno"), strings.Contains(normalized, "lote"):
		return "Residential / Land Lot"
	case strings.Contains(normalized, "comercial"), strings.Contains(normalized, "sala"), strings.Contains(normalized, "loja"):
		return "Commercial / Business"
	case strings.Contains(normalized, "galpao"):
		return "Commercial / Industrial"
	case strings.Contains(normalized, "fazenda"), strings.Contains(normalized, "sitio"), strings.Contains(normalized, "chacara"):
		return "Rural / Farm Ranch"
	default:
		if strings.TrimSpace(value) == "" {
			return ""
		}
		return "Residential / Apartment"
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

func priceForSale(property map[string]any, transactionType string) *float64 {
	if transactionType != "For Sale" && transactionType != "Sale/Rent" {
		return nil
	}
	return positiveFloatPointer(firstPropertyNumber(property, "preco", "valor_venda_avaliado"))
}

func priceForRent(property map[string]any, transactionType string) *float64 {
	if transactionType != "For Rent" && transactionType != "Sale/Rent" {
		return nil
	}
	return positiveFloatPointer(firstPropertyNumber(property, "valor_locacao", "preco"))
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
	return err == nil && parsed.Scheme != "" && parsed.Host != ""
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
