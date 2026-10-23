package schedule

import (
	"context"
	"fmt"
	"time"
	_ "time/tzdata"
)

func loadScheduleRecurrenceLocation(ctx context.Context, queryer queryRower, organizationID string) (*time.Location, error) {
	var name string
	if err := queryer.QueryRow(ctx, `
		select coalesce((
			select zone.name from public.organization_attention_settings settings
			join pg_catalog.pg_timezone_names zone on zone.name = nullif(btrim(settings.timezone), '')
			where settings.organization_id = $1::uuid limit 1
		), 'America/Sao_Paulo')
	`, organizationID).Scan(&name); err != nil {
		return nil, err
	}
	location, err := time.LoadLocation(name)
	if err != nil {
		return nil, fmt.Errorf("%w: organization recurrence timezone is unavailable", ErrRecurrenceCreate)
	}
	return location, nil
}

// Occurrences use the original civil day and clock, never an iterative month
// addition. Months/years clamp to their last valid day (Jan 31 -> Feb 28 ->
// Mar 31; Feb 29 -> Feb 28 in a non-leap year). A DST gap shifts forward by the
// missing interval; a repeated clock prefers the original event's UTC offset.
func addRecurrence(value time.Time, frequency string, amount int) time.Time {
	year, month, day := value.Date()
	switch frequency {
	case "daily", "weekly":
		days := amount
		if frequency == "weekly" {
			days *= 7
		}
		date := time.Date(year, month, day+days, 12, 0, 0, 0, time.UTC)
		year, month, day = date.Date()
	case "monthly", "yearly":
		months := amount
		if frequency == "yearly" {
			months *= 12
		}
		date := time.Date(year, month+time.Month(months), 1, 12, 0, 0, 0, time.UTC)
		year, month, _ = date.Date()
		lastDay := time.Date(year, month+1, 0, 12, 0, 0, 0, time.UTC).Day()
		if day > lastDay {
			day = lastDay
		}
	default:
		return value
	}
	return recurrenceCivilTime(value, year, month, day)
}

func recurrenceCivilTime(original time.Time, year int, month time.Month, day int) time.Time {
	hour, minute, second := original.Clock()
	wanted := time.Date(year, month, day, hour, minute, second, original.Nanosecond(), time.UTC)
	candidate := time.Date(year, month, day, hour, minute, second, original.Nanosecond(), original.Location())
	cy, cm, cd := candidate.Date()
	ch, cmin, cs := candidate.Clock()
	actual := time.Date(cy, cm, cd, ch, cmin, cs, candidate.Nanosecond(), time.UTC)
	if !actual.Equal(wanted) {
		// Go may resolve a nonexistent 02:30 backward to 01:30. Shift forward
		// by the gap instead, preserving minutes and preventing an earlier slot.
		if actual.Before(wanted) {
			candidate = candidate.Add(wanted.Sub(actual))
		}
		return candidate
	}
	_, originalOffset := original.Zone()
	for _, alternative := range []time.Time{candidate.Add(-time.Hour), candidate.Add(-30 * time.Minute), candidate.Add(30 * time.Minute), candidate.Add(time.Hour), candidate} {
		ay, am, ad := alternative.Date()
		ah, amin, as := alternative.Clock()
		_, offset := alternative.Zone()
		if ay == year && am == month && ad == day && ah == hour && amin == minute && as == second && offset == originalOffset {
			return alternative
		}
	}
	return candidate
}

func recurringEventInterval(input createInput, index int) (time.Time, time.Time) {
	start := addRecurrence(input.StartTime, *input.RecurrenceRule, index)
	end := addRecurrence(input.EndTime, *input.RecurrenceRule, index)
	if !end.After(start) {
		// Independently resolving a gap can place the end before the shifted
		// start. Preserve the original positive duration for that occurrence.
		end = start.Add(input.EndTime.Sub(input.StartTime))
	}
	return start, end
}
