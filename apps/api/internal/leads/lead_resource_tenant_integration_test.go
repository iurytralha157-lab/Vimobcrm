package leads

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestLeadResourceTenantBoundaries(t *testing.T) {
	f := newAutomationStageFixture(t, "lead_tasks", "cadence_enrollments")
	otherOrg := pipelinePostgresID(99)
	ownLead, foreignLead := pipelinePostgresID(100), pipelinePostgresID(101)
	missingLead, hiddenLead := pipelinePostgresID(102), pipelinePostgresID(103)
	f.exec(t, `alter table public.leads add primary key (id);
		alter table public.notifications add constraint notifications_lead_id_fkey
			foreign key (lead_id) references public.leads (id) on delete cascade;
		alter table public.lead_tasks add foreign key (lead_id) references public.leads (id) on delete cascade`)
	f.exec(t, `insert into public.leads (id, organization_id, name, assigned_user_id)
		values ($1, $4, 'Lead A', $6), ($2, $5, 'Lead B', null), ($3, $4, 'Unassigned lead A', null)`, ownLead, foreignLead, hiddenLead, f.org, otherOrg, f.user)
	actor := tenant.Context{OrganizationID: f.org, UserID: f.user, MemberRole: "admin", Permissions: []string{permissions.LeadOperate}}
	handler := NewHandler(f.repo)

	for _, endpoint := range []struct {
		name   string
		handle http.HandlerFunc
		actor  tenant.Context
	}{
		{"create", handler.CreateNotification, actor},
		{"dispatch", handler.DispatchNotification, tenant.Context{OrganizationID: f.org, UserID: f.user, MemberRole: "user", Permissions: []string{permissions.LeadViewOwn}}},
	} {
		t.Run("notification/"+endpoint.name, func(t *testing.T) {
			request := func(leadID string) int {
				t.Helper()
				payload := map[string]any{"title": "Tenant test", "user_id": f.user}
				path := "/v1/notifications"
				if endpoint.name == "dispatch" {
					path += "/dispatch"
					payload["event_key"] = "info"
					payload["channels"] = []string{"system"}
				}
				if leadID != "" {
					payload["lead_id"] = leadID
				}
				body, err := json.Marshal(payload)
				if err != nil {
					t.Fatal(err)
				}
				req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
				req.Header.Set("Content-Type", "application/json")
				recorder := httptest.NewRecorder()
				endpoint.handle(recorder, req.WithContext(tenant.ContextWithTenant(f.ctx, endpoint.actor)))
				return recorder.Code
			}
			before := f.count(t, "public.notifications")
			foreignStatus, missingStatus := request(foreignLead), request(missingLead)
			if foreignStatus != http.StatusNotFound || missingStatus != foreignStatus {
				t.Errorf("foreign lead status = %d, missing lead status = %d, want 404 for both", foreignStatus, missingStatus)
			}
			if endpoint.name == "dispatch" {
				if status := request(hiddenLead); status != http.StatusNotFound {
					t.Errorf("hidden lead status = %d, want 404", status)
				}
			}
			if after := f.count(t, "public.notifications"); after != before {
				t.Errorf("denied requests wrote %d notifications", after-before)
			}
			if status := request(ownLead); status != http.StatusCreated {
				t.Errorf("own lead status = %d, want 201", status)
			}
			if status := request(""); status != http.StatusCreated {
				t.Errorf("leadless notification status = %d, want 201", status)
			}
		})
	}

	t.Run("tasks", func(t *testing.T) {
		ownTask, foreignTask := pipelinePostgresID(110), pipelinePostgresID(111)
		cancelledTask, ownEnrollment, foreignEnrollment := pipelinePostgresID(112), pipelinePostgresID(113), pipelinePostgresID(114)
		f.exec(t, `insert into public.cadence_enrollments (id, organization_id, lead_id, cadence_template_id, status)
			values ($1, $3, $5, gen_random_uuid(), 'cancelled'), ($2, $4, $6, gen_random_uuid(), 'cancelled')`,
			ownEnrollment, foreignEnrollment, f.org, otherOrg, ownLead, foreignLead)
		f.exec(t, `insert into public.lead_tasks (id, organization_id, lead_id, title, cadence_enrollment_id)
			values ($1, $4, $6, 'Task A', $8), ($2, $5, $6, 'Task B', null), ($3, $4, $6, 'Cancelled task A', $7)`,
			ownTask, foreignTask, cancelledTask, f.org, otherOrg, ownLead, ownEnrollment, foreignEnrollment)
		tasks, err := f.repo.ListLeadTasks(f.ctx, actor, ownLead)
		if err != nil {
			t.Fatal(err)
		}
		if len(tasks) != 1 || tasks[0].ID != ownTask {
			t.Fatalf("expected only task A, got %+v", tasks)
		}
		if _, err := f.repo.ListLeadTasks(f.ctx, actor, foreignLead); !errors.Is(err, ErrLeadNotFound) {
			t.Fatalf("foreign lead returned %v, want not found", err)
		}
	})
}
