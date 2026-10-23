package roundrobin

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

// A missing calendar deliberately preserves the legacy queue lifecycle. An
// explicit calendar must be complete; malformed input never becomes all-day.
func normalizeOperatingSchedule(settings map[string]any) (map[string]any, error) {
	if raw, exists := settings["pool_notifications"]; exists {
		encoded, err := json.Marshal(raw)
		var notifications struct {
			Enabled *bool `json:"enabled"`
		}
		decoder := json.NewDecoder(bytes.NewReader(encoded))
		decoder.DisallowUnknownFields()
		if err != nil || decoder.Decode(&notifications) != nil || notifications.Enabled == nil {
			return nil, fmt.Errorf("%w: pool_notifications requires an explicit enabled boolean", ErrInvalidInput)
		}
		settings["pool_notifications"] = map[string]any{"enabled": *notifications.Enabled}
	}
	raw, exists := settings["operating_schedule"]
	if !exists {
		return settings, nil
	}
	encoded, err := json.Marshal(raw)
	if err != nil {
		return nil, fmt.Errorf("%w: operating_schedule must be an object", ErrInvalidInput)
	}
	var schedule struct {
		Version  *int                   `json:"version"`
		Timezone string                 `json:"timezone"`
		Days     []operatingScheduleDay `json:"days"`
	}
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&schedule); err != nil || schedule.Version == nil || *schedule.Version != 1 || len(schedule.Days) != 7 {
		return nil, fmt.Errorf("%w: operating_schedule requires version 1 and all seven days", ErrInvalidInput)
	}
	schedule.Timezone = strings.TrimSpace(schedule.Timezone)
	if schedule.Timezone == "" || schedule.Timezone == "Local" {
		return nil, fmt.Errorf("%w: operating_schedule requires an explicit timezone", ErrInvalidInput)
	}
	if _, err := time.LoadLocation(schedule.Timezone); err != nil {
		return nil, fmt.Errorf("%w: operating_schedule timezone is invalid", ErrInvalidInput)
	}
	seen := [7]bool{}
	for index := range schedule.Days {
		day := &schedule.Days[index]
		if day.DayOfWeek == nil || *day.DayOfWeek < 0 || *day.DayOfWeek > 6 || seen[*day.DayOfWeek] || day.IsActive == nil || day.IsAllDay == nil {
			return nil, fmt.Errorf("%w: operating_schedule days must be unique and explicitly configured", ErrInvalidInput)
		}
		seen[*day.DayOfWeek] = true
		if *day.IsAllDay {
			day.StartTime, day.EndTime = nil, nil
			continue
		}
		if !*day.IsActive && day.StartTime == nil && day.EndTime == nil {
			continue
		}
		if !validOperatingTime(day.StartTime) || !validOperatingTime(day.EndTime) || *day.StartTime == *day.EndTime {
			return nil, fmt.Errorf("%w: operating_schedule requires distinct HH:MM times or explicit all-day", ErrInvalidInput)
		}
	}
	sort.Slice(schedule.Days, func(i, j int) bool { return *schedule.Days[i].DayOfWeek < *schedule.Days[j].DayOfWeek })
	settings["operating_schedule"] = schedule
	settings["ignore_availability"] = false
	return settings, nil
}

func validateOperatingScheduleTransition(previous, next map[string]any) error {
	_, wasManaged := previous["operating_schedule"]
	_, remainsManaged := next["operating_schedule"]
	if wasManaged && !remainsManaged {
		return fmt.Errorf("%w: an active queue calendar cannot be removed through a settings replacement", ErrInvalidInput)
	}
	return nil
}

type operatingScheduleDay struct {
	DayOfWeek *int    `json:"day_of_week"`
	IsActive  *bool   `json:"is_active"`
	IsAllDay  *bool   `json:"is_all_day"`
	StartTime *string `json:"start_time"`
	EndTime   *string `json:"end_time"`
}

func validOperatingTime(value *string) bool {
	if value == nil || len(*value) != 5 || (*value)[2] != ':' {
		return false
	}
	for _, position := range []int{0, 1, 3, 4} {
		if (*value)[position] < '0' || (*value)[position] > '9' {
			return false
		}
	}
	hour := int((*value)[0]-'0')*10 + int((*value)[1]-'0')
	minute := int((*value)[3]-'0')*10 + int((*value)[4]-'0')
	return hour < 24 && minute < 60
}
