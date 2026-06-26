package leads

import (
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

const (
	defaultPipelineBoardLimit = 12
	maxPipelineBoardLimit     = 100
)

type PipelineBoardFilter struct {
	PipelineID       string
	StageID          string
	StageIDs         []string
	Offset           int
	Limit            int
	Search           string
	FilterUserID     string
	FilterUserIDs    []string
	FilterUserIDsSet bool
	FilterTag        string
	FilterDealStatus string
	FilterCampaign   string
	FilterAdSet      string
	FilterAd         string
	FilterSource     string
	DateFrom         *time.Time
	DateTo           *time.Time
}

type PipelineBoardStage struct {
	ID             string              `json:"id"`
	OrganizationID string              `json:"organization_id"`
	PipelineID     string              `json:"pipeline_id"`
	Name           string              `json:"name"`
	Color          *string             `json:"color"`
	StageKey       *string             `json:"stage_key"`
	Position       int                 `json:"position"`
	IsWon          bool                `json:"is_won"`
	IsLost         bool                `json:"is_lost"`
	SLAHours       *int                `json:"sla_hours"`
	IsActive       bool                `json:"is_active"`
	CreatedAt      time.Time           `json:"created_at"`
	UpdatedAt      time.Time           `json:"updated_at"`
	Leads          []PipelineBoardLead `json:"leads"`
	TotalLeadCount int64               `json:"total_lead_count"`
	HasMore        bool                `json:"has_more"`
}

type PipelineBoardLead struct {
	ID                        string                  `json:"id"`
	Name                      string                  `json:"name"`
	Phone                     *string                 `json:"phone"`
	Email                     *string                 `json:"email"`
	Source                    string                  `json:"source"`
	CreatedAt                 time.Time               `json:"created_at"`
	UpdatedAt                 time.Time               `json:"updated_at"`
	StageID                   *string                 `json:"stage_id"`
	AssignedUserID            *string                 `json:"assigned_user_id"`
	PipelineID                *string                 `json:"pipeline_id"`
	Message                   *string                 `json:"message"`
	StageEnteredAt            *time.Time              `json:"stage_entered_at"`
	OrganizationID            string                  `json:"organization_id"`
	LastEntryAt               *time.Time              `json:"last_entry_at"`
	ReentryCount              int                     `json:"reentry_count"`
	WhatsAppAvatarURL         *string                 `json:"whatsapp_avatar_url"`
	DealStatus                string                  `json:"deal_status"`
	InterestValue             *float64                `json:"valor_interesse"`
	PropertyID                *string                 `json:"property_id"`
	LostReason                *string                 `json:"lost_reason"`
	WonAt                     *time.Time              `json:"won_at"`
	LostAt                    *time.Time              `json:"lost_at"`
	InterestPropertyID        *string                 `json:"interest_property_id"`
	FirstResponseAt           *time.Time              `json:"first_response_at"`
	FirstResponseSeconds      *int                    `json:"first_response_seconds"`
	FirstResponseIsAutomation *bool                   `json:"first_response_is_automation"`
	Assignee                  *LeadEnrichmentUser     `json:"assignee"`
	InterestProperty          *LeadEnrichmentProperty `json:"interest_property"`
	LeadMeta                  []LeadEnrichmentMeta    `json:"lead_meta"`
	Tags                      []LeadEnrichmentTag     `json:"tags"`
	TasksCount                LeadEnrichmentTaskCount `json:"tasks_count"`
}

type PipelineStageLeadsResponse struct {
	StageID string              `json:"stageId"`
	Leads   []PipelineBoardLead `json:"leads"`
}

type PipelineStageCountsResponse struct {
	Data map[string]int64 `json:"data"`
}

type LeadMetaFilters struct {
	Campaigns []LeadMetaCampaignOption `json:"campaigns"`
	Adsets    []LeadMetaAdsetOption    `json:"adsets"`
	Ads       []LeadMetaAdOption       `json:"ads"`
}

type LeadMetaCampaignOption struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type LeadMetaAdsetOption struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	CampaignID string `json:"campaignId"`
}

type LeadMetaAdOption struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	AdsetID    string `json:"adsetId"`
	CampaignID string `json:"campaignId"`
}

func ParsePipelineBoardFilter(values url.Values) (PipelineBoardFilter, error) {
	limit := parsePipelineBoundedInt(values.Get("limit"), defaultPipelineBoardLimit, 1, maxPipelineBoardLimit)
	offset := parsePipelineBoundedInt(values.Get("offset"), 0, 0, 100000)
	dateFrom, err := parseOptionalTime(values.Get("dateFrom"))
	if err != nil {
		return PipelineBoardFilter{}, err
	}
	dateTo, err := parseOptionalTime(values.Get("dateTo"))
	if err != nil {
		return PipelineBoardFilter{}, err
	}

	filterUserIDs, filterUserIDsSet := parseOptionalCSV(values, "filterUserIds")
	stageIDs, _ := parseOptionalCSV(values, "stageIds")

	return PipelineBoardFilter{
		PipelineID:       strings.TrimSpace(values.Get("pipelineId")),
		StageID:          strings.TrimSpace(values.Get("stageId")),
		StageIDs:         stageIDs,
		Offset:           offset,
		Limit:            limit,
		Search:           strings.TrimSpace(values.Get("search")),
		FilterUserID:     strings.TrimSpace(values.Get("filterUserId")),
		FilterUserIDs:    filterUserIDs,
		FilterUserIDsSet: filterUserIDsSet,
		FilterTag:        strings.TrimSpace(values.Get("filterTag")),
		FilterDealStatus: strings.TrimSpace(values.Get("filterDealStatus")),
		FilterCampaign:   strings.TrimSpace(values.Get("filterCampaign")),
		FilterAdSet:      strings.TrimSpace(values.Get("filterAdSet")),
		FilterAd:         strings.TrimSpace(values.Get("filterAd")),
		FilterSource:     strings.TrimSpace(values.Get("filterSource")),
		DateFrom:         dateFrom,
		DateTo:           dateTo,
	}, nil
}

func parsePipelineBoundedInt(raw string, fallback int, min int, max int) int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	if value < min {
		return min
	}
	if value > max {
		return max
	}

	return value
}

func parseOptionalTime(raw string) (*time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	value, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid date", ErrInvalidInput)
	}

	return &value, nil
}

func parseOptionalCSV(values url.Values, key string) ([]string, bool) {
	rawValues, ok := values[key]
	if !ok {
		return nil, false
	}

	out := []string{}
	for _, raw := range rawValues {
		for _, part := range strings.Split(raw, ",") {
			part = strings.TrimSpace(part)
			if part == "" || part == "__none__" {
				continue
			}
			out = append(out, part)
		}
	}

	return out, true
}

func pipelineTextPtr(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}

	return &value.String
}

func pipelineTimePtr(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}

	return &value.Time
}

func pipelineBoolPtr(value pgtype.Bool) *bool {
	if !value.Valid {
		return nil
	}

	return &value.Bool
}

func pipelineIntPtr(value pgtype.Int4) *int {
	if !value.Valid {
		return nil
	}
	valueInt := int(value.Int32)

	return &valueInt
}

func sortLeadMetaOptions(filters *LeadMetaFilters) {
	sort.Slice(filters.Campaigns, func(i, j int) bool {
		return strings.ToLower(filters.Campaigns[i].Name) < strings.ToLower(filters.Campaigns[j].Name)
	})
	sort.Slice(filters.Adsets, func(i, j int) bool {
		return strings.ToLower(filters.Adsets[i].Name) < strings.ToLower(filters.Adsets[j].Name)
	})
	sort.Slice(filters.Ads, func(i, j int) bool {
		return strings.ToLower(filters.Ads[i].Name) < strings.ToLower(filters.Ads[j].Name)
	})
}
