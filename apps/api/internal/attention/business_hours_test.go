package attention

import (
	"encoding/json"
	"testing"
	"time"
)

func TestAddPolicyMinutesAcrossBusinessDays(t *testing.T) {
	location, err := time.LoadLocation("America/Sao_Paulo")
	if err != nil {
		t.Fatal(err)
	}
	// Friday at 17:30 in Sao Paulo. Ninety business minutes finish Monday at 09:00.
	start := time.Date(2026, time.July, 10, 17, 30, 0, 0, location)
	got, err := AddPolicyMinutes(start, 90, true, "America/Sao_Paulo", json.RawMessage(`{"days":[1,2,3,4,5],"start":"08:00","end":"18:00"}`))
	if err != nil {
		t.Fatal(err)
	}
	want := time.Date(2026, time.July, 13, 9, 0, 0, 0, location).UTC()
	if !got.Equal(want) {
		t.Fatalf("got %s, want %s", got, want)
	}
}

func TestAddPolicyMinutesUsesElapsedTimeWhenBusinessHoursDisabled(t *testing.T) {
	start := time.Date(2026, time.July, 10, 17, 30, 0, 0, time.UTC)
	got, err := AddPolicyMinutes(start, 90, false, "invalid", nil)
	if err != nil {
		t.Fatal(err)
	}
	if want := start.Add(90 * time.Minute); !got.Equal(want) {
		t.Fatalf("got %s, want %s", got, want)
	}
}
