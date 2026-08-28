package homefocus

import (
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	defaultLimit = 8
	maxLimit     = 20
)

var (
	ErrInvalidInput = errors.New("invalid home focus input")
	ErrForbidden    = errors.New("home focus access denied")
)

type Envelope[T any] struct {
	Data T `json:"data"`
}

type Item struct {
	ID            string    `json:"id"`
	Kind          string    `json:"kind"`
	ObligationKey string    `json:"obligation_key"`
	LeadID        string    `json:"lead_id"`
	LeadName      string    `json:"lead_name"`
	Title         string    `json:"title"`
	Description   string    `json:"description"`
	DueAt         time.Time `json:"due_at"`
	Status        string    `json:"status"`
	Tone          string    `json:"tone"`
	PolicyType    *string   `json:"policy_type,omitempty"`
	TaskType      *string   `json:"task_type,omitempty"`
	TargetURL     string    `json:"target_url"`
	StageID       *string   `json:"stage_id,omitempty"`
	StageName     *string   `json:"stage_name,omitempty"`
}

type Notice struct {
	ID                     string     `json:"id"`
	Source                 string     `json:"source"`
	Severity               string     `json:"severity"`
	Title                  string     `json:"title"`
	Description            string     `json:"description"`
	ActionLabel            *string    `json:"action_label,omitempty"`
	ActionURL              *string    `json:"action_url,omitempty"`
	Dismissible            bool       `json:"dismissible"`
	DisplayDurationSeconds *int       `json:"display_duration_seconds,omitempty"`
	StartsAt               *time.Time `json:"starts_at,omitempty"`
	EndsAt                 *time.Time `json:"ends_at,omitempty"`
}

type Filter struct {
	Limit int
	Scope string
}

func normalizeFilter(values url.Values) (Filter, error) {
	filter := Filter{
		Limit: defaultLimit,
		Scope: strings.ToLower(strings.TrimSpace(values.Get("scope"))),
	}
	if filter.Scope == "" {
		filter.Scope = "mine"
	}
	switch filter.Scope {
	case "mine", "team", "organization", "all":
	default:
		return Filter{}, fmt.Errorf("%w: scope is invalid", ErrInvalidInput)
	}

	rawLimit := strings.TrimSpace(values.Get("limit"))
	if rawLimit == "" {
		return filter, nil
	}
	limit, err := strconv.Atoi(rawLimit)
	if err != nil || limit < 1 {
		return Filter{}, fmt.Errorf("%w: limit must be a positive integer", ErrInvalidInput)
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	filter.Limit = limit
	return filter, nil
}
