package app

import (
	"strings"
	"testing"
)

func TestScheduleRoutesRequireAgendaModuleAndDedicatedPermission(t *testing.T) {
	source := readAppWiringSource(t)
	if !strings.Contains(source, `tenant.RequireOrganization(tenant.RequireModule("agenda", tenant.RequirePermission(permissions.ScheduleView, handler)))`) ||
		!strings.Contains(source, `return withActiveTenantResolver(agendaDashboardResolver,`) {
		t.Fatal("dashboard reads must use the active tenant chain with Agenda module and view permission")
	}

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
		expected := `mux.Handle("` + route.methodPath + `", withActiveModulePermission("agenda", ` + route.permission
		if route.methodPath == "GET /v1/schedule/dashboard" || route.methodPath == "GET /v1/schedule/dashboard/events" {
			expected = `mux.Handle("` + route.methodPath + `", withAgendaDashboardRead(`
		}
		if !strings.Contains(source, expected) {
			t.Fatalf("schedule route must require an active session, the agenda module and its dedicated permission: %s", route.methodPath)
		}
	}
}
