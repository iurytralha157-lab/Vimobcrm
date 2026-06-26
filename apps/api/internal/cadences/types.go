package cadences

import "errors"

var (
	ErrInvalidInput     = errors.New("invalid cadence input")
	ErrCadenceNotFound  = errors.New("cadence not found")
	ErrCadenceForbidden = errors.New("cadence access denied")
)

type Envelope[T any] struct {
	Data T `json:"data"`
}

type TaskTemplate struct {
	ID                 string  `json:"id"`
	CadenceTemplateID  string  `json:"cadence_template_id"`
	DayOffset          int     `json:"day_offset"`
	Title              string  `json:"title"`
	Description        *string `json:"description"`
	Position           *int    `json:"position"`
	Type               *string `json:"type"`
	Observation        *string `json:"observation"`
	RecommendedMessage *string `json:"recommended_message"`
}

type Template struct {
	ID             string         `json:"id"`
	OrganizationID string         `json:"organization_id"`
	PipelineID     *string        `json:"pipeline_id"`
	StageID        *string        `json:"stage_id"`
	StageKey       *string        `json:"stage_key"`
	Name           string         `json:"name"`
	Description    *string        `json:"description,omitempty"`
	IsActive       bool           `json:"is_active"`
	CreatedAt      string         `json:"created_at"`
	UpdatedAt      *string        `json:"updated_at,omitempty"`
	Tasks          []TaskTemplate `json:"tasks"`
}

type TaskRequest struct {
	CadenceTemplateID  string  `json:"cadence_template_id"`
	DayOffset          int     `json:"day_offset"`
	Type               string  `json:"type"`
	Title              string  `json:"title"`
	Description        *string `json:"description"`
	Observation        *string `json:"observation"`
	RecommendedMessage *string `json:"recommended_message"`
}

type UpdateTaskRequest struct {
	DayOffset          int     `json:"day_offset"`
	Type               string  `json:"type"`
	Title              string  `json:"title"`
	Description        *string `json:"description"`
	Observation        *string `json:"observation"`
	RecommendedMessage *string `json:"recommended_message"`
}

type taskInput struct {
	CadenceTemplateID  string
	DayOffset          int
	Type               string
	Title              string
	Description        *string
	Observation        *string
	RecommendedMessage *string
}
