package schedule

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestScheduleListRequiresBoundedPeriodAndRejectsInvalidPagination(t *testing.T) {
	const id = "11111111-1111-4111-8111-111111111111"
	for _, values := range []url.Values{
		{}, {"userId": {id}}, {"startDate": {"2026-10-12T00:00:00Z"}},
		{"startDate": {"2026-10-13T00:00:00Z"}, "endDate": {"2026-10-12T00:00:00Z"}},
		{"startDate": {"2025-01-01T00:00:00Z"}, "endDate": {"2026-10-12T00:00:00Z"}},
		{"eventId": {id}, "limit": {"0"}}, {"leadId": {id}, "limit": {"501"}},
		{"eventId": {id}, "offset": {"-1"}}, {"eventId": {id}, "limit": {"not-an-integer"}},
	} {
		if _, err := ParseListFilter(values); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("unsafe list accepted: %v (%v)", values, err)
		}
	}
	for _, key := range []string{"eventId", "leadId"} {
		filter, err := ParseListFilter(url.Values{key: {id}})
		if err != nil || filter.Limit != 200 || filter.Offset != 0 {
			t.Fatalf("specific lookup = %#v %v", filter, err)
		}
	}
	filter, err := ParseListFilter(url.Values{"startDate": {"2026-10-01T00:00:00Z"}, "endDate": {"2026-10-31T23:59:59Z"}, "limit": {"500"}, "offset": {"500"}})
	if err != nil || filter.Limit != 500 || filter.Offset != 500 {
		t.Fatalf("valid page = %#v %v", filter, err)
	}
}

func TestSchedulePageReportsMoreWithoutLosingTheRequestedPage(t *testing.T) {
	filter := ListFilter{Limit: 2, Offset: 4}
	page := scheduleEventPage([]Event{{ID: "a"}, {ID: "b"}, {ID: "c"}}, filter)
	if len(page.Events) != 2 || page.Events[1].ID != "b" || !page.Pagination.HasMore || page.Pagination.Offset != 4 {
		t.Fatalf("incorrect paginated contract: %#v", page)
	}
	last := scheduleEventPage([]Event{{ID: "c"}}, filter)
	if last.Pagination.HasMore || len(last.Events) != 1 {
		t.Fatalf("last page = %#v", last)
	}
}

func TestScheduleCreateLimitsAssigneesAndRequiresPositiveNewIntervals(t *testing.T) {
	const actor = "11111111-1111-4111-8111-111111111111"
	start := time.Date(2026, 10, 12, 12, 0, 0, 0, time.UTC)
	request := CreateRequest{Title: "Synthetic task", StartTime: start, EndTime: start.Add(time.Minute)}
	request.AssigneeIDs = make([]string, 101)
	for index := range request.AssigneeIDs {
		request.AssigneeIDs[index] = actor
	}
	if _, err := request.Validate(actor); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("unbounded assignees: %v", err)
	}
	request.AssigneeIDs = request.AssigneeIDs[:100]
	if _, err := request.Validate(actor); err != nil {
		t.Fatal(err)
	}
	request.EndTime = start
	if _, err := request.Validate(actor); !errors.Is(err, ErrInvalidInput) {
		t.Fatal("zero duration create accepted")
	}
	if _, err := (RescheduleRequest{StartTime: start, EndTime: start}).Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatal("zero duration reschedule accepted")
	}
	if _, err := (UpdateRequest{StartTime: patchTime{Set: true, Value: &start}, EndTime: patchTime{Set: true, Value: &start}}).Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatal("zero duration timing patch accepted")
	}
	request.StartTime = start.Add(time.Nanosecond)
	request.EndTime = start.Add(999 * time.Nanosecond)
	if _, err := request.Validate(actor); !errors.Is(err, ErrInvalidInput) {
		t.Fatal("sub-microsecond duration would persist as zero")
	}
}

type scheduleAssigneeLimitLookup struct {
	count    int
	existing bool
}

func (q scheduleAssigneeLimitLookup) QueryRow(context.Context, string, ...any) pgx.Row { return q }
func (q scheduleAssigneeLimitLookup) Scan(dest ...any) error {
	*dest[0].(*int) = q.count
	*dest[1].(*bool) = q.existing
	return nil
}
func TestAssigneeAdditionCannotBypassTheServerLimitWithRepeatedRequests(t *testing.T) {
	for _, tc := range []struct {
		count    int
		existing bool
		fail     bool
	}{{99, false, false}, {100, false, true}, {100, true, false}, {101, true, false}, {101, false, true}} {
		err := validateScheduleAssigneeAddition(context.Background(), scheduleAssigneeLimitLookup{tc.count, tc.existing}, "org", "event", "user")
		if errors.Is(err, ErrInvalidInput) != tc.fail {
			t.Fatalf("count=%d existing=%v err=%v", tc.count, tc.existing, err)
		}
	}
}

func TestExpectedScheduleVersionDetectsLostUpdatesAndAllowsLegacyClients(t *testing.T) {
	version := time.Date(2026, 10, 12, 12, 0, 0, 123000, time.UTC)
	current := eventSnapshot{UpdatedAt: version}
	if err := validateExpectedScheduleVersion(current, nil); err != nil {
		t.Fatal(err)
	}
	sameInstant := version.In(time.FixedZone("offset", -3*3600))
	if err := validateExpectedScheduleVersion(current, &sameInstant); err != nil {
		t.Fatal(err)
	}
	stale := version.Add(-time.Microsecond)
	if err := validateExpectedScheduleVersion(current, &stale); !errors.Is(err, ErrScheduleConflict) {
		t.Fatalf("lost update not detected: %v", err)
	}
}

func TestScheduleCreateReplayComparesPayloadRatherThanTitleOnly(t *testing.T) {
	owner := "11111111-1111-4111-8111-111111111111"
	start := time.Date(2026, 10, 12, 12, 0, 0, 0, time.UTC)
	reminder := 30
	input := createInput{Title: "Synthetic task", EventType: "task", UserID: owner, StartTime: start, EndTime: start.Add(time.Hour), Visibility: "private", ReminderMinutes: &reminder, AssigneeIDs: []string{"a", "b"}}
	event := Event{UserID: &owner, Title: input.Title, EventType: input.EventType, StartTime: start, EndTime: input.EndTime, Visibility: input.Visibility, ReminderMinutes: &reminder, AssigneeUserIDs: []string{"b", "a"}, Status: "scheduled"}
	if !scheduleCreateReplayMatches(input, event) {
		t.Fatal("equivalent retry should match independent of assignee order")
	}
	for _, mutate := range []func(*Event){
		func(e *Event) { e.Title = "other" }, func(e *Event) { e.StartTime = e.StartTime.Add(time.Minute) },
		func(e *Event) { e.AssigneeUserIDs = []string{"a"} }, func(e *Event) { e.Status = "completed" },
		func(e *Event) { other := "other-lead"; e.LeadID = &other }, func(e *Event) { e.IsAllDay = true },
		func(e *Event) { notes := "Owner's later private notes"; e.OutcomeNotes = &notes },
		func(e *Event) { e.CompletedBy = &owner }, func(e *Event) { e.CompletedAt = &start },
		func(e *Event) { e.OutcomeRecordedAt = &start }, func(e *Event) { e.PerformedBy = &owner },
	} {
		changed := event
		mutate(&changed)
		if scheduleCreateReplayMatches(input, changed) {
			t.Fatalf("different command matched: %#v", changed)
		}
	}
}

type unpristineReplayLookup struct{ queries []string }

func (q *unpristineReplayLookup) QueryRow(_ context.Context, query string, _ ...any) pgx.Row {
	q.queries = append(q.queries, query)
	return q
}
func (q *unpristineReplayLookup) Scan(dest ...any) error {
	if len(dest) == 2 {
		*dest[0].(*bool) = true
		*dest[1].(*bool) = true
		return nil
	}
	if len(dest) == 1 {
		return pgx.ErrNoRows
	}
	return errors.New("private command result must not be projected")
}
func TestCreateReplayRejectsLaterPrivateArtifactsBeforeProjectingAnyDetails(t *testing.T) {
	for _, role := range []string{"user", "leader", "admin"} {
		q := &unpristineReplayLookup{}
		_, replay, err := findScheduleCreateReplay(context.Background(), q, tenant.Context{OrganizationID: "org", UserID: "creator", MemberRole: role}, createInput{ClientRequestID: "11111111-1111-4111-8111-111111111111"})
		if replay || !errors.Is(err, ErrScheduleConflict) || len(q.queries) != 2 {
			t.Fatalf("private artifacts read: replay=%v err=%v queries=%d", replay, err, len(q.queries))
		}
		for _, guard := range []string{"outcome_notes is null", "completed_by is null", "completed_at is null", "outcome_recorded_at is null", "performed_by is null", "for update"} {
			if !strings.Contains(q.queries[1], guard) {
				t.Fatalf("pristine lock lost %s", guard)
			}
		}
	}
}

type scheduleReplayLookup struct {
	exists, owned bool
	query         string
	args          []any
	calls         int
}

func (q *scheduleReplayLookup) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	q.query = query
	q.args = args
	q.calls++
	return q
}
func (q *scheduleReplayLookup) Scan(dest ...any) error {
	if len(dest) != 2 {
		return errors.New("a mismatched actor must never load event details")
	}
	*dest[0].(*bool) = q.exists
	*dest[1].(*bool) = q.owned
	return nil
}

func TestScheduleCommandReplayIsBoundToOrganizationAndActorBeforeReadingDetails(t *testing.T) {
	for _, organizationID := range []string{"organization-a", "organization-b"} {
		for _, actorID := range []string{"broker", "leader", "admin"} {
			actor := tenant.Context{OrganizationID: organizationID, UserID: actorID}
			q := &scheduleReplayLookup{exists: true, owned: false}
			_, replay, err := findScheduleCreateReplay(context.Background(), q, actor, createInput{ClientRequestID: "11111111-1111-4111-8111-111111111111"})
			if replay || !errors.Is(err, ErrScheduleConflict) || q.calls != 1 {
				t.Fatalf("foreign command replay: %v %v calls%d", replay, err, q.calls)
			}
			if q.args[0] != organizationID || q.args[2] != actorID || !strings.Contains(q.query, "organization_id = $1::uuid") || !strings.Contains(q.query, "created_by = $3::uuid") {
				t.Fatal("command lookup lost its authorization binding")
			}
		}
	}
}

func TestCommentCommandRejectsForeignActorEventTenantOrChangedContent(t *testing.T) {
	actor := tenant.Context{OrganizationID: "organization-a", UserID: "broker"}
	q := &scheduleReplayLookup{exists: true, owned: false}
	_, replay, err := findScheduleCommentReplay(context.Background(), q, actor, "event-a", "11111111-1111-4111-8111-111111111111", "Synthetic comment")
	if replay || !errors.Is(err, ErrScheduleConflict) || q.calls != 1 {
		t.Fatalf("unsafe comment retry: %v %v", replay, err)
	}
	if q.args[0] != actor.OrganizationID || q.args[1] != "event-a" || q.args[3] != actor.UserID || q.args[4] != "Synthetic comment" || !strings.Contains(q.query, "user_id = $4::uuid and content = $5") {
		t.Fatal("comment command lost identity/content binding")
	}
}

func TestRescheduleReplayRejectsASecondDifferentTimeInsteadOfReportingFalseSuccess(t *testing.T) {
	start := time.Date(2026, 10, 12, 12, 0, 0, 0, time.UTC)
	input := rescheduleInput{StartTime: start, EndTime: start.Add(time.Hour)}
	replacement := Event{StartTime: start, EndTime: input.EndTime}
	if !rescheduleReplayMatches(eventSnapshot{}, input, replacement) {
		t.Fatal("matching retry was rejected")
	}
	input.StartTime = input.StartTime.Add(time.Minute)
	if rescheduleReplayMatches(eventSnapshot{}, input, replacement) {
		t.Fatal("different replay must report conflict")
	}
	input.StartTime = replacement.StartTime
	notes := "Original notes"
	current := eventSnapshot{OutcomeNotes: &notes}
	input.OutcomeNotes = &notes
	if !rescheduleReplayMatches(current, input, replacement) {
		t.Fatal("equivalent notes retry should match")
	}
	changedNotes := "Changed notes"
	input.OutcomeNotes = &changedNotes
	if rescheduleReplayMatches(current, input, replacement) {
		t.Fatal("changed notes must report conflict")
	}
}
