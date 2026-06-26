package properties

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
)

const (
	defaultLimit = 50
	maxLimit     = 1000
)

var (
	ErrInvalidInput     = errors.New("invalid property input")
	ErrPropertyNotFound = errors.New("property not found")
	ErrNoChanges        = errors.New("no property changes provided")
)

type Property map[string]any

type ListResponse struct {
	Data   []Property `json:"data"`
	Total  int64      `json:"total"`
	Limit  int        `json:"limit"`
	Offset int        `json:"offset"`
}

type propertyRequest map[string]any

type ListFilter struct {
	Limit         int
	Offset        int
	Search        string
	DealType      string
	PropertyType  string
	City          string
	Neighborhood  string
	ResponsibleID string
	BedroomsMin   int
	SuitesMin     int
	BathroomsMin  int
	PriceMin      float64
	PriceMax      float64
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
	"aceita_financiamento":      {column: "aceita_financiamento", kind: fieldBool},
	"aceita_permuta":            {column: "aceita_permuta", kind: fieldBool},
	"andar":                     {column: "andar", kind: fieldInt},
	"ano_construcao":            {column: "ano_construcao", kind: fieldInt},
	"ano_reforma":               {column: "ano_reforma", kind: fieldInt},
	"anunciar":                  {column: "published_on_site", kind: fieldBool},
	"aprovacao_ambiental":       {column: "aprovacao_ambiental", kind: fieldText},
	"area_total":                {column: "area_total", kind: fieldNumeric},
	"area_util":                 {column: "area_util", kind: fieldNumeric},
	"arquivos":                  {column: "documents", kind: fieldJSON},
	"bairro":                    {column: "bairro", kind: fieldText},
	"banheiros":                 {column: "banheiros", kind: fieldInt},
	"cadastrado_por":            {column: "responsible_user_id", kind: fieldUUID},
	"cep":                       {column: "cep", kind: fieldText},
	"cidade":                    {column: "cidade", kind: fieldText},
	"city_id":                   {column: "city_id", kind: fieldUUID},
	"code":                      {column: "code", kind: fieldText},
	"codigo_agua":               {column: "codigo_agua", kind: fieldText},
	"codigo_eletricidade":       {column: "codigo_eletricidade", kind: fieldText},
	"codigo_iptu":               {column: "codigo_iptu", kind: fieldText},
	"comentarios_internos":      {column: "comentarios_internos", kind: fieldText},
	"comissao_locacao":          {column: "comissao_locacao", kind: fieldNumeric},
	"comissao_venda":            {column: "comissao_venda", kind: fieldNumeric},
	"complemento":               {column: "complemento", kind: fieldText},
	"condicao_comercial":        {column: "condicao_comercial", kind: fieldText},
	"condominio":                {column: "condominio", kind: fieldNumeric},
	"condominium_id":            {column: "condominium_id", kind: fieldUUID},
	"created_by":                {column: "created_by", kind: fieldUUID},
	"descricao":                 {column: "descricao", kind: fieldText},
	"descricao_site":            {column: "descricao_site", kind: fieldText},
	"destaque":                  {column: "is_featured", kind: fieldBool},
	"documents":                 {column: "documents", kind: fieldJSON},
	"endereco":                  {column: "endereco", kind: fieldText},
	"external_id":               {column: "external_id", kind: fieldText},
	"external_provider":         {column: "external_provider", kind: fieldText},
	"fotos":                     {column: "image_urls", kind: fieldTextArray},
	"image_urls":                {column: "image_urls", kind: fieldTextArray},
	"iptu":                      {column: "iptu", kind: fieldNumeric},
	"is_featured":               {column: "is_featured", kind: fieldBool},
	"latitude":                  {column: "latitude", kind: fieldNumeric},
	"local_chaves":              {column: "local_chaves", kind: fieldText},
	"longitude":                 {column: "longitude", kind: fieldNumeric},
	"metadata":                  {column: "metadata", kind: fieldJSON},
	"mobiliado":                 {column: "mobiliado", kind: fieldBool},
	"neighborhood_id":           {column: "neighborhood_id", kind: fieldUUID},
	"numero":                    {column: "numero", kind: fieldText},
	"numero_matricula":          {column: "numero_matricula", kind: fieldText},
	"observacoes_documentacao":  {column: "observacoes_documentacao", kind: fieldText},
	"origin_media":              {column: "origin_media", kind: fieldText},
	"owner_cellphone":           {column: "owner_cellphone", kind: fieldText},
	"owner_email":               {column: "owner_email", kind: fieldText},
	"owner_media_source":        {column: "origin_media", kind: fieldText},
	"owner_name":                {column: "owner_name", kind: fieldText},
	"owner_phone_commercial":    {column: "owner_phone_commercial", kind: fieldText},
	"owner_phone_residential":   {column: "owner_phone_residential", kind: fieldText},
	"preco":                     {column: "preco", kind: fieldNumeric},
	"property_type_id":          {column: "property_type_id", kind: fieldUUID},
	"public_address_visibility": {column: "address_visibility", kind: fieldText},
	"published_on_site":         {column: "published_on_site", kind: fieldBool},
	"quartos":                   {column: "quartos", kind: fieldInt},
	"referencia_alternativa":    {column: "referencia_alternativa", kind: fieldText},
	"responsible_user_id":       {column: "responsible_user_id", kind: fieldUUID},
	"seguro_incendio":           {column: "seguro_incendio", kind: fieldNumeric},
	"status":                    {column: "status", kind: fieldStatus},
	"status_descritivo":         {column: "status_descritivo", kind: fieldText},
	"suites":                    {column: "suites", kind: fieldInt},
	"taxa_de_servico":           {column: "taxa_de_servico", kind: fieldNumeric},
	"tipo":                      {column: "tipo", kind: fieldText},
	"tipo_de_imovel":            {column: "tipo", kind: fieldText},
	"tipo_de_negocio":           {column: "finalidade", kind: fieldDealType},
	"title":                     {column: "title", kind: fieldText},
	"tour_virtual":              {column: "tour_virtual", kind: fieldText},
	"uf":                        {column: "uf", kind: fieldText},
	"vagas":                     {column: "vagas", kind: fieldInt},
	"valor_itr":                 {column: "valor_itr", kind: fieldNumeric},
	"valor_locacao":             {column: "valor_locacao", kind: fieldNumeric},
	"valor_seguro_fianca":       {column: "valor_seguro_fianca", kind: fieldNumeric},
	"video_imovel":              {column: "video_imovel", kind: fieldText},
}

var legacyMetadataFields = map[string]struct{}{
	"autorizado_comercializacao": {},
	"commission_percentage":      {},
	"condicao_pagamento":         {},
	"corretor_id":                {},
	"data_inicio_comissao":       {},
	"detalhes_extras":            {},
	"exclusividade":              {},
	"faixa_valor_imovel":         {},
	"finalidade":                 {},
	"imoview_codigo":             {},
	"is_demo":                    {},
	"marcadores":                 {},
	"mobilia":                    {},
	"ocupacao":                   {},
	"owner_notify_email":         {},
	"padrao":                     {},
	"pais":                       {},
	"placa_no_local":             {},
	"posicao_localizacao":        {},
	"projeto_aprovado":           {},
	"proximidades":               {},
	"regra_pet":                  {},
	"renda_familiar":             {},
	"situacao_imovel":            {},
	"super_destaque":             {},
	"tipo_comissao":              {},
	"usou_fgts":                  {},
	"valor_locacao_avaliado":     {},
	"valor_venda_avaliado":       {},
	"vista_codigo":               {},
	"zoneamento":                 {},
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
		Search:        trimMax(values.Get("search"), 120),
		DealType:      trimMax(values.Get("tipo_de_negocio"), 80),
		PropertyType:  trimMax(values.Get("tipo_de_imovel"), 80),
		City:          trimMax(values.Get("cidade"), 120),
		Neighborhood:  trimMax(values.Get("bairro"), 120),
		ResponsibleID: strings.TrimSpace(values.Get("responsavel_id")),
	}

	if filter.ResponsibleID != "" && !isUUID(filter.ResponsibleID) {
		return ListFilter{}, fmt.Errorf("%w: responsavel_id is invalid", ErrInvalidInput)
	}

	filter.BedroomsMin = parseOptionalPositiveInt(values.Get("quartos_min"))
	filter.SuitesMin = parseOptionalPositiveInt(values.Get("suites_min"))
	filter.BathroomsMin = parseOptionalPositiveInt(values.Get("banheiros_min"))
	filter.PriceMin = parseOptionalPositiveFloat(values.Get("valor_min"))
	filter.PriceMax = parseOptionalPositiveFloat(values.Get("valor_max"))

	return filter, nil
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

	return input, nil
}

func sanitizePayload(request propertyRequest) (propertyRequest, error) {
	out := propertyRequest{}
	legacy := map[string]any{}
	var mainImage any

	for key, value := range request {
		if key == "imagem_principal" {
			mainImage = value
			continue
		}

		def, ok := writableFields[key]
		if !ok {
			if _, isLegacy := legacyMetadataFields[key]; isLegacy {
				legacy[key] = value
			}
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

	if len(legacy) > 0 {
		out["metadata"] = mergeLegacyMetadata(out["metadata"], legacy)
	}

	return out, nil
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
		if strings.TrimSpace(typed) == "" {
			return nil, nil
		}
		parsed, err := strconv.ParseFloat(typed, 64)
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

func normalizePropertyStatus(value any) (string, error) {
	text, ok := value.(string)
	if !ok {
		return "", errors.New("expected status string")
	}
	text = normalizeASCII(text)
	switch text {
	case "", "ativo", "active", "disponivel", "reservado":
		return "active", nil
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
	value, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil || value <= 0 {
		return 0
	}
	return value
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
