package schedule

import (
	"testing"
	"time"
)

func runScheduleGoogleDisconnectRollbackChecks(t *testing.T, f scheduleHardeningFixtureContext, create func(*testing.T, string) Event) {
	t.Run("Google disconnect fence rolls back every schedule mutation without losing durable intent", func(t *testing.T) {
		task, meeting := create(t, "task"), create(t, "meeting")
		if _, err := f.repo.AddAssignee(f.ctx, f.admin, task.ID, f.otherMember); err != nil {
			t.Fatal(err)
		}
		queryCount := func(query string, args ...any) int {
			t.Helper()
			var value int
			if err := f.pool.QueryRow(f.ctx, query, args...).Scan(&value); err != nil {
				t.Fatal(err)
			}
			return value
		}
		jobsBefore := queryCount(`select count(*) from public.google_calendar_sync_jobs where organization_id=$1`, f.org)
		notificationsBefore := queryCount(`select count(*) from public.notifications where organization_id=$1`, f.org)
		if _, err := f.pool.Exec(f.ctx, `create function public.fixture_google_disconnecting() returns trigger language plpgsql as $$begin raise exception using errcode='55P03',message='google_calendar_connection_disconnecting'; end$$; create trigger fixture_google_disconnecting before insert on public.google_calendar_sync_jobs for each row execute function public.fixture_google_disconnecting()`); err != nil {
			t.Fatal(err)
		}
		defer func() {
			if _, err := f.pool.Exec(f.ctx, `drop trigger fixture_google_disconnecting on public.google_calendar_sync_jobs; drop function public.fixture_google_disconnecting()`); err != nil {
				t.Error(err)
			}
		}()
		input, err := (CreateRequest{ClientRequestID: f.id(), Title: "Synthetic blocked create", UserID: f.owner, EventType: "task", StartTime: f.start, EndTime: f.start.Add(time.Hour), Visibility: "private"}).Validate(f.owner)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.repo.Create(f.ctx, f.ownerActor, input); !isGoogleCalendarDisconnectingError(err) {
			t.Fatalf("create fence: %v", err)
		}
		if queryCount(`select count(*) from public.schedule_events where id=$1`, input.ClientRequestID) != 0 {
			t.Fatal("blocked create was committed")
		}
		title := "Blocked update"
		if _, err := f.repo.Update(f.ctx, f.ownerActor, task.ID, updateInput{Title: patchString{Set: true, Value: &title}}); !isGoogleCalendarDisconnectingError(err) {
			t.Fatalf("update fence: %v", err)
		}
		completion, err := (CompleteRequest{Status: "completed"}).Validate(f.owner)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.repo.Complete(f.ctx, f.ownerActor, task.ID, completion); !isGoogleCalendarDisconnectingError(err) {
			t.Fatalf("complete fence: %v", err)
		}
		if _, err := f.repo.Reschedule(f.ctx, f.ownerActor, meeting.ID, rescheduleInput{StartTime: f.start.Add(time.Hour), EndTime: f.start.Add(2 * time.Hour)}); !isGoogleCalendarDisconnectingError(err) {
			t.Fatalf("reschedule fence: %v", err)
		}
		if _, err := f.repo.Delete(f.ctx, f.ownerActor, task.ID); !isGoogleCalendarDisconnectingError(err) {
			t.Fatalf("delete fence: %v", err)
		}
		if _, err := f.repo.AddAssignee(f.ctx, f.admin, task.ID, f.admin.UserID); !isGoogleCalendarDisconnectingError(err) {
			t.Fatalf("assignee fence: %v", err)
		}
		if _, err := f.repo.RemoveAssignee(f.ctx, f.admin, task.ID, f.otherMember); !isGoogleCalendarDisconnectingError(err) {
			t.Fatalf("remove assignee fence: %v", err)
		}
		persistedTask, err := f.repo.Get(f.ctx, f.ownerActor, task.ID)
		if err != nil {
			t.Fatal(err)
		}
		persistedMeeting, err := f.repo.Get(f.ctx, f.ownerActor, meeting.ID)
		if err != nil {
			t.Fatal(err)
		}
		if persistedTask.Title != task.Title || persistedTask.Status != "scheduled" || len(persistedTask.AssigneeUserIDs) != 1 || persistedTask.AssigneeUserIDs[0] != f.otherMember || persistedMeeting.Status != "scheduled" || persistedMeeting.RescheduledToID != nil {
			t.Fatal("fenced mutation left partial CRM state")
		}
		if queryCount(`select count(*) from public.google_calendar_sync_jobs where organization_id=$1`, f.org) != jobsBefore || queryCount(`select count(*) from public.notifications where organization_id=$1`, f.org) != notificationsBefore || queryCount(`select count(*) from public.schedule_events where rescheduled_from_event_id=$1`, meeting.ID) != 0 {
			t.Fatal("fenced mutation leaked jobs, notifications or replacement")
		}
	})
}
