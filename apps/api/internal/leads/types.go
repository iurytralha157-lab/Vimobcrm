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
	ErrInvalidInput            = errors.New("invalid lead input")
	ErrInvalidReference        = errors.New("invalid lead reference")
	ErrLeadPropertyUnavailable = errors.New("lead property unavailable")
	ErrLeadAlreadyExists       = errors.New("lead already exists")
	ErrLeadPhoneConflict       = errors.New("lead phone already exists")
	ErrLeadNotFound            = errors.New("lead not found")
	ErrNoLeadChanges           = errors.New("no lead changes provided")
	ErrTagAlreadyExists        = errors.New("tag already exists on lead")
)

type Lead struct {
	ID                   string       `json:"id"`
	OrganizationID       string       `json:"organizationId"`
	Name                 string       `json:"name"`
	Email                string       `json:"email,omitempty"`
	Phone                string       `json:"phone,omitempty"`
	Source               string       `json:"source"`
	Status               string       `json:"status"`
	DealStatus           string       `json:"dealStatus"`
	LostReason           string       `json:"lostReason,omitempty"`
	Priority             string       `json:"priority"`
	Message              string       `json:"message,omitempty"`
	PropertyCode         string       `json:"propertyCode,omitempty"`
	PropertyID           string       `json:"propertyId,omitempty"`
	InterestPropertyID   string       `json:"interestPropertyId,omitempty"`
	PipelineID           string       `json:"pipelineId,omitempty"`
	StageID              string       `json:"stageId,omitempty"`
	AssignedUserID       string       `json:"assignedUserId,omitempty"`
	TeamID               string       `json:"teamId,omitempty"`
	InterestValue        string       `json:"interestValue,omitempty"`
	CommissionPercentage string       `json:"commissionPercentage,omitempty"`
	Feedback             string       `json:"feedback,omitempty"`
	FinalidadeCompra     string       `json:"finalidadeCompra,omitempty"`
	Trabalha             *bool        `json:"trabalha,omitempty"`
	ProcuraFinanciamento *bool        `json:"procuraFinanciamento,omitempty"`
	IsOwnResource        *bool        `json:"isOwnResource,omitempty"`
	ReentryCount         int          `json:"reentryCount"`
	Stage                *Stage       `json:"stage,omitempty"`
	Assignee             *Assignee    `json:"assignee,omitempty"`
	CreatedAt            time.Time    `json:"createdAt"`
	UpdatedAt            time.Time    `json:"updatedAt"`
	StageEnteredAt       *time.Time   `json:"stageEnteredAt,omitempty"`
	BoardOrderAt         *time.Time   `json:"boardOrderAt,omitempty"`
	LastContactAt        *time.Time   `json:"lastContactAt,omitempty"`
	NextFollowUpAt       *time.Time   `json:"nextFollowUpAt,omitempty"`
	AdditionalFields     LeadMetadata `json:"additionalFields,omitempty"`
}

type LeadMetadata map[string]any

type SensitiveLeadProfile struct {
	CPF string `json:"cpf,omitempty"`
	RG  string `json:"rg,omitempty"`
}

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
	Name                string              `json:"name"`
	Email               string              `json:"email,omitempty"`
	Phone               string              `json:"phone,omitempty"`
	Source              string              `json:"source,omitempty"`
	Message             string              `json:"message,omitempty"`
	Feedback            string              `json:"feedback,omitempty"`
	PropertyCode        string              `json:"propertyCode,omitempty"`
	PropertyID          string              `json:"propertyId,omitempty"`
	InterestPropertyIDs []string            `json:"interestPropertyIds,omitempty"`
	PipelineID          string              `json:"pipelineId,omitempty"`
	StageID             string              `json:"stageId,omitempty"`
	AssignedUserID      string              `json:"assignedUserId,omitempty"`
	TeamID              string              `json:"teamId,omitempty"`
	InterestValue       *string             `json:"interestValue,omitempty"`
	DealStatus          string              `json:"dealStatus,omitempty"`
	LostReason          string              `json:"lostReason,omitempty"`
	IsOwnResource       *bool               `json:"isOwnResource,omitempty"`
	ConversationID      string              `json:"conversationId,omitempty"`
	TagIDs              []string            `json:"tagIds,omitempty"`
	Cargo               string              `json:"cargo,omitempty"`
	Empresa             string              `json:"empresa,omitempty"`
	Profissao           string              `json:"profissao,omitempty"`
	Endereco            string              `json:"endereco,omitempty"`
	Bairro              string              `json:"bairro,omitempty"`
	Numero              string              `json:"numero,omitempty"`
	CEP                 string              `json:"cep,omitempty"`
	Cidade              string              `json:"cidade,omitempty"`
	UF                  string              `json:"uf,omitempty"`
	RendaFamiliar       string              `json:"rendaFamiliar,omitempty"`
	FaixaValorImovel    string              `json:"faixaValorImovel,omitempty"`
	Profile             *LeadProfileRequest `json:"profile,omitempty"`
	ImportMode          bool                `json:"importMode,omitempty"`
}

type LeadProfileRequest struct {
	PersonType        string `json:"personType,omitempty"`
	Gender            string `json:"gender,omitempty"`
	SocialName        string `json:"socialName,omitempty"`
	BirthDate         string `json:"birthDate,omitempty"`
	CPF               string `json:"cpf,omitempty"`
	RG                string `json:"rg,omitempty"`
	CNPJ              string `json:"cnpj,omitempty"`
	CorporateName     string `json:"corporateName,omitempty"`
	TradeName         string `json:"tradeName,omitempty"`
	StateRegistration string `json:"stateRegistration,omitempty"`
}

type createInput struct {
	Name                string
	Email               *string
	Phone               *string
	Source              string
	Message             *string
	Feedback            *string
	PropertyCode        *string
	PropertyID          *string
	InterestPropertyIDs []string
	PipelineID          *string
	StageID             *string
	AssignedUserID      *string
	TeamID              *string
	InterestValue       *string
	DealStatus          string
	LostReason          *string
	IsOwnResource       *bool
	ConversationID      *string
	TagIDs              []string
	Cargo               *string
	Empresa             *string
	Profissao           *string
	Endereco            *string
	Bairro              *string
	Numero              *string
	CEP                 *string
	Cidade              *string
	UF                  *string
	RendaFamiliar       *string
	FaixaValorImovel    *string
	Metadata            LeadMetadata
	ImportMode          bool
}

type patchString struct {
	Set   bool
	Value *string
}

type patchBool struct {
	Set   bool
	Value *bool
}

type patchStringSlice struct {
	Set   bool
	Value []string
}

type UpdateRequest struct {
	Name                 patchString         `json:"name,omitempty"`
	Email                patchString         `json:"email,omitempty"`
	Phone                patchString         `json:"phone,omitempty"`
	Source               patchString         `json:"source,omitempty"`
	Message              patchString         `json:"message,omitempty"`
	PropertyCode         patchString         `json:"propertyCode,omitempty"`
	PropertyID           patchString         `json:"propertyId,omitempty"`
	InterestPropertyID   patchString         `json:"interestPropertyId,omitempty"`
	PipelineID           patchString         `json:"pipelineId,omitempty"`
	StageID              patchString         `json:"stageId,omitempty"`
	AssignedUserID       patchString         `json:"assignedUserId,omitempty"`
	TeamID               patchString         `json:"teamId,omitempty"`
	InterestPropertyIDs  patchStringSlice    `json:"interestPropertyIds,omitempty"`
	InterestValue        patchString         `json:"interestValue,omitempty"`
	CommissionPercentage patchString         `json:"commissionPercentage,omitempty"`
	DealStatus           patchString         `json:"dealStatus,omitempty"`
	LostReason           patchString         `json:"lostReason,omitempty"`
	Feedback             patchString         `json:"feedback,omitempty"`
	Cargo                patchString         `json:"cargo,omitempty"`
	Empresa              patchString         `json:"empresa,omitempty"`
	Profissao            patchString         `json:"profissao,omitempty"`
	Endereco             patchString         `json:"endereco,omitempty"`
	Numero               patchString         `json:"numero,omitempty"`
	Complemento          patchString         `json:"complemento,omitempty"`
	Bairro               patchString         `json:"bairro,omitempty"`
	CEP                  patchString         `json:"cep,omitempty"`
	Cidade               patchString         `json:"cidade,omitempty"`
	UF                   patchString         `json:"uf,omitempty"`
	RendaFamiliar        patchString         `json:"rendaFamiliar,omitempty"`
	FaixaValorImovel     patchString         `json:"faixaValorImovel,omitempty"`
	FinalidadeCompra     patchString         `json:"finalidadeCompra,omitempty"`
	Trabalha             patchBool           `json:"trabalha,omitempty"`
	ProcuraFinanciamento patchBool           `json:"procuraFinanciamento,omitempty"`
	IsOwnResource        patchBool           `json:"isOwnResource,omitempty"`
	Profile              *LeadProfileRequest `json:"profile,omitempty"`
	Metadata             LeadMetadata        `json:"-"`
	MetadataSet          bool                `json:"-"`
}

type updateInput UpdateRequest

type TagRequest struct {
	TagID string `json:"tagId"`
}

type tagInput struct {
	TagID string
}

type MoveStageRequest struct {
	StageID       string     `json:"stageId"`
	IsOwnResource *bool      `json:"isOwnResource,omitempty"`
	BoardOrderAt  *time.Time `json:"boardOrderAt,omitempty"`
	// StageEnteredAt is kept temporarily for compatibility with older clients
	// that used this field as the visual Kanban order.
	StageEnteredAt *time.Time `json:"stageEnteredAt,omitempty"`
}

type moveStageInput struct {
	StageID        string
	IsOwnResource  *bool
	BoardOrderAt   *time.Time
	StageEnteredAt *time.Time
}

type moveStageResult struct {
	Lead         Lead
	StageChanged bool
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

func (field *patchStringSlice) UnmarshalJSON(data []byte) error {
	field.Set = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		field.Value = []string{}
		return nil
	}

	if err := json.Unmarshal(data, &field.Value); err != nil {
		return fmt.Errorf("%w: expected string array or null", ErrInvalidInput)
	}

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
		Feedback:         optionalString(request.Feedback, 2_000),
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
		ImportMode:       request.ImportMode,
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
	if input.DealStatus == "lost" && input.LostReason == nil {
		return createInput{}, fmt.Errorf("%w: lostReason is required when dealStatus is lost", ErrInvalidInput)
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

	if len(request.InterestPropertyIDs) > 20 {
		return createInput{}, fmt.Errorf("%w: interestPropertyIds can contain at most 20 items", ErrInvalidInput)
	}
	seenPropertyIDs := map[string]struct{}{}
	if input.PropertyID != nil {
		seenPropertyIDs[*input.PropertyID] = struct{}{}
		input.InterestPropertyIDs = append(input.InterestPropertyIDs, *input.PropertyID)
	}
	for _, propertyID := range request.InterestPropertyIDs {
		value, ok := normalizeUUID(propertyID)
		if !ok {
			return createInput{}, fmt.Errorf("%w: interestPropertyIds contains an invalid uuid", ErrInvalidInput)
		}
		if _, exists := seenPropertyIDs[value]; exists {
			continue
		}
		seenPropertyIDs[value] = struct{}{}
		input.InterestPropertyIDs = append(input.InterestPropertyIDs, value)
	}
	if input.PropertyID == nil && len(input.InterestPropertyIDs) > 0 {
		value := input.InterestPropertyIDs[0]
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

	if request.TeamID != "" {
		value, ok := normalizeUUID(request.TeamID)
		if !ok {
			return createInput{}, fmt.Errorf("%w: teamId is invalid", ErrInvalidInput)
		}
		input.TeamID = &value
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

	metadata, err := validateLeadProfile(request.Profile, input.InterestPropertyIDs)
	if err != nil {
		return createInput{}, err
	}
	input.Metadata = metadata

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
	if request.BoardOrderAt != nil && request.BoardOrderAt.IsZero() {
		return moveStageInput{}, fmt.Errorf("%w: boardOrderAt is invalid", ErrInvalidInput)
	}

	return moveStageInput{
		StageID:        stageID,
		IsOwnResource:  request.IsOwnResource,
		BoardOrderAt:   request.BoardOrderAt,
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
		TeamID:               request.TeamID,
		InterestPropertyIDs:  request.InterestPropertyIDs,
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
		Profile:              request.Profile,
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
		{name: "teamId", field: &input.TeamID},
	} {
		if err := validatePatchUUID(item.name, item.field); err != nil {
			return updateInput{}, err
		}
	}

	if input.InterestPropertyIDs.Set {
		if len(input.InterestPropertyIDs.Value) > 20 {
			return updateInput{}, fmt.Errorf("%w: interestPropertyIds can contain at most 20 items", ErrInvalidInput)
		}
		seenPropertyIDs := map[string]struct{}{}
		propertyIDs := make([]string, 0, len(input.InterestPropertyIDs.Value))
		for _, propertyID := range input.InterestPropertyIDs.Value {
			value, ok := normalizeUUID(propertyID)
			if !ok {
				return updateInput{}, fmt.Errorf("%w: interestPropertyIds contains an invalid uuid", ErrInvalidInput)
			}
			if _, exists := seenPropertyIDs[value]; exists {
				continue
			}
			seenPropertyIDs[value] = struct{}{}
			propertyIDs = append(propertyIDs, value)
		}
		input.InterestPropertyIDs.Value = propertyIDs
	}

	if input.Profile != nil || input.InterestPropertyIDs.Set {
		metadata := LeadMetadata{}
		if input.InterestPropertyIDs.Set {
			metadata["interestPropertyIds"] = input.InterestPropertyIDs.Value
		}
		if input.Profile != nil {
			profileMetadata, err := validateLeadProfile(input.Profile, nil)
			if err != nil {
				return updateInput{}, err
			}
			metadata["profile"] = profileMetadata["profile"]
		}
		input.Metadata = metadata
		input.MetadataSet = true
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

	if !input.hasChanges() {
		return updateInput{}, ErrNoLeadChanges
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
		input.TeamID,
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

	return input.Trabalha.Set || input.ProcuraFinanciamento.Set || input.IsOwnResource.Set || input.MetadataSet
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
	addString("team_id", input.TeamID)
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
	if input.MetadataSet {
		if profile, ok := input.Metadata["profile"].(LeadMetadata); ok {
			for _, key := range []string{
				"personType", "gender", "socialName", "birthDate", "cpf", "rg", "cnpj",
				"corporateName", "tradeName", "stateRegistration",
			} {
				value, exists := profile[key]
				if !exists {
					out[leadProfileAuditKey(key)] = nil
					continue
				}
				out[leadProfileAuditKey(key)] = value
			}
		}
	}

	return out
}

func leadProfileAuditKey(key string) string {
	switch key {
	case "personType":
		return "person_type"
	case "socialName":
		return "social_name"
	case "birthDate":
		return "birth_date"
	case "corporateName":
		return "corporate_name"
	case "tradeName":
		return "trade_name"
	case "stateRegistration":
		return "state_registration"
	default:
		return key
	}
}

func validateLeadProfile(request *LeadProfileRequest, interestPropertyIDs []string) (LeadMetadata, error) {
	metadata := LeadMetadata{}
	if len(interestPropertyIDs) > 0 {
		metadata["interestPropertyIds"] = interestPropertyIDs
	}
	if request == nil {
		return metadata, nil
	}

	personType := trimMax(request.PersonType, 20)
	if personType == "" {
		personType = "individual"
	}
	if !validEnum(personType, "individual", "company") {
		return nil, fmt.Errorf("%w: profile.personType is invalid", ErrInvalidInput)
	}

	gender := trimMax(request.Gender, 20)
	if gender != "" && !validEnum(gender, "male", "female", "other") {
		return nil, fmt.Errorf("%w: profile.gender is invalid", ErrInvalidInput)
	}

	birthDate := strings.TrimSpace(request.BirthDate)
	if birthDate != "" {
		parsed, err := time.Parse("2006-01-02", birthDate)
		if err != nil || parsed.Before(time.Date(1900, 1, 1, 0, 0, 0, 0, time.UTC)) || parsed.After(time.Now().UTC()) {
			return nil, fmt.Errorf("%w: profile.birthDate is invalid", ErrInvalidInput)
		}
	}

	cpf := digitsOnly(request.CPF)
	if cpf != "" && len(cpf) != 11 {
		return nil, fmt.Errorf("%w: profile.cpf is invalid", ErrInvalidInput)
	}
	cnpj := digitsOnly(request.CNPJ)
	if cnpj != "" && len(cnpj) != 14 {
		return nil, fmt.Errorf("%w: profile.cnpj is invalid", ErrInvalidInput)
	}

	profile := LeadMetadata{"personType": personType}
	add := func(key string, value string, maxLength int) {
		value = trimMax(value, maxLength)
		if value != "" {
			profile[key] = value
		}
	}
	add("gender", gender, 20)
	add("socialName", request.SocialName, 180)
	add("birthDate", birthDate, 10)
	add("cpf", cpf, 11)
	add("rg", request.RG, 30)
	add("cnpj", cnpj, 14)
	add("corporateName", request.CorporateName, 180)
	add("tradeName", request.TradeName, 180)
	add("stateRegistration", request.StateRegistration, 40)
	metadata["profile"] = profile

	return metadata, nil
}

func digitsOnly(value string) string {
	var builder strings.Builder
	for _, character := range value {
		if character >= '0' && character <= '9' {
			builder.WriteRune(character)
		}
	}
	return builder.String()
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
