package app

import (
	"strings"
	"testing"
)

func TestScheduleRoutesRequireAgendaModuleAndDedicatedPermission(t *testing.T) {
	source := readAppWiringSource(t)

	routes := []struct {
		methodPath string
		permission string
	}{
		{`GET /v1/schedule/capabilities`, `permissions.ScheduleView`},
		{`GET /v1/schedule/dashboard`, `permissions.ScheduleView`},
		{`GET /v1/schedule/dashboard/events`, `permissions.ScheduleView`},
		{`GET /v1/schedule/events`, `permissions.ScheduleView`},
		{`POST /v1/schedule/events`, `permissions.ScheduleManage`},
		{`PATCH /v1/schedule/events/{id}`, `permissions.ScheduleManage`},
		{`DELETE /v1/schedule/events/{id}`, `permissions.ScheduleManage`},
		{`POST /v1/schedule/events/{id}/complete`, `permissions.ScheduleManage`},
		{`POST /v1/schedule/events/{id}/reschedule`, `permissions.ScheduleManage`},
		{`GET /v1/schedule/events/{id}/comments`, `permissions.ScheduleView`},
		{`POST /v1/schedule/events/{id}/comments`, `permissions.ScheduleManage`},
		{`GET /v1/schedule/events/{id}/assignees`, `permissions.ScheduleView`},
		{`POST /v1/schedule/events/{id}/assignees`, `permissions.ScheduleManage`},
		{`DELETE /v1/schedule/events/{id}/assignees/{userId}`, `permissions.ScheduleManage`},
	}

	for _, route := range routes {
		expected := `mux.Handle("` + route.methodPath + `", withModulePermission("agenda", ` + route.permission
		if !strings.Contains(source, expected) {
			t.Fatalf("schedule route must require the agenda module and its dedicated permission: %s", route.methodPath)
		}
	}
}
