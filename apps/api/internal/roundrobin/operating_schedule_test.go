package roundrobin

import (
	"encoding/json"
	"errors"
	"testing"
)

func syntheticOperatingSchedule() map[string]any {
	days := make([]any, 7)
	for day := range days {
		days[day] = map[string]any{"day_of_week": day, "is_active": day > 0 && day < 6, "is_all_day": false, "start_time": "08:00", "end_time": "18:00"}
	}
	return map[string]any{"version": 1, "timezone": "America/Sao_Paulo", "days": days}
}

func TestOperatingSchedulePreservesLegacyAndSupportsOvernightAndAllDay(t *testing.T) {
	legacy, err := normalizeQueueSettings(map[string]any{"enable_redistribution": false})
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := legacy["operating_schedule"]; exists {
		t.Fatal("saving legacy settings must not activate a calendar")
	}
	schedule := syntheticOperatingSchedule()
	days := schedule["days"].([]any)
	days[1].(map[string]any)["start_time"] = "22:00"
	days[1].(map[string]any)["end_time"] = "06:00"
	days[2].(map[string]any)["is_all_day"] = true
	days[2].(map[string]any)["start_time"], days[2].(map[string]any)["end_time"] = nil, nil
	settings, err := normalizeQueueSettings(map[string]any{"operating_schedule": schedule})
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(settings["operating_schedule"])
	if err != nil || !json.Valid(encoded) {
		t.Fatalf("normalized calendar must remain JSON: %s %v", encoded, err)
	}
}

func TestOperatingScheduleRejectsIncompleteOrAmbiguousCalendars(t *testing.T) {
	cases := map[string]func(map[string]any){
		"null":                func(schedule map[string]any) { schedule["version"] = nil },
		"version":             func(schedule map[string]any) { schedule["version"] = 2 },
		"timezone":            func(schedule map[string]any) { schedule["timezone"] = "unconfigured/zone" },
		"local timezone":      func(schedule map[string]any) { schedule["timezone"] = "Local" },
		"missing day":         func(schedule map[string]any) { schedule["days"] = schedule["days"].([]any)[:6] },
		"duplicate day":       func(schedule map[string]any) { schedule["days"].([]any)[6].(map[string]any)["day_of_week"] = 0 },
		"missing active flag": func(schedule map[string]any) { delete(schedule["days"].([]any)[1].(map[string]any), "is_active") },
		"unknown flag": func(schedule map[string]any) {
			schedule["days"].([]any)[1].(map[string]any)["ignore_availability"] = true
		},
		"invalid time":          func(schedule map[string]any) { schedule["days"].([]any)[1].(map[string]any)["start_time"] = "24:00" },
		"ambiguous equal times": func(schedule map[string]any) { schedule["days"].([]any)[1].(map[string]any)["end_time"] = "08:00" },
		"missing active time":   func(schedule map[string]any) { schedule["days"].([]any)[1].(map[string]any)["start_time"] = nil },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			schedule := syntheticOperatingSchedule()
			mutate(schedule)
			_, err := normalizeQueueSettings(map[string]any{"operating_schedule": schedule})
			if !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("ambiguous explicit calendar accepted: %v", err)
			}
		})
	}
	if _, err := normalizeQueueSettings(map[string]any{"operating_schedule": nil}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("explicit null must not fall back to legacy: %v", err)
	}
}

func TestOperatingScheduleShortTimeoutAllowsDistributionWithoutWarning(t *testing.T) {
	for timeout := 1; timeout <= 5; timeout++ {
		input := map[string]any{"operating_schedule": syntheticOperatingSchedule(), "enable_redistribution": true, "redistribution_timeout_minutes": timeout}
		settings, err := normalizeQueueSettings(input)
		if err != nil || settings["redistribution_warning_minutes"] != 0 {
			t.Fatalf("timeout %d must work without warning: %#v %v", timeout, settings, err)
		}
		input["redistribution_warning_minutes"] = 1
		_, err = normalizeQueueSettings(input)
		if !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("short timeout %d accepted a warning: %v", timeout, err)
		}
	}
}

func TestOperatingScheduleCannotBeSilentlyDowngradedOrBypassMemberSchedule(t *testing.T) {
	managed := map[string]any{"operating_schedule": syntheticOperatingSchedule(), "ignore_availability": true}
	normalized, err := normalizeQueueSettings(managed)
	if err != nil || normalized["ignore_availability"] != false {
		t.Fatalf("managed calendar must not bypass member schedules: %#v %v", normalized, err)
	}
	if err := validateOperatingScheduleTransition(normalized, map[string]any{}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("a partial settings client could remove managed guards: %v", err)
	}
	if err := validateOperatingScheduleTransition(map[string]any{}, normalized); err != nil {
		t.Fatalf("explicit activation must remain supported: %v", err)
	}
	if _, err := normalizeQueueSettings(map[string]any{"pool_notifications": "true"}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("notification opt-in must be explicit boolean: %v", err)
	}
}

func TestOperatingSchedulePoolNotificationsAcceptEditorObjectContract(t *testing.T) {
	for _, body := range []string{`{"pool_notifications":{"enabled":false}}`, `{"pool_notifications":{"enabled":true}}`} {
		var settings map[string]any
		if err := json.Unmarshal([]byte(body), &settings); err != nil {
			t.Fatal(err)
		}
		if _, err := normalizeQueueSettings(settings); err != nil {
			t.Fatalf("editor payload rejected: %s %v", body, err)
		}
	}
	for _, body := range []string{`{"pool_notifications":true}`, `{"pool_notifications":null}`, `{"pool_notifications":{}}`, `{"pool_notifications":{"enabled":"true"}}`, `{"pool_notifications":{"enabled":true,"audience":"all"}}`} {
		var settings map[string]any
		if err := json.Unmarshal([]byte(body), &settings); err != nil {
			t.Fatal(err)
		}
		if _, err := normalizeQueueSettings(settings); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("ambiguous notification payload accepted: %s %v", body, err)
		}
	}
}
