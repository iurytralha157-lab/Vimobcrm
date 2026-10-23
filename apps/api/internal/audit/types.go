package audit

import (
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
	Diff           map[string]any `json:"diff,omitempty"`
	Source         string         `json:"source,omitempty"`
	Metadata       map[string]any `json:"metadata,omitempty"`
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
