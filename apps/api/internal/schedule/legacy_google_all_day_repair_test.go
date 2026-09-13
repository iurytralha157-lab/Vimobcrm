package schedule

import (
	"testing"
	"time"
)

const civilDateLayout = "2006-01-02"

func legacyFixedMinusThreeFields(value time.Time) time.Time {
	return value.UTC().Add(-3 * time.Hour)
}

func legacyGoogleAllDayFingerprint(start, end time.Time) bool {
	startFields := legacyFixedMinusThreeFields(start)
	endFields := legacyFixedMinusThreeFields(end)
	return startFields.Hour() == 0 &&
		startFields.Minute() == 0 &&
		startFields.Second() == 0 &&
		startFields.Nanosecond() == 0 &&
		endFields.Hour() == 0 &&
		endFields.Minute() == 0 &&
		endFields.Second() == 0 &&
		endFields.Nanosecond() == 0
}

func TestLegacyGoogleAllDayFingerprintUsesTheProducerFixedOffsetAcrossHistoricalDST(t *testing.T) {
	fixedMinusThree := time.FixedZone("legacy-google-minus-three", -3*60*60)
	legacyStart := time.Date(2018, time.November, 4, 0, 0, 0, 0, fixedMinusThree)

	saoPaulo, err := time.LoadLocation("America/Sao_Paulo")
	if err != nil {
		t.Fatalf("load America/Sao_Paulo: %v", err)
	}
	if local := legacyStart.In(saoPaulo); local.Hour() == 0 {
		t.Fatalf("fixture must exercise the historical DST midnight gap, got %s", local)
	}
	if !legacyGoogleAllDayFingerprint(legacyStart, legacyStart) {
		t.Fatal("a one-day legacy range must match its fixed UTC-03 producer fingerprint")
	}
	if got := legacyFixedMinusThreeFields(legacyStart).Format(civilDateLayout); got != "2018-11-04" {
		t.Fatalf("recover legacy civil start date: got %s", got)
	}

	// On this date Sao Paulo skipped midnight. The repaired all-day range starts
	// at the first representable instant of the civil day and ends immediately
	// before the following civil midnight.
	wantStart := time.Date(2018, time.November, 4, 3, 0, 0, 0, time.UTC)
	wantEnd := time.Date(2018, time.November, 5, 2, 0, 0, 0, time.UTC).Add(-time.Millisecond)
	if !wantEnd.After(wantStart) {
		t.Fatal("the repaired one-day range must remain positive through a DST midnight gap")
	}
	if legacyGoogleAllDayFingerprint(wantStart, wantEnd) {
		t.Fatal("a repaired inclusive range must not match the legacy midnight fingerprint")
	}
}

func TestLegacyGoogleAllDayFingerprintCoversMultiDayAndSkipsRepairedRanges(t *testing.T) {
	fixedMinusThree := time.FixedZone("legacy-google-minus-three", -3*60*60)
	legacyStart := time.Date(2026, time.January, 10, 0, 0, 0, 0, fixedMinusThree)
	legacyIncludedEnd := time.Date(2026, time.January, 12, 0, 0, 0, 0, fixedMinusThree)

	if !legacyGoogleAllDayFingerprint(legacyStart, legacyIncludedEnd) {
		t.Fatal("the deterministic multi-day legacy shape must be eligible for repair")
	}
	if got := legacyFixedMinusThreeFields(legacyIncludedEnd).Format(civilDateLayout); got != "2026-01-12" {
		t.Fatalf("recover legacy included end date: got %s", got)
	}

	repairedEnd := time.Date(2026, time.January, 13, 0, 0, 0, 0, fixedMinusThree).Add(-time.Millisecond)
	if legacyGoogleAllDayFingerprint(legacyStart, repairedEnd) {
		t.Fatal("an already repaired multi-day range must not be selected again")
	}
}
