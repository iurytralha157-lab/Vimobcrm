package publications

import (
	"encoding/json"
	"fmt"
	"html"
	"net/mail"
	"net/url"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/grupoolx"
)

type publicationSource struct {
	Property                map[string]any
	UpdatedAt               time.Time
	Status                  string
	OwnerPresent            bool
	ResponsiblePresent      bool
	Offers                  []sourceOffer
	Assets                  []sourceAsset
	SiteActive              bool
	SiteModuleActive        bool
	SitePublicURL           string
	GrupoOLXIntegrationID   string
	GrupoOLXStatus          string
	GrupoOLXActive          bool
	GrupoOLXModuleActive    bool
	GrupoOLXSettings        map[string]any
	GrupoOLXClientListingID string
	GrupoOLXPublicationType string
	GrupoOLXPublicURL       string
}

type sourceOffer struct {
	OfferType   string
	Status      string
	Price       float64
	Currency    string
	PricePeriod string
}

type sourceAsset struct {
	ID             string
	AssetType      string
	Visibility     string
	StoragePath    string
	ExternalURL    string
	SortOrder      int
	IsPrimary      bool
	MIMEType       string
	FileName       string
	FileSizeBytes  *int64
	ChecksumSHA256 string
}

func evaluatePublicationReadiness(scope publicationScope, source publicationSource) ([]Check, int, string) {
	switch scope.Channel {
	case SiteChannel:
		return evaluateSiteReadiness(source)
	case GrupoOLXChannel:
		return evaluateGrupoOLXReadiness(source)
	default:
		checks := []Check{publicationCheck("channel", "Canal suportado", "error", false, "O canal de publicação não é suportado.")}
		return checks, 0, ReadinessBlocked
	}
}

func evaluateSiteReadiness(source publicationSource) ([]Check, int, string) {
	property := source.Property
	activeOffer := false
	for _, offer := range source.Offers {
		if offer.Status == "active" && offer.Price > 0 {
			activeOffer = true
			break
		}
	}
	if !activeOffer {
		activeOffer = positiveNumber(property["valor_venda"]) || positiveNumber(property["valor_aluguel"])
	}
	compatiblePurpose := hasCompatiblePurpose(property, source.Offers)
	publicPhoto := len(publicAssetPhotos(source.Assets)) > 0
	if !hasPropertyAssetPhoto(source.Assets) {
		publicPhoto = len(stringSlice(property["fotos"])) > 0 || text(property["imagem_principal"]) != ""
	}

	checks := []Check{
		publicationCheck("site_active", "Site ativo", "error", source.SiteActive, "Ative e configure o site da organização."),
		publicationCheck("title", "Título comercial informado", "error", text(property["titulo"]) != "", "Informe um título comercial."),
		publicationCheck("type", "Tipo do imóvel definido", "error", text(property["tipo_imovel"]) != "", "Defina o tipo do imóvel."),
		publicationCheck("location", "Bairro, cidade e UF informados", "error", text(property["bairro"]) != "" && text(property["cidade"]) != "" && text(property["estado"]) != "", "Informe bairro, cidade e UF."),
		publicationCheck("description", "Descrição pública informada", "error", text(property["descricao"]) != "", "Informe a descrição do site."),
		publicationCheck("offer", "Oferta ativa com valor válido", "error", activeOffer, "Ative uma oferta de venda ou locação com valor positivo."),
		publicationCheck("purpose", "Finalidade compatível com a oferta", "error", compatiblePurpose, "Defina venda ou locação de acordo com a oferta ativa."),
		publicationCheck("photo", "Ao menos uma foto pública", "error", publicPhoto, "Adicione uma foto pública ao imóvel."),
		publicationCheck("owner", "Proprietário vinculado", "warning", source.OwnerPresent, "Vincule um proprietário atual para completar a operação interna."),
		publicationCheck("responsible", "Corretor responsável definido", "warning", source.ResponsiblePresent, "Defina o corretor responsável para completar a operação interna."),
		publicationCheck("status", "Imóvel disponível para divulgação", "error", normalizedASCII(source.Status) == "active" || normalizedASCII(source.Status) == "ativo" || normalizedASCII(source.Status) == "disponivel", "Altere o imóvel para ativo."),
	}

	resolved := 0
	blocking := false
	for _, check := range checks {
		if check.Resolved {
			resolved++
		} else if check.Severity == "error" {
			blocking = true
		}
	}
	score := resolved * 100 / len(checks)
	state := ReadinessReady
	if blocking {
		state = ReadinessBlocked
	}
	return checks, score, state
}

func evaluateGrupoOLXReadiness(source publicationSource) ([]Check, int, string) {
	property := source.Property
	title := text(property["titulo"])
	description := text(property["descricao"])
	transactionType := grupoOLXTransactionType(property, source.Offers)
	propertyType := grupoOLXPropertyType(text(property["tipo_imovel"]))
	photos := publicAssetPhotos(source.Assets)
	// Canonical Grupo OLX publications must carry immutable media proof in their
	// version payload. Historical property.fotos URLs are accepted only by the
	// explicitly legacy feed path; allowing them here made publish readiness say
	// "ready" while the canonical feed adapter correctly omitted the listing.
	photoPresent := len(photos) > 0
	jpegCompatible := photoPresent
	withinSizeLimit := true
	serverVerified := photoPresent
	for _, asset := range photos {
		if strings.TrimSpace(asset.StoragePath) == "" {
			serverVerified = false
		}
		if !grupoOLXJPEGAsset(asset) {
			jpegCompatible = false
		}
		if asset.FileSizeBytes == nil || *asset.FileSizeBytes <= 0 || *asset.FileSizeBytes > 7*1024*1024 {
			withinSizeLimit = false
		}
	}
	contactName := grupoOLXSettingText(source.GrupoOLXSettings, "contact_name")
	contactEmail := grupoOLXSettingText(source.GrupoOLXSettings, "contact_email")
	contactValid := contactName != "" && validPublicationEmail(contactEmail)
	clientListingID := strings.TrimSpace(source.GrupoOLXClientListingID)
	publicationType := normalizeGrupoOLXPublicationType(source.GrupoOLXPublicationType)
	locationValid := text(property["bairro"]) != "" && text(property["cidade"]) != "" && len(text(property["estado"])) == 2
	postalCodeValid := len(onlyDigitsPublication(text(property["cep"]))) == 8
	addressVisibility := text(property["address_visibility"])
	if addressVisibility == "" {
		addressVisibility = text(property["public_address_visibility"])
	}
	addressVisibilityValid := !grupoOLXMinimumAddressVisibility(addressVisibility)
	status := normalizedASCII(source.Status)
	statusValid := status == "active" || status == "available" || status == "ativo" || status == "disponivel"
	salePrice := grupoOLXSalePrice(property, source.Offers)
	rentPrice := grupoOLXRentPrice(property, source.Offers)
	priceValid := (transactionType == "For Sale" && salePrice > 0) ||
		(transactionType == "For Rent" && rentPrice > 0) ||
		(transactionType == "Sale/Rent" && salePrice > 0 && rentPrice > 0)
	area := number(property["area_construida"])
	if grupoOLXRequiresLotArea(propertyType) {
		area = number(property["area_total"])
	}
	roomRequirements := grupoolx.RoomRequirementsFor(propertyType)
	bedroomsValid := roomRequirements.MinimumBedrooms == 0 || number(property["quartos"]) >= float64(roomRequirements.MinimumBedrooms)
	bathroomsValid := roomRequirements.MinimumBathrooms == 0 || number(property["banheiros"]) >= float64(roomRequirements.MinimumBathrooms)

	checks := []Check{
		publicationCheck("grupo_olx_integration", "Integração Grupo OLX configurada", "error", source.GrupoOLXIntegrationID != "", "Configure a integração do Grupo OLX."),
		publicationCheck("grupo_olx_active", "Integração Grupo OLX ativa", "error", source.GrupoOLXActive && normalizedASCII(source.GrupoOLXStatus) != "paused", "Ative a integração do Grupo OLX."),
		publicationCheck("grupo_olx_module", "Módulo de portais ativo", "error", source.GrupoOLXModuleActive, "Ative o módulo de portais para a organização."),
		publicationCheck("grupo_olx_contact", "Contato do anunciante válido", "error", contactValid, "Informe nome e e-mail válidos para o contato do Grupo OLX."),
		publicationCheck("grupo_olx_listing_id", "ListingID válido", "error", validGrupoOLXListingID(clientListingID), "Informe um ListingID com 1 a 50 caracteres."),
		publicationCheck("grupo_olx_product", "Produto de publicação válido", "error", validGrupoOLXPublicationType(publicationType), "Selecione um produto de publicação aceito pelo Grupo OLX."),
		publicationCheck("grupo_olx_title", "Título entre 10 e 100 caracteres, sem HTML", "error", runeLengthBetween(title, 10, 100) && !publicationTitleHasMarkup(title), "Informe um título entre 10 e 100 caracteres, sem HTML."),
		publicationCheck("grupo_olx_description", "Descrição entre 50 e 3000 caracteres, sem HTML não suportado", "error", runeLengthBetween(description, 50, 3000) && !publicationDescriptionHasDisallowedMarkup(description), "Informe uma descrição pública entre 50 e 3000 caracteres; use apenas entidades de b, i e br para formatar."),
		publicationCheck("grupo_olx_transaction", "Tipo de transação compatível", "error", transactionType != "", "Defina venda, locação ou venda/locação."),
		publicationCheck("grupo_olx_property_type", "Tipo de imóvel compatível", "error", propertyType != "", "Defina um tipo de imóvel aceito pelo VRSync."),
		publicationCheck("grupo_olx_status", "Imóvel disponível", "error", statusValid, "Altere o imóvel para ativo ou disponível."),
		publicationCheck("grupo_olx_location", "Bairro, cidade e UF informados", "error", locationValid, "Informe bairro, cidade e UF."),
		publicationCheck("grupo_olx_postal_code", "CEP com 8 dígitos", "error", postalCodeValid, "Informe um CEP válido com 8 dígitos."),
		publicationCheck("grupo_olx_address_visibility", "Privacidade de endereço compatível", "error", addressVisibilityValid, "O Grupo OLX exige bairro e CEP; selecione endereço parcial ou completo."),
		publicationCheck("grupo_olx_price", "Preço compatível com a transação", "error", priceValid, "Informe os preços exigidos para a transação."),
		publicationCheck("grupo_olx_area", "Área obrigatória informada", "error", area > 0, "Informe a área exigida para este tipo de imóvel."),
		publicationCheck("grupo_olx_bedrooms", "Quartos obrigatórios informados", "error", bedroomsValid, "Informe ao menos um quarto para este tipo de imóvel."),
		publicationCheck("grupo_olx_bathrooms", "Banheiros obrigatórios informados", "error", bathroomsValid, "Informe ao menos um banheiro para este tipo de imóvel."),
		publicationCheck("grupo_olx_photo", "Ao menos uma foto pública", "error", photoPresent, "Adicione ao menos uma foto pública."),
		publicationCheck("grupo_olx_photo_verified", "Fotos verificadas pelo servidor", "error", serverVerified, "Envie a foto ao armazenamento do Vimob para verificar formato e tamanho."),
		publicationCheck("grupo_olx_photo_jpeg", "Fotos em JPEG", "error", jpegCompatible, "Use apenas imagens JPG/JPEG no feed do Grupo OLX."),
		publicationCheck("grupo_olx_photo_size", "Fotos com até 7 MB", "error", withinSizeLimit, "Cada foto deve ter no máximo 7 MB."),
	}

	resolved := 0
	blocked := false
	for _, check := range checks {
		if check.Resolved {
			resolved++
		} else if check.Severity == "error" {
			blocked = true
		}
	}
	state := ReadinessReady
	if blocked {
		state = ReadinessBlocked
	}
	return checks, resolved * 100 / len(checks), state
}

func grupoOLXMinimumAddressVisibility(value string) bool {
	switch normalizedASCII(value) {
	case "minimo", "minimum", "city", "cidade":
		return true
	default:
		return false
	}
}

var allowedPublicationDescriptionTag = regexp.MustCompile(`(?i)</?(?:b|i)>|<br\s*/?>`)

func publicationTitleHasMarkup(value string) bool {
	return strings.ContainsAny(html.UnescapeString(value), "<>")
}

func publicationDescriptionHasDisallowedMarkup(value string) bool {
	if strings.ContainsAny(value, "<>") {
		return true
	}
	decoded := html.UnescapeString(value)
	withoutAllowedTags := allowedPublicationDescriptionTag.ReplaceAllString(decoded, "")
	return strings.ContainsAny(withoutAllowedTags, "<>")
}

func publicationCheck(code string, label string, severity string, resolved bool, unresolvedMessage string) Check {
	check := Check{Code: code, Label: label, Severity: severity, Resolved: resolved}
	if !resolved {
		check.Message = stringPointer(unresolvedMessage)
	}
	return check
}

func hasCompatiblePurpose(property map[string]any, offers []sourceOffer) bool {
	purpose := normalizedASCII(text(property["finalidade"]))
	wantsSale := strings.Contains(purpose, "venda") || strings.Contains(purpose, "sale")
	wantsRent := strings.Contains(purpose, "locacao") || strings.Contains(purpose, "aluguel") || strings.Contains(purpose, "rent") || strings.Contains(purpose, "temporada")
	if !wantsSale && !wantsRent {
		return false
	}
	hasSale := positiveNumber(property["valor_venda"])
	hasRent := positiveNumber(property["valor_aluguel"])
	for _, offer := range offers {
		if offer.Status != "active" || offer.Price <= 0 {
			continue
		}
		switch offer.OfferType {
		case "sale":
			hasSale = true
		case "rent", "seasonal":
			hasRent = true
		}
	}
	return (wantsSale && hasSale) || (wantsRent && hasRent)
}

func unresolvedChecks(checks []Check) []Check {
	result := make([]Check, 0, len(checks))
	for _, check := range checks {
		if !check.Resolved {
			result = append(result, check)
		}
	}
	return result
}

func buildSiteSnapshot(source publicationSource, publicBaseURL string, publicationID string, version int64) siteSnapshot {
	property := sanitizePublicProperty(source.Property)
	return buildSnapshotProjection(source, property, publicBaseURL, publicationID, version, source.SitePublicURL)
}

func buildSnapshotProjection(
	source publicationSource,
	property map[string]any,
	publicBaseURL string,
	publicationID string,
	version int64,
	publicURL string,
) siteSnapshot {
	applyCanonicalOffers(property, source.Offers)

	media := make([]snapshotMedia, 0)
	images := make([]string, 0)
	seen := map[string]bool{}
	for position, asset := range publicAssetPhotos(source.Assets) {
		stableURL := stableMediaURL(publicBaseURL, publicationID, version, asset.ID)
		if stableURL == "" || seen[stableURL] {
			continue
		}
		seen[stableURL] = true
		images = append(images, stableURL)
		media = append(media, snapshotMedia{
			AssetID: asset.ID, URL: stableURL, Kind: "photo", Primary: position == 0, Position: position,
			SourceHash: assetSourceHash(asset.ChecksumSHA256, asset.StoragePath, asset.ExternalURL),
			MIMEType:   strings.ToLower(strings.TrimSpace(asset.MIMEType)), FileSizeBytes: asset.FileSizeBytes,
			ServerVerified: strings.TrimSpace(asset.StoragePath) != "",
		})
	}
	if !hasPropertyAssetPhoto(source.Assets) {
		for _, legacyURL := range legacyPropertyImages(property) {
			if seen[legacyURL] {
				continue
			}
			seen[legacyURL] = true
			images = append(images, legacyURL)
		}
	}
	property["fotos"] = images
	if len(images) > 0 {
		property["imagem_principal"] = images[0]
	} else {
		property["imagem_principal"] = nil
	}

	preview := buildPreview(property, publicURL)
	return siteSnapshot{Property: property, Preview: preview, Media: media}
}

func buildGrupoOLXSnapshot(source publicationSource, publicBaseURL string, publicationID string, version int64) grupoOLXSnapshot {
	base := buildSnapshotProjection(
		source,
		sanitizeGrupoOLXProperty(source.Property),
		publicBaseURL,
		publicationID,
		version,
		source.GrupoOLXPublicURL,
	)
	// Never freeze legacy URLs into a canonical Grupo OLX version. Every photo
	// exported by this path must have a matching snapshotMedia MIME/size proof.
	if len(base.Media) == 0 {
		base.Property["fotos"] = []string{}
		base.Property["imagem_principal"] = nil
	}
	switch grupoOLXTransactionType(base.Property, source.Offers) {
	case "For Sale":
		base.Property["finalidade"] = "venda"
	case "For Rent":
		base.Property["finalidade"] = "locacao"
	case "Sale/Rent":
		base.Property["finalidade"] = "venda e locacao"
	}
	return grupoOLXSnapshot{
		Property: base.Property,
		Preview:  base.Preview,
		Media:    base.Media,
		ChannelConfig: grupoOLXChannelConfig{
			ClientListingID: strings.TrimSpace(source.GrupoOLXClientListingID),
			PublicationType: normalizeGrupoOLXPublicationType(source.GrupoOLXPublicationType),
		},
	}
}

func buildPublicationSnapshot(scope publicationScope, source publicationSource, publicBaseURL string, publicationID string, version int64) any {
	if scope.Channel == GrupoOLXChannel {
		return buildGrupoOLXSnapshot(source, publicBaseURL, publicationID, version)
	}
	return buildSiteSnapshot(source, publicBaseURL, publicationID, version)
}

func sanitizePublicProperty(source map[string]any) map[string]any {
	allowed := map[string]struct{}{
		"id": {}, "codigo": {}, "titulo": {}, "descricao": {}, "tipo_imovel": {}, "finalidade": {},
		"valor_venda": {}, "valor_aluguel": {}, "valor_condominio": {}, "iptu": {}, "iptu_period": {}, "taxa_de_servico": {},
		"valor_itr": {}, "seguro_incendio": {}, "valor_venda_avaliado": {}, "valor_locacao_avaliado": {},
		"quartos": {}, "suites": {}, "banheiros": {}, "vagas": {}, "area_total": {}, "area_construida": {},
		"andar": {}, "bairro": {}, "cidade": {}, "estado": {}, "imagem_principal": {}, "fotos": {},
		"detalhes_extras": {}, "proximidades": {}, "video_imovel": {}, "tour_virtual": {},
		"aceita_financiamento": {}, "aceita_permuta": {}, "usou_fgts": {}, "exclusividade": {},
		"destaque": {}, "status": {}, "mobiliado": {},
	}
	result := make(map[string]any, len(allowed))
	for key := range allowed {
		if value, exists := source[key]; exists {
			result[key] = value
		}
	}
	switch normalizedASCII(text(result["iptu_period"])) {
	case "anual", "annual", "yearly":
		result["iptu_period"] = "anual"
	default:
		result["iptu_period"] = "mensal"
	}
	visibility := normalizePublicAddressVisibility(text(source["public_address_visibility"]))
	result["public_address_visibility"] = visibility
	// The site publication snapshot contains only the address granularity the
	// owner selected. Exact fields never survive partial/minimum snapshots.
	result["cidade"] = source["cidade"]
	result["estado"] = source["estado"]
	if visibility != "minimo" {
		result["bairro"] = source["bairro"]
	} else {
		delete(result, "bairro")
	}
	if visibility == "completo" {
		for _, key := range []string{"pais", "endereco", "numero", "complemento", "cep", "latitude", "longitude"} {
			if value, exists := source[key]; exists {
				result[key] = value
			}
		}
	}
	return result
}

func normalizePublicAddressVisibility(value string) string {
	switch normalizedASCII(value) {
	case "completo", "complete", "full":
		return "completo"
	case "minimo", "minimum", "city", "cidade":
		return "minimo"
	default:
		return "parcial"
	}
}

func sanitizeGrupoOLXProperty(source map[string]any) map[string]any {
	result := sanitizePublicProperty(source)
	for _, key := range []string{
		"pais", "endereco", "numero", "complemento", "cep",
		"latitude", "longitude", "public_address_visibility",
	} {
		if value, exists := source[key]; exists {
			result[key] = value
		}
	}
	return result
}

func assetSourceHash(checksumSHA256 string, storagePath string, externalURL string) string {
	checksumSHA256 = strings.ToLower(strings.TrimSpace(checksumSHA256))
	if len(checksumSHA256) == 64 {
		return checksumSHA256
	}
	source := ""
	if storagePath = strings.Trim(strings.TrimSpace(storagePath), "/"); storagePath != "" {
		source = "storage:" + storagePath
	} else if externalURL = strings.TrimSpace(externalURL); externalURL != "" {
		source = "external:" + externalURL
	}
	return payloadHash([]byte(source))
}

func siteSnapshotHash(snapshot siteSnapshot) (string, error) {
	return publicationSnapshotHash(snapshot)
}

func publicationSnapshotHash(snapshot any) (string, error) {
	payload, err := json.Marshal(snapshot)
	if err != nil {
		return "", err
	}
	return payloadHash(payload), nil
}

func propertyPublicURL(appURL string, customDomain string, subdomain string, code string) string {
	code = strings.TrimSpace(code)
	if code == "" {
		return ""
	}
	if customDomain = strings.TrimSpace(customDomain); customDomain != "" {
		return "https://" + strings.TrimRight(customDomain, "/") + "/imovel/" + url.PathEscape(code)
	}
	appURL = strings.TrimRight(strings.TrimSpace(appURL), "/")
	subdomain = strings.TrimSpace(subdomain)
	if appURL == "" || subdomain == "" {
		return ""
	}
	return appURL + "/sites/" + url.PathEscape(subdomain) + "/imovel/" + url.PathEscape(code)
}

func grupoOLXPropertyPublicURL(settings map[string]any, code string) string {
	baseURL := strings.TrimRight(grupoOLXSettingText(settings, "detail_base_url"), "/")
	code = strings.TrimSpace(code)
	if baseURL == "" || code == "" {
		return ""
	}
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return ""
	}
	return baseURL + "/" + url.PathEscape(code)
}

func buildPreview(property map[string]any, publicURL string) Preview {
	preview := Preview{
		Title:           stringPointer(truncatePublicationRunes(text(property["titulo"]), 4000)),
		Description:     stringPointer(truncatePublicationRunes(text(property["descricao"]), 10000)),
		Address:         stringPointer(truncatePublicationRunes(joinNonEmpty(", ", text(property["bairro"]), text(property["cidade"]), text(property["estado"])), 1000)),
		ImageURLs:       stringSlice(property["fotos"]),
		PrimaryImageURL: stringPointer(text(property["imagem_principal"])),
		Bedrooms:        intPointer(property["quartos"]),
		Bathrooms:       intPointer(property["banheiros"]),
		ParkingSpaces:   intPointer(property["vagas"]),
		Area:            numberPointer(firstNonZero(property["area_construida"], property["area_total"])),
		PublicURL:       stringPointer(publicURL),
	}
	if price := firstNonZero(property["valor_venda"], property["valor_aluguel"]); price > 0 {
		preview.Price = &price
		label := "Venda"
		if !positiveNumber(property["valor_venda"]) && positiveNumber(property["valor_aluguel"]) {
			label = "Locação"
		}
		preview.PriceLabel = &label
	}
	return preview
}

func truncatePublicationRunes(value string, maximum int) string {
	value = strings.TrimSpace(value)
	if maximum < 1 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= maximum {
		return value
	}
	return strings.TrimSpace(string(runes[:maximum]))
}

func applyCanonicalOffers(property map[string]any, offers []sourceOffer) {
	var rentOffer *sourceOffer
	var seasonalOffer *sourceOffer
	for _, offer := range offers {
		if offer.Status != "active" || offer.Price <= 0 {
			continue
		}
		switch offer.OfferType {
		case "sale":
			property["valor_venda"] = offer.Price
		case "rent":
			selected := offer
			rentOffer = &selected
		case "seasonal":
			selected := offer
			seasonalOffer = &selected
		}
	}
	selected := rentOffer
	if selected == nil {
		selected = seasonalOffer
	}
	if selected == nil {
		return
	}
	property["valor_aluguel"] = selected.Price
	period := strings.TrimSpace(selected.PricePeriod)
	if period == "" && selected.OfferType == "seasonal" {
		period = "daily"
	}
	if period != "" {
		property["rental_period"] = period
	}
}

func publicAssetPhotos(assets []sourceAsset) []sourceAsset {
	photos := make([]sourceAsset, 0)
	for _, asset := range assets {
		if asset.AssetType == "photo" && asset.Visibility == "public" && asset.ID != "" && (asset.StoragePath != "" || asset.ExternalURL != "") {
			photos = append(photos, asset)
		}
	}
	sort.SliceStable(photos, func(i, j int) bool {
		if photos[i].IsPrimary != photos[j].IsPrimary {
			return photos[i].IsPrimary
		}
		if photos[i].SortOrder != photos[j].SortOrder {
			return photos[i].SortOrder < photos[j].SortOrder
		}
		return photos[i].ID < photos[j].ID
	})
	return photos
}

func hasPropertyAssetPhoto(assets []sourceAsset) bool {
	for _, asset := range assets {
		if asset.AssetType == "photo" {
			return true
		}
	}
	return false
}

func stableMediaURL(baseURL string, publicationID string, version int64, assetID string) string {
	publicationID, publicationOK := normalizeUUID(publicationID)
	assetID, assetOK := normalizeUUID(assetID)
	if !publicationOK || !assetOK || version < 1 {
		return ""
	}
	path := fmt.Sprintf("/v1/public/property-publications/%s/versions/%d/assets/%s", url.PathEscape(publicationID), version, url.PathEscape(assetID))
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return path
	}
	return baseURL + path
}

func legacyPropertyImages(property map[string]any) []string {
	values := append([]string{}, stringSlice(property["fotos"])...)
	if primary := text(property["imagem_principal"]); primary != "" {
		values = append([]string{primary}, values...)
	}
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		parsed, err := url.Parse(value)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func sitePublicPropertySQL(alias string) string {
	return `jsonb_build_object(
		'id', ` + alias + `.id::text,
		'codigo', coalesce(` + alias + `.code, ` + alias + `.id::text),
		'titulo', ` + alias + `.title,
		'descricao', coalesce(nullif(` + alias + `.descricao_site, ''), nullif(` + alias + `.descricao, '')),
		'tipo_imovel', ` + alias + `.tipo,
		'finalidade', ` + alias + `.finalidade,
		'valor_venda', ` + alias + `.preco,
		'valor_aluguel', ` + alias + `.valor_locacao,
		'valor_condominio', ` + alias + `.condominio,
		'iptu', ` + alias + `.iptu,
		'iptu_period', case lower(trim(coalesce(` + alias + `.metadata->>'iptu_period', '')))
			when 'mensal' then 'mensal'
			when 'monthly' then 'mensal'
			when 'anual' then 'anual'
			when 'annual' then 'anual'
			when 'yearly' then 'anual'
			else 'mensal'
		end,
		'taxa_de_servico', ` + alias + `.taxa_de_servico,
		'valor_itr', ` + alias + `.valor_itr,
		'seguro_incendio', ` + alias + `.seguro_incendio,
		'valor_venda_avaliado', ` + alias + `.valor_venda_avaliado,
		'valor_locacao_avaliado', ` + alias + `.valor_locacao_avaliado,
		'quartos', ` + alias + `.quartos,
		'suites', ` + alias + `.suites,
		'banheiros', ` + alias + `.banheiros,
		'vagas', ` + alias + `.vagas,
		'area_total', ` + alias + `.area_total,
		'area_construida', ` + alias + `.area_util,
		'andar', ` + alias + `.andar,
		'bairro', ` + alias + `.bairro,
		'cidade', ` + alias + `.cidade,
		'estado', ` + alias + `.uf,
		'pais', coalesce(nullif(` + alias + `.pais, ''), 'Brasil'),
		'endereco', ` + alias + `.endereco,
		'numero', ` + alias + `.numero,
		'complemento', ` + alias + `.complemento,
		'cep', ` + alias + `.cep,
		'latitude', ` + alias + `.latitude,
		'longitude', ` + alias + `.longitude,
		'public_address_visibility', case lower(trim(coalesce(
			nullif(` + alias + `.address_visibility, ''),
			nullif(` + alias + `.public_address_visibility, ''),
			'parcial'
		)))
			when 'completo' then 'completo'
			when 'complete' then 'completo'
			when 'full' then 'completo'
			when 'minimo' then 'minimo'
			when 'minimum' then 'minimo'
			when 'city' then 'minimo'
			when 'cidade' then 'minimo'
			else 'parcial'
		end,
		'imagem_principal', nullif(` + alias + `.imagem_principal, ''),
		'fotos', to_jsonb(coalesce(` + alias + `.image_urls, '{}'::text[])),
		'detalhes_extras', to_jsonb(coalesce(` + alias + `.detalhes_extras, '{}'::text[])),
		'proximidades', to_jsonb(coalesce(` + alias + `.proximidades, '{}'::text[])),
		'video_imovel', ` + alias + `.video_imovel,
		'tour_virtual', ` + alias + `.tour_virtual,
		'aceita_financiamento', ` + alias + `.aceita_financiamento,
		'aceita_permuta', ` + alias + `.aceita_permuta,
		'usou_fgts', ` + alias + `.usou_fgts,
		'exclusividade', ` + alias + `.exclusividade,
		'destaque', ` + alias + `.is_featured,
		'status', ` + alias + `.status,
		'mobiliado', ` + alias + `.mobiliado
	)`
}

func grupoOLXSettingText(settings map[string]any, key string) string {
	if settings == nil {
		return ""
	}
	return text(settings[key])
}

func validPublicationEmail(value string) bool {
	value = strings.TrimSpace(value)
	address, err := mail.ParseAddress(value)
	return err == nil && strings.EqualFold(strings.TrimSpace(address.Address), value)
}

func runeLengthBetween(value string, minimum int, maximum int) bool {
	length := len([]rune(strings.TrimSpace(value)))
	return length >= minimum && length <= maximum
}

func validGrupoOLXListingID(value string) bool {
	value = strings.TrimSpace(value)
	length := len([]rune(value))
	return length >= 1 && length <= 50
}

func normalizeGrupoOLXListingID(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		value = strings.TrimSpace(fallback)
	}
	value = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			return r
		}
		return '-'
	}, value)
	value = strings.Trim(value, "-_")
	if value == "" {
		value = strings.ReplaceAll(strings.TrimSpace(fallback), "-", "")
	}
	if runes := []rune(value); len(runes) > 50 {
		value = string(runes[:50])
	}
	return value
}

func normalizeGrupoOLXPublicationType(value string) string {
	value = strings.ToUpper(strings.TrimSpace(value))
	if value == "" {
		return "STANDARD"
	}
	return value
}

func validGrupoOLXPublicationType(value string) bool {
	switch normalizeGrupoOLXPublicationType(value) {
	case "STANDARD", "PREMIUM", "SUPER_PREMIUM", "PREMIERE_1", "PREMIERE_2", "TRIPLE":
		return true
	default:
		return false
	}
}

func grupoOLXTransactionType(property map[string]any, offers []sourceOffer) string {
	purpose := normalizedASCII(text(property["finalidade"]))
	hasSale := strings.Contains(purpose, "venda") || strings.Contains(purpose, "sale")
	hasRent := strings.Contains(purpose, "locacao") || strings.Contains(purpose, "aluguel") || strings.Contains(purpose, "rent")
	for _, offer := range offers {
		if offer.Status != "active" || offer.Price <= 0 {
			continue
		}
		hasSale = hasSale || offer.OfferType == "sale"
		hasRent = hasRent || offer.OfferType == "rent" || offer.OfferType == "seasonal"
	}
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

func grupoOLXPropertyType(value string) string {
	return grupoolx.NormalizePropertyType(value)
}

func legacyGrupoOLXPropertyType(value string) string {
	normalized := normalizedASCII(value)
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

func grupoOLXRequiresLotArea(propertyType string) bool {
	return grupoolx.RequiresLotArea(propertyType)
}

func legacyGrupoOLXRequiresLotArea(propertyType string) bool {
	return strings.Contains(propertyType, "Land Lot") || strings.Contains(propertyType, "Farm Ranch") || strings.Contains(propertyType, "Industrial")
}

func grupoOLXSalePrice(property map[string]any, offers []sourceOffer) float64 {
	value := number(property["valor_venda"])
	for _, offer := range offers {
		if offer.Status == "active" && offer.OfferType == "sale" && offer.Price > 0 {
			value = offer.Price
		}
	}
	return value
}

func grupoOLXRentPrice(property map[string]any, offers []sourceOffer) float64 {
	value := number(property["valor_aluguel"])
	seasonal := float64(0)
	for _, offer := range offers {
		if offer.Status != "active" || offer.Price <= 0 {
			continue
		}
		if offer.OfferType == "rent" {
			return offer.Price
		}
		if offer.OfferType == "seasonal" {
			seasonal = offer.Price
		}
	}
	if seasonal > 0 {
		return seasonal
	}
	return value
}

func grupoOLXJPEGAsset(asset sourceAsset) bool {
	return strings.EqualFold(strings.TrimSpace(asset.MIMEType), "image/jpeg") ||
		strings.EqualFold(strings.TrimSpace(asset.MIMEType), "image/jpg")
}

func grupoOLXJPEGURL(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	parsed, err := url.Parse(value)
	if err == nil && parsed.Path != "" {
		value = parsed.Path
	}
	extension := strings.ToLower(path.Ext(value))
	return extension == ".jpg" || extension == ".jpeg"
}

func onlyDigitsPublication(value string) string {
	var builder strings.Builder
	for _, r := range value {
		if r >= '0' && r <= '9' {
			builder.WriteRune(r)
		}
	}
	return builder.String()
}

func text(value any) string {
	if value == nil {
		return ""
	}
	if typed, ok := value.(string); ok {
		return strings.TrimSpace(typed)
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func positiveNumber(value any) bool { return number(value) > 0 }

func number(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case jsonNumber:
		parsed, _ := strconv.ParseFloat(string(typed), 64)
		return parsed
	case string:
		parsed, _ := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return parsed
	default:
		return 0
	}
}

// jsonNumber is intentionally local so projection helpers stay testable without
// making callers depend on encoding/json concrete values.
type jsonNumber string

func firstNonZero(values ...any) float64 {
	for _, value := range values {
		if parsed := number(value); parsed > 0 {
			return parsed
		}
	}
	return 0
}

func stringSlice(value any) []string {
	result := []string{}
	switch typed := value.(type) {
	case []string:
		result = append(result, typed...)
	case []any:
		for _, item := range typed {
			if value := text(item); value != "" {
				result = append(result, value)
			}
		}
	case string:
		if strings.TrimSpace(typed) != "" {
			result = append(result, strings.TrimSpace(typed))
		}
	}
	return result
}

func intPointer(value any) *int {
	parsed := int(number(value))
	if parsed <= 0 {
		return nil
	}
	return &parsed
}

func numberPointer(value float64) *float64 {
	if value <= 0 {
		return nil
	}
	return &value
}

func joinNonEmpty(separator string, values ...string) string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			result = append(result, value)
		}
	}
	return strings.Join(result, separator)
}

func normalizedASCII(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	replacer := strings.NewReplacer(
		"á", "a", "à", "a", "â", "a", "ã", "a", "ä", "a",
		"é", "e", "è", "e", "ê", "e", "ë", "e",
		"í", "i", "ì", "i", "î", "i", "ï", "i",
		"ó", "o", "ò", "o", "ô", "o", "õ", "o", "ö", "o",
		"ú", "u", "ù", "u", "û", "u", "ü", "u", "ç", "c",
	)
	return replacer.Replace(value)
}
