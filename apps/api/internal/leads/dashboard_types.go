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
)

type DashboardFilter struct {
	DateFrom    *time.Time
	DateTo      *time.Time
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

	limit := defaultDashboardTaskLimit
	if rawLimit := strings.TrimSpace(values.Get("limit")); rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil {
			return DashboardFilter{}, fmt.Errorf("%w: invalid limit", ErrInvalidInput)
		}
		limit = parsed
	}
	if limit < 1 {
		limit = 1
	}
	if limit > maxDashboardTaskLimit {
		limit = maxDashboardTaskLimit
	}

	searchQuery := strings.TrimSpace(values.Get("searchQuery"))
	if searchQuery == "" {
		searchQuery = strings.TrimSpace(values.Get("search"))
	}

	return DashboardFilter{
		DateFrom:    dateFrom,
		DateTo:      dateTo,
		TeamID:      strings.TrimSpace(values.Get("teamId")),
		UserID:      strings.TrimSpace(values.Get("userId")),
		Source:      strings.TrimSpace(values.Get("source")),
		CampaignID:  strings.TrimSpace(values.Get("campaignId")),
		AdSetID:     strings.TrimSpace(values.Get("adSetId")),
		AdID:        strings.TrimSpace(values.Get("adId")),
		TagID:       strings.TrimSpace(values.Get("tagId")),
		DealStatus:  strings.TrimSpace(values.Get("dealStatus")),
		SearchQuery: searchQuery,
		PipelineID:  strings.TrimSpace(values.Get("pipelineId")),
		Limit:       limit,
	}, nil
}
