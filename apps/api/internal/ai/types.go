package ai

import (
	"encoding/json"
	"errors"
	"strings"
	"time"
)

var (
	ErrInvalidInput  = errors.New("invalid ai input")
	ErrAgentNotFound = errors.New("ai agent not found")
	ErrPermission    = errors.New("ai permission denied")
)

const (
	defaultModel = "gpt-4.1-mini"
)

type Config struct {
	OpenAIAPIKey  string
	OpenAIBaseURL string
	DefaultModel  string
	RealtimeModel string
	RealtimeVoice string
}

type Envelope[T any] struct {
	Data T `json:"data"`
}

type Agent struct {
	ID             string      `json:"id"`
	OrganizationID string      `json:"organizationId,omitempty"`
	Name           string      `json:"name"`
	Description    string      `json:"description,omitempty"`
	Status         string      `json:"status"`
	Config         AgentConfig `json:"config"`
	CreatedAt      time.Time   `json:"createdAt"`
	UpdatedAt      time.Time   `json:"updatedAt"`
}

type AgentConfig struct {
	Type            string   `json:"type"`
	Prompt          string   `json:"prompt"`
	Model           string   `json:"model"`
	Temperature     float64  `json:"temperature"`
	AllowedTools    []string `json:"allowedTools"`
	HandoffTargets  []string `json:"handoffTargets"`
	RoutingKeywords []string `json:"routingKeywords"`
	IsDefault       bool     `json:"isDefault"`
}

type AgentInput struct {
	OrganizationID string      `json:"organizationId,omitempty"`
	Name           string      `json:"name"`
	Description    string      `json:"description,omitempty"`
	Status         string      `json:"status"`
	Config         AgentConfig `json:"config"`
}

type RunRequest struct {
	Message        string `json:"message"`
	AgentID        string `json:"agentId,omitempty"`
	LeadID         string `json:"leadId,omitempty"`
	ConversationID string `json:"conversationId,omitempty"`
}

type RunResponse struct {
	Mode             string            `json:"mode"`
	Agent            AgentSummary      `json:"agent"`
	PreviousAgent    *AgentSummary     `json:"previousAgent,omitempty"`
	Handoff          *HandoffResult    `json:"handoff,omitempty"`
	Output           string            `json:"output"`
	ToolsUsed        []ToolResult      `json:"toolsUsed"`
	RequiresApproval []SuggestedAction `json:"requiresApproval,omitempty"`
	Memory           map[string]any    `json:"memory,omitempty"`
}

type AgentSummary struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
}

type HandoffResult struct {
	FromAgent AgentSummary `json:"fromAgent"`
	ToAgent   AgentSummary `json:"toAgent"`
	Reason    string       `json:"reason"`
}

type ToolResult struct {
	Name string `json:"name"`
	Data any    `json:"data"`
}

type SuggestedAction struct {
	Type        string         `json:"type"`
	Label       string         `json:"label"`
	Description string         `json:"description,omitempty"`
	Payload     map[string]any `json:"payload,omitempty"`
}

type LeadContext struct {
	Lead       map[string]any   `json:"lead,omitempty"`
	Activities []map[string]any `json:"activities,omitempty"`
	Properties []map[string]any `json:"properties,omitempty"`
}

func (input AgentInput) Validate() (AgentInput, error) {
	input.Name = trimMax(input.Name, 120)
	input.Description = trimMax(input.Description, 500)
	input.Status = normalizeStatus(input.Status)
	input.OrganizationID = strings.TrimSpace(input.OrganizationID)
	input.Config = normalizeAgentConfig(input.Config)
	if input.Name == "" {
		return AgentInput{}, ErrInvalidInput
	}
	return input, nil
}

func (request RunRequest) Validate() (RunRequest, error) {
	request.Message = trimMax(request.Message, 4000)
	request.AgentID = strings.TrimSpace(request.AgentID)
	request.LeadID = strings.TrimSpace(request.LeadID)
	request.ConversationID = strings.TrimSpace(request.ConversationID)
	if request.Message == "" {
		return RunRequest{}, ErrInvalidInput
	}
	return request, nil
}

func normalizeAgentConfig(config AgentConfig) AgentConfig {
	config.Type = trimMax(config.Type, 80)
	if config.Type == "" {
		config.Type = "triage"
	}
	config.Prompt = trimMax(config.Prompt, 12000)
	config.Model = trimMax(config.Model, 80)
	if config.Model == "" {
		config.Model = defaultModel
	}
	if config.Temperature < 0 || config.Temperature > 2 {
		config.Temperature = 0.3
	}
	config.AllowedTools = cleanStringList(config.AllowedTools, 40, 80)
	config.HandoffTargets = cleanStringList(config.HandoffTargets, 20, 80)
	config.RoutingKeywords = cleanStringList(config.RoutingKeywords, 80, 80)
	return config
}

func normalizeStatus(status string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "active", "paused", "draft":
		return strings.ToLower(strings.TrimSpace(status))
	default:
		return "draft"
	}
}

func cleanStringList(values []string, maxItems int, maxLength int) []string {
	out := []string{}
	seen := map[string]struct{}{}
	for _, value := range values {
		value = trimMax(value, maxLength)
		if value == "" {
			continue
		}
		key := strings.ToLower(value)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, value)
		if len(out) >= maxItems {
			break
		}
	}
	return out
}

func trimMax(value string, maxLength int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) > maxLength {
		return string(runes[:maxLength])
	}
	return value
}

func jsonb(value any) string {
	payload, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(payload)
}
