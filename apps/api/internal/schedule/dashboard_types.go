package schedule

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	dashboardDateLayout         = "2006-01-02"
	maxDashboardPeriodDays      = 366
	defaultDashboardEventsLimit = 20
	maxDashboardEventsLimit     = 100
)

type DashboardDateBasis string

const (
	DashboardDateBasisStartTime   DashboardDateBasis = "start_time"
	DashboardDateBasisCreatedAt   DashboardDateBasis = "created_at"
	DashboardDateBasisCompletedAt DashboardDateBasis = "completed_at"
)

type DashboardFilter struct {
	DateFrom  time.Time
	DateTo    time.Time
	DateBasis DashboardDateBasis
	TeamID    string
	UserID    string
	Source    string
	EventType string
	Status    string
}

type DashboardEventsFilter struct {
	DashboardFilter
	Limit  int
	Offset int
}

type DashboardReport struct {
	ReportTimezone   string                      `json:"report_timezone"`
	Period           DashboardPeriod             `json:"period"`
	KPIs             DashboardKPIs               `json:"kpis"`
	Daily            []DashboardDailyPoint       `json:"daily"`
	Hourly           []DashboardHourlyPoint      `json:"hourly"`
	Weekly           []DashboardWeeklyPoint      `json:"weekly"`
	ByType           []DashboardCount            `json:"by_type"`
	BySource         []DashboardSourceCount      `json:"by_source"`
	ByOutcome        []DashboardCount            `json:"by_outcome"`
	UpcomingEvents   []DashboardUpcomingEvent    `json:"upcoming_events"`
	OverdueByOwner   []DashboardOverdueOwner     `json:"overdue_by_owner"`
	PerformerRanking []DashboardPerformerRanking `json:"performer_ranking"`
	TopPerformers    []DashboardTopPerformer     `json:"top_performers"`
}

type DashboardPeriod struct {
	DateFrom  string             `json:"date_from"`
	DateTo    string             `json:"date_to"`
	DateBasis DashboardDateBasis `json:"date_basis"`
}

type DashboardKPIs struct {
	Total               int64   `json:"total"`
	Eligible            int64   `json:"eligible"`
	AppointmentEligible int64   `json:"appointment_eligible"`
	Open                int64   `json:"open"`
	Overdue             int64   `json:"overdue"`
	Upcoming            int64   `json:"upcoming"`
	Visits              int64   `json:"visits"`
	Meetings            int64   `json:"meetings"`
	Calls               int64   `json:"calls"`
	Completed           int64   `json:"completed"`
	Cancelled           int64   `json:"cancelled"`
	NoShow              int64   `json:"no_show"`
	CompletionRate      float64 `json:"completion_rate"`
	NoShowRate          float64 `json:"no_show_rate"`
}

type DashboardDailyPoint struct {
	Date      string `json:"date"`
	Total     int64  `json:"total"`
	Open      int64  `json:"open"`
	Overdue   int64  `json:"overdue"`
	Completed int64  `json:"completed"`
	Cancelled int64  `json:"cancelled"`
	NoShow    int64  `json:"no_show"`
}

type DashboardHourlyPoint struct {
	Hour      int   `json:"hour"`
	Total     int64 `json:"total"`
	Open      int64 `json:"open"`
	Overdue   int64 `json:"overdue"`
	Completed int64 `json:"completed"`
	Cancelled int64 `json:"cancelled"`
	NoShow    int64 `json:"no_show"`
}

type DashboardWeeklyPoint struct {
	WeekStart string `json:"week_start"`
	WeekEnd   string `json:"week_end"`
	Total     int64  `json:"total"`
	Open      int64  `json:"open"`
	Overdue   int64  `json:"overdue"`
	Completed int64  `json:"completed"`
	Cancelled int64  `json:"cancelled"`
	NoShow    int64  `json:"no_show"`
}

type DashboardCount struct {
	Key   string `json:"key"`
	Count int64  `json:"count"`
}

type DashboardSourceCount struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Count int64  `json:"count"`
}

type DashboardTopPerformer struct {
	UserID    string  `json:"user_id"`
	Name      string  `json:"name"`
	AvatarURL *string `json:"avatar_url"`
	Total     int64   `json:"total"`
}

type DashboardUpcomingEvent struct {
	ID            string    `json:"id"`
	Title         string    `json:"title"`
	EventType     string    `json:"event_type"`
	StartTime     time.Time `json:"start_time"`
	EndTime       time.Time `json:"end_time"`
	UserID        string    `json:"user_id"`
	UserName      string    `json:"user_name"`
	UserAvatarURL *string   `json:"user_avatar_url"`
	LeadID        *string   `json:"lead_id"`
	LeadName      *string   `json:"lead_name"`
	PropertyID    *string   `json:"property_id"`
	PropertyTitle *string   `json:"property_title"`
	PropertyCode  *string   `json:"property_code"`
}

type DashboardEventItem struct {
	ID            string    `json:"id"`
	Title         string    `json:"title"`
	EventType     string    `json:"event_type"`
	StartTime     time.Time `json:"start_time"`
	EndTime       time.Time `json:"end_time"`
	IsAllDay      bool      `json:"is_all_day"`
	UserID        string    `json:"user_id"`
	UserName      string    `json:"user_name"`
	UserAvatarURL *string   `json:"user_avatar_url"`
	LeadID        *string   `json:"lead_id"`
	LeadName      *string   `json:"lead_name"`
	PropertyID    *string   `json:"property_id"`
	PropertyTitle *string   `json:"property_title"`
	PropertyCode  *string   `json:"property_code"`
	Status        string    `json:"status"`
	Outcome       *string   `json:"outcome"`
	IsOverdue     bool      `json:"is_overdue"`
}

type DashboardEventsPage struct {
	Items   []DashboardEventItem `json:"items"`
	Total   int64                `json:"total"`
	Limit   int                  `json:"limit"`
	Offset  int                  `json:"offset"`
	HasMore bool                 `json:"has_more"`
}

type DashboardOverdueOwner struct {
	UserID    string  `json:"user_id"`
	Name      string  `json:"name"`
	AvatarURL *string `json:"avatar_url"`
	Overdue   int64   `json:"overdue"`
}

type DashboardPerformerRanking struct {
	UserID              string  `json:"user_id"`
	Name                string  `json:"name"`
	AvatarURL           *string `json:"avatar_url"`
	Total               int64   `json:"total"`
	Eligible            int64   `json:"eligible"`
	Appointments        int64   `json:"appointments"`
	AppointmentEligible int64   `json:"appointment_eligible"`
	Open                int64   `json:"open"`
	Completed           int64   `json:"completed"`
	NoShow              int64   `json:"no_show"`
	Overdue             int64   `json:"overdue"`
	CompletionRate      float64 `json:"completion_rate"`
	NoShowRate          float64 `json:"no_show_rate"`
}

func ParseDashboardFilter(values url.Values) (DashboardFilter, error) {
	dateFrom, err := parseRequiredDashboardDate("dateFrom", values.Get("dateFrom"))
	if err != nil {
		return DashboardFilter{}, err
	}
	dateTo, err := parseRequiredDashboardDate("dateTo", values.Get("dateTo"))
	if err != nil {
		return DashboardFilter{}, err
	}
	if dateTo.Before(dateFrom) {
		return DashboardFilter{}, fmt.Errorf("%w: dateTo must be on or after dateFrom", ErrInvalidInput)
	}
	periodDays := int(dateTo.Sub(dateFrom)/(24*time.Hour)) + 1
	if periodDays > maxDashboardPeriodDays {
		return DashboardFilter{}, fmt.Errorf("%w: dashboard date range is too large", ErrInvalidInput)
	}

	dateBasis := DashboardDateBasis(strings.ToLower(strings.TrimSpace(values.Get("dateBasis"))))
	if dateBasis == "" {
		dateBasis = DashboardDateBasisStartTime
	}
	if !validDashboardDateBasis(dateBasis) {
		return DashboardFilter{}, fmt.Errorf("%w: dateBasis is invalid", ErrInvalidInput)
	}

	teamID, err := parseOptionalDashboardUUID("teamId", values.Get("teamId"))
	if err != nil {
		return DashboardFilter{}, err
	}
	userID, err := parseOptionalDashboardUUID("userId", values.Get("userId"))
	if err != nil {
		return DashboardFilter{}, err
	}

	source := strings.TrimSpace(values.Get("source"))
	if strings.EqualFold(source, "all") {
		source = ""
	}
	if len([]rune(source)) > 160 {
		return DashboardFilter{}, fmt.Errorf("%w: source is too long", ErrInvalidInput)
	}

	eventType := strings.ToLower(strings.TrimSpace(values.Get("eventType")))
	if eventType == "all" {
		eventType = ""
	}
	if eventType != "" && !validEnum(eventType, "call", "email", "meeting", "task", "message", "visit") {
		return DashboardFilter{}, fmt.Errorf("%w: eventType is invalid", ErrInvalidInput)
	}

	status := strings.ToLower(strings.TrimSpace(values.Get("status")))
	if status == "all" {
		status = ""
	}
	if status != "" && !validEnum(status, "scheduled", "completed", "cancelled", "canceled", "no_show", "overdue", "upcoming") {
		return DashboardFilter{}, fmt.Errorf("%w: status is invalid", ErrInvalidInput)
	}

	return DashboardFilter{
		DateFrom:  dateFrom,
		DateTo:    dateTo,
		DateBasis: dateBasis,
		TeamID:    teamID,
		UserID:    userID,
		Source:    source,
		EventType: eventType,
		Status:    status,
	}, nil
}

func ParseDashboardEventsFilter(values url.Values) (DashboardEventsFilter, error) {
	dashboardFilter, err := ParseDashboardFilter(values)
	if err != nil {
		return DashboardEventsFilter{}, err
	}

	limit := defaultDashboardEventsLimit
	if rawLimit := strings.TrimSpace(values.Get("limit")); rawLimit != "" {
		parsed, parseErr := strconv.Atoi(rawLimit)
		if parseErr != nil || parsed < 1 || parsed > maxDashboardEventsLimit {
			return DashboardEventsFilter{}, fmt.Errorf("%w: limit must be between 1 and %d", ErrInvalidInput, maxDashboardEventsLimit)
		}
		limit = parsed
	}

	offset := 0
	if rawOffset := strings.TrimSpace(values.Get("offset")); rawOffset != "" {
		parsed, parseErr := strconv.Atoi(rawOffset)
		if parseErr != nil || parsed < 0 {
			return DashboardEventsFilter{}, fmt.Errorf("%w: offset must be a non-negative integer", ErrInvalidInput)
		}
		offset = parsed
	}

	return DashboardEventsFilter{
		DashboardFilter: dashboardFilter,
		Limit:           limit,
		Offset:          offset,
	}, nil
}

func parseRequiredDashboardDate(name string, raw string) (time.Time, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return time.Time{}, fmt.Errorf("%w: %s is required", ErrInvalidInput, name)
	}
	parsed, err := time.Parse(dashboardDateLayout, value)
	if err != nil || parsed.Format(dashboardDateLayout) != value {
		return time.Time{}, fmt.Errorf("%w: %s must use YYYY-MM-DD", ErrInvalidInput, name)
	}
	return parsed, nil
}

func parseOptionalDashboardUUID(name string, raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" || strings.EqualFold(value, "all") {
		return "", nil
	}
	normalized, ok := normalizeUUID(value)
	if !ok {
		return "", fmt.Errorf("%w: %s is invalid", ErrInvalidInput, name)
	}
	return normalized, nil
}

func validDashboardDateBasis(value DashboardDateBasis) bool {
	switch value {
	case DashboardDateBasisStartTime, DashboardDateBasisCreatedAt, DashboardDateBasisCompletedAt:
		return true
	default:
		return false
	}
}
