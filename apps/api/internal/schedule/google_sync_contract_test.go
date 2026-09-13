package schedule

import (
	"os"
	"strings"
	"testing"
)

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
