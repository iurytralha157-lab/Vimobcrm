package schedule

import (
	"context"
	_ "embed"
	"errors"
	"net/url"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

//go:embed testdata/hardening_fixture.sql
var scheduleHardeningFixture string

// This deliberately cannot use DATABASE_URL or a remote/shared database.
func TestScheduleHardeningAgainstDedicatedLocalPostgres(t *testing.T) {
	if os.Getenv("VIMOB_RUN_AGENDA_HARDENING_DB_TESTS") != "1" {
		t.Skip("opt in to the dedicated localhost:58022/agenda_schedule synthetic fixture")
	}
	databaseURL := os.Getenv("VIMOB_AGENDA_HARDENING_DATABASE_URL")
	if databaseURL == "" {
		databaseURL = "postgres://postgres:agenda_fixture_only@127.0.0.1:58022/agenda_schedule?sslmode=disable"
	}
	parsed, err := url.Parse(databaseURL)
	if err != nil || parsed.User == nil || parsed.User.Username() != "postgres" || (parsed.Port() != "58022" && parsed.Port() != "58023") || parsed.Path != "/agenda_schedule" ||
		(parsed.Hostname() != "localhost" && parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "::1") {
		t.Fatal("hardening fixture requires the dedicated loopback agenda_schedule database on port 58022 (native) or 58023 (PGlite)")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	pglite := parsed.Port() == "58023"
	maxConnections := int32(4)
	if pglite {
		maxConnections = 1
	}
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, MaxConns: maxConnections, MinConns: 0, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatalf("connect dedicated synthetic database: %v", err)
	}
	defer database.Close()
	if _, err := database.Pool().Exec(ctx, scheduleHardeningFixture); err != nil {
		t.Fatalf("create minimal owned fixture: %v", err)
	}
	repo := NewRepository(database, nil)
	id := func() string {
		var result string
		if err := database.Pool().QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	org, otherOrg, leader, owner, otherMember, otherTenantUser, team := id(), id(), id(), id(), id(), id(), id()
	if _, err := database.Pool().Exec(ctx, `
		insert into public.organizations(id,name) values($1,'Synthetic Agenda A'),($2,'Synthetic Agenda B');
		insert into public.users(id,organization_id,name) values($3,$1,'Synthetic leader'),($4,$1,'Synthetic owner'),($5,$1,'Synthetic member'),($6,$2,'Synthetic other tenant');
		insert into public.organization_members(organization_id,user_id) values($1,$3),($1,$4),($1,$5),($2,$6);
		insert into public.teams(id,organization_id,name) values($7,$1,'Synthetic team');
		insert into public.team_members(organization_id,team_id,user_id,is_leader,membership_generation)
		select $1,$7,user_id,user_id=$3,membership_generation from public.organization_members where organization_id=$1 and user_id in ($3,$4);
		insert into public.organization_attention_settings(organization_id,timezone) values($1,'America/New_York');
	`, pgx.QueryExecModeSimpleProtocol, org, otherOrg, leader, owner, otherMember, otherTenantUser, team); err != nil {
		t.Fatal(err)
	}
	actor := tenant.Context{OrganizationID: org, UserID: leader, MemberRole: "user", Permissions: []string{permissions.ScheduleView, permissions.ScheduleManage}}
	ownerActor := actor
	ownerActor.UserID = owner
	admin := actor
	admin.MemberRole = "admin"
	foreign := tenant.Context{OrganizationID: otherOrg, UserID: otherTenantUser, MemberRole: "admin"}
	start := time.Now().UTC().Truncate(time.Minute).Add(time.Hour)
	end := start.Add(time.Hour)
	request := CreateRequest{Title: "Synthetic private task", EventType: "task", UserID: owner, StartTime: start, EndTime: end, Visibility: "private", ClientRequestID: id()}
	input, err := request.Validate(actor.UserID)
	if err != nil {
		t.Fatal(err)
	}
	var event Event
	count := func(query string, args ...any) int {
		var result int
		if err := database.Pool().QueryRow(ctx, query, args...).Scan(&result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	notifications := func(eventID string) int {
		return count(`select count(*) from public.notifications where organization_id=$1 and metadata->>'schedule_event_id'=$2`, org, eventID)
	}

	t.Run("private delegation commits a confirmation without future read access", func(t *testing.T) {
		event, err = repo.Create(ctx, actor, input)
		if err != nil {
			t.Fatal(err)
		}
		if event.ID == "" || event.ID == input.ClientRequestID || event.IsMasked {
			t.Fatalf("incorrect command confirmation: %#v", event)
		}
		if _, err := repo.Get(ctx, actor, event.ID); !errors.Is(err, ErrEventNotFound) {
			t.Fatalf("delegator received future private read access: %v", err)
		}
		if _, err := repo.Get(ctx, ownerActor, event.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := repo.Get(ctx, admin, event.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := repo.Get(ctx, foreign, event.ID); !errors.Is(err, ErrEventNotFound) {
			t.Fatalf("cross-tenant read: %v", err)
		}
	})
	t.Run("event commands are independent across actors and organizations", func(t *testing.T) {
		before := notifications(event.ID)
		replay, err := repo.Create(ctx, actor, input)
		if err != nil || replay.ID != event.ID {
			t.Fatalf("retry: %v %v", replay.ID, err)
		}
		if count(`select count(*) from public.schedule_events where id=$1`, event.ID) != 1 || notifications(event.ID) != before {
			t.Fatal("create retry duplicated side effects")
		}
		changed := input
		changed.Title = "Different command"
		if _, err := repo.Create(ctx, actor, changed); !errors.Is(err, ErrScheduleConflict) {
			t.Fatalf("changed payload: %v", err)
		}
		otherActorInput := input
		otherActorInput.CreatedBy = owner
		otherActorEvent, err := repo.Create(ctx, ownerActor, otherActorInput)
		if err != nil || otherActorEvent.ID == event.ID {
			t.Fatalf("another actor's independent command: %v %v", otherActorEvent.ID, err)
		}
		foreignInput := input
		foreignInput.UserID = otherTenantUser
		foreignInput.CreatedBy = otherTenantUser
		for _, key := range []string{input.ClientRequestID, event.ID, id()} {
			foreignInput.ClientRequestID = key
			independent, err := repo.Create(ctx, foreign, foreignInput)
			if err != nil || independent.OrganizationID != otherOrg || independent.ID == key {
				t.Fatalf("foreign create must not reveal a key collision: %#v %v", independent, err)
			}
			if retry, err := repo.Create(ctx, foreign, foreignInput); err != nil || retry.ID != independent.ID {
				t.Fatalf("foreign retry: %v %v", retry.ID, err)
			}
		}
	})
	t.Run("legacy event and comment commands replay only within their scope", func(t *testing.T) {
		legacyInput := input
		legacyInput.ClientRequestID = ""
		legacyInput.CreatedBy = owner
		legacyEvent, err := repo.Create(ctx, ownerActor, legacyInput)
		if err != nil {
			t.Fatal(err)
		}
		legacyInput.ClientRequestID = legacyEvent.ID
		if retry, err := repo.Create(ctx, ownerActor, legacyInput); err != nil || retry.ID != legacyEvent.ID {
			t.Fatalf("legacy event retry: %v %v", retry.ID, err)
		}
		legacyComment, err := repo.AddComment(ctx, ownerActor, legacyEvent.ID, "Synthetic legacy comment")
		if err != nil {
			t.Fatal(err)
		}
		if retry, err := repo.AddComment(ctx, ownerActor, legacyEvent.ID, legacyComment.Content, legacyComment.ID); err != nil || retry.ID != legacyComment.ID {
			t.Fatalf("legacy comment retry: %v %v", retry.ID, err)
		}

		foreignInput := legacyInput
		foreignInput.UserID = otherTenantUser
		foreignInput.CreatedBy = otherTenantUser
		foreignEvent, err := repo.Create(ctx, foreign, foreignInput)
		if err != nil || foreignEvent.OrganizationID != otherOrg || foreignEvent.ID == legacyEvent.ID {
			t.Fatalf("legacy event ID must be independent in another tenant: %#v %v", foreignEvent, err)
		}
		for _, key := range []string{legacyComment.ID, id()} {
			independent, err := repo.AddComment(ctx, foreign, foreignEvent.ID, "Synthetic foreign comment", key)
			if err != nil || independent.OrganizationID != otherOrg || independent.ID == key {
				t.Fatalf("foreign comment must not reveal a key collision: %#v %v", independent, err)
			}
			if retry, err := repo.AddComment(ctx, foreign, foreignEvent.ID, independent.Content, key); err != nil || retry.ID != independent.ID {
				t.Fatalf("foreign comment retry: %v %v", retry.ID, err)
			}
		}
	})
	t.Run("two concurrent identical create commands produce one event", func(t *testing.T) {
		if pglite {
			t.Skip("PGlite single-connection fixture cannot prove concurrent native transaction locking")
		}
		concurrent := input
		concurrent.ClientRequestID = id()
		concurrent.UserID = owner
		concurrent.CreatedBy = owner
		var group sync.WaitGroup
		failures := make(chan error, 2)
		results := make(chan string, 2)
		for range 2 {
			group.Add(1)
			go func() {
				defer group.Done()
				result, err := repo.Create(ctx, ownerActor, concurrent)
				failures <- err
				results <- result.ID
			}()
		}
		group.Wait()
		close(failures)
		close(results)
		for err := range failures {
			if err != nil {
				t.Fatal(err)
			}
		}
		firstID := <-results
		for result := range results {
			if result != firstID || result == concurrent.ClientRequestID {
				t.Fatal("concurrent replay created another ID")
			}
		}
		if count(`select count(*) from public.schedule_events where organization_id=$1 and created_by=$2 and client_request_id=$3`, org, owner, concurrent.ClientRequestID) != 1 {
			t.Fatal("duplicate concurrent create")
		}
	})
	t.Run("stale and concurrent edit versions cannot overwrite the winner", func(t *testing.T) {
		version := event.UpdatedAt
		title := "First accepted edit"
		updated, err := repo.Update(ctx, ownerActor, event.ID, updateInput{Title: patchString{Set: true, Value: &title}, ExpectedUpdatedAt: version})
		if err != nil {
			t.Fatal(err)
		}
		staleTitle := "Stale edit"
		if _, err := repo.Update(ctx, ownerActor, event.ID, updateInput{Title: patchString{Set: true, Value: &staleTitle}, ExpectedUpdatedAt: version}); !errors.Is(err, ErrScheduleConflict) {
			t.Fatalf("stale edit: %v", err)
		}
		if pglite {
			t.Log("stale version rejected; concurrent native transaction race remains unverified in PGlite")
			return
		}
		version = updated.UpdatedAt
		var group sync.WaitGroup
		results := make(chan error, 2)
		for _, text := range []string{"Concurrent A", "Concurrent B"} {
			group.Add(1)
			go func(text string) {
				defer group.Done()
				_, err := repo.Update(ctx, ownerActor, event.ID, updateInput{Title: patchString{Set: true, Value: &text}, ExpectedUpdatedAt: version})
				results <- err
			}(text)
		}
		group.Wait()
		close(results)
		success, conflicts := 0, 0
		for err := range results {
			if err == nil {
				success++
			} else if errors.Is(err, ErrScheduleConflict) {
				conflicts++
			} else {
				t.Fatal(err)
			}
		}
		if success != 1 || conflicts != 1 {
			t.Fatalf("version winners/conflicts %d/%d", success, conflicts)
		}
	})
	t.Run("comments and assignee notifications are idempotent", func(t *testing.T) {
		key := id()
		comment, err := repo.AddComment(ctx, ownerActor, event.ID, "Synthetic comment", key)
		if err != nil {
			t.Fatal(err)
		}
		replay, err := repo.AddComment(ctx, ownerActor, event.ID, "Synthetic comment", key)
		if err != nil || replay.ID != comment.ID {
			t.Fatalf("comment retry: %v %v", replay.ID, err)
		}
		if count(`select count(*) from public.schedule_event_comments where event_id=$1`, event.ID) != 1 {
			t.Fatal("duplicate comment")
		}
		if _, err := repo.AddComment(ctx, ownerActor, event.ID, "Changed content", key); !errors.Is(err, ErrScheduleConflict) {
			t.Fatalf("changed comment retry: %v", err)
		}
		before := notifications(event.ID)
		if _, err := repo.AddAssignee(ctx, admin, event.ID, otherMember); err != nil {
			t.Fatal(err)
		}
		if notifications(event.ID) != before+1 {
			t.Fatal("new assignee notification missing")
		}
		if _, err := repo.AddAssignee(ctx, admin, event.ID, otherMember); err != nil {
			t.Fatal(err)
		}
		if _, err := repo.AddAssignee(ctx, admin, event.ID, owner); err != nil {
			t.Fatal(err)
		}
		if notifications(event.ID) != before+1 {
			t.Fatal("no-op assignee created another notification")
		}
	})
	t.Run("paged SQL honors tenant scope and provides has_more", func(t *testing.T) {
		pageStart, pageEnd := start.Add(24*time.Hour), end.Add(24*time.Hour)
		for range 2 {
			pageInput := input
			pageInput.ClientRequestID, pageInput.CreatedBy = id(), owner
			pageInput.StartTime, pageInput.EndTime = pageStart, pageEnd
			if _, err := repo.Create(ctx, ownerActor, pageInput); err != nil {
				t.Fatal(err)
			}
		}
		page, err := repo.ListPage(ctx, ownerActor, ListFilter{StartTime: &pageStart, EndTime: &pageEnd, Limit: 1})
		if err != nil {
			t.Fatal(err)
		}
		if len(page.Events) != 1 || !page.Pagination.HasMore {
			t.Fatalf("page=%#v", page.Pagination)
		}
		next, err := repo.ListPage(ctx, ownerActor, ListFilter{StartTime: &pageStart, EndTime: &pageEnd, Limit: 1, Offset: 1})
		if err != nil {
			t.Fatal(err)
		}
		if len(next.Events) != 1 || next.Events[0].ID == page.Events[0].ID || next.Pagination.HasMore {
			t.Fatal("invalid next page")
		}
		other, err := repo.ListPage(ctx, foreign, ListFilter{StartTime: &pageStart, EndTime: &pageEnd, Limit: 1})
		if err != nil || len(other.Events) != 0 {
			t.Fatalf("another tenant's page=%d err%v", len(other.Events), err)
		}
	})
	t.Run("monthly series uses organization civil clock and bounded occurrences", func(t *testing.T) {
		recurrent := request
		recurrent.ClientRequestID = id()
		recurrent.UserID = owner
		recurrent.RecurrenceRule = "monthly"
		recurrent.StartTime = time.Date(2026, time.January, 31, 15, 0, 0, 0, time.UTC)
		recurrent.EndTime = recurrent.StartTime.Add(time.Hour)
		validated, err := recurrent.Validate(owner)
		if err != nil {
			t.Fatal(err)
		}
		parent, err := repo.Create(ctx, ownerActor, validated)
		if err != nil {
			t.Fatal(err)
		}
		if count(`select count(*) from public.schedule_events where id=$1 or recurrence_parent_id=$1`, parent.ID) != 24 {
			t.Fatal("incorrect occurrence count")
		}
		var february, march string
		if err := database.Pool().QueryRow(ctx, `select to_char(min(start_time) at time zone 'America/New_York','YYYY-MM-DD HH24:MI') from public.schedule_events where recurrence_parent_id=$1 and extract(month from start_time)=2 and extract(year from start_time)=2026`, parent.ID).Scan(&february); err != nil {
			t.Fatal(err)
		}
		if err := database.Pool().QueryRow(ctx, `select to_char(min(start_time) at time zone 'America/New_York','YYYY-MM-DD HH24:MI') from public.schedule_events where recurrence_parent_id=$1 and extract(month from start_time)=3 and extract(year from start_time)=2026`, parent.ID).Scan(&march); err != nil {
			t.Fatal(err)
		}
		if february != "2026-02-28 10:00" || march != "2026-03-31 10:00" {
			t.Fatalf("civil months %s / %s", february, march)
		}
	})
	t.Run("reschedule is atomic retry-safe and preserves finalized history", func(t *testing.T) {
		visit := request
		visit.ClientRequestID = id()
		visit.UserID = owner
		visit.EventType = "visit"
		visit.StartTime = start.Add(-4 * time.Hour)
		visit.EndTime = start.Add(-3 * time.Hour)
		validated, err := visit.Validate(owner)
		if err != nil {
			t.Fatal(err)
		}
		original, err := repo.Create(ctx, ownerActor, validated)
		if err != nil {
			t.Fatal(err)
		}
		newTime := original.StartTime.Add(30 * time.Minute)
		input := rescheduleInput{StartTime: newTime, EndTime: newTime.Add(time.Hour), ExpectedUpdatedAt: original.UpdatedAt}
		result, err := repo.Reschedule(ctx, ownerActor, original.ID, input)
		if err != nil {
			t.Fatal(err)
		}
		if result.PreviousEvent.Status != "cancelled" || result.PreviousEvent.RescheduledToID == nil || *result.PreviousEvent.RescheduledToID != result.NewEvent.ID || result.NewEvent.RescheduledFromID == nil || *result.NewEvent.RescheduledFromID != original.ID {
			t.Fatal("broken reschedule history")
		}
		replay, err := repo.Reschedule(ctx, ownerActor, original.ID, input)
		if err != nil || replay.NewEvent.ID != result.NewEvent.ID || !replay.wasReplay {
			t.Fatalf("reschedule retry: %v %v", replay.NewEvent.ID, err)
		}
		changed := input
		changed.StartTime = changed.StartTime.Add(time.Minute)
		if _, err := repo.Reschedule(ctx, ownerActor, original.ID, changed); !errors.Is(err, ErrScheduleConflict) {
			t.Fatalf("changed reschedule retry: %v", err)
		}
		changed = input
		notes := "Changed retry notes"
		changed.OutcomeNotes = &notes
		if _, err := repo.Reschedule(ctx, ownerActor, original.ID, changed); !errors.Is(err, ErrScheduleConflict) {
			t.Fatalf("changed reschedule notes: %v", err)
		}
		completion, err := (CompleteRequest{Status: "completed", Outcome: "visit_completed", ExpectedUpdatedAt: result.NewEvent.UpdatedAt}).Validate(owner)
		if err != nil {
			t.Fatal(err)
		}
		completed, err := repo.Complete(ctx, ownerActor, result.NewEvent.ID, completion)
		if err != nil {
			t.Fatal(err)
		}
		if completed.Status != "completed" || completed.PerformedBy == nil || completed.CompletedAt == nil {
			t.Fatal("missing durable realization")
		}
		if _, err := repo.Delete(ctx, ownerActor, completed.ID); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("final history deletion: %v", err)
		}
	})
	runScheduleHardeningAdditionalChecks(t, scheduleHardeningFixtureContext{
		ctx: ctx, repo: repo, pool: database.Pool(), org: org, otherOrg: otherOrg, owner: owner, otherMember: otherMember, otherTenantUser: otherTenantUser,
		ownerActor: ownerActor, admin: admin, start: start, id: id,
	})
	t.Run("projection failure rolls back creation and notifications before commit", func(t *testing.T) {
		if _, err := database.Pool().Exec(ctx, `alter table public.users rename column avatar_url to fixture_avatar_unavailable`); err != nil {
			t.Fatal(err)
		}
		defer func() {
			if _, err := database.Pool().Exec(ctx, `alter table public.users rename column fixture_avatar_unavailable to avatar_url`); err != nil {
				t.Error(err)
			}
		}()
		broken := input
		broken.ClientRequestID = id()
		before := count(`select count(*) from public.notifications where organization_id=$1`, org)
		if _, err := repo.Create(ctx, actor, broken); err == nil {
			t.Fatal("projection failure should abort creation")
		}
		if count(`select count(*) from public.schedule_events where organization_id=$1 and client_request_id=$2`, org, broken.ClientRequestID) != 0 || count(`select count(*) from public.notifications where organization_id=$1`, org) != before {
			t.Fatal("failed response left a committed event/notification")
		}
	})
}
