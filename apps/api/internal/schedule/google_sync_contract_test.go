package schedule

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestGoogleSyncStatusIsMaskedAndAvailableToClients(t *testing.T) {
	t.Parallel()

	query := scheduleEventsQuery("se.organization_id = $1::uuid")
	if !strings.Contains(query, "case when v.is_masked then null else v.google_sync_status end") {
		t.Fatal("schedule list must hide Google sync status for masked events")
	}

	pending := "pending"
	encoded, err := json.Marshal(Event{GoogleSyncStatus: &pending})
	if err != nil {
		t.Fatalf("marshal schedule event: %v", err)
	}
	if !strings.Contains(string(encoded), `"google_sync_status":"pending"`) {
		t.Fatalf("schedule event omitted pending sync state: %s", encoded)
	}
}

func TestHistoricalGoogleConflictDoesNotBlockVimobOutbound(t *testing.T) {
	t.Parallel()

	if strings.Contains(enqueueScheduleGoogleMutationSQL, "google_sync_status is distinct from 'conflict'") ||
		strings.Contains(enqueueScheduleGoogleRecurringCreatesSQL, "google_sync_status is distinct from 'conflict'") {
		t.Fatal("historical Google conflict status must not suppress a Vimob outbound job")
	}
	if count := strings.Count(enqueueScheduleGoogleMutationSQL, "and exists (select 1 from syncable_event)"); count != 3 {
		t.Fatalf("Google enqueue guarded %d of 3 tenant-scoped side effects", count)
	}

	deletion := scheduleFunctionBody(t, mustReadScheduleContractFile(t, "repository.go"), "Delete")
	if strings.Contains(deletion, "ErrGoogleSyncConflict") {
		t.Fatal("historical Google conflict must not prevent a Vimob deletion")
	}
	reschedule := scheduleFunctionBody(t, mustReadScheduleContractFile(t, "reschedule.go"), "Reschedule")
	if strings.Contains(reschedule, "ErrGoogleSyncConflict") {
		t.Fatal("historical Google conflict must not prevent a Vimob reschedule")
	}
}

func TestScheduleGoogleUpsertIsDurableAndTransactionScoped(t *testing.T) {
	t.Parallel()

	for _, fragment := range []string{
		"from public.google_calendar_tokens connection",
		"connection.organization_id = $1::uuid",
		"connection.user_id = $4::uuid",
		"connection.disconnected_at is null",
		"insert into public.google_calendar_sync_jobs",
		"'push_upsert'",
		"from active_owner_connection",
		"$3::uuid",
		"when exists (select 1 from upsert_job) then 'pending'",
		"else 'not_connected'",
		"google_event_id = case",
		"google_calendar_connection_id = case",
		"google_calendar_id = case",
	} {
		if !strings.Contains(enqueueScheduleGoogleMutationSQL, fragment) {
			t.Fatalf("transactional Google enqueue missing %q", fragment)
		}
	}

	repositorySource := mustReadScheduleContractFile(t, "repository.go")
	for _, function := range []string{"Create", "Update"} {
		body := scheduleFunctionBody(t, repositorySource, function)
		enqueue := strings.Index(body, "repo.enqueueScheduleGoogleMutation(")
		commit := strings.Index(body, "tx.Commit(ctx)")
		if enqueue < 0 || commit < 0 || enqueue > commit {
			t.Fatalf("%s must enqueue Google sync before committing the schedule transaction", function)
		}
	}
	complete := scheduleFunctionBody(t, repositorySource, "Complete")
	if !strings.Contains(complete, "return repo.Update(ctx, tenantContext, eventID, input)") {
		t.Fatal("Complete must keep using the transactional Update path")
	}
}

func TestScheduleGoogleOwnerTransferPreservesDurableLinks(t *testing.T) {
	t.Parallel()

	for _, fragment := range []string{
		"from public.google_calendar_event_links link",
		"link.organization_id = $1::uuid",
		"link.schedule_event_id = $2::uuid",
		"link.deleted_at is null",
		"jsonb_agg(link.id::text order by link.id::text)",
		"'push_delete'",
		"'link_ids', transfer_links.link_ids",
		"when $5::boolean then statement_timestamp() + interval '30 seconds'",
	} {
		if !strings.Contains(enqueueScheduleGoogleMutationSQL, fragment) {
			t.Fatalf("owner transfer Google plan missing %q", fragment)
		}
	}
}

func TestScheduleGoogleRecurrenceEnqueuesEveryOccurrenceBeforeCommit(t *testing.T) {
	t.Parallel()

	for _, fragment := range []string{
		"event.id = any($2::uuid[])",
		"event.recurrence_parent_id = $5::uuid",
		"event.user_id = $4::uuid",
		"from recurring_events event",
		"jsonb_build_object('event_id', event.id::text, 'owner_user_id', $4::text)",
		"when exists (select 1 from active_owner_connection) then 'pending'",
	} {
		if !strings.Contains(enqueueScheduleGoogleRecurringCreatesSQL, fragment) {
			t.Fatalf("recurring Google enqueue missing %q", fragment)
		}
	}
	create := scheduleFunctionBody(t, mustReadScheduleContractFile(t, "repository.go"), "Create")
	if enqueue, commit := strings.Index(create, "repo.enqueueScheduleGoogleRecurringCreates("), strings.Index(create, "tx.Commit(ctx)"); enqueue < 0 || commit < 0 || enqueue > commit {
		t.Fatal("recurring Google jobs must be committed with their Vimob occurrences")
	}
}

func TestScheduleGoogleDeletePreservesUnlinkedInFlightIntent(t *testing.T) {
	t.Parallel()

	for _, fragment := range []string{
		"'event_id', $2::text",
		"'owner_user_id', (select user_id::text from target_event)",
		"'connection_id', (select id::text from active_owner_connection)",
		"or exists (select 1 from active_owner_connection)",
		"or exists (select 1 from in_flight_upsert)",
		"job.organization_id = $1::uuid",
		"job.schedule_event_id = $2::uuid",
	} {
		if !strings.Contains(enqueueScheduleGoogleDeleteSQL, fragment) {
			t.Fatalf("durable Google deletion intent missing %q", fragment)
		}
	}
	for _, fragment := range []string{
		"'owner_user_id', $6::text",
		"'connection_id', (select id::text from previous_owner_connection)",
		"or exists (select 1 from previous_upsert)",
	} {
		if !strings.Contains(enqueueScheduleGoogleMutationSQL, fragment) {
			t.Fatalf("owner transfer deletion intent missing %q", fragment)
		}
	}
}

func TestAssigneeChangesEnqueueGoogleOnlyWhenTheyChangeTheEvent(t *testing.T) {
	t.Parallel()

	repository := mustReadScheduleContractFile(t, "repository.go")
	add := scheduleFunctionBody(t, repository, "AddAssignee")
	if !strings.Contains(add, "assigneeAdded = tag.RowsAffected() > 0") ||
		!strings.Contains(add, "if assigneeAdded {") ||
		!strings.Contains(add, "repo.enqueueScheduleGoogleMutation(") {
		t.Fatal("AddAssignee must enqueue a durable Google update only after inserting an assignee")
	}
	remove := scheduleFunctionBody(t, repository, "RemoveAssignee")
	if !strings.Contains(remove, "if tag.RowsAffected() > 0 {") ||
		!strings.Contains(remove, "repo.enqueueScheduleGoogleMutation(") {
		t.Fatal("RemoveAssignee must enqueue a durable Google update only after removing an assignee")
	}
}

func TestGoogleWorkerWakeupFollowsCommitAndIsOptional(t *testing.T) {
	t.Parallel()

	if !strings.Contains(mustReadScheduleContractFile(t, "google_sync.go"), "if !repo.immediateGoogleDispatch") {
		t.Fatal("immediate worker wakeup must be opt-in")
	}
	for _, fileAndFunction := range [][2]string{{"repository.go", "Create"}, {"repository.go", "Update"}, {"repository.go", "Delete"}, {"reschedule.go", "Reschedule"}} {
		body := scheduleFunctionBody(t, mustReadScheduleContractFile(t, fileAndFunction[0]), fileAndFunction[1])
		commit, wakeup := strings.Index(body, "tx.Commit(ctx)"), strings.Index(body, "repo.kickGoogleCalendarOutboundWorker(ctx)")
		if commit < 0 || wakeup < commit {
			t.Fatalf("%s must wake the worker only after commit", fileAndFunction[1])
		}
	}
}

func TestScheduleDeleteCapturesGoogleLinksBeforeDeletingTheEvent(t *testing.T) {
	t.Parallel()

	for _, fragment := range []string{
		"from public.google_calendar_event_links link",
		"link.organization_id = $1::uuid",
		"link.schedule_event_id = $2::uuid",
		"link.deleted_at is null",
		"jsonb_agg(link.id::text order by link.id::text)",
		"insert into public.google_calendar_sync_jobs",
		"'push_delete'",
		"'event_id', $2::text",
		"'link_ids', durable_links.link_ids",
		"$3::uuid",
	} {
		if !strings.Contains(enqueueScheduleGoogleDeleteSQL, fragment) {
			t.Fatalf("transactional Google delete enqueue missing %q", fragment)
		}
	}

	repositorySource := mustReadScheduleContractFile(t, "repository.go")
	deleteBody := scheduleFunctionBody(t, repositorySource, "Delete")
	enqueue := strings.Index(deleteBody, "repo.enqueueScheduleGoogleDelete(")
	deleteEvent := strings.Index(deleteBody, "delete from public.schedule_events")
	commit := strings.Index(deleteBody, "tx.Commit(ctx)")
	if enqueue < 0 || deleteEvent < 0 || commit < 0 || enqueue > deleteEvent || deleteEvent > commit {
		t.Fatal("Delete must capture the Google outbox job before deleting and committing the schedule event")
	}
}

func TestScheduleHooksDoNotFireAndForgetCreateUpdateOrCompleteGoogleUpserts(t *testing.T) {
	t.Parallel()

	hooks := mustReadScheduleContractFile(t, "../../../../hooks/use-schedule-events.ts")
	if strings.Contains(hooks, "syncGoogleCalendarEventInBackground") {
		t.Fatal("create/update/complete hooks must not retain fire-and-forget Google upserts")
	}
	for _, forbidden := range []string{
		"syncGoogleCalendarEventInBackground",
		"syncScheduleEventWithGoogle",
		"'push_upsert'",
		"'push_delete'",
	} {
		if strings.Contains(hooks, forbidden) {
			t.Fatalf("use-schedule-events must leave Google enqueueing to backend transactions: %s", forbidden)
		}
	}
}

func mustReadScheduleContractFile(t *testing.T, path string) string {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(raw)
}

func scheduleFunctionBody(t *testing.T, source string, name string) string {
	t.Helper()
	start := strings.Index(source, "func (repo Repository) "+name+"(")
	if start < 0 {
		t.Fatalf("%s function not found", name)
	}
	rest := source[start:]
	next := strings.Index(rest[1:], "\nfunc (repo Repository) ")
	if next < 0 {
		return rest
	}
	return rest[:next+1]
}
