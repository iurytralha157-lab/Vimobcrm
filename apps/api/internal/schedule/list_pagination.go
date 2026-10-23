package schedule

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	defaultScheduleListLimit = 200
	maxScheduleListLimit     = 500
	maxScheduleListPeriod    = 366 * 24 * time.Hour
)

type ListPagination struct {
	Limit   int  `json:"limit"`
	Offset  int  `json:"offset"`
	HasMore bool `json:"has_more"`
}

type EventPage struct {
	Events     []Event
	Pagination ListPagination
}

func validateScheduleListFilter(filter ListFilter, values url.Values) (ListFilter, error) {
	if raw := strings.TrimSpace(values.Get("leadPreview")); raw != "" {
		if raw != "true" && raw != "false" {
			return ListFilter{}, fmt.Errorf("%w: leadPreview is invalid", ErrInvalidInput)
		}
		filter.LeadPreview = raw == "true"
	}
	filter.Limit = defaultScheduleListLimit
	if raw := strings.TrimSpace(values.Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > maxScheduleListLimit {
			return ListFilter{}, fmt.Errorf("%w: limit must be between 1 and %d", ErrInvalidInput, maxScheduleListLimit)
		}
		filter.Limit = value
	}
	if raw := strings.TrimSpace(values.Get("offset")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 {
			return ListFilter{}, fmt.Errorf("%w: offset must be a non-negative integer", ErrInvalidInput)
		}
		filter.Offset = value
	}
	return normalizeScheduleListFilter(filter)
}

func normalizeScheduleListFilter(filter ListFilter) (ListFilter, error) {
	if filter.LeadPreview && filter.LeadID == "" {
		return ListFilter{}, fmt.Errorf("%w: leadPreview requires leadId", ErrInvalidInput)
	}
	if filter.Limit == 0 {
		filter.Limit = defaultScheduleListLimit
	}
	if filter.Limit < 1 || filter.Limit > maxScheduleListLimit || filter.Offset < 0 {
		return ListFilter{}, fmt.Errorf("%w: schedule pagination is invalid", ErrInvalidInput)
	}
	if (filter.StartTime == nil) != (filter.EndTime == nil) {
		return ListFilter{}, fmt.Errorf("%w: startDate and endDate must be provided together", ErrInvalidInput)
	}
	if filter.StartTime == nil && filter.EventID == "" && filter.LeadID == "" {
		return ListFilter{}, fmt.Errorf("%w: a bounded date range, eventId or leadId is required", ErrInvalidInput)
	}
	if filter.StartTime != nil && (filter.EndTime.Before(*filter.StartTime) || filter.EndTime.Sub(*filter.StartTime) > maxScheduleListPeriod) {
		return ListFilter{}, fmt.Errorf("%w: schedule date range must be ordered and at most 366 days", ErrInvalidInput)
	}
	return filter, nil
}

func scheduleEventPage(events []Event, filter ListFilter) EventPage {
	hasMore := len(events) > filter.Limit
	if hasMore {
		events = events[:filter.Limit]
	}
	return EventPage{Events: events, Pagination: ListPagination{Limit: filter.Limit, Offset: filter.Offset, HasMore: hasMore}}
}
