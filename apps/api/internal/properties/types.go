package properties

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/numericinput"
)

const (
	defaultLimit = 50
	maxLimit     = 1000
)

var (
	ErrInvalidInput           = errors.New("invalid property input")
	ErrPropertyNotFound       = errors.New("property not found")
	ErrPropertyHasLinkedLeads = errors.New("property has linked leads")
	ErrNoChanges              = errors.New("no property changes provided")
)

type Property map[string]any

type ListResponse struct {
	Data   []Property `json:"data"`
	Total  int64      `json:"total"`
	Limit  int        `json:"limit"`
	Offset int        `json:"offset"`
}

type StatsResponse struct {
	Total     int64 `json:"total"`
	Sale      int64 `json:"sale"`
	Rental    int64 `json:"rental"`
	Available int64 `json:"available"`
	Reserved  int64 `json:"reserved"`
	Sold      int64 `json:"sold"`
	Rented    int64 `json:"rented"`
	Private   int64 `json:"private"`
}

type HistoryEvent struct {
	ID        string         `json:"id"`
	Type      string         `json:"type"`
	Title     string         `json:"title"`
	Metadata  map[string]any `json:"metadata"`
	CreatedAt string         `json:"created_at"`
}

type propertyRequest map[string]any

type ListFilter struct {
	Limit            int
	Offset           int
	Scope            string
	Search           string
	Status           string
	DealType         string
	PropertyType     string
	City             string
	Neighborhood     string
	ResponsibleID    string
	BedroomsMin      int
	SuitesMin        int
	BathroomsMin     int
	PriceMin         float64
	PriceMax         float64
	AcceptsExchange  *bool
	AcceptsFinancing *bool
	PublishedOnSite  *bool
	OwnerID          string
	CondominiumID    string
	Furniture        string
	Exclusive        *bool
	HasSign          *bool
	Featured         *bool
	ParkingSpacesMin int
	UsableAreaMin    float64
	UsableAreaMax    float64
	TotalAreaMin     float64
	TotalAreaMax     float64
}

type fieldKind string

const (
	fieldText      fieldKind = "text"
	fieldBool      fieldKind = "bool"
	fieldInt       fieldKind = "int"
	fieldNumeric   fieldKind = "numeric"
	fieldUUID      fieldKind = "uuid"
	fieldDate      fieldKind = "date"
	fieldJSON      fieldKind = "json"
	fieldTextArray fieldKind = "text_array"
	fieldDealType  fieldKind = "deal_type"
	fieldStatus    fieldKind = "status"
)

type fieldDef struct {
	column string
	kind   fieldKind
}

var writableFields = map[string]fieldDef{
	"aceita_financiamento":       {column: "aceita_financiamento", kind: fieldBool},
	"aceita_permuta":             {column: "aceita_permuta", kind: fieldBool},
	"andar":                      {column: "andar", kind: fieldInt},
	"ano_construcao":             {column: "ano_construcao", kind: fieldInt},
	"ano_reforma":                {column: "ano_reforma", kind: fieldInt},
	"anunciar":                   {column: "published_on_site", kind: fieldBool},
	"aprovacao_ambiental":        {column: "aprovacao_ambiental", kind: fieldText},
	"area_total":                 {column: "area_total", kind: fieldNumeric},
	"area_util":                  {column: "area_util", kind: fieldNumeric},
	"arquivos":                   {column: "documents", kind: fieldJSON},
	"autorizado_comercializacao": {column: "autorizado_comercializacao", kind: fieldBool},
	"bairro":                     {column: "bairro", kind: fieldText},
	"banheiros":                  {column: "banheiros", kind: fieldInt},
	"cadastrado_por":             {column: "responsible_user_id", kind: fieldUUID},
	"cep":                        {column: "cep", kind: fieldText},
	"cidade":                     {column: "cidade", kind: fieldText},
	"city_id":                    {column: "city_id", kind: fieldUUID},
	"code":                       {column: "code", kind: fieldText},
	"codigo_agua":                {column: "codigo_agua", kind: fieldText},
	"codigo_eletricidade":        {column: "codigo_eletricidade", kind: fieldText},
	"codigo_iptu":                {column: "codigo_iptu", kind: fieldText},
	"comentarios_internos":       {column: "comentarios_internos", kind: fieldText},
	"comissao_locacao":           {column: "comissao_locacao", kind: fieldNumeric},
	"comissao_venda":             {column: "comissao_venda", kind: fieldNumeric},
	"commission_percentage":      {column: "commission_percentage", kind: fieldNumeric},
	"complemento":                {column: "complemento", kind: fieldText},
	"condicao_comercial":         {column: "condicao_comercial", kind: fieldText},
	"condicao_pagamento":         {column: "condicao_pagamento", kind: fieldText},
	"condominio":                 {column: "condominio", kind: fieldNumeric},
	"condominium_id":             {column: "condominium_id", kind: fieldUUID},
	"corretor_id":                {column: "corretor_id", kind: fieldUUID},
	"created_by":                 {column: "created_by", kind: fieldUUID},
	"data_inicio_comissao":       {column: "data_inicio_comissao", kind: fieldDate},
	"descricao":                  {column: "descricao", kind: fieldText},
	"descricao_site":             {column: "descricao_site", kind: fieldText},
	"destaque":                   {column: "is_featured", kind: fieldBool},
	"detalhes_extras":            {column: "detalhes_extras", kind: fieldTextArray},
	"documents":                  {column: "documents", kind: fieldJSON},
	"endereco":                   {column: "endereco", kind: fieldText},
	"exclusividade":              {column: "exclusividade", kind: fieldBool},
	"external_id":                {column: "external_id", kind: fieldText},
	"external_provider":          {column: "external_provider", kind: fieldText},
	"faixa_valor_imovel":         {column: "faixa_valor_imovel", kind: fieldText},
	"fotos":                      {column: "image_urls", kind: fieldTextArray},
	"finalidade":                 {column: "finalidade_uso", kind: fieldText},
	"image_urls":                 {column: "image_urls", kind: fieldTextArray},
	"imagem_principal":           {column: "imagem_principal", kind: fieldText},
	"imoview_codigo":             {column: "imoview_codigo", kind: fieldText},
	"iptu":                       {column: "iptu", kind: fieldNumeric},
	"is_featured":                {column: "is_featured", kind: fieldBool},
	"is_demo":                    {column: "is_demo", kind: fieldBool},
	"latitude":                   {column: "latitude", kind: fieldNumeric},
	"local_chaves":               {column: "local_chaves", kind: fieldText},
	"longitude":                  {column: "longitude", kind: fieldNumeric},
	"marcadores":                 {column: "marcadores", kind: fieldTextArray},
	"mobilia":                    {column: "mobilia", kind: fieldText},
	"metadata":                   {column: "metadata", kind: fieldJSON},
	"mobiliado":                  {column: "mobiliado", kind: fieldBool},
	"neighborhood_id":            {column: "neighborhood_id", kind: fieldUUID},
	"numero":                     {column: "numero", kind: fieldText},
	"numero_matricula":           {column: "numero_matricula", kind: fieldText},
	"observacoes_documentacao":   {column: "observacoes_documentacao", kind: fieldText},
	"ocupacao":                   {column: "ocupacao", kind: fieldText},
	"origin_media":               {column: "origin_media", kind: fieldText},
	"owner_cellphone":            {column: "owner_cellphone", kind: fieldText},
	"owner_email":                {column: "owner_email", kind: fieldText},
	"owner_media_source":         {column: "origin_media", kind: fieldText},
	"owner_id":                   {column: "owner_id", kind: fieldUUID},
	"owner_name":                 {column: "owner_name", kind: fieldText},
	"owner_notify_email":         {column: "owner_notify_email", kind: fieldBool},
	"owner_phone_commercial":     {column: "owner_phone_commercial", kind: fieldText},
	"owner_phone_residential":    {column: "owner_phone_residential", kind: fieldText},
	"padrao":                     {column: "padrao", kind: fieldText},
	"pais":                       {column: "pais", kind: fieldText},
	"placa_no_local":             {column: "placa_no_local", kind: fieldBool},
	"posicao_localizacao":        {column: "posicao_localizacao", kind: fieldText},
	"preco":                      {column: "preco", kind: fieldNumeric},
	"projeto_aprovado":           {column: "projeto_aprovado", kind: fieldBool},
	"property_type_id":           {column: "property_type_id", kind: fieldUUID},
	"proximidades":               {column: "proximidades", kind: fieldTextArray},
	"public_address_visibility":  {column: "address_visibility", kind: fieldText},
	"published_on_site":          {column: "published_on_site", kind: fieldBool},
	"quartos":                    {column: "quartos", kind: fieldInt},
	"referencia_alternativa":     {column: "referencia_alternativa", kind: fieldText},
	"regra_pet":                  {column: "regra_pet", kind: fieldBool},
	"renda_familiar":             {column: "renda_familiar", kind: fieldNumeric},
	"responsible_user_id":        {column: "responsible_user_id", kind: fieldUUID},
	"seguro_incendio":            {column: "seguro_incendio", kind: fieldNumeric},
	"situacao_imovel":            {column: "situacao_imovel", kind: fieldText},
	"status":                     {column: "status", kind: fieldStatus},
	"status_descritivo":          {column: "status_descritivo", kind: fieldText},
	"suites":                     {column: "suites", kind: fieldInt},
	"super_destaque":             {column: "super_destaque", kind: fieldBool},
	"taxa_de_servico":            {column: "taxa_de_servico", kind: fieldNumeric},
	"tipo_comissao":              {column: "tipo_comissao", kind: fieldText},
	"tipo":                       {column: "tipo", kind: fieldText},
	"tipo_de_imovel":             {column: "tipo", kind: fieldText},
	"tipo_de_negocio":            {column: "finalidade", kind: fieldDealType},
	"title":                      {column: "title", kind: fieldText},
	"tour_virtual":               {column: "tour_virtual", kind: fieldText},
	"uf":                         {column: "uf", kind: fieldText},
	"usou_fgts":                  {column: "usou_fgts", kind: fieldBool},
	"vagas":                      {column: "vagas", kind: fieldInt},
	"valor_itr":                  {column: "valor_itr", kind: fieldNumeric},
	"valor_locacao":              {column: "valor_locacao", kind: fieldNumeric},
	"valor_locacao_avaliado":     {column: "valor_locacao_avaliado", kind: fieldNumeric},
	"valor_seguro_fianca":        {column: "valor_seguro_fianca", kind: fieldNumeric},
	"valor_venda_avaliado":       {column: "valor_venda_avaliado", kind: fieldNumeric},
	"video_imovel":               {column: "video_imovel", kind: fieldText},
	"vista_codigo":               {column: "vista_codigo", kind: fieldText},
	"zoneamento":                 {column: "zoneamento", kind: fieldText},
}

var compatibilityColumns = map[string]fieldDef{
	"anunciar":                  {column: "anunciar", kind: fieldBool},
	"arquivos":                  {column: "arquivos", kind: fieldJSON},
	"cadastrado_por":            {column: "cadastrado_por", kind: fieldUUID},
	"destaque":                  {column: "destaque", kind: fieldBool},
	"fotos":                     {column: "fotos", kind: fieldTextArray},
	"owner_media_source":        {column: "owner_media_source", kind: fieldText},
	"public_address_visibility": {column: "public_address_visibility", kind: fieldText},
	"tipo_de_imovel":            {column: "tipo_de_imovel", kind: fieldText},
	"tipo_de_negocio":           {column: "tipo_de_negocio", kind: fieldText},
}

var writableColumns = buildWritableColumns()

func buildWritableColumns() map[string]fieldDef {
	columns := map[string]fieldDef{}
	for _, def := range writableFields {
		columns[def.column] = def
	}
	return columns
}

func ParseListFilter(values url.Values) (ListFilter, error) {
	limit, err := parseBoundedInt(values.Get("limit"), defaultLimit, 1, maxLimit)
	if err != nil {
		return ListFilter{}, err
	}

	offset, err := parseBoundedInt(values.Get("offset"), 0, 0, 100_000)
	if err != nil {
		return ListFilter{}, err
	}

	filter := ListFilter{
		Limit:         limit,
		Offset:        offset,
		Scope:         normalizedPropertyScope(values.Get("scope")),
		Search:        trimMax(values.Get("search"), 120),
		Status:        normalizedPropertyStatusForFilter(values.Get("status")),
		DealType:      trimMax(values.Get("tipo_de_negocio"), 80),
		PropertyType:  trimMax(values.Get("tipo_de_imovel"), 80),
		City:          trimMax(values.Get("cidade"), 120),
		Neighborhood:  trimMax(values.Get("bairro"), 120),
		ResponsibleID: strings.TrimSpace(values.Get("responsavel_id")),
		OwnerID:       strings.TrimSpace(values.Get("owner_id")),
		CondominiumID: strings.TrimSpace(values.Get("condominium_id")),
		Furniture:     trimMax(values.Get("mobilia"), 80),
	}

	if filter.ResponsibleID != "" && !isUUID(filter.ResponsibleID) {
		return ListFilter{}, fmt.Errorf("%w: responsavel_id is invalid", ErrInvalidInput)
	}
	if filter.OwnerID != "" && !isUUID(filter.OwnerID) {
		return ListFilter{}, fmt.Errorf("%w: owner_id is invalid", ErrInvalidInput)
	}
	if filter.CondominiumID != "" && !isUUID(filter.CondominiumID) {
		return ListFilter{}, fmt.Errorf("%w: condominium_id is invalid", ErrInvalidInput)
	}

	filter.BedroomsMin = parseOptionalPositiveInt(values.Get("quartos_min"))
	filter.SuitesMin = parseOptionalPositiveInt(values.Get("suites_min"))
	filter.BathroomsMin = parseOptionalPositiveInt(values.Get("banheiros_min"))
	filter.ParkingSpacesMin = parseOptionalPositiveInt(values.Get("vagas_min"))
	filter.PriceMin = parseOptionalPositiveFloat(values.Get("valor_min"))
	filter.PriceMax = parseOptionalPositiveFloat(values.Get("valor_max"))
	filter.UsableAreaMin = parseOptionalPositiveFloat(values.Get("area_util_min"))
	filter.UsableAreaMax = parseOptionalPositiveFloat(values.Get("area_util_max"))
	filter.TotalAreaMin = parseOptionalPositiveFloat(values.Get("area_total_min"))
	filter.TotalAreaMax = parseOptionalPositiveFloat(values.Get("area_total_max"))
	if acceptsExchange, ok := parseOptionalBool(values.Get("aceita_permuta")); ok {
		filter.AcceptsExchange = &acceptsExchange
	}
	if acceptsFinancing, ok := parseOptionalBool(values.Get("aceita_financiamento")); ok {
		filter.AcceptsFinancing = &acceptsFinancing
	}
	if publishedOnSite, ok := parseOptionalBool(values.Get("published_on_site")); ok {
		filter.PublishedOnSite = &publishedOnSite
	}
	if exclusive, ok := parseOptionalBool(values.Get("exclusividade")); ok {
		filter.Exclusive = &exclusive
	}
	if hasSign, ok := parseOptionalBool(values.Get("placa_no_local")); ok {
		filter.HasSign = &hasSign
	}
	if featured, ok := parseOptionalBool(values.Get("destaque")); ok {
		filter.Featured = &featured
	}

	return filter, nil
}

func normalizedPropertyScope(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "own", "mine", "pipeline":
		return "own"
	default:
		return ""
	}
}

func (request propertyRequest) ValidateCreate() (propertyRequest, error) {
	input, err := sanitizePayload(request)
	if err != nil {
		return nil, err
	}

	title, _ := input["title"].(string)
	if strings.TrimSpace(title) == "" {
		return nil, fmt.Errorf("%w: title is required", ErrInvalidInput)
	}
	if err := validatePropertyBusinessRules(input); err != nil {
		return nil, err
	}

	return input, nil
}

func (request propertyRequest) ValidateUpdate() (propertyRequest, error) {
	input, err := sanitizePayload(request)
	if err != nil {
		return nil, err
	}
	if len(input) == 0 {
		return nil, ErrNoChanges
	}
	if err := validatePropertyBusinessRules(input); err != nil {
		return nil, err
	}

	return input, nil
}

func sanitizePayload(request propertyRequest) (propertyRequest, error) {
	for _, publicationField := range []string{"anunciar", "published_on_site"} {
		if _, exists := request[publicationField]; exists {
			return nil, fmt.Errorf(
				"%w: %s is managed by the Property Publication Center",
				ErrInvalidInput,
				publicationField,
			)
		}
	}
	out := propertyRequest{}
	var mainImage any

	for key, value := range request {
		if key == "imagem_principal" {
			mainImage = value
		}

		def, ok := writableFields[key]
		if !ok {
			continue
		}
		if key == "id" || key == "organization_id" || key == "created_at" || key == "updated_at" || key == "code" {
			continue
		}

		normalized, err := normalizeValue(value, def.kind)
		if err != nil {
			return nil, fmt.Errorf("%w: %s is invalid", ErrInvalidInput, key)
		}
		out[def.column] = normalized

	}

	if _, hasImages := out["image_urls"]; !hasImages && mainImage != nil {
		images, err := normalizeStringSlice(mainImage)
		if err != nil {
			return nil, fmt.Errorf("%w: imagem_principal is invalid", ErrInvalidInput)
		}
		if len(images) > 0 {
			out["image_urls"] = images
		}
	}

	mirrorPropertyCompatibilityFields(out)
	applyPropertyAvailabilityContract(out)

	return out, nil
}

func applyPropertyAvailabilityContract(out propertyRequest) {
	status, ok := out["status"].(string)
	if !ok {
		return
	}
	switch status {
	case "reserved", "sold", "rented":
		out["published_on_site"] = false
	}
}

func mirrorPropertyCompatibilityFields(out propertyRequest) {
	// Reads still expose legacy aliases in normalizePropertyOutput. Writes use the
	// canonical columns only because older projects can keep legacy columns with
	// different types, such as fotos jsonb and cadastrado_por text.
	if _, hasMainImage := out["imagem_principal"]; !hasMainImage {
		if images, ok := out["image_urls"].([]string); ok && len(images) > 0 {
			out["imagem_principal"] = images[0]
		}
	}
}

func normalizeValue(value any, kind fieldKind) (any, error) {
	if value == nil {
		return nil, nil
	}

	switch kind {
	case fieldText, fieldDate:
		switch typed := value.(type) {
		case string:
			return trimMax(typed, 4_000), nil
		case json.Number:
			return typed.String(), nil
		default:
			return fmt.Sprint(typed), nil
		}
	case fieldBool:
		typed, ok := value.(bool)
		if !ok {
			return nil, errors.New("expected boolean")
		}
		return typed, nil
	case fieldInt:
		return normalizeInt(value)
	case fieldNumeric:
		return normalizeFloat(value)
	case fieldUUID:
		text, ok := value.(string)
		if !ok {
			return nil, errors.New("expected uuid string")
		}
		text = strings.TrimSpace(text)
		if text == "" {
			return nil, nil
		}
		if !isUUID(text) {
			return nil, errors.New("invalid uuid")
		}
		return text, nil
	case fieldTextArray:
		items, err := normalizeStringSlice(value)
		if err != nil {
			return nil, err
		}
		return items, nil
	case fieldDealType:
		return normalizeDealType(value)
	case fieldStatus:
		return normalizePropertyStatus(value)
	case fieldJSON:
		payload, err := json.Marshal(value)
		if err != nil {
			return nil, err
		}
		return string(payload), nil
	default:
		return value, nil
	}
}

func mergeLegacyMetadata(current any, legacy map[string]any) string {
	metadata := map[string]any{}
	if text, ok := current.(string); ok && strings.TrimSpace(text) != "" {
		_ = json.Unmarshal([]byte(text), &metadata)
	}
	if raw, ok := current.(map[string]any); ok {
		for key, value := range raw {
			metadata[key] = value
		}
	}

	currentLegacy, _ := metadata["legacy"].(map[string]any)
	if currentLegacy == nil {
		currentLegacy = map[string]any{}
	}
	for key, value := range legacy {
		currentLegacy[key] = value
	}
	metadata["legacy"] = currentLegacy

	payload, err := json.Marshal(metadata)
	if err != nil {
		return "{}"
	}
	return string(payload)
}

func normalizeInt(value any) (any, error) {
	switch typed := value.(type) {
	case float64:
		return int64(typed), nil
	case json.Number:
		parsed, err := typed.Int64()
		return parsed, err
	case string:
		if strings.TrimSpace(typed) == "" {
			return nil, nil
		}
		parsed, err := strconv.ParseInt(typed, 10, 64)
		return parsed, err
	default:
		return nil, errors.New("expected integer")
	}
}

func normalizeFloat(value any) (any, error) {
	switch typed := value.(type) {
	case float64:
		return typed, nil
	case json.Number:
		parsed, err := typed.Float64()
		return parsed, err
	case string:
		text := strings.TrimSpace(typed)
		if text == "" {
			return nil, nil
		}
		if strings.Contains(text, ",") {
			text = strings.ReplaceAll(text, ".", "")
			text = strings.ReplaceAll(text, ",", ".")
		}
		parsed, err := strconv.ParseFloat(text, 64)
		return parsed, err
	default:
		return nil, errors.New("expected number")
	}
}

func normalizeStringSlice(value any) ([]string, error) {
	if value == nil {
		return nil, nil
	}

	switch typed := value.(type) {
	case []string:
		return typed, nil
	case string:
		text := strings.TrimSpace(typed)
		if text == "" {
			return nil, nil
		}
		return []string{text}, nil
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			text, ok := item.(string)
			if !ok {
				return nil, errors.New("expected string array")
			}
			out = append(out, text)
		}
		return out, nil
	default:
		return nil, errors.New("expected string array")
	}
}

func normalizeDealType(value any) (string, error) {
	text, ok := value.(string)
	if !ok {
		return "", errors.New("expected deal type string")
	}
	text = normalizeASCII(text)
	switch text {
	case "", "venda", "sale":
		return "venda", nil
	case "aluguel", "locacao", "locacao anual", "rent":
		return "locacao", nil
	case "temporada", "season":
		return "temporada", nil
	case "lancamento", "launch", "release":
		return "lancamento", nil
	case "venda e aluguel", "venda locacao", "venda/locacao", "venda/aluguel", "venda_locacao":
		return "venda_locacao", nil
	default:
		return "", errors.New("invalid deal type")
	}
}

func normalizedDealTypeForFilter(value string) string {
	if strings.TrimSpace(value) == "" {
		return ""
	}
	normalized, err := normalizeDealType(value)
	if err != nil {
		return ""
	}
	return normalized
}

func normalizedPropertyStatusForFilter(value string) string {
	if strings.TrimSpace(value) == "" {
		return ""
	}
	normalized, err := normalizePropertyStatus(value)
	if err != nil {
		return ""
	}
	return normalized
}

func normalizePropertyStatus(value any) (string, error) {
	text, ok := value.(string)
	if !ok {
		return "", errors.New("expected status string")
	}
	text = normalizeASCII(text)
	switch text {
	case "", "ativo", "active", "disponivel":
		return "active", nil
	case "reservado", "reserved":
		return "reserved", nil
	case "draft", "rascunho":
		return "draft", nil
	case "vendido", "sold":
		return "sold", nil
	case "alugado", "rented", "locado":
		return "rented", nil
	case "inativo", "inactive":
		return "inactive", nil
	case "arquivado", "archived":
		return "archived", nil
	default:
		return "", errors.New("invalid status")
	}
}

func parseBoundedInt(raw string, fallback int, min int, max int) (int, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fallback, nil
	}

	value, err := strconv.Atoi(raw)
	if err != nil || value < min || value > max {
		return 0, fmt.Errorf("%w: pagination value is invalid", ErrInvalidInput)
	}

	return value, nil
}

func parseOptionalPositiveInt(raw string) int {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || value < 1 {
		return 0
	}
	return value
}

func parseOptionalPositiveFloat(raw string) float64 {
	value, ok := numericinput.ParseNonNegativeDecimal(raw)
	if !ok || value <= 0 {
		return 0
	}
	return value
}

func parseOptionalBool(raw string) (bool, bool) {
	switch normalizeASCII(raw) {
	case "true", "1", "sim", "yes", "aceita":
		return true, true
	case "false", "0", "nao", "no", "nao aceita":
		return false, true
	default:
		return false, false
	}
}

func trimMax(value string, maxLength int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) > maxLength {
		return string(runes[:maxLength])
	}
	return value
}

func isUUID(value string) bool {
	var uuid pgtype.UUID
	if err := uuid.Scan(strings.TrimSpace(value)); err != nil {
		return false
	}
	return uuid.Valid
}
