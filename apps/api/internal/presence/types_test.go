package presence

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestNewDataCountsStatusesAndFormatsGeneratedAt(t *testing.T) {
	generatedAt := time.Date(2026, time.September, 2, 12, 34, 56, 789, time.FixedZone("BRT", -3*60*60))
	data := newData([]User{
		{UserID: "online-user", PresenceStatus: StatusOnline},
		{UserID: "idle-user", PresenceStatus: StatusIdle},
		{UserID: "offline-user", PresenceStatus: StatusOffline},
	}, generatedAt)

	if data.Counts != (Counts{Total: 3, Online: 1, Idle: 1, Offline: 1}) {
		t.Fatalf("counts = %#v", data.Counts)
	}
	if data.GeneratedAt != "2026-09-02T15:34:56Z" {
		t.Fatalf("generated_at = %q", data.GeneratedAt)
	}
	if _, err := time.Parse(time.RFC3339, data.GeneratedAt); err != nil {
		t.Fatalf("generated_at is not RFC3339: %v", err)
	}
}

func TestNewDataUsesEmptyArrayAndMinimalSnakeCaseContract(t *testing.T) {
	payload, err := json.Marshal(Response{Data: newData(nil, time.Unix(0, 0))})
	if err != nil {
		t.Fatalf("marshal response: %v", err)
	}

	text := string(payload)
	if !strings.Contains(text, `"users":[]`) {
		t.Fatalf("empty users must be an array: %s", text)
	}
	for _, forbidden := range []string{
		`"email"`,
		`"session_id"`,
		`"current_path"`,
		`"current_page_title"`,
		`"user_agent"`,
		`"metadata"`,
		`"generatedAt"`,
		`"presenceStatus"`,
		`"idleSinceAt"`,
	} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("response leaked forbidden or camelCase field %s: %s", forbidden, text)
		}
	}
}

func TestPresenceUserSerializesIdleSinceAtAsNullableSnakeCase(t *testing.T) {
	idleSinceAt := "2026-09-02T15:20:00Z"
	payload, err := json.Marshal(User{
		UserID:         "idle-user",
		Name:           "Ana",
		MemberRole:     "user",
		PresenceStatus: StatusIdle,
		IdleSinceAt:    &idleSinceAt,
	})
	if err != nil {
		t.Fatalf("marshal idle presence user: %v", err)
	}

	text := string(payload)
	if !strings.Contains(text, `"idle_since_at":"2026-09-02T15:20:00Z"`) {
		t.Fatalf("idle_since_at is missing from response: %s", text)
	}
	if strings.Contains(text, `"idleSinceAt"`) {
		t.Fatalf("idle timestamp used camelCase: %s", text)
	}

	payload, err = json.Marshal(User{})
	if err != nil {
		t.Fatalf("marshal empty presence user: %v", err)
	}
	if !strings.Contains(string(payload), `"idle_since_at":null`) {
		t.Fatalf("idle_since_at must remain present and nullable: %s", payload)
	}
}
