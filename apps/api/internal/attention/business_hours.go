package attention

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

type BusinessHours struct {
	Days  []int  `json:"days"`
	Start string `json:"start"`
	End   string `json:"end"`
}

func ParseBusinessHours(raw json.RawMessage) (BusinessHours, error) {
	hours := BusinessHours{Days: []int{1, 2, 3, 4, 5}, Start: "08:00", End: "18:00"}
	if len(raw) > 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &hours); err != nil {
			return BusinessHours{}, err
		}
	}
	if len(hours.Days) == 0 {
		return BusinessHours{}, errors.New("business hours must include at least one day")
	}
	seen := map[int]bool{}
	for _, day := range hours.Days {
		if day < 1 || day > 7 || seen[day] {
			return BusinessHours{}, errors.New("business hours days must be unique ISO weekdays from 1 to 7")
		}
		seen[day] = true
	}
	startHour, startMinute, err := parseClock(hours.Start)
	if err != nil {
		return BusinessHours{}, err
	}
	endHour, endMinute, err := parseClock(hours.End)
	if err != nil {
		return BusinessHours{}, err
	}
	if endHour*60+endMinute <= startHour*60+startMinute {
		return BusinessHours{}, errors.New("business hours end must be after start")
	}
	return hours, nil
}

func AddPolicyMinutes(start time.Time, minutes int, businessOnly bool, timezone string, raw json.RawMessage) (time.Time, error) {
	if minutes <= 0 {
		return start.UTC(), nil
	}
	if !businessOnly {
		return start.UTC().Add(time.Duration(minutes) * time.Minute), nil
	}
	location, err := time.LoadLocation(strings.TrimSpace(timezone))
	if err != nil {
		return time.Time{}, fmt.Errorf("load attention timezone: %w", err)
	}
	hours, err := ParseBusinessHours(raw)
	if err != nil {
		return time.Time{}, err
	}
	startHour, startMinute, _ := parseClock(hours.Start)
	endHour, endMinute, _ := parseClock(hours.End)
	allowed := map[int]bool{}
	for _, day := range hours.Days {
		allowed[day] = true
	}

	current := start.In(location)
	remaining := time.Duration(minutes) * time.Minute
	for guard := 0; guard < 3700; guard++ {
		dayStart := time.Date(current.Year(), current.Month(), current.Day(), startHour, startMinute, 0, 0, location)
		dayEnd := time.Date(current.Year(), current.Month(), current.Day(), endHour, endMinute, 0, 0, location)
		if allowed[isoWeekday(current.Weekday())] && current.Before(dayEnd) {
			if current.Before(dayStart) {
				current = dayStart
			}
			available := dayEnd.Sub(current)
			if remaining <= available {
				return current.Add(remaining).UTC(), nil
			}
			remaining -= available
		}
		next := current.AddDate(0, 0, 1)
		current = time.Date(next.Year(), next.Month(), next.Day(), startHour, startMinute, 0, 0, location)
	}
	return time.Time{}, errors.New("business hours calculation exceeded safety limit")
}

func parseClock(value string) (int, int, error) {
	parts := strings.Split(strings.TrimSpace(value), ":")
	if len(parts) != 2 {
		return 0, 0, fmt.Errorf("invalid business hours clock %q", value)
	}
	hour, hourErr := strconv.Atoi(parts[0])
	minute, minuteErr := strconv.Atoi(parts[1])
	if hourErr != nil || minuteErr != nil || hour < 0 || hour > 23 || minute < 0 || minute > 59 {
		return 0, 0, fmt.Errorf("invalid business hours clock %q", value)
	}
	return hour, minute, nil
}

func isoWeekday(value time.Weekday) int {
	if value == time.Sunday {
		return 7
	}
	return int(value)
}
