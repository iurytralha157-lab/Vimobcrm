package schedule

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// Called only by the existing guarded disposable-database fixture.
func runScheduleSecondRoundChecks(t *testing.T, f scheduleHardeningFixtureContext) {
	create := func(t *testing.T, kind, visibility, lead string) Event {
		t.Helper()
		input, err := (CreateRequest{ClientRequestID: f.id(), Title: "Synthetic second-round activity", UserID: f.owner, EventType: kind, LeadID: lead, StartTime: f.start, EndTime: f.start.Add(time.Hour), Visibility: visibility}).Validate(f.admin.UserID)
		if err != nil {
			t.Fatal(err)
		}
		event, err := f.repo.Create(f.ctx, f.admin, input)
		if err != nil {
			t.Fatal(err)
		}
		return event
	}
	lead := f.id()
	if _, err := f.pool.Exec(f.ctx, `insert into public.leads(id,organization_id,name,phone,source,assigned_user_id) values($1,$2,'Synthetic scoped lead','0000000009','Synthetic source',$3)`, lead, f.org, f.owner); err != nil {
		t.Fatal(err)
	}
	public := create(t, "task", "public", lead)
	day := time.Date(f.start.Year(), f.start.Month(), f.start.Day(), 0, 0, 0, 0, time.UTC)
	filter := DashboardEventsFilter{DashboardFilter: DashboardFilter{DateFrom: day.AddDate(0, 0, -1), DateTo: day.AddDate(0, 0, 1), DateBasis: DashboardDateBasisStartTime}, Limit: maxDashboardEventsLimit}
	assertHiddenSources := func(t *testing.T, actor tenant.Context, minimumEvents int64) {
		t.Helper()
		report, err := f.repo.Dashboard(f.ctx, actor, filter.DashboardFilter)
		if err != nil || report.KPIs.Total < minimumEvents {
			t.Fatalf("source redaction must retain authorized activities: %#v %v", report, err)
		}
		for _, source := range report.BySource {
			if source.Key != "__none__" {
				t.Fatalf("unauthorized current or historical source exposed: %#v", source)
			}
		}
		if report.DataQuality == nil || report.DataQuality.MissingLeadSourceSnapshot != 0 {
			t.Fatalf("quality counters inferred a hidden lead binding: %#v", report.DataQuality)
		}
		sourced := filter.DashboardFilter
		sourced.Source = "Synthetic source"
		filtered, err := f.repo.Dashboard(f.ctx, actor, sourced)
		if err != nil || filtered.KPIs.Total != 0 {
			t.Fatalf("source filter inferred a hidden lead: %#v %v", filtered, err)
		}
		sourced.Source = "__none__"
		filtered, err = f.repo.Dashboard(f.ctx, actor, sourced)
		if err != nil || filtered.KPIs.Total != report.KPIs.Total {
			t.Fatalf("neutral source must preserve the activities: %#v %v", filtered, err)
		}
	}
	assertNoLead := func(t *testing.T, event Event) {
		t.Helper()
		if event.ID == "" || event.Lead != nil || event.LeadID != nil || event.LeadSourceSnapshot != nil {
			t.Fatalf("event missing or unauthorized lead projection remained: %#v", event)
		}
	}
	t.Run("public and owned events retain access without exposing a lead grant", func(t *testing.T) {
		actor := f.ownerActor
		actor.Permissions = []string{permissions.ScheduleView}
		got, err := f.repo.Get(f.ctx, actor, public.ID)
		if err != nil {
			t.Fatal(err)
		}
		assertNoLead(t, got)
		private := create(t, "task", "private", lead)
		got, err = f.repo.Get(f.ctx, actor, private.ID)
		if err != nil {
			t.Fatal(err)
		}
		assertNoLead(t, got)
		page, err := f.repo.DashboardEvents(f.ctx, actor, filter)
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, item := range page.Items {
			if item.ID == public.ID {
				found = true
				if item.LeadID != nil || item.LeadName != nil {
					t.Fatalf("dashboard exposed lead without grant: %#v", item)
				}
			}
		}
		if !found {
			t.Fatal("lead privacy unexpectedly hid the public event")
		}
		assertHiddenSources(t, actor, 2)
		foreign := tenant.Context{OrganizationID: f.otherOrg, UserID: f.otherTenantUser, MemberRole: "admin"}
		if _, err := f.repo.Get(f.ctx, foreign, public.ID); !errors.Is(err, ErrEventNotFound) {
			t.Fatalf("foreign organization accessed event: %v", err)
		}
	})
	t.Run("lead own team and all grants use current scope in list preview and mutation responses", func(t *testing.T) {
		own := f.ownerActor
		own.Permissions = append(append([]string(nil), own.Permissions...), permissions.LeadViewOwn)
		got, err := f.repo.Get(f.ctx, own, public.ID)
		if err != nil || got.Lead == nil {
			t.Fatalf("current own lead must be readable: %#v %v", got, err)
		}
		sourceFilter := filter.DashboardFilter
		sourceFilter.Source = "Synthetic source"
		ownReport, err := f.repo.Dashboard(f.ctx, own, sourceFilter)
		if err != nil || ownReport.KPIs.Total < 2 {
			t.Fatalf("current own lead source must remain usable: %#v %v", ownReport, err)
		}
		team := own
		team.UserID = f.admin.UserID
		team.Permissions = []string{permissions.ScheduleView, permissions.LeadViewTeam}
		got, err = f.repo.Get(f.ctx, team, public.ID)
		if err != nil || got.Lead == nil {
			t.Fatalf("current active led-team lead must be readable: %#v %v", got, err)
		}
		if _, err := f.pool.Exec(f.ctx, `update public.leads set assigned_user_id=$2 where id=$1`, lead, f.otherMember); err != nil {
			t.Fatal(err)
		}
		defer f.pool.Exec(f.ctx, `update public.leads set assigned_user_id=$2 where id=$1`, lead, f.owner)
		for _, actor := range []tenant.Context{own, team} {
			minimumEvents := int64(1) // A leader cannot see the owner's private event.
			if actor.UserID == f.owner {
				minimumEvents = 2
			}
			assertHiddenSources(t, actor, minimumEvents)
			got, err := f.repo.Get(f.ctx, actor, public.ID)
			if err != nil {
				t.Fatal(err)
			}
			assertNoLead(t, got)
			preview, err := f.repo.List(f.ctx, actor, ListFilter{LeadID: lead, LeadPreview: true})
			if err != nil {
				t.Fatal(err)
			}
			for _, event := range preview {
				assertNoLead(t, event)
			}
		}
		title := "Synthetic edited title without binding a lead"
		got, err = f.repo.Update(f.ctx, own, public.ID, updateInput{Title: patchString{Set: true, Value: &title}})
		if err != nil {
			t.Fatal(err)
		}
		assertNoLead(t, got)
		all := own
		all.Permissions = append(all.Permissions, permissions.LeadViewAll)
		got, err = f.repo.Get(f.ctx, all, public.ID)
		if err != nil || got.Lead == nil {
			t.Fatalf("explicit all grant must retain current lead access: %#v %v", got, err)
		}
	})
	t.Run("missing-date quality cannot infer a hidden current or historical lead source", func(t *testing.T) {
		event := create(t, "task", "public", lead)
		defer f.pool.Exec(f.ctx, `delete from public.schedule_events where id=$1 and organization_id=$2`, event.ID, f.org)
		if _, err := f.pool.Exec(f.ctx, `update public.schedule_events set status='completed',completed_at=null,outcome_recorded_at=null where id=$1`, event.ID); err != nil {
			t.Fatal(err)
		}
		actor := f.ownerActor
		actor.Permissions = []string{permissions.ScheduleView}
		qualityFilter := filter.DashboardFilter
		qualityFilter.DateBasis = DashboardDateBasisCompletedAt
		qualityFilter.Source = "Synthetic source"
		report, err := f.repo.Dashboard(f.ctx, actor, qualityFilter)
		if err != nil || report.DataQuality == nil || report.DataQuality.UnknownResultTimeInScope != 0 {
			t.Fatalf("source filter inferred a hidden lead from unknown-date quality: %#v %v", report.DataQuality, err)
		}
		qualityFilter.Source = "__none__"
		report, err = f.repo.Dashboard(f.ctx, actor, qualityFilter)
		if err != nil || report.DataQuality == nil || report.DataQuality.UnknownResultTimeInScope < 1 {
			t.Fatalf("neutral source must retain the authorized undated activity: %#v %v", report.DataQuality, err)
		}
		actor.Permissions = append(actor.Permissions, permissions.LeadViewOwn)
		qualityFilter.Source = "Synthetic source"
		report, err = f.repo.Dashboard(f.ctx, actor, qualityFilter)
		if err != nil || report.DataQuality == nil || report.DataQuality.UnknownResultTimeInScope < 1 {
			t.Fatalf("current own scope must keep historical source quality: %#v %v", report.DataQuality, err)
		}
	})
	t.Run("inconsistent legacy cross-organization lead references never project foreign details", func(t *testing.T) {
		foreignLead := f.id()
		if _, err := f.pool.Exec(f.ctx, `insert into public.leads(id,organization_id,name,phone,assigned_user_id) values($1,$2,'Synthetic foreign lead','0000000001',$3)`, foreignLead, f.otherOrg, f.otherTenantUser); err != nil {
			t.Fatal(err)
		}
		event := create(t, "task", "public", "")
		if _, err := f.pool.Exec(f.ctx, `update public.schedule_events set lead_id=$2,lead_source_snapshot='Synthetic foreign source' where id=$1`, event.ID, foreignLead); err != nil {
			t.Fatal(err)
		}
		got, err := f.repo.Get(f.ctx, f.admin, event.ID)
		if err != nil {
			t.Fatal(err)
		}
		assertNoLead(t, got)
		foreignSource := filter.DashboardFilter
		foreignSource.Source = "Synthetic foreign source"
		report, err := f.repo.Dashboard(f.ctx, f.admin, foreignSource)
		if err != nil || report.KPIs.Total != 0 {
			t.Fatalf("legacy foreign lead source exposed through aggregation: %#v %v", report, err)
		}
	})
	t.Run("assignee-only patches persist and notify only new recipients", func(t *testing.T) {
		event := create(t, "task", "private", "")
		var request UpdateRequest
		if err := json.Unmarshal([]byte(`{"assignee_ids":["`+f.otherMember+`"]}`), &request); err != nil {
			t.Fatal(err)
		}
		input, err := request.Validate()
		if err != nil {
			t.Fatal(err)
		}
		updated, err := f.repo.Update(f.ctx, f.admin, event.ID, input)
		if err != nil || len(updated.AssigneeUserIDs) != 1 || updated.AssigneeUserIDs[0] != f.otherMember {
			t.Fatalf("valid participant-only change not applied: %#v %v", updated, err)
		}
		var before, after int
		if err := f.pool.QueryRow(f.ctx, `select count(*) from public.notifications where metadata->>'schedule_event_id'=$1`, event.ID).Scan(&before); err != nil {
			t.Fatal(err)
		}
		if _, err := f.repo.Update(f.ctx, f.admin, event.ID, input); err != nil {
			t.Fatal(err)
		}
		if err := f.pool.QueryRow(f.ctx, `select count(*) from public.notifications where metadata->>'schedule_event_id'=$1`, event.ID).Scan(&after); err != nil || after != before {
			t.Fatalf("participant retry notified twice: %d -> %d, %v", before, after, err)
		}
		if _, err := f.repo.Update(f.ctx, f.admin, event.ID, updateInput{AssigneeIDs: patchStringSlice{Set: true, Value: []string{}}}); err != nil {
			t.Fatalf("clearing participants-only change failed: %v", err)
		}
	})
	t.Run("appointment type cannot bypass transactional reschedule in two or three steps", func(t *testing.T) {
		visit := create(t, "visit", "private", "")
		task, meeting, visitType := "task", "meeting", "visit"
		if _, err := f.repo.Update(f.ctx, f.ownerActor, visit.ID, updateInput{EventType: patchString{Set: true, Value: &task}}); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("first step of history bypass accepted: %v", err)
		}
		if _, err := f.repo.Update(f.ctx, f.ownerActor, visit.ID, updateInput{EventType: patchString{Set: true, Value: &meeting}}); err != nil {
			t.Fatalf("open visit-to-meeting without timing change must work: %v", err)
		}
		activity := create(t, "task", "private", "")
		changed := f.start.Add(24 * time.Hour)
		if _, err := f.repo.Update(f.ctx, f.ownerActor, activity.ID, updateInput{EventType: patchString{Set: true, Value: &visitType}, StartTime: patchTime{Set: true, Value: &changed}}); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("destination appointment timing guard bypassed: %v", err)
		}
	})
	t.Run("busy completed recurrence reveals neither result nor series metadata", func(t *testing.T) {
		rule := "monthly"
		input, err := (CreateRequest{Title: "Synthetic masked series", UserID: f.owner, EventType: "task", StartTime: f.start, EndTime: f.start.Add(time.Hour), Visibility: "default", RecurrenceRule: rule}).Validate(f.admin.UserID)
		if err != nil {
			t.Fatal(err)
		}
		event, err := f.repo.Create(f.ctx, f.admin, input)
		if err != nil {
			t.Fatal(err)
		}
		complete, err := (CompleteRequest{Status: "completed"}).Validate(f.owner)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.repo.Complete(f.ctx, f.ownerActor, event.ID, complete); err != nil {
			t.Fatal(err)
		}
		viewer := f.ownerActor
		viewer.UserID = f.otherMember
		masked, err := f.repo.Get(f.ctx, viewer, event.ID)
		if err != nil || !masked.IsMasked || masked.Status != "" || masked.CompletedAt != nil || masked.RecurrenceRule != nil || masked.ReminderMinutes != nil {
			t.Fatalf("busy row contains details: %#v %v", masked, err)
		}
		visible, err := f.repo.Get(f.ctx, f.ownerActor, event.ID)
		if err != nil || visible.Status != "completed" || visible.CompletedAt == nil || visible.RecurrenceRule == nil {
			t.Fatalf("authorized owner lost outcome/series data: %#v %v", visible, err)
		}
	})
	t.Run("reads of comments and participants retain authorized content and deny a transferred private event", func(t *testing.T) {
		event := create(t, "task", "private", "")
		if _, err := f.repo.AddComment(f.ctx, f.ownerActor, event.ID, "Synthetic private comment", f.id()); err != nil {
			t.Fatal(err)
		}
		if _, err := f.repo.AddAssignee(f.ctx, f.admin, event.ID, f.otherMember); err != nil {
			t.Fatal(err)
		}
		comments, err := f.repo.ListComments(f.ctx, f.ownerActor, event.ID)
		if err != nil || len(comments) != 1 {
			t.Fatalf("authorized comments read failed: %v", err)
		}
		assignees, err := f.repo.ListAssignees(f.ctx, f.ownerActor, event.ID)
		if err != nil || len(assignees) != 1 {
			t.Fatalf("authorized participants read failed: %v", err)
		}
		if _, err := f.repo.Update(f.ctx, f.admin, event.ID, updateInput{UserID: patchString{Set: true, Value: &f.otherMember}, AssigneeIDs: patchStringSlice{Set: true, Value: []string{}}}); err != nil {
			t.Fatal(err)
		}
		if _, err := f.repo.ListComments(f.ctx, f.ownerActor, event.ID); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
			t.Fatalf("former owner read private comments: %v", err)
		}
		if _, err := f.repo.ListAssignees(f.ctx, f.ownerActor, event.ID); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
			t.Fatalf("former owner read private participants: %v", err)
		}
	})
	t.Run("concatenated creation JSON cannot commit a first event", func(t *testing.T) {
		command := f.id()
		body := `{"client_request_id":"` + command + `","title":"Synthetic EOF regression","event_type":"task","start_time":"` + f.start.Format(time.RFC3339) + `","end_time":"` + f.start.Add(time.Hour).Format(time.RFC3339) + `"}{}`
		r := httptest.NewRequest(http.MethodPost, "/v1/schedule/events", strings.NewReader(body))
		r = r.WithContext(tenant.ContextWithTenant(r.Context(), f.admin))
		w := httptest.NewRecorder()
		NewHandler(f.repo).CreateEvent(w, r)
		var persisted int
		if err := f.pool.QueryRow(f.ctx, `select count(*) from public.schedule_events where client_request_id=$1`, command).Scan(&persisted); err != nil {
			t.Fatal(err)
		}
		if w.Code != http.StatusBadRequest || persisted != 0 {
			t.Fatalf("invalid envelope changed data: status=%d rows=%d", w.Code, persisted)
		}
	})
}
