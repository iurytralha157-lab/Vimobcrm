package schedule

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type scheduleHardeningFixtureContext struct {
	ctx                                                context.Context
	repo                                               Repository
	pool                                               *pgxpool.Pool
	org, otherOrg, owner, otherMember, otherTenantUser string
	ownerActor, admin                                  tenant.Context
	start                                              time.Time
	id                                                 func() string
}

// These share only the already-guarded disposable database from the opt-in
// harness. They cannot independently open a production/shared connection.
func runScheduleHardeningAdditionalChecks(t *testing.T, f scheduleHardeningFixtureContext) {
	runScheduleCreateReplayPrivacyChecks(t, f)
	runScheduleSecondRoundChecks(t, f)
	create := func(t *testing.T, kind string) Event {
		t.Helper()
		input, err := (CreateRequest{ClientRequestID: f.id(), Title: "Synthetic negative case", UserID: f.owner, EventType: kind, StartTime: f.start, EndTime: f.start.Add(time.Hour), Visibility: "private"}).Validate(f.owner)
		if err != nil {
			t.Fatal(err)
		}
		event, err := f.repo.Create(f.ctx, f.ownerActor, input)
		if err != nil {
			t.Fatal(err)
		}
		return event
	}
	t.Run("reschedule retry cannot disclose a transferred private replacement", func(t *testing.T) {
		original := create(t, "meeting")
		input := rescheduleInput{StartTime: f.start.Add(time.Hour), EndTime: f.start.Add(2 * time.Hour), ExpectedUpdatedAt: original.UpdatedAt}
		result, err := f.repo.Reschedule(f.ctx, f.ownerActor, original.ID, input)
		if err != nil {
			t.Fatal(err)
		}
		newOwner, private, description := f.otherMember, "private", "Synthetic confidential replacement"
		if _, err := f.repo.Update(f.ctx, f.admin, result.NewEvent.ID, updateInput{UserID: patchString{Set: true, Value: &newOwner}, Visibility: patchString{Set: true, Value: &private}, Description: patchString{Set: true, Value: &description}}); err != nil {
			t.Fatal(err)
		}
		if _, err := f.repo.Get(f.ctx, f.ownerActor, result.NewEvent.ID); !errors.Is(err, ErrEventNotFound) {
			t.Fatalf("old owner can read replacement: %v", err)
		}
		replay, err := f.repo.Reschedule(f.ctx, f.ownerActor, original.ID, input)
		if !errors.Is(err, ErrScheduleConflict) || replay.NewEvent.ID != "" || replay.NewEvent.Description != nil {
			t.Fatalf("private replacement leaked in replay: %#v %v", replay, err)
		}
	})
	t.Run("title-only edit does not require reassigning an invisible property", func(t *testing.T) {
		property := f.id()
		if _, err := f.pool.Exec(f.ctx, `insert into public.properties(id,organization_id,title,responsible_user_id,created_by) values($1,$2,'Synthetic hidden property',$3,$3)`, property, f.org, f.otherMember); err != nil {
			t.Fatal(err)
		}
		event := create(t, "task")
		if _, err := f.repo.Update(f.ctx, f.admin, event.ID, updateInput{PropertyID: patchString{Set: true, Value: &property}}); err != nil {
			t.Fatal(err)
		}
		title := "Edited without reference mutation"
		updated, err := f.repo.Update(f.ctx, f.ownerActor, event.ID, updateInput{Title: patchString{Set: true, Value: &title}})
		if err != nil || updated.Title != title || updated.PropertyID != nil {
			t.Fatalf("scoped title-only edit: %#v %v", updated, err)
		}
		if _, err := f.repo.Update(f.ctx, f.ownerActor, event.ID, updateInput{PropertyID: patchString{Set: true, Value: &property}}); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
			t.Fatalf("explicit invisible property bind: %v", err)
		}
	})
	t.Run("dashboard reports unknown dates without attributing another tenant or private owner", func(t *testing.T) {
		for _, row := range []struct{ org, user string }{{f.org, f.owner}, {f.org, f.otherMember}, {f.otherOrg, f.otherTenantUser}} {
			if _, err := f.pool.Exec(f.ctx, `insert into public.schedule_events(organization_id,user_id,title,event_type,start_time,end_time,status,visibility) values($1,$2,'Synthetic legacy task','task',$3,$4,'completed','private')`, row.org, row.user, f.start, f.start.Add(time.Hour)); err != nil {
				t.Fatal(err)
			}
		}
		loc, err := time.LoadLocation("America/New_York")
		if err != nil {
			t.Fatal(err)
		}
		day := time.Date(f.start.In(loc).Year(), f.start.In(loc).Month(), f.start.In(loc).Day(), 0, 0, 0, 0, time.UTC)
		filter := DashboardFilter{DateFrom: day, DateTo: day, DateBasis: DashboardDateBasisStartTime}
		report, err := f.repo.Dashboard(f.ctx, f.ownerActor, filter)
		if err != nil {
			t.Fatal(err)
		}
		if report.DataQuality == nil || report.DataQuality.UnknownResultTimeInScope != 1 || report.DataQuality.CompletedWithoutPerformer != 1 || report.DataQuality.CompletedWithoutResultTime != 1 || report.DataQuality.MissingCreatedBy != 1 {
			t.Fatalf("incorrect authorized legacy coverage: %#v", report.DataQuality)
		}
		filter.DateBasis = DashboardDateBasisCompletedAt
		report, err = f.repo.Dashboard(f.ctx, f.ownerActor, filter)
		if err != nil {
			t.Fatal(err)
		}
		if report.DataQuality == nil || report.DataQuality.UnknownResultTimeInScope != 1 || report.DataQuality.CompletedWithoutResultTime != 0 {
			t.Fatalf("unknown result received an invented completion date: %#v", report.DataQuality)
		}
	})
	t.Run("individual assignee endpoint enforces limit and preserves a duplicate no-op", func(t *testing.T) {
		event := create(t, "task")
		if _, err := f.pool.Exec(f.ctx, `with synthetic_users as (insert into public.users(organization_id,name) select $1,'Synthetic assignee' from generate_series(1,100) returning id), synthetic_members as (insert into public.organization_members(organization_id,user_id) select $1,id from synthetic_users returning user_id) insert into public.schedule_event_assignees(organization_id,event_id,user_id) select $1,$2,user_id from synthetic_members`, f.org, event.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := f.repo.AddAssignee(f.ctx, f.admin, event.ID, f.otherMember); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("101st assignee: %v", err)
		}
		var existing string
		if err := f.pool.QueryRow(f.ctx, `select user_id::text from public.schedule_event_assignees where event_id=$1 limit 1`, event.ID).Scan(&existing); err != nil {
			t.Fatal(err)
		}
		assignees, err := f.repo.AddAssignee(f.ctx, f.admin, event.ID, existing)
		if err != nil || len(assignees) != 100 {
			t.Fatalf("existing assignee at limit: %d %v", len(assignees), err)
		}
	})
	t.Run("trigger-rejected Google upserts never leave falsely pending occurrences", func(t *testing.T) {
		if _, err := f.pool.Exec(f.ctx, `insert into public.google_calendar_tokens(organization_id,user_id) values($1,$2); create function public.fixture_skip_google_upsert() returns trigger language plpgsql as $$begin if new.action='push_upsert' then return null; end if; return new; end$$; create trigger fixture_skip_google_upsert before insert on public.google_calendar_sync_jobs for each row execute function public.fixture_skip_google_upsert()`, pgx.QueryExecModeSimpleProtocol, f.org, f.owner); err != nil {
			t.Fatal(err)
		}
		defer func() {
			if _, err := f.pool.Exec(f.ctx, `drop trigger fixture_skip_google_upsert on public.google_calendar_sync_jobs; drop function public.fixture_skip_google_upsert()`); err != nil {
				t.Error(err)
			}
		}()
		input, err := (CreateRequest{ClientRequestID: f.id(), Title: "Synthetic trigger recurrence", UserID: f.owner, EventType: "task", StartTime: f.start, EndTime: f.start.Add(time.Hour), Visibility: "private", RecurrenceRule: "monthly"}).Validate(f.owner)
		if err != nil {
			t.Fatal(err)
		}
		parent, err := f.repo.Create(f.ctx, f.ownerActor, input)
		if err != nil {
			t.Fatal(err)
		}
		var count int
		if err := f.pool.QueryRow(f.ctx, `select count(*) from public.schedule_events where (id=$1 or recurrence_parent_id=$1) and google_sync_status='not_connected'`, parent.ID).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 24 {
			t.Fatalf("rejected upsert pending states: disconnected=%d", count)
		}
		original := create(t, "meeting")
		result, err := f.repo.Reschedule(f.ctx, f.ownerActor, original.ID, rescheduleInput{StartTime: f.start.Add(time.Hour), EndTime: f.start.Add(2 * time.Hour)})
		if err != nil {
			t.Fatal(err)
		}
		if result.NewEvent.GoogleSyncStatus == nil || *result.NewEvent.GoogleSyncStatus != "not_connected" || result.PreviousEvent.GoogleSyncStatus == nil || *result.PreviousEvent.GoogleSyncStatus != "pending" {
			t.Fatalf("incorrect actual job status: %#v / %#v", result.PreviousEvent.GoogleSyncStatus, result.NewEvent.GoogleSyncStatus)
		}
	})
	runScheduleGoogleDisconnectRollbackChecks(t, f, create)
}
