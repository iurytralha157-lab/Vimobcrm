package leads

import (
	"context"
	"fmt"
	"time"
	_ "time/tzdata"
)

const dashboardDefaultTimezone = "America/Sao_Paulo"

func (repo Repository) dashboardReportLocation(ctx context.Context, queryer dashboardQueryer, organizationID string) (*time.Location, error) {
	var timezone string
	err := queryer.QueryRow(ctx, `
		select coalesce((
			select zone.name
			from public.organization_attention_settings settings
			join pg_catalog.pg_timezone_names zone on zone.name = nullif(btrim(settings.timezone), '')
			where settings.organization_id = $1::uuid
			limit 1
		), 'America/Sao_Paulo')
	`, organizationID).Scan(&timezone)
	if err != nil {
		return nil, err
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		// Embedded tzdata guarantees the documented fallback even in minimal images.
		return time.LoadLocation(dashboardDefaultTimezone)
	}
	return location, nil
}

// Bounds are instants. Civil boundaries and labels use the validated organization
// timezone, while the aggregate still compares timestamptz instants in SQL.
func dashboardEvolutionIntervals(from time.Time, to time.Time, granularity string) ([]time.Time, []string) {
	if !to.After(from) {
		return nil, nil
	}
	to = to.In(from.Location())
	if granularity == "hour" || sameDashboardDay(from, to.Add(-time.Nanosecond)) || isSingleDashboardDayRange(from, to) {
		start := from.Add(-time.Duration(from.Minute())*time.Minute - time.Duration(from.Second())*time.Second - time.Duration(from.Nanosecond()))
		hours := (to.Unix() - start.Unix()) / 3600
		if (to.Unix()-start.Unix())%3600 != 0 || to.Nanosecond() != 0 {
			hours++
		}
		stride := dashboardEvolutionStride(hours)
		intervals := make([]time.Time, 0, dashboardMaxEvolutionBucketCount)
		labels := make([]string, 0, dashboardMaxEvolutionBucketCount)
		crossesDay := !sameDashboardDay(from, to.Add(-time.Nanosecond))
		for index := int64(0); index < hours && len(intervals) < dashboardMaxEvolutionBucketCount; index += stride {
			current := time.Unix(start.Unix()+index*3600, 0).In(from.Location())
			intervals = append(intervals, current)
			label := current.Format("15:04")
			if crossesDay {
				label = current.Format("02/01 15:04")
			}
			labels = append(labels, label)
		}
		counts := map[string]int{}
		for _, label := range labels {
			counts[label]++
		}
		for index, label := range labels {
			if counts[label] > 1 {
				labels[index] += intervals[index].Format(" -07:00")
			}
		}
		if stride > 1 {
			labels = dashboardEvolutionRangeLabels(intervals, from, to, true)
		}
		return intervals, labels
	}

	// Advance calendar dates in UTC, not the local result of AddDate. A missing
	// midnight may normalize backwards, and a skipped civil day may not advance
	// at all. Calculate the stride before allocating or generating any buckets.
	firstDay := dashboardCivilDate(from)
	lastDay := dashboardCivilDate(to.Add(-time.Nanosecond))
	days := (lastDay.Unix()-firstDay.Unix())/86400 + 1
	stepDays := int64(1)
	start := firstDay
	monthly := granularity == "month" || (granularity == "" && days > 90)
	if granularity == "week" || (granularity == "" && days > 31 && !monthly) {
		stepDays = 7
		weekday := (int(start.Weekday()) + 6) % 7
		start = start.AddDate(0, 0, -weekday)
	}
	bucketCount := (lastDay.Unix()-start.Unix())/(86400*stepDays) + 1
	if monthly {
		start = time.Date(from.Year(), from.Month(), 1, 0, 0, 0, 0, time.UTC)
		bucketCount = int64((lastDay.Year()-start.Year())*12+int(lastDay.Month())-int(start.Month())) + 1
	}
	stride := dashboardEvolutionStride(bucketCount)
	intervals := make([]time.Time, 0, dashboardMaxEvolutionBucketCount)
	labels := make([]string, 0, dashboardMaxEvolutionBucketCount)
	for index := int64(0); index < bucketCount && len(intervals) < dashboardMaxEvolutionBucketCount; index += stride {
		var anchor time.Time
		if monthly {
			anchor = start.AddDate(0, int(index), 0)
		} else {
			anchor = start.AddDate(0, 0, int(index*stepDays))
		}
		current := dashboardCivilDayStart(anchor, from.Location())
		if !current.Before(to) || (len(intervals) > 0 && !current.After(intervals[len(intervals)-1])) {
			// A nonexistent civil date has the same first real instant as the
			// next date. Do not produce a phantom or repeated bucket.
			continue
		}
		intervals = append(intervals, current)
		if monthly {
			labels = append(labels, fmt.Sprintf("%s %d", dashboardMonthLabel(current), current.Year()))
		} else {
			labels = append(labels, current.Format("02/01"))
		}
	}
	if stride > 1 || (!monthly && (stepDays > 1 || from.Year() != to.Add(-time.Nanosecond).Year())) {
		labels = dashboardEvolutionRangeLabels(intervals, from, to, false)
	}
	return intervals, labels
}

func dashboardEvolutionStride(count int64) int64 {
	if count <= dashboardMaxEvolutionBucketCount {
		return 1
	}
	return (count + dashboardMaxEvolutionBucketCount - 1) / dashboardMaxEvolutionBucketCount
}

func dashboardEvolutionRangeLabels(intervals []time.Time, from, to time.Time, hourly bool) []string {
	labels := make([]string, len(intervals))
	format := "02/01"
	if from.Year() != to.Add(-time.Nanosecond).Year() {
		format = "02/01/2006"
	}
	if hourly {
		format += " 15:04"
		_, fromOffset := from.Zone()
		_, toOffset := to.Add(-time.Nanosecond).Zone()
		if fromOffset != toOffset {
			format += " -07:00"
		}
	}
	for index, start := range intervals {
		if start.Before(from) {
			start = from
		}
		end := to
		if index+1 < len(intervals) {
			end = intervals[index+1]
		}
		first, last := start.Format(format), end.Add(-time.Nanosecond).Format(format)
		labels[index] = first
		if last != first {
			labels[index] += "–" + last
		}
	}
	return labels
}

func dashboardCivilDate(value time.Time) time.Time {
	return time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, time.UTC)
}

// Find the first real instant of a civil date. If that entire date was skipped,
// this is the next existing date's start. Searching a fixed UTC window handles
// missing/repeated midnights without carrying their normalized hour forward.
func dashboardCivilDayStart(date time.Time, location *time.Location) time.Time {
	candidate := time.Date(date.Year(), date.Month(), date.Day(), 0, 0, 0, 0, location)
	target := date.Unix() / 86400
	dayNumber := func(value time.Time) int64 { return dashboardCivilDate(value.In(location)).Unix() / 86400 }
	if dayNumber(candidate) == target && dayNumber(candidate.Add(-time.Nanosecond)) < target {
		return candidate
	}
	low, high := candidate.Unix()-48*3600, candidate.Unix()+48*3600
	for high-low > 1 {
		middle := low + (high-low)/2
		if dayNumber(time.Unix(middle, 0)) >= target {
			high = middle
		} else {
			low = middle
		}
	}
	return time.Unix(high, 0).In(location)
}

func sameDashboardDay(left time.Time, right time.Time) bool {
	right = right.In(left.Location())
	return left.Year() == right.Year() && left.YearDay() == right.YearDay()
}

func isSingleDashboardDayRange(from time.Time, to time.Time) bool {
	return to.After(from) && sameDashboardDay(from, to.Add(-time.Nanosecond))
}

func startOfDashboardDay(value time.Time) time.Time {
	return dashboardCivilDayStart(dashboardCivilDate(value), value.Location())
}

func startOfDashboardWeek(value time.Time) time.Time {
	start := dashboardCivilDate(value)
	weekday := int(start.Weekday())
	if weekday == 0 {
		weekday = 7
	}
	return dashboardCivilDayStart(start.AddDate(0, 0, -(weekday-1)), value.Location())
}

func dashboardMonthLabel(value time.Time) string {
	labels := []string{"Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"}
	return labels[int(value.Month())-1]
}
