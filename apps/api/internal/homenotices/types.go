package homenotices

import "time"

type Envelope[T any] struct {
	Data T `json:"data"`
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
