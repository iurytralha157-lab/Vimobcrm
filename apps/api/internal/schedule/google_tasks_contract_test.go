package schedule

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestGoogleTasksProjectionRetainsSeparateCalendarAndTaskIDs(t *testing.T) {
	query := scheduleEventsQuery("se.organization_id = $1::uuid")
	for _, field := range []string{"google_event_id", "google_task_id", "google_sync_target"} {
		if !strings.Contains(query, "case when v.is_masked then null else v."+field+" end") {
			t.Fatalf("masked event exposes %s", field)
		}
	}
	taskID, eventID, target := "synthetic-task", "synthetic-calendar", "tasks"
	encoded, err := json.Marshal(Event{GoogleTaskID: &taskID, GoogleEventID: &eventID, GoogleSyncTarget: &target})
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{`"google_task_id":"synthetic-task"`, `"google_event_id":"synthetic-calendar"`, `"google_sync_target":"tasks"`} {
		if !strings.Contains(string(encoded), field) {
			t.Fatalf("separate remote identity missing: %s", encoded)
		}
	}
}

func TestGoogleTasksDeleteAndTransferCarryDurableCleanupIntent(t *testing.T) {
	for name, query := range map[string]string{"mutation": enqueueScheduleGoogleMutationSQL, "delete": enqueueScheduleGoogleDeleteSQL} {
		for _, required := range []string{"'protocol_version', 2", "'task_link_ids'", "public.google_tasks_links", "link.vimob_event_id = $2::uuid", "link.organization_id = $1::uuid", "'owner_user_id'", "'connection_id'", "'link_ids'"} {
			if !strings.Contains(query, required) {
				t.Fatalf("%s lost durable Tasks cleanup: %s", name, required)
			}
		}
	}
	if !strings.Contains(enqueueScheduleGoogleMutationSQL, "connection.routing_v2") || !strings.Contains(enqueueScheduleGoogleMutationSQL, "('task','message','email','call')") {
		t.Fatal("server-side opt-in/type routing is absent")
	}
}
