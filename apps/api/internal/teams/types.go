package teams

import "errors"

var (
	ErrInvalidInput         = errors.New("invalid team input")
	ErrTeamNotFound         = errors.New("team not found")
	ErrTeamMemberNotFound   = errors.New("team member not found")
	ErrStorageNotConfigured = errors.New("team storage is not configured")
	ErrStorageOperation     = errors.New("team storage operation failed")
)

type Envelope[T any] struct {
	Data T `json:"data"`
}

type Team struct {
	ID             string       `json:"id"`
	Name           string       `json:"name"`
	OrganizationID string       `json:"organization_id"`
	CreatedAt      string       `json:"created_at"`
	IsActive       bool         `json:"is_active"`
	LogoURL        *string      `json:"logo_url"`
	CreatedBy      *string      `json:"created_by"`
	CreatedByUser  *TeamUser    `json:"created_by_user"`
	Members        []TeamMember `json:"members"`
}

type TeamMember struct {
	ID        string    `json:"id"`
	TeamID    string    `json:"team_id"`
	UserID    string    `json:"user_id"`
	CreatedAt string    `json:"created_at"`
	IsLeader  bool      `json:"is_leader"`
	User      *TeamUser `json:"user"`
}

type TeamUser struct {
	ID        string  `json:"id"`
	Name      *string `json:"name"`
	Email     *string `json:"email"`
	AvatarURL *string `json:"avatar_url"`
}

type EntityRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type TeamPipelineRelation struct {
	ID         string     `json:"id"`
	TeamID     string     `json:"team_id"`
	PipelineID string     `json:"pipeline_id"`
	CreatedAt  string     `json:"created_at"`
	Pipeline   *EntityRef `json:"pipeline"`
	Team       *EntityRef `json:"team,omitempty"`
}

type AssignPipelineRequest struct {
	TeamID     string `json:"teamId"`
	PipelineID string `json:"pipelineId"`
}

type SetTeamLeaderRequest struct {
	TeamID   string `json:"teamId"`
	UserID   string `json:"userId"`
	IsLeader bool   `json:"isLeader"`
}

type MemberAvailability struct {
	ID           string  `json:"id"`
	TeamMemberID string  `json:"team_member_id"`
	DayOfWeek    int     `json:"day_of_week"`
	StartTime    *string `json:"start_time"`
	EndTime      *string `json:"end_time"`
	IsAllDay     bool    `json:"is_all_day"`
	IsActive     bool    `json:"is_active"`
	CreatedAt    string  `json:"created_at"`
	UpdatedAt    string  `json:"updated_at"`
}

type AvailabilityRequest struct {
	TeamMemberID string  `json:"team_member_id"`
	DayOfWeek    int     `json:"day_of_week"`
	StartTime    *string `json:"start_time"`
	EndTime      *string `json:"end_time"`
	IsAllDay     *bool   `json:"is_all_day"`
	IsActive     *bool   `json:"is_active"`
}

type BulkAvailabilityRequest struct {
	Availability []AvailabilityRequest `json:"availability"`
}

type TeamMemberInput struct {
	UserID   string `json:"userId"`
	IsLeader bool   `json:"isLeader"`
}

type CreateTeamRequest struct {
	Name      string            `json:"name"`
	MemberIDs []string          `json:"memberIds"`
	Members   []TeamMemberInput `json:"members"`
	LogoURL   *string           `json:"logo_url"`
	IsActive  *bool             `json:"is_active"`
}

type UpdateTeamRequest struct {
	Name               *string           `json:"name"`
	MemberIDs          []string          `json:"memberIds"`
	Members            []TeamMemberInput `json:"members"`
	LogoURL            *string           `json:"logo_url"`
	IsActive           *bool             `json:"is_active"`
	PreserveLeadership bool              `json:"preserveLeadership"`
}

type UpdateTeamStatusRequest struct {
	IsActive bool `json:"is_active"`
}

type AssetUpload struct {
	URL         string `json:"url"`
	Path        string `json:"path"`
	Bucket      string `json:"bucket"`
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
}
