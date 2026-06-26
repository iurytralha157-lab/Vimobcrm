package audit

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

const (
	defaultLimit = 20
	maxLimit     = 200
)

var ErrInvalidInput = errors.New("invalid audit input")

type AuditLog struct {
	ID             string         `json:"id"`
	OrganizationID string         `json:"organization_id,omitempty"`
	UserID         string         `json:"user_id,omitempty"`
	Action         string         `json:"action"`
	EntityType     string         `json:"entity_type"`
	EntityID       string         `json:"entity_id,omitempty"`
	OldData        map[string]any `json:"old_data,omitempty"`
	NewData        map[string]any `json:"new_data,omitempty"`
	IPAddress      string         `json:"ip_address,omitempty"`
	UserAgent      string         `json:"user_agent,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
	User           *AuditUser     `json:"user,omitempty"`
	Organization   *AuditOrg      `json:"organization,omitempty"`
}

type AuditUser struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}

type AuditOrg struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type ListResponse struct {
	Data       []AuditLog `json:"data"`
	Count      int64      `json:"count"`
	TotalPages int        `json:"totalPages"`
}

type ListFilter struct {
	OrganizationID string
	UserID         string
	Action         string
	EntityType     string
	StartDate      string
	EndDate        string
	Page           int
	Limit          int
}

type CreateRequest struct {
	Action         string         `json:"action"`
	EntityType     string         `json:"entity_type"`
	EntityID       string         `json:"entity_id,omitempty"`
	OldData        map[string]any `json:"old_data,omitempty"`
	NewData        map[string]any `json:"new_data,omitempty"`
	OrganizationID string         `json:"organization_id,omitempty"`
	UserAgent      string         `json:"user_agent,omitempty"`
}

type createInput struct {
	Action         string
	EntityType     string
	EntityID       string
	OldData        map[string]any
	NewData        map[string]any
	OrganizationID string
	UserAgent      string
	IPAddress      string
}

func ParseListFilter(values url.Values) (ListFilter, error) {
	page, err := parseBoundedInt(values.Get("page"), 1, 1, 10_000)
	if err != nil {
		return ListFilter{}, err
	}
	limit, err := parseBoundedInt(values.Get("limit"), defaultLimit, 1, maxLimit)
	if err != nil {
		return ListFilter{}, err
	}

	filter := ListFilter{
		OrganizationID: strings.TrimSpace(values.Get("organizationId")),
		UserID:         strings.TrimSpace(values.Get("userId")),
		Action:         trimMax(values.Get("action"), 120),
		EntityType:     trimMax(values.Get("entityType"), 120),
		StartDate:      strings.TrimSpace(values.Get("startDate")),
		EndDate:        strings.TrimSpace(values.Get("endDate")),
		Page:           page,
		Limit:          limit,
	}

	for _, item := range []struct {
		name  string
		value string
	}{
		{name: "organizationId", value: filter.OrganizationID},
		{name: "userId", value: filter.UserID},
	} {
		if item.value != "" && !isUUID(item.value) {
			return ListFilter{}, fmt.Errorf("%w: %s is invalid", ErrInvalidInput, item.name)
		}
	}

	return filter, nil
}

func (request CreateRequest) Validate(ipAddress string) (createInput, error) {
	input := createInput{
		Action:         trimMax(request.Action, 120),
		EntityType:     trimMax(request.EntityType, 120),
		EntityID:       trimMax(request.EntityID, 160),
		OldData:        boundedMap(request.OldData, 8_000),
		NewData:        boundedMap(request.NewData, 8_000),
		OrganizationID: strings.TrimSpace(request.OrganizationID),
		UserAgent:      trimMax(request.UserAgent, 500),
		IPAddress:      trimMax(ipAddress, 80),
	}
	if input.Action == "" {
		return createInput{}, fmt.Errorf("%w: action is required", ErrInvalidInput)
	}
	if input.EntityType == "" {
		return createInput{}, fmt.Errorf("%w: entity_type is required", ErrInvalidInput)
	}
	if input.OrganizationID != "" && !isUUID(input.OrganizationID) {
		return createInput{}, fmt.Errorf("%w: organization_id is invalid", ErrInvalidInput)
	}
	return input, nil
}

func parseBoundedInt(raw string, fallback int, minValue int, maxValue int) (int, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("%w: invalid integer", ErrInvalidInput)
	}
	if value < minValue || value > maxValue {
		return 0, fmt.Errorf("%w: integer out of range", ErrInvalidInput)
	}
	return value, nil
}

func trimMax(value string, max int) string {
	value = strings.TrimSpace(value)
	if max > 0 && len(value) > max {
		return value[:max]
	}
	return value
}

func isUUID(value string) bool {
	var uuid pgtype.UUID
	return uuid.Scan(strings.TrimSpace(value)) == nil && uuid.Valid
}

func boundedMap(value map[string]any, maxBytes int) map[string]any {
	if value == nil {
		return nil
	}
	payload, err := json.Marshal(value)
	if err != nil {
		return map[string]any{"invalid": true}
	}
	if len(payload) <= maxBytes {
		return value
	}
	return map[string]any{
		"truncated":     true,
		"originalBytes": len(payload),
	}
}
