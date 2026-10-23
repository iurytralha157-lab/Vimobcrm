package schedule

import (
	"testing"
	"time"
)

func TestMonthlyAndYearlyRecurrenceClampWithoutLosingTheAnchorDay(t *testing.T) {
	for _, test := range []struct {
		start     string
		frequency string
		amount    int
		want      string
	}{
		{"2026-01-31T10:30:00Z", "monthly", 1, "2026-02-28T10:30:00Z"},
		{"2026-01-31T10:30:00Z", "monthly", 2, "2026-03-31T10:30:00Z"},
		{"2026-08-31T10:30:00Z", "monthly", 1, "2026-09-30T10:30:00Z"},
		{"2024-02-29T10:30:00Z", "yearly", 1, "2025-02-28T10:30:00Z"},
		{"2024-02-29T10:30:00Z", "yearly", 4, "2028-02-29T10:30:00Z"},
	} {
		start, err := time.Parse(time.RFC3339, test.start)
		if err != nil {
			t.Fatal(err)
		}
		got := addRecurrence(start, test.frequency, test.amount)
		if got.Format(time.RFC3339) != test.want {
			t.Fatalf("%s %s %d = %s, want %s", test.start, test.frequency, test.amount, got, test.want)
		}
	}
}

func TestCivilRecurrenceKeepsLocalClockAcrossSpringAndFallDST(t *testing.T) {
	location, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		month       time.Month
		day, amount int
		frequency   string
		elapsed     time.Duration
	}{
		{time.March, 7, 1, "daily", 23 * time.Hour},
		{time.October, 31, 1, "daily", 25 * time.Hour},
		{time.March, 1, 1, "weekly", 167 * time.Hour},
	} {
		start := time.Date(2026, test.month, test.day, 10, 15, 0, 0, location)
		got := addRecurrence(start, test.frequency, test.amount)
		if got.Hour() != 10 || got.Minute() != 15 || got.Sub(start) != test.elapsed {
			t.Fatalf("civil clock drift: %s -> %s elapsed %v", start, got, got.Sub(start))
		}
	}
}

func TestRecurrenceGapShiftsForwardAndPreservesPositiveDuration(t *testing.T) {
	location, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	start := time.Date(2026, time.March, 7, 2, 30, 0, 0, location)
	rule := "daily"
	input := createInput{StartTime: start, EndTime: start.Add(30 * time.Minute), RecurrenceRule: &rule}
	nextStart, nextEnd := recurringEventInterval(input, 1)
	if nextStart.Day() != 8 || nextStart.Hour() != 3 || nextStart.Minute() != 30 || nextEnd.Sub(nextStart) != 30*time.Minute {
		t.Fatalf("invalid DST-gap occurrence: %s -> %s", nextStart, nextEnd)
	}
}

func TestRepeatedClockPrefersTheOriginalUTCOffset(t *testing.T) {
	location, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct{ day, amount, offset int }{{31, 1, -4 * 3600}, {2, -1, -5 * 3600}} {
		month := time.October
		if test.day == 2 {
			month = time.November
		}
		start := time.Date(2026, month, test.day, 1, 30, 0, 0, location)
		got := addRecurrence(start, "daily", test.amount)
		_, offset := got.Zone()
		if got.Month() != time.November || got.Day() != 1 || got.Hour() != 1 || got.Minute() != 30 || offset != test.offset {
			t.Fatalf("ambiguous clock changed offset: %s -> %s", start, got)
		}
	}
}
