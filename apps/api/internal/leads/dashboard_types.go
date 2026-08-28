package leads

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	defaultDashboardTaskLimit = 5
	maxDashboardTaskLimit     = 50
	maxDashboardDateRange     = 5 * 366 * 24 * time.Hour
	maxDashboardSearchLength  = 180
)

type DashboardFilter struct {
	DateFrom    *time.Time
	DateTo      *time.Time
	Granularity string
	TeamID      string
	UserID      string
	Source      string
	CampaignID  string
	AdSetID     string
	AdID        string
	TagID       string
	DealStatus  string
	SearchQuery string
	PipelineID  string
	Limit       int
}

type DashboardStats struct {
	TotalLeads               int64                 `json:"totalLeads"`
	LeadsInProgress          int64                 `json:"leadsInProgress"`
	LeadsClosed              int64                 `json:"leadsClosed"`
	LeadsLost                int64                 `json:"leadsLost"`
	OpenLeads                int64                 `json:"openLeads"`
	LostLeads                int64                 `json:"lostLeads"`
	ConversionRate           float64               `json:"conversionRate"`
	ClosedLeads              int64                 `json:"closedLeads"`
	WonAverageConversionDays *int                  `json:"wonAverageConversionDays"`
	WonConversionBuckets     []WonConversionBucket `json:"wonConversionBuckets"`
	WonDeals                 []WonDealDetail       `json:"wonDeals"`
	LostReasonBuckets        []LostReasonBucket    `json:"lostReasonBuckets"`
	LostDeals                []LostDealDetail      `json:"lostDeals"`
	AverageResponseTime      string                `json:"avgResponseTime"`
	TotalSalesValue          float64               `json:"totalSalesValue"`
	PendingCommissions       float64               `json:"pendingCommissions"`
	LeadsTrend               int                   `json:"leadsTrend"`
	OpenTrend                int                   `json:"openTrend"`
	LostTrend                int                   `json:"lostTrend"`
	ConversionTrend          int                   `json:"conversionTrend"`
	ClosedTrend              int                   `json:"closedTrend"`
	TotalReceivables         float64               `json:"totalReceivables"`
	TotalPayables            float64               `json:"totalPayables"`
	OverdueReceivables       float64               `json:"overdueReceivables"`
	OverduePayables          float64               `json:"overduePayables"`
	PaidCommissions          float64               `json:"paidCommissions"`
}

type WonConversionBucket struct {
	Key        string  `json:"key"`
	Label      string  `json:"label"`
	Count      int64   `json:"count"`
	Percentage float64 `json:"percentage"`
	Value      float64 `json:"value"`
	Color      string  `json:"color"`
}

type WonDealDetail struct {
	ID               string  `json:"id"`
	Name             string  `json:"name"`
	Phone            *string `json:"phone"`
	Source           *string `json:"source"`
	Value            float64 `json:"value"`
	CreatedAt        *string `json:"createdAt"`
	WonAt            *string `json:"wonAt"`
	ConversionDays   *int    `json:"conversionDays"`
	AssignedUserName string  `json:"assignedUserName"`
}

type LostReasonBucket struct {
	Key        string  `json:"key"`
	Label      string  `json:"label"`
	Count      int64   `json:"count"`
	Percentage float64 `json:"percentage"`
	Color      string  `json:"color"`
}

type LostDealDetail struct {
	ID               string  `json:"id"`
	Name             string  `json:"name"`
	Phone            *string `json:"phone"`
	Source           *string `json:"source"`
	LostReason       string  `json:"lostReason"`
	LostReasonGroup  string  `json:"lostReasonGroup"`
	CreatedAt        *string `json:"createdAt"`
	LostAt           *string `json:"lostAt"`
	AssignedUserName string  `json:"assignedUserName"`
}

type FunnelDataPoint struct {
	Name       string `json:"name"`
	Value      int64  `json:"value"`
	Percentage int    `json:"percentage"`
	StageKey   string `json:"stage_key"`
}

type SourceDataPoint struct {
	Name      string `json:"name"`
	Value     int64  `json:"value"`
	RawSource string `json:"rawSource"`
}

type TopBroker struct {
	ID               string  `json:"id"`
	Name             string  `json:"name"`
	AvatarURL        *string `json:"avatar_url"`
	ClosedLeads      int64   `json:"closedLeads"`
	SalesValue       float64 `json:"salesValue"`
	TotalCommissions float64 `json:"totalCommissions"`
}

type TopBrokersResult struct {
	Brokers        []TopBroker `json:"brokers"`
	IsFallbackMode bool        `json:"isFallbackMode"`
}

type UpcomingTask struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Type     string `json:"type"`
	DueDate  string `json:"due_date"`
	LeadName string `json:"lead_name"`
	LeadID   string `json:"lead_id"`
}

type DashboardExtraCounts struct {
	PropertyCount   int64 `json:"propertyCount"`
	SiteVisits      int64 `json:"siteVisits"`
	ScheduledVisits int64 `json:"scheduledVisits"`
}

type RecentActivity struct {
	ID        string  `json:"id"`
	Type      string  `json:"type"`
	Content   *string `json:"content"`
	CreatedAt string  `json:"created_at"`
	LeadName  string  `json:"lead_name"`
	UserName  *string `json:"user_name"`
}

type DashboardTeamLeadIDsResponse struct {
	LeadIDs []string `json:"leadIds"`
}

type DealsEvolutionPoint struct {
	Date    string `json:"date"`
	Ganhos  int64  `json:"ganhos"`
	Perdas  int64  `json:"perdas"`
	Abertos int64  `json:"abertos"`
}

func ParseDashboardFilter(values url.Values) (DashboardFilter, error) {
	dateFrom, err := parseOptionalTime(values.Get("dateFrom"))
	if err != nil {
		return DashboardFilter{}, err
	}
	dateTo, err := parseOptionalTime(values.Get("dateTo"))
	if err != nil {
		return DashboardFilter{}, err
	}
	if (dateFrom == nil) != (dateTo == nil) {
		return DashboardFilter{}, fmt.Errorf("%w: dateFrom and dateTo must be provided together", ErrInvalidInput)
	}
	if dateFrom != nil && dateTo != nil {
		duration := dateTo.Sub(*dateFrom)
		if duration <= 0 {
			return DashboardFilter{}, fmt.Errorf("%w: dateTo must be after dateFrom", ErrInvalidInput)
		}
		if duration > maxDashboardDateRange {
			return DashboardFilter{}, fmt.Errorf("%w: dashboard date range is too large", ErrInvalidInput)
		}
	}

	limit := defaultDashboardTaskLimit
	if rawLimit := strings.TrimSpace(values.Get("limit")); rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil {
			return DashboardFilter{}, fmt.Errorf("%w: invalid limit", ErrInvalidInput)
		}
		if parsed < 1 || parsed > maxDashboardTaskLimit {
			return DashboardFilter{}, fmt.Errorf("%w: limit must be between 1 and %d", ErrInvalidInput, maxDashboardTaskLimit)
		}
		limit = parsed
	}

	searchQuery := strings.TrimSpace(values.Get("searchQuery"))
	if searchQuery == "" {
		searchQuery = strings.TrimSpace(values.Get("search"))
	}
	if len(searchQuery) > maxDashboardSearchLength {
		return DashboardFilter{}, fmt.Errorf("%w: searchQuery is too long", ErrInvalidInput)
	}

	granularity := strings.TrimSpace(values.Get("granularity"))
	if granularity != "" && granularity != "hour" && granularity != "day" && granularity != "week" && granularity != "month" {
		return DashboardFilter{}, fmt.Errorf("%w: invalid granularity", ErrInvalidInput)
	}

	teamID, err := normalizeDashboardUUIDFilter("teamId", values.Get("teamId"))
	if err != nil {
		return DashboardFilter{}, err
	}
	userID, err := normalizeDashboardUUIDFilter("userId", values.Get("userId"))
	if err != nil {
		return DashboardFilter{}, err
	}
	tagID, err := normalizeDashboardUUIDFilter("tagId", values.Get("tagId"))
	if err != nil {
		return DashboardFilter{}, err
	}
	pipelineID, err := normalizeDashboardUUIDFilter("pipelineId", values.Get("pipelineId"))
	if err != nil {
		return DashboardFilter{}, err
	}

	source, err := normalizeDashboardTextFilter("source", values.Get("source"), 180)
	if err != nil {
		return DashboardFilter{}, err
	}
	campaignID, err := normalizeDashboardTextFilter("campaignId", values.Get("campaignId"), 255)
	if err != nil {
		return DashboardFilter{}, err
	}
	adSetID, err := normalizeDashboardTextFilter("adSetId", values.Get("adSetId"), 255)
	if err != nil {
		return DashboardFilter{}, err
	}
	adID, err := normalizeDashboardTextFilter("adId", values.Get("adId"), 255)
	if err != nil {
		return DashboardFilter{}, err
	}

	dealStatus := strings.TrimSpace(values.Get("dealStatus"))
	if strings.EqualFold(dealStatus, "all") {
		dealStatus = "all"
	}
	if dealStatus != "" && dealStatus != "all" && dealStatus != "open" && dealStatus != "won" && dealStatus != "lost" {
		return DashboardFilter{}, fmt.Errorf("%w: invalid dealStatus", ErrInvalidInput)
	}

	return DashboardFilter{
		DateFrom:    dateFrom,
		DateTo:      dateTo,
		Granularity: granularity,
		TeamID:      teamID,
		UserID:      userID,
		Source:      source,
		CampaignID:  campaignID,
		AdSetID:     adSetID,
		AdID:        adID,
		TagID:       tagID,
		DealStatus:  dealStatus,
		SearchQuery: searchQuery,
		PipelineID:  pipelineID,
		Limit:       limit,
	}, nil
}

func normalizeDashboardUUIDFilter(name string, raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" || strings.EqualFold(value, "all") {
		if value == "" {
			return "", nil
		}
		return "all", nil
	}

	normalized, ok := normalizeUUID(value)
	if !ok {
		return "", fmt.Errorf("%w: invalid %s", ErrInvalidInput, name)
	}
	return normalized, nil
}

func normalizeDashboardTextFilter(name string, raw string, maxLength int) (string, error) {
	value := strings.TrimSpace(raw)
	if strings.EqualFold(value, "all") {
		return "all", nil
	}
	if len(value) > maxLength {
		return "", fmt.Errorf("%w: %s is too long", ErrInvalidInput, name)
	}
	return value, nil
}
