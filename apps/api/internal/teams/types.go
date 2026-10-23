package teams

import (
	"bytes"
	"encoding/json"
	"errors"
	"time"
)

var (
	ErrInvalidInput         = errors.New("invalid team input")
	ErrTeamNotFound         = errors.New("team not found")
	ErrTeamInUse            = errors.New("team is in use")
	ErrTeamMemberNotFound   = errors.New("team member not found")
	ErrTeamRevisionConflict = errors.New("team revision conflict")
	ErrTeamQueueSyncBlocked = errors.New("team queue synchronization exceeds participant or position limit")
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
	Revision       int64        `json:"revision"`
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

type TeamHistoryEvent struct {
	ID          string         `json:"id"`
	Action      string         `json:"action"`
	EntityType  string         `json:"entity_type"`
	EntityID    string         `json:"entity_id"`
	OldData     map[string]any `json:"old_data"`
	NewData     map[string]any `json:"new_data"`
	Diff        map[string]any `json:"diff"`
	CreatedAt   time.Time      `json:"created_at"`
	User        *TeamUser      `json:"user"`
	SubjectUser *TeamUser      `json:"subject_user"`
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
	ExpectedRevision *int64  `json:"expected_revision,omitempty"`
	TeamMemberID     string  `json:"team_member_id"`
	DayOfWeek        int     `json:"day_of_week"`
	StartTime        *string `json:"start_time"`
	EndTime          *string `json:"end_time"`
	IsAllDay         *bool   `json:"is_all_day"`
	IsActive         *bool   `json:"is_active"`
}

type BulkAvailabilityRequest struct {
	ExpectedRevision *int64                `json:"expected_revision"`
	Availability     []AvailabilityRequest `json:"availability"`
}

// AvailabilitySnapshot binds the observed week to the team aggregate revision.
type AvailabilitySnapshot struct {
	Data     []MemberAvailability `json:"data"`
	Revision int64                `json:"revision"`
}

type AvailabilityMutationResponse struct {
	Data     MemberAvailability `json:"data"`
	Revision int64              `json:"revision"`
}

type TeamMemberInput struct {
	UserID       string                `json:"userId"`
	IsLeader     bool                  `json:"isLeader"`
	Availability []AvailabilityRequest `json:"availability,omitempty"`
}

type CreateTeamRequest struct {
	IdempotencyKey    string            `json:"-"`
	Name              string            `json:"name"`
	MemberIDs         []string          `json:"memberIds"`
	Members           []TeamMemberInput `json:"members"`
	LogoURL           *string           `json:"logo_url"`
	IsActive          *bool             `json:"is_active"`
	membersProvided   bool
	memberIDsProvided bool
}

type UpdateTeamRequest struct {
	ExpectedRevision   *int64            `json:"expected_revision"`
	ExpectedMemberIDs  []string          `json:"expected_member_ids"`
	Name               *string           `json:"name"`
	MemberIDs          []string          `json:"memberIds"`
	Members            []TeamMemberInput `json:"members"`
	LogoURL            *string           `json:"logo_url"`
	IsActive           *bool             `json:"is_active"`
	PreserveLeadership bool              `json:"preserveLeadership"`
	membersProvided    bool
	memberIDsProvided  bool
}

func decodeTeamRequestMemberFields(data []byte, target any) (bool, bool, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return false, false, err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return false, false, err
	}
	_, membersProvided := fields["members"]
	_, memberIDsProvided := fields["memberIds"]
	return membersProvided, memberIDsProvided, nil
}

func (request *CreateTeamRequest) UnmarshalJSON(data []byte) error {
	type decodedRequest CreateTeamRequest
	var decoded decodedRequest
	membersProvided, memberIDsProvided, err := decodeTeamRequestMemberFields(data, &decoded)
	if err != nil {
		return err
	}
	*request = CreateTeamRequest(decoded)
	request.membersProvided = membersProvided
	request.memberIDsProvided = memberIDsProvided
	return nil
}

func (request *UpdateTeamRequest) UnmarshalJSON(data []byte) error {
	type decodedRequest UpdateTeamRequest
	var decoded decodedRequest
	membersProvided, memberIDsProvided, err := decodeTeamRequestMemberFields(data, &decoded)
	if err != nil {
		return err
	}
	*request = UpdateTeamRequest(decoded)
	request.membersProvided = membersProvided
	request.memberIDsProvided = memberIDsProvided
	return nil
}

func invalidTeamMemberFormats(membersProvided, memberIDsProvided bool, members []TeamMemberInput, memberIDs []string) bool {
	hasMembers := membersProvided || members != nil
	hasMemberIDs := memberIDsProvided || memberIDs != nil
	return (hasMembers && hasMemberIDs) ||
		(membersProvided && members == nil) ||
		(memberIDsProvided && memberIDs == nil)
}

type UpdateTeamStatusRequest struct {
	IsActive *bool `json:"is_active"`
}

type AssetUpload struct {
	URL         string `json:"url"`
	Path        string `json:"path"`
	Bucket      string `json:"bucket"`
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
}
