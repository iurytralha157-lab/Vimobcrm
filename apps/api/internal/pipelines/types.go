package pipelines

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

var (
	ErrInvalidInput     = errors.New("invalid pipeline input")
	ErrInvalidReference = errors.New("invalid pipeline reference")
	ErrPipelineNotFound = errors.New("pipeline not found")
	ErrStageNotFound    = errors.New("stage not found")
	ErrHasLeads         = errors.New("pipeline or stage has leads")
	ErrNoChanges        = errors.New("no pipeline changes provided")
)

type Pipeline struct {
	ID                  string    `json:"id"`
	OrganizationID      string    `json:"organizationId"`
	Name                string    `json:"name"`
	IsDefault           bool      `json:"isDefault"`
	IsActive            bool      `json:"isActive"`
	Position            int       `json:"position"`
	DefaultRoundRobinID string    `json:"defaultRoundRobinId,omitempty"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
}

type Stage struct {
	ID             string    `json:"id"`
	OrganizationID string    `json:"organizationId"`
	PipelineID     string    `json:"pipelineId"`
	Name           string    `json:"name"`
	Color          string    `json:"color,omitempty"`
	StageKey       string    `json:"stageKey,omitempty"`
	Position       int       `json:"position"`
	IsWon          bool      `json:"isWon"`
	IsLost         bool      `json:"isLost"`
	IsActive       bool      `json:"isActive"`
	SLAHours       int       `json:"slaHours,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type CreatePipelineRequest struct {
	Name      string `json:"name"`
	IsDefault bool   `json:"isDefault,omitempty"`
}

type createPipelineInput struct {
	Name      string
	IsDefault bool
}

type patchString struct {
	Set   bool
	Value *string
}

type patchBool struct {
	Set   bool
	Value *bool
}

type UpdatePipelineRequest struct {
	Name      patchString `json:"name,omitempty"`
	IsDefault patchBool   `json:"isDefault,omitempty"`
}

type updatePipelineInput UpdatePipelineRequest

type CreateStageRequest struct {
	Name  string `json:"name"`
	Color string `json:"color,omitempty"`
}

type createStageInput struct {
	Name  string
	Color string
}

type UpdateStageRequest struct {
	Name     patchString `json:"name,omitempty"`
	Color    patchString `json:"color,omitempty"`
	StageKey patchString `json:"stageKey,omitempty"`
	IsWon    patchBool   `json:"isWon,omitempty"`
	IsLost   patchBool   `json:"isLost,omitempty"`
	IsActive patchBool   `json:"isActive,omitempty"`
}

type updateStageInput UpdateStageRequest

type ReorderStagesRequest struct {
	Stages []StageOrderItem `json:"stages"`
}

type StageOrderItem struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Color    string `json:"color,omitempty"`
	StageKey string `json:"stageKey,omitempty"`
}

type reorderStagesInput struct {
	Stages []stageOrderItem
}

type stageOrderItem struct {
	ID       string
	Name     string
	Color    string
	StageKey string
	Position int
}

type SetPipelineRoundRobinRequest struct {
	RoundRobinID *string `json:"roundRobinId"`
}

type setPipelineRoundRobinInput struct {
	RoundRobinID *string
}

func (field *patchString) UnmarshalJSON(data []byte) error {
	field.Set = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		field.Value = nil
		return nil
	}

	var value string
	if err := json.Unmarshal(data, &value); err != nil {
		return fmt.Errorf("%w: expected string or null", ErrInvalidInput)
	}
	field.Value = &value
	return nil
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

func (request CreatePipelineRequest) Validate() (createPipelineInput, error) {
	name := trimMax(request.Name, 120)
	if len([]rune(name)) < 2 {
		return createPipelineInput{}, fmt.Errorf("%w: name must have at least 2 characters", ErrInvalidInput)
	}

	return createPipelineInput{Name: name, IsDefault: request.IsDefault}, nil
}

func (request UpdatePipelineRequest) Validate() (updatePipelineInput, error) {
	input := updatePipelineInput{
		Name:      validatePatchString(request.Name, 120),
		IsDefault: request.IsDefault,
	}
	if !input.Name.Set && !input.IsDefault.Set {
		return updatePipelineInput{}, ErrNoChanges
	}
	if input.Name.Set && (input.Name.Value == nil || len([]rune(*input.Name.Value)) < 2) {
		return updatePipelineInput{}, fmt.Errorf("%w: name must have at least 2 characters", ErrInvalidInput)
	}

	return input, nil
}

func (request CreateStageRequest) Validate() (createStageInput, error) {
	name := trimMax(request.Name, 120)
	if len([]rune(name)) < 2 {
		return createStageInput{}, fmt.Errorf("%w: name must have at least 2 characters", ErrInvalidInput)
	}

	color := trimMax(request.Color, 20)
	if color == "" {
		color = "#6b7280"
	}

	return createStageInput{Name: name, Color: color}, nil
}

func (request UpdateStageRequest) Validate() (updateStageInput, error) {
	input := updateStageInput{
		Name:     validatePatchString(request.Name, 120),
		Color:    validatePatchString(request.Color, 20),
		StageKey: validatePatchString(request.StageKey, 80),
		IsWon:    request.IsWon,
		IsLost:   request.IsLost,
		IsActive: request.IsActive,
	}
	if !input.Name.Set && !input.Color.Set && !input.StageKey.Set && !input.IsWon.Set && !input.IsLost.Set && !input.IsActive.Set {
		return updateStageInput{}, ErrNoChanges
	}
	if input.Name.Set && (input.Name.Value == nil || len([]rune(*input.Name.Value)) < 2) {
		return updateStageInput{}, fmt.Errorf("%w: name must have at least 2 characters", ErrInvalidInput)
	}

	return input, nil
}

func (request ReorderStagesRequest) Validate() (reorderStagesInput, error) {
	if len(request.Stages) == 0 {
		return reorderStagesInput{}, fmt.Errorf("%w: stages is required", ErrInvalidInput)
	}
	if len(request.Stages) > 100 {
		return reorderStagesInput{}, fmt.Errorf("%w: at most 100 stages can be reordered", ErrInvalidInput)
	}

	input := reorderStagesInput{Stages: make([]stageOrderItem, 0, len(request.Stages))}
	seen := map[string]struct{}{}
	for index, item := range request.Stages {
		id, ok := normalizeUUID(item.ID)
		if !ok {
			return reorderStagesInput{}, fmt.Errorf("%w: stage id is invalid", ErrInvalidInput)
		}
		if _, exists := seen[id]; exists {
			return reorderStagesInput{}, fmt.Errorf("%w: duplicated stage id", ErrInvalidInput)
		}
		seen[id] = struct{}{}

		name := trimMax(item.Name, 120)
		if len([]rune(name)) < 2 {
			return reorderStagesInput{}, fmt.Errorf("%w: stage name must have at least 2 characters", ErrInvalidInput)
		}
		color := trimMax(item.Color, 20)
		if color == "" {
			color = "#6b7280"
		}
		stageKey := trimMax(item.StageKey, 80)
		if stageKey == "" {
			stageKey = buildStageKey(name)
		}

		input.Stages = append(input.Stages, stageOrderItem{
			ID:       id,
			Name:     name,
			Color:    color,
			StageKey: stageKey,
			Position: index,
		})
	}

	return input, nil
}

func (request SetPipelineRoundRobinRequest) Validate() (setPipelineRoundRobinInput, error) {
	if request.RoundRobinID == nil || strings.TrimSpace(*request.RoundRobinID) == "" {
		return setPipelineRoundRobinInput{}, nil
	}

	value, ok := normalizeUUID(*request.RoundRobinID)
	if !ok {
		return setPipelineRoundRobinInput{}, fmt.Errorf("%w: roundRobinId is invalid", ErrInvalidInput)
	}

	return setPipelineRoundRobinInput{RoundRobinID: &value}, nil
}

func validatePatchString(field patchString, maxLength int) patchString {
	if !field.Set || field.Value == nil {
		return field
	}

	value := trimMax(*field.Value, maxLength)
	field.Value = &value
	return field
}

func trimMax(value string, maxLength int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) > maxLength {
		return string(runes[:maxLength])
	}
	return value
}

func buildStageKey(name string) string {
	name = strings.ToLower(strings.TrimSpace(name))
	var builder strings.Builder
	lastUnderscore := false
	for _, char := range name {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') {
			builder.WriteRune(char)
			lastUnderscore = false
			continue
		}
		if !lastUnderscore {
			builder.WriteRune('_')
			lastUnderscore = true
		}
	}
	out := strings.Trim(builder.String(), "_")
	if out == "" {
		return "coluna"
	}
	return out
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
