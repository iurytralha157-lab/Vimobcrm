package schedule

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestScheduleOutcomeMigrationCarriesOperationalContracts(t *testing.T) {
	root := scheduleRepositoryRoot(t)
	migration := readScheduleContractFile(t, filepath.Join(
		root,
		"supabase",
		"migrations",
		"20260908062156_add_schedule_outcomes_and_dashboard_indexes.sql",
	))

	for _, fragment := range []string{
		"add column if not exists created_by uuid",
		"add column if not exists outcome text",
		"add column if not exists performed_by uuid",
		"add column if not exists rescheduled_from_event_id uuid",
		"add column if not exists rescheduled_to_event_id uuid",
		"schedule_events_outcome_state_check",
		"coalesce(\n          (\n            case",
		"schedule_events_reminder_minutes_supported_check",
		"schedule reminder preflight failed",
		"invalid_reminder_count",
		"outside 0..120",
		"reminder_minutes not between 0 and 120",
		"schedule status preflight failed",
		"invalid_status_count",
		"schedule outcome-state preflight failed",
		"invalid_outcome_state_count",
		"set event_type = lower(btrim(event_type))",
		"set status = case lower(btrim(status))",
		"when status = 'completed' and lower(btrim(event_type)) = 'visit' then 'visit_completed'",
		"when status = 'completed' and lower(btrim(event_type)) = 'meeting' then 'meeting_completed'",
		"or status = 'no_show'",
		"set outcome_recorded_at = coalesce(completed_at, updated_at, start_time)",
		"where outcome_recorded_at is null",
		"and lower(btrim(status)) in ('completed', 'cancelled', 'canceled', 'no_show')",
		"validate constraint schedule_events_outcome_state_check",
		"reminder_minutes between 0 and 120",
		"array['system', 'push', 'whatsapp']::text[]",
		"stamp_schedule_event_outcome_recorded_at",
		"before insert or update of status, outcome",
		"event_type in ('visit', 'meeting')",
		"and rescheduled_to_event_id is not null",
		"and rescheduled_from_event_id <> id",
		"and rescheduled_to_event_id <> id",
		"idx_schedule_events_org_open_end_time",
		"idx_schedule_events_org_outcome_basis",
		"(coalesce(outcome_recorded_at, completed_at)) desc",
		"on public.schedule_events (organization_id, end_time)",
		"idx_schedule_events_pending_outcome_end_time",
		"where status = 'scheduled'",
		"idx_schedule_events_rescheduled_from_unique",
		"idx_schedule_events_rescheduled_to_unique",
		"'appointment_reminder'",
		"'appointment_outcome_pending'",
		"on conflict (slug) do update",
		"where system_template.organization_id is null",
	} {
		if !strings.Contains(migration, fragment) {
			t.Fatalf("schedule migration missing %q", fragment)
		}
	}

	timestampBackfillStart := strings.Index(
		migration,
		"set outcome_recorded_at = coalesce(completed_at, updated_at, start_time)",
	)
	outcomeBackfillStart := strings.Index(migration, "set\n  outcome = case")
	statusNormalizationStart := strings.Index(migration, "set status = case lower(btrim(status))")
	eventTypeNormalizationStart := strings.Index(migration, "set event_type = lower(btrim(event_type))")
	if timestampBackfillStart < 0 || statusNormalizationStart < 0 || eventTypeNormalizationStart < 0 || outcomeBackfillStart < 0 ||
		timestampBackfillStart >= statusNormalizationStart || statusNormalizationStart >= eventTypeNormalizationStart || eventTypeNormalizationStart >= outcomeBackfillStart {
		t.Fatal("historical outcome timestamps must be preserved before outcome backfill can fire legacy updated_at triggers")
	}

	fromLinkStart := strings.Index(migration, "rescheduled_from_event_id is null")
	toLinkOffset := -1
	if fromLinkStart >= 0 {
		toLinkOffset = strings.Index(migration[fromLinkStart:], "rescheduled_to_event_id is null")
	}
	if fromLinkStart < 0 || toLinkOffset <= 0 {
		t.Fatal("schedule migration does not expose independent reschedule link guards")
	}
	toLinkStart := fromLinkStart + toLinkOffset
	fromLinkGuard := migration[fromLinkStart:toLinkStart]
	if strings.Contains(fromLinkGuard, "status") {
		t.Fatal("replacement link must survive completed, no-show, and cancelled outcomes")
	}

	for _, constraint := range []string{
		"add constraint schedule_events_reminder_minutes_supported_check",
		"add constraint schedule_events_status_check",
	} {
		constraintStart := strings.Index(migration, constraint)
		if constraintStart < 0 {
			t.Fatalf("schedule migration missing validated constraint %q", constraint)
		}
		nextConstraint := strings.Index(migration[constraintStart:], "\n  if not exists (")
		if nextConstraint < 0 {
			t.Fatalf("could not isolate schedule constraint %q", constraint)
		}
		if strings.Contains(migration[constraintStart:constraintStart+nextConstraint], "not valid") {
			t.Fatalf("schedule constraint %q must be validated after its preflight", constraint)
		}
	}

	outcomeStateStart := strings.Index(migration, "add constraint schedule_events_outcome_state_check")
	if outcomeStateStart < 0 {
		t.Fatal("schedule migration is missing the outcome-state constraint")
	}
	outcomeStateEnd := strings.Index(migration[outcomeStateStart:], "not valid;")
	if outcomeStateEnd < 0 {
		t.Fatal("could not isolate the outcome-state constraint")
	}
	outcomeStateConstraint := migration[outcomeStateStart : outcomeStateStart+outcomeStateEnd]
	if !strings.Contains(outcomeStateConstraint, "coalesce(") ||
		!strings.Contains(outcomeStateConstraint, "false") {
		t.Fatal("nullable legacy fields must not turn an invalid outcome state into SQL CHECK UNKNOWN")
	}
}

func TestLegacyGoogleAllDayRepairIsScopedAndTimezoneAware(t *testing.T) {
	root := scheduleRepositoryRoot(t)
	migration := readScheduleContractFile(t, filepath.Join(
		root,
		"supabase",
		"migrations",
		"20260912193000_repair_legacy_google_all_day_ranges.sql",
	))

	for _, fragment := range []string{
		"legacy Google all-day repair preflight failed",
		"coalesce(is_all_day, false)",
		"nullif(btrim(google_event_id), '') is not null",
		"at time zone 'UTC') - interval '3 hours'",
		"public.organization_attention_settings",
		"pg_catalog.pg_timezone_names",
		"schedule_event.end_time >= schedule_event.start_time",
		"(legacy.google_included_end_date + 1)",
		"interval '1 millisecond'",
		"legacy Google all-day repair postcheck failed",
		"legacy Google all-day repair left an encoded legacy range",
		"deploy and drain the corrected Google writer",
	} {
		if !strings.Contains(migration, fragment) {
			t.Fatalf("legacy Google all-day repair missing %q", fragment)
		}
	}

	if strings.Contains(migration, "start_time at time zone 'America/Sao_Paulo'") ||
		strings.Contains(migration, "end_time at time zone 'America/Sao_Paulo'") {
		t.Fatal("legacy fingerprint must use the producer's fixed UTC-03 offset, not historical Sao Paulo DST rules")
	}
	if count := strings.Count(migration, "at time zone 'UTC') - interval '3 hours'"); count < 6 {
		t.Fatalf("fixed UTC-03 recovery must cover selection, decoding and postcheck, found %d expressions", count)
	}
}

func TestScheduleMutationTablesAreBackendOnlyByContract(t *testing.T) {
	root := scheduleRepositoryRoot(t)
	migration := readScheduleContractFile(t, filepath.Join(
		root,
		"supabase",
		"migrations",
		"20260912134500_lock_schedule_mutations_to_backend_gateway.sql",
	))

	for _, fragment := range []string{
		"public.schedule_events",
		"public.schedule_event_assignees",
		"public.schedule_event_comments",
		"from public, anon, authenticated",
		"grant select, insert, update, delete",
		"to service_role",
		"on function public.get_schedule_events_secure(uuid, uuid, timestamptz, timestamptz)",
		"has_function_privilege",
		"Authenticated execution survived on public.get_schedule_events_secure",
		"Browser table privilege survived",
		"has_table_privilege('authenticated', target_relation, 'INSERT')",
		"has_table_privilege('authenticated', target_relation, 'SELECT')",
		"has_table_privilege('service_role', target_relation, 'DELETE')",
		"A browser policy survived the Agenda backend-only cutover",
	} {
		if !strings.Contains(migration, fragment) {
			t.Fatalf("schedule backend-only migration missing %q", fragment)
		}
	}
	if strings.Contains(migration, "to authenticated;") {
		t.Fatal("schedule operational tables must not restore a raw authenticated grant")
	}
}

func TestRescheduleEndpointIsAtomicAndRetrySafeByContract(t *testing.T) {
	root := scheduleRepositoryRoot(t)
	source := readScheduleContractFile(t, filepath.Join(root, "apps", "api", "internal", "schedule", "reschedule.go"))
	routes := readScheduleContractFile(t, filepath.Join(root, "apps", "api", "internal", "app", "routes.go"))
	handler := readScheduleContractFile(t, filepath.Join(root, "apps", "api", "internal", "schedule", "handler.go"))

	for _, fragment := range []string{
		"repo.db.Pool().Begin(ctx)",
		"getSnapshotForUpdate",
		"findReplacementEventID",
		"rescheduled_from_event_id",
		"rescheduled_to_event_id = $4::uuid",
		"when $7::boolean then $8::integer",
		"else original.reminder_minutes",
		"status = 'cancelled'",
		"outcome = 'rescheduled'",
		`"rescheduled_to_event_id": newEventID`,
		`"rescheduled_from_event_id": eventID`,
		"insert into public.schedule_event_assignees",
		"enqueueRescheduleGoogleSyncJobs",
		"insert into public.google_calendar_sync_jobs",
		"'push_delete'",
		"'push_upsert'",
		"public.google_calendar_event_links",
		"tx.Commit(ctx)",
	} {
		if !strings.Contains(source, fragment) {
			t.Fatalf("reschedule implementation missing %q", fragment)
		}
	}
	if !strings.Contains(routes, `POST /v1/schedule/events/{id}/reschedule`) {
		t.Fatal("transactional reschedule endpoint is not registered")
	}
	if !strings.Contains(handler, "if !result.wasReplay") {
		t.Fatal("retry replay must not publish duplicate schedule side effects")
	}
}

func TestScheduleRepositoryAuditsFinalOutcomesAndDeepLinksNotifications(t *testing.T) {
	root := scheduleRepositoryRoot(t)
	repository := readScheduleContractFile(t, filepath.Join(root, "apps", "api", "internal", "schedule", "repository.go"))

	for _, fragment := range []string{
		`insertTimelineEvent(ctx, tx, tenantContext, updated, "completed")`,
		`insertTimelineEvent(ctx, tx, tenantContext, updated, "no_show")`,
		`insertTimelineEvent(ctx, tx, tenantContext, updated, "cancelled")`,
		`if input.Status.Set || input.Outcome.Set`,
		`assignments = append(assignments, "outcome_recorded_at = now()")`,
		`return "/agenda?event=" + eventID`,
	} {
		if !strings.Contains(repository, fragment) {
			t.Fatalf("schedule repository missing final-outcome contract %q", fragment)
		}
	}
	if count := strings.Count(repository, "validateFinalAppointmentMutation(current)"); count < 3 {
		t.Fatalf("final appointment immutability must guard PATCH/AddAssignee/RemoveAssignee, found %d repository guards", count)
	}
}

func TestScheduleCapabilitiesExposeTheOrganizationTimeZone(t *testing.T) {
	root := scheduleRepositoryRoot(t)
	repository := readScheduleContractFile(t, filepath.Join(root, "apps", "api", "internal", "schedule", "repository.go"))
	typesSource := readScheduleContractFile(t, filepath.Join(root, "apps", "api", "internal", "schedule", "types.go"))

	for _, fragment := range []string{
		"public.organization_attention_settings",
		"pg_catalog.pg_timezone_names",
		"'America/Sao_Paulo'",
		"&capabilities.TimeZone",
	} {
		if !strings.Contains(repository, fragment) {
			t.Fatalf("schedule capabilities timezone query missing %q", fragment)
		}
	}
	if !strings.Contains(typesSource, "TimeZone") || !strings.Contains(typesSource, `json:"timeZone"`) {
		t.Fatal("schedule capabilities response must expose timeZone")
	}
}

func scheduleRepositoryRoot(t *testing.T) string {
	t.Helper()
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(sourceFile), "..", "..", "..", ".."))
}

func readScheduleContractFile(t *testing.T, path string) string {
	t.Helper()
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(payload)
}
