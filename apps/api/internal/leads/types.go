package leads

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/mail"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

const (
	defaultLimit = 50
	maxLimit     = 200
)

var (
	ErrInvalidInput     = errors.New("invalid lead input")
	ErrInvalidReference = errors.New("invalid lead reference")
	ErrLeadNotFound     = errors.New("lead not found")
	ErrNoLeadChanges    = errors.New("no lead changes provided")
	ErrTagAlreadyExists = errors.New("tag already exists on lead")
)

type Lead struct {
	ID                 string       `json:"id"`
	OrganizationID     string       `json:"organizationId"`
	Name               string       `json:"name"`
	Email              string       `json:"email,omitempty"`
	Phone              string       `json:"phone,omitempty"`
	Source             string       `json:"source"`
	Status             string       `json:"status"`
	DealStatus         string       `json:"dealStatus"`
	LostReason         string       `json:"lostReason,omitempty"`
	Priority           string       `json:"priority"`
	Message            string       `json:"message,omitempty"`
	PropertyCode       string       `json:"propertyCode,omitempty"`
	PropertyID         string       `json:"propertyId,omitempty"`
	InterestPropertyID string       `json:"interestPropertyId,omitempty"`
	PipelineID         string       `json:"pipelineId,omitempty"`
	StageID            string       `json:"stageId,omitempty"`
	AssignedUserID     string       `json:"assignedUserId,omitempty"`
	InterestValue      string       `json:"interestValue,omitempty"`
	IsOwnResource      *bool        `json:"isOwnResource,omitempty"`
	ReentryCount       int          `json:"reentryCount"`
	Stage              *Stage       `json:"stage,omitempty"`
	Assignee           *Assignee    `json:"assignee,omitempty"`
	CreatedAt          time.Time    `json:"createdAt"`
	UpdatedAt          time.Time    `json:"updatedAt"`
	StageEnteredAt     *time.Time   `json:"stageEnteredAt,omitempty"`
	LastContactAt      *time.Time   `json:"lastContactAt,omitempty"`
	NextFollowUpAt     *time.Time   `json:"nextFollowUpAt,omitempty"`
	AdditionalFields   LeadMetadata `json:"additionalFields,omitempty"`
}

type LeadMetadata map[string]any

type Stage struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Color    string `json:"color,omitempty"`
	StageKey string `json:"stageKey,omitempty"`
}

type Assignee struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatarUrl,omitempty"`
}

type ListResponse struct {
	Data   []Lead `json:"data"`
	Total  int64  `json:"total"`
	Limit  int    `json:"limit"`
	Offset int    `json:"offset"`
}

type CreateResponse struct {
	Data             Lead   `json:"data"`
	Reentry          bool   `json:"reentry"`
	AssignedUserName string `json:"assignedUserName,omitempty"`
}

type ListFilter struct {
	Limit          int
	Offset         int
	Search         string
	StageID        string
	AssignedUserID string
	Unassigned     bool
	DealStatus     string
}

type CreateRequest struct {
	Name             string   `json:"name"`
	Email            string   `json:"email,omitempty"`
	Phone            string   `json:"phone,omitempty"`
	Source           string   `json:"source,omitempty"`
	Message          string   `json:"message,omitempty"`
	PropertyCode     string   `json:"propertyCode,omitempty"`
	PropertyID       string   `json:"propertyId,omitempty"`
	PipelineID       string   `json:"pipelineId,omitempty"`
	StageID          string   `json:"stageId,omitempty"`
	AssignedUserID   string   `json:"assignedUserId,omitempty"`
	InterestValue    *string  `json:"interestValue,omitempty"`
	DealStatus       string   `json:"dealStatus,omitempty"`
	LostReason       string   `json:"lostReason,omitempty"`
	IsOwnResource    *bool    `json:"isOwnResource,omitempty"`
	ConversationID   string   `json:"conversationId,omitempty"`
	TagIDs           []string `json:"tagIds,omitempty"`
	Cargo            string   `json:"cargo,omitempty"`
	Empresa          string   `json:"empresa,omitempty"`
	Profissao        string   `json:"profissao,omitempty"`
	Endereco         string   `json:"endereco,omitempty"`
	Bairro           string   `json:"bairro,omitempty"`
	Numero           string   `json:"numero,omitempty"`
	CEP              string   `json:"cep,omitempty"`
	Cidade           string   `json:"cidade,omitempty"`
	UF               string   `json:"uf,omitempty"`
	RendaFamiliar    string   `json:"rendaFamiliar,omitempty"`
	FaixaValorImovel string   `json:"faixaValorImovel,omitempty"`
}

type createInput struct {
	Name             string
	Email            *string
	Phone            *string
	Source           string
	Message          *string
	PropertyCode     *string
	PropertyID       *string
	PipelineID       *string
	StageID          *string
	AssignedUserID   *string
	InterestValue    *string
	DealStatus       string
	LostReason       *string
	IsOwnResource    *bool
	ConversationID   *string
	TagIDs           []string
	Cargo            *string
	Empresa          *string
	Profissao        *string
	Endereco         *string
	Bairro           *string
	Numero           *string
	CEP              *string
	Cidade           *string
	UF               *string
	RendaFamiliar    *string
	FaixaValorImovel *string
}

type patchString struct {
	Set   bool
	Value *string
}

type patchBool struct {
	Set   bool
	Value *bool
}

type UpdateRequest struct {
	Name                 patchString `json:"name,omitempty"`
	Email                patchString `json:"email,omitempty"`
	Phone                patchString `json:"phone,omitempty"`
	Source               patchString `json:"source,omitempty"`
	Message              patchString `json:"message,omitempty"`
	PropertyCode         patchString `json:"propertyCode,omitempty"`
	PropertyID           patchString `json:"propertyId,omitempty"`
	InterestPropertyID   patchString `json:"interestPropertyId,omitempty"`
	PipelineID           patchString `json:"pipelineId,omitempty"`
	StageID              patchString `json:"stageId,omitempty"`
	AssignedUserID       patchString `json:"assignedUserId,omitempty"`
	InterestValue        patchString `json:"interestValue,omitempty"`
	CommissionPercentage patchString `json:"commissionPercentage,omitempty"`
	DealStatus           patchString `json:"dealStatus,omitempty"`
	LostReason           patchString `json:"lostReason,omitempty"`
	Feedback             patchString `json:"feedback,omitempty"`
	Cargo                patchString `json:"cargo,omitempty"`
	Empresa              patchString `json:"empresa,omitempty"`
	Profissao            patchString `json:"profissao,omitempty"`
	Endereco             patchString `json:"endereco,omitempty"`
	Numero               patchString `json:"numero,omitempty"`
	Complemento          patchString `json:"complemento,omitempty"`
	Bairro               patchString `json:"bairro,omitempty"`
	CEP                  patchString `json:"cep,omitempty"`
	Cidade               patchString `json:"cidade,omitempty"`
	UF                   patchString `json:"uf,omitempty"`
	RendaFamiliar        patchString `json:"rendaFamiliar,omitempty"`
	FaixaValorImovel     patchString `json:"faixaValorImovel,omitempty"`
	FinalidadeCompra     patchString `json:"finalidadeCompra,omitempty"`
	Trabalha             patchBool   `json:"trabalha,omitempty"`
	ProcuraFinanciamento patchBool   `json:"procuraFinanciamento,omitempty"`
	IsOwnResource        patchBool   `json:"isOwnResource,omitempty"`
}

type updateInput UpdateRequest

type TagRequest struct {
	TagID string `json:"tagId"`
}

type tagInput struct {
	TagID string
}

type MoveStageRequest struct {
	StageID        string     `json:"stageId"`
	IsOwnResource  *bool      `json:"isOwnResource,omitempty"`
	StageEnteredAt *time.Time `json:"stageEnteredAt,omitempty"`
}

type moveStageInput struct {
	StageID        string
	IsOwnResource  *bool
	StageEnteredAt *time.Time
}

type AssignRequest struct {
	AssignedUserID patchString `json:"assignedUserId"`
}

type assignInput struct {
	AssignedUserID *string
}

type RoundRobinResult struct {
	Success        bool   `json:"success"`
	LeadID         string `json:"leadId"`
	PipelineID     string `json:"pipelineId,omitempty"`
	StageID        string `json:"stageId,omitempty"`
	AssignedUserID string `json:"assignedUserId,omitempty"`
	RoundRobinUsed bool   `json:"roundRobinUsed"`
	RoundRobinID   string `json:"roundRobinId,omitempty"`
	Error          string `json:"error,omitempty"`
}

func (field *patchString) UnmarshalJSON(data []byte) error {
	field.Set = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		field.Value = nil
		return nil
	}

	var value string
	if err := json.Unmarshal(data, &value); err == nil {
		field.Value = &value
		return nil
	}

	var numeric json.Number
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if err := decoder.Decode(&numeric); err == nil {
		value = numeric.String()
		field.Value = &value
		return nil
	}

	return fmt.Errorf("%w: expected string, number or null", ErrInvalidInput)
}

func (field *patchBool) UnmarshalJSON(data []byte) error {
	field.Set = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		field.Value = nil
		return nil
	}

	var value bool
	if err := json.Unmarshal(data, &value); err != nil {
		return fmt.Errorf("%w: expected boolean or null", ErrInvalidInput)
	}

	field.Value = &value
	return nil
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
		Limit:          limit,
		Offset:         offset,
		Search:         trimMax(values.Get("search"), 100),
		StageID:        strings.TrimSpace(values.Get("stageId")),
		AssignedUserID: strings.TrimSpace(values.Get("assignedUserId")),
		DealStatus:     strings.TrimSpace(values.Get("dealStatus")),
	}
	if strings.TrimSpace(values.Get("assigned")) == "none" {
		filter.Unassigned = true
	}
	if filter.Unassigned && filter.AssignedUserID != "" {
		return ListFilter{}, fmt.Errorf("%w: assigned and assignedUserId are mutually exclusive", ErrInvalidInput)
	}

	for _, item := range []struct {
		name  string
		value string
	}{
		{name: "stageId", value: filter.StageID},
		{name: "assignedUserId", value: filter.AssignedUserID},
	} {
		if item.value != "" && !isUUID(item.value) {
			return ListFilter{}, fmt.Errorf("%w: %s is invalid", ErrInvalidInput, item.name)
		}
	}

	if filter.DealStatus != "" && !validEnum(filter.DealStatus, "open", "won", "lost") {
		return ListFilter{}, fmt.Errorf("%w: dealStatus is invalid", ErrInvalidInput)
	}

	return filter, nil
}

func (request CreateRequest) Validate() (createInput, error) {
	input := createInput{
		Name:             trimMax(request.Name, 180),
		Email:            optionalString(request.Email, 254),
		Phone:            optionalString(request.Phone, 40),
		Source:           trimMax(request.Source, 80),
		Message:          optionalString(request.Message, 2_000),
		PropertyCode:     optionalString(request.PropertyCode, 80),
		DealStatus:       trimMax(request.DealStatus, 20),
		LostReason:       optionalString(request.LostReason, 300),
		IsOwnResource:    request.IsOwnResource,
		Cargo:            optionalString(request.Cargo, 120),
		Empresa:          optionalString(request.Empresa, 160),
		Profissao:        optionalString(request.Profissao, 120),
		Endereco:         optionalString(request.Endereco, 200),
		Bairro:           optionalString(request.Bairro, 120),
		Numero:           optionalString(request.Numero, 40),
		CEP:              optionalString(request.CEP, 20),
		Cidade:           optionalString(request.Cidade, 120),
		UF:               optionalString(strings.ToUpper(request.UF), 2),
		RendaFamiliar:    optionalString(request.RendaFamiliar, 80),
		FaixaValorImovel: optionalString(request.FaixaValorImovel, 80),
	}

	if input.Name == "" || len([]rune(input.Name)) < 2 {
		return createInput{}, fmt.Errorf("%w: name must have at least 2 characters", ErrInvalidInput)
	}

	if input.Source == "" {
		input.Source = "manual"
	}

	if input.DealStatus == "" {
		input.DealStatus = "open"
	}
	if !validEnum(input.DealStatus, "open", "won", "lost") {
		return createInput{}, fmt.Errorf("%w: dealStatus is invalid", ErrInvalidInput)
	}

	if input.Email != nil {
		if _, err := mail.ParseAddress(*input.Email); err != nil {
			return createInput{}, fmt.Errorf("%w: email is invalid", ErrInvalidInput)
		}
	}

	if request.PropertyID != "" {
		value, ok := normalizeUUID(request.PropertyID)
		if !ok {
			return createInput{}, fmt.Errorf("%w: propertyId is invalid", ErrInvalidInput)
		}
		input.PropertyID = &value
	}

	if request.PipelineID != "" {
		value, ok := normalizeUUID(request.PipelineID)
		if !ok {
			return createInput{}, fmt.Errorf("%w: pipelineId is invalid", ErrInvalidInput)
		}
		input.PipelineID = &value
	}

	if request.StageID != "" {
		value, ok := normalizeUUID(request.StageID)
		if !ok {
			return createInput{}, fmt.Errorf("%w: stageId is invalid", ErrInvalidInput)
		}
		input.StageID = &value
	}

	if request.AssignedUserID != "" {
		value, ok := normalizeUUID(request.AssignedUserID)
		if !ok {
			return createInput{}, fmt.Errorf("%w: assignedUserId is invalid", ErrInvalidInput)
		}
		input.AssignedUserID = &value
	}

	if request.ConversationID != "" {
		value, ok := normalizeUUID(request.ConversationID)
		if !ok {
			return createInput{}, fmt.Errorf("%w: conversationId is invalid", ErrInvalidInput)
		}
		input.ConversationID = &value
	}

	if len(request.TagIDs) > 50 {
		return createInput{}, fmt.Errorf("%w: tagIds can contain at most 50 items", ErrInvalidInput)
	}
	seenTagIDs := map[string]struct{}{}
	for _, tagID := range request.TagIDs {
		value, ok := normalizeUUID(tagID)
		if !ok {
			return createInput{}, fmt.Errorf("%w: tagIds contains an invalid uuid", ErrInvalidInput)
		}
		if _, exists := seenTagIDs[value]; exists {
			continue
		}
		seenTagIDs[value] = struct{}{}
		input.TagIDs = append(input.TagIDs, value)
	}

	if request.InterestValue != nil {
		value := strings.TrimSpace(*request.InterestValue)
		if value != "" {
			if _, err := strconv.ParseFloat(value, 64); err != nil {
				return createInput{}, fmt.Errorf("%w: interestValue is invalid", ErrInvalidInput)
			}
			input.InterestValue = &value
		}
	}

	return input, nil
}

func (request TagRequest) Validate() (tagInput, error) {
	value, ok := normalizeUUID(request.TagID)
	if !ok {
		return tagInput{}, fmt.Errorf("%w: tagId is invalid", ErrInvalidInput)
	}

	return tagInput{TagID: value}, nil
}

func (request MoveStageRequest) Validate() (moveStageInput, error) {
	stageID, ok := normalizeUUID(request.StageID)
	if !ok {
		return moveStageInput{}, fmt.Errorf("%w: stageId is invalid", ErrInvalidInput)
	}

	if request.StageEnteredAt != nil && request.StageEnteredAt.IsZero() {
		return moveStageInput{}, fmt.Errorf("%w: stageEnteredAt is invalid", ErrInvalidInput)
	}

	return moveStageInput{
		StageID:        stageID,
		IsOwnResource:  request.IsOwnResource,
		StageEnteredAt: request.StageEnteredAt,
	}, nil
}

func (request AssignRequest) Validate() (assignInput, error) {
	if !request.AssignedUserID.Set {
		return assignInput{}, ErrNoLeadChanges
	}

	input := assignInput{}
	if request.AssignedUserID.Value != nil {
		value, ok := normalizeUUID(*request.AssignedUserID.Value)
		if !ok {
			return assignInput{}, fmt.Errorf("%w: assignedUserId is invalid", ErrInvalidInput)
		}
		input.AssignedUserID = &value
	}

	return input, nil
}

func (request UpdateRequest) Validate() (updateInput, error) {
	input := updateInput{
		Name:                 validatePatchString(request.Name, 180),
		Email:                validatePatchString(request.Email, 254),
		Phone:                validatePatchString(request.Phone, 40),
		Source:               validatePatchString(request.Source, 80),
		Message:              validatePatchString(request.Message, 2_000),
		PropertyCode:         validatePatchString(request.PropertyCode, 80),
		PropertyID:           request.PropertyID,
		InterestPropertyID:   request.InterestPropertyID,
		PipelineID:           request.PipelineID,
		StageID:              request.StageID,
		AssignedUserID:       request.AssignedUserID,
		InterestValue:        validatePatchString(request.InterestValue, 40),
		CommissionPercentage: validatePatchString(request.CommissionPercentage, 20),
		DealStatus:           validatePatchString(request.DealStatus, 20),
		LostReason:           validatePatchString(request.LostReason, 300),
		Feedback:             validatePatchString(request.Feedback, 2_000),
		Cargo:                validatePatchString(request.Cargo, 120),
		Empresa:              validatePatchString(request.Empresa, 160),
		Profissao:            validatePatchString(request.Profissao, 120),
		Endereco:             validatePatchString(request.Endereco, 200),
		Numero:               validatePatchString(request.Numero, 40),
		Complemento:          validatePatchString(request.Complemento, 120),
		Bairro:               validatePatchString(request.Bairro, 120),
		CEP:                  validatePatchString(request.CEP, 20),
		Cidade:               validatePatchString(request.Cidade, 120),
		UF:                   validatePatchString(request.UF, 2),
		RendaFamiliar:        validatePatchString(request.RendaFamiliar, 80),
		FaixaValorImovel:     validatePatchString(request.FaixaValorImovel, 80),
		FinalidadeCompra:     validatePatchString(request.FinalidadeCompra, 120),
		Trabalha:             request.Trabalha,
		ProcuraFinanciamento: request.ProcuraFinanciamento,
		IsOwnResource:        request.IsOwnResource,
	}

	if !input.hasChanges() {
		return updateInput{}, ErrNoLeadChanges
	}

	if input.Name.Set {
		if input.Name.Value == nil || len([]rune(*input.Name.Value)) < 2 {
			return updateInput{}, fmt.Errorf("%w: name must have at least 2 characters", ErrInvalidInput)
		}
	}

	if input.Email.Set && input.Email.Value != nil {
		if _, err := mail.ParseAddress(*input.Email.Value); err != nil {
			return updateInput{}, fmt.Errorf("%w: email is invalid", ErrInvalidInput)
		}
	}

	if input.UF.Set && input.UF.Value != nil {
		value := strings.ToUpper(*input.UF.Value)
		input.UF.Value = &value
	}

	if input.DealStatus.Set && input.DealStatus.Value != nil && !validEnum(*input.DealStatus.Value, "open", "won", "lost") {
		return updateInput{}, fmt.Errorf("%w: dealStatus is invalid", ErrInvalidInput)
	}

	for _, item := range []struct {
		name  string
		field *patchString
	}{
		{name: "propertyId", field: &input.PropertyID},
		{name: "interestPropertyId", field: &input.InterestPropertyID},
		{name: "pipelineId", field: &input.PipelineID},
		{name: "stageId", field: &input.StageID},
		{name: "assignedUserId", field: &input.AssignedUserID},
	} {
		if err := validatePatchUUID(item.name, item.field); err != nil {
			return updateInput{}, err
		}
	}

	for _, item := range []struct {
		name  string
		field patchString
	}{
		{name: "interestValue", field: input.InterestValue},
		{name: "commissionPercentage", field: input.CommissionPercentage},
	} {
		if item.field.Set && item.field.Value != nil {
			if _, err := strconv.ParseFloat(*item.field.Value, 64); err != nil {
				return updateInput{}, fmt.Errorf("%w: %s is invalid", ErrInvalidInput, item.name)
			}
		}
	}

	return input, nil
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

func (input updateInput) hasChanges() bool {
	for _, field := range []patchString{
		input.Name,
		input.Email,
		input.Phone,
		input.Source,
		input.Message,
		input.PropertyCode,
		input.PropertyID,
		input.InterestPropertyID,
		input.PipelineID,
		input.StageID,
		input.AssignedUserID,
		input.InterestValue,
		input.CommissionPercentage,
		input.DealStatus,
		input.LostReason,
		input.Feedback,
		input.Cargo,
		input.Empresa,
		input.Profissao,
		input.Endereco,
		input.Numero,
		input.Complemento,
		input.Bairro,
		input.CEP,
		input.Cidade,
		input.UF,
		input.RendaFamiliar,
		input.FaixaValorImovel,
		input.FinalidadeCompra,
	} {
		if field.Set {
			return true
		}
	}

	return input.Trabalha.Set || input.ProcuraFinanciamento.Set || input.IsOwnResource.Set
}

func validatePatchString(field patchString, maxLength int) patchString {
	if !field.Set || field.Value == nil {
		return field
	}

	value := trimMax(*field.Value, maxLength)
	field.Value = &value
	return field
}

func validatePatchUUID(name string, field *patchString) error {
	if !field.Set || field.Value == nil {
		return nil
	}

	value, ok := normalizeUUID(*field.Value)
	if !ok {
		return fmt.Errorf("%w: %s is invalid", ErrInvalidInput, name)
	}

	field.Value = &value
	return nil
}

func (input updateInput) auditData() map[string]any {
	out := map[string]any{}

	addString := func(key string, field patchString) {
		if !field.Set {
			return
		}
		if field.Value == nil {
			out[key] = nil
			return
		}
		out[key] = *field.Value
	}
	addBool := func(key string, field patchBool) {
		if !field.Set {
			return
		}
		if field.Value == nil {
			out[key] = nil
			return
		}
		out[key] = *field.Value
	}

	addString("name", input.Name)
	addString("email", input.Email)
	addString("phone", input.Phone)
	addString("source", input.Source)
	addString("message", input.Message)
	addString("property_code", input.PropertyCode)
	addString("property_id", input.PropertyID)
	addString("interest_property_id", input.InterestPropertyID)
	addString("pipeline_id", input.PipelineID)
	addString("stage_id", input.StageID)
	addString("assigned_user_id", input.AssignedUserID)
	addString("valor_interesse", input.InterestValue)
	addString("commission_percentage", input.CommissionPercentage)
	addString("deal_status", input.DealStatus)
	addString("lost_reason", input.LostReason)
	addString("feedback", input.Feedback)
	addString("cargo", input.Cargo)
	addString("empresa", input.Empresa)
	addString("profissao", input.Profissao)
	addString("endereco", input.Endereco)
	addString("numero", input.Numero)
	addString("complemento", input.Complemento)
	addString("bairro", input.Bairro)
	addString("cep", input.CEP)
	addString("cidade", input.Cidade)
	addString("uf", input.UF)
	addString("renda_familiar", input.RendaFamiliar)
	addString("faixa_valor_imovel", input.FaixaValorImovel)
	addString("finalidade_compra", input.FinalidadeCompra)
	addBool("trabalha", input.Trabalha)
	addBool("procura_financiamento", input.ProcuraFinanciamento)
	addBool("is_own_resource", input.IsOwnResource)

	return out
}

func optionalString(value string, maxLength int) *string {
	value = trimMax(value, maxLength)
	if value == "" {
		return nil
	}

	return &value
}

func trimMax(value string, maxLength int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) > maxLength {
		return string(runes[:maxLength])
	}

	return value
}

func validEnum(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}

	return false
}

func isUUID(value string) bool {
	_, ok := normalizeUUID(value)
	return ok
}

func normalizeUUID(value string) (string, bool) {
	var uuid pgtype.UUID
	if err := uuid.Scan(strings.TrimSpace(value)); err != nil {
		return "", false
	}

	if !uuid.Valid {
		return "", false
	}

	return uuid.String(), true
}
