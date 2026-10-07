package leads

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type propertyReservationLockTx struct {
	pgx.Tx
	query string
	args  []any
}

func (tx *propertyReservationLockTx) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	tx.query = query
	tx.args = args
	return propertyReservationLockRow{}
}

type propertyReservationLockRow struct{}

func (propertyReservationLockRow) Scan(destinations ...any) error {
	if len(destinations) != 10 {
		return errors.New("unexpected lock scan")
	}
	for index, value := range []string{
		"44444444-4444-4444-8444-444444444444",
		"Imovel E2E",
		"VIMOB-001",
		"active",
	} {
		destination, ok := destinations[index].(*string)
		if !ok {
			return errors.New("unexpected string lock destination")
		}
		*destination = value
	}
	for _, index := range []int{4, 5} {
		destination, ok := destinations[index].(*bool)
		if !ok {
			return errors.New("unexpected bool lock destination")
		}
		*destination = true
	}
	*destinations[6].(*pgtype.Text) = pgtype.Text{String: "active", Valid: true}
	*destinations[7].(*pgtype.Bool) = pgtype.Bool{Bool: true, Valid: true}
	*destinations[8].(*pgtype.Bool) = pgtype.Bool{Bool: true, Valid: true}
	*destinations[9].(*string) = "55555555-5555-4555-8555-555555555555"
	return nil
}

func TestWonLeadPropertyIsLockedBeforeMutation(t *testing.T) {
	tx := &propertyReservationLockTx{}
	reservation, err := (Repository{}).lockWonLeadPropertyForTrustedSystem(
		context.Background(),
		tx,
		"11111111-1111-4111-8111-111111111111",
		"",
		"44444444-4444-4444-8444-444444444444",
	)
	if err != nil {
		t.Fatalf("lock won property: %v", err)
	}
	if reservation == nil ||
		reservation.PropertyID != "44444444-4444-4444-8444-444444444444" ||
		reservation.OldStatus != "active" ||
		!reservation.OldPublishedOnSite ||
		!reservation.OldAnnounce {
		t.Fatalf("conditional reservation snapshot = %#v", reservation)
	}
	query := strings.ToLower(strings.Join(strings.Fields(tx.query), " "))
	for _, required := range []string{
		"with candidate as materialized",
		"for update of property skip locked",
		"update public.properties property",
		"set status = 'reserved'",
		"candidate.old_status",
		"candidate.reservation_event_id::text",
		"metadata = coalesce(property.metadata",
	} {
		if !strings.Contains(query, required) {
			t.Fatalf("conditional won property lock missing %q: %s", required, query)
		}
	}
	if strings.Contains(query, "pg_try_advisory") {
		t.Fatalf("conditional won property lock must preserve rollback handoff: %s", query)
	}
	if len(tx.args) != 3 || tx.args[1] != "44444444-4444-4444-8444-444444444444" || tx.args[2] != activeWonLeadReservationEventIDKey {
		t.Fatalf("won property lock args = %#v", tx.args)
	}
}

type propertyReservationRetryTx struct {
	pgx.Tx
	queries int
}

func (tx *propertyReservationRetryTx) QueryRow(_ context.Context, query string, _ ...any) pgx.Row {
	tx.queries++
	if strings.Contains(strings.ToLower(query), "with candidate as materialized") {
		return propertyReservationRetryRow{err: pgx.ErrNoRows}
	}
	return propertyReservationRetryRow{status: "active"}
}

type propertyReservationRetryRow struct {
	status string
	err    error
}

func (row propertyReservationRetryRow) Scan(destinations ...any) error {
	if row.err != nil {
		return row.err
	}
	if len(destinations) != 5 {
		return errors.New("unexpected retry status scan")
	}
	destination, ok := destinations[0].(*string)
	if !ok {
		return errors.New("unexpected retry status destination")
	}
	*destination = row.status
	*destinations[1].(*string) = ""
	*destinations[2].(*string) = "object"
	*destinations[3].(*pgtype.Bool) = pgtype.Bool{Bool: false, Valid: true}
	*destinations[4].(*pgtype.Bool) = pgtype.Bool{Bool: false, Valid: true}
	return nil
}

func TestWonLeadPropertyRetryRespectsContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	tx := &propertyReservationRetryTx{}

	_, err := (Repository{}).lockWonLeadPropertyForTrustedSystem(
		ctx,
		tx,
		"11111111-1111-4111-8111-111111111111",
		"33333333-3333-4333-8333-333333333333",
		"44444444-4444-4444-8444-444444444444",
	)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("retry error = %v, want context.Canceled", err)
	}
	if tx.queries != 2 {
		t.Fatalf("retry queries = %d, want one candidate and one visible-status query", tx.queries)
	}
}

func TestPropertyReleaseRequiresCurrentOwnedExactReservation(t *testing.T) {
	const eventID = "55555555-5555-4555-8555-555555555555"
	const leadID = "33333333-3333-4333-8333-333333333333"
	snapshot := propertyReservationSnapshot{
		EventID:      eventID,
		LeadID:       leadID,
		Active:       true,
		ExactRestore: true,
	}
	falseFlag := pgtype.Bool{Bool: false, Valid: true}
	if !propertyReservationIsCurrent(snapshot, leadID, eventID, falseFlag, falseFlag) {
		t.Fatal("exact active reservation by the lead was not recognized")
	}
	checks := []struct {
		name     string
		adjust   func(*propertyReservationSnapshot)
		leadID   string
		eventID  string
		announce pgtype.Bool
	}{
		{name: "another lead", leadID: "44444444-4444-4444-8444-444444444444", eventID: eventID, announce: falseFlag},
		{name: "released event", adjust: func(s *propertyReservationSnapshot) { s.Active = false }, leadID: leadID, eventID: eventID, announce: falseFlag},
		{name: "legacy event without exact snapshot", adjust: func(s *propertyReservationSnapshot) { s.ExactRestore = false }, leadID: leadID, eventID: eventID, announce: falseFlag},
		{name: "property marker replaced", leadID: leadID, eventID: "66666666-6666-4666-8666-666666666666", announce: falseFlag},
		{name: "publication changed", leadID: leadID, eventID: eventID, announce: pgtype.Bool{Bool: true, Valid: true}},
	}
	for _, check := range checks {
		t.Run(check.name, func(t *testing.T) {
			candidate := snapshot
			if check.adjust != nil {
				check.adjust(&candidate)
			}
			if propertyReservationIsCurrent(candidate, check.leadID, check.eventID, falseFlag, check.announce) {
				t.Fatal("unproven reservation was treated as active")
			}
		})
	}
}

type propertyReservationBulkTx struct {
	pgx.Tx
	execCount int
	query     string
	args      []any
}

func (tx *propertyReservationBulkTx) Exec(_ context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	tx.execCount++
	tx.query = query
	tx.args = args
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}

func TestNotifyInterestedLeadsUsesOneSetBasedWrite(t *testing.T) {
	tx := &propertyReservationBulkTx{}
	tenantContext := tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
	}
	current := leadSnapshot{
		ID:   "33333333-3333-4333-8333-333333333333",
		Name: "Lead ganho",
	}

	deliveredCount, err := (Repository{}).notifyInterestedLeadsForReservedProperty(
		context.Background(),
		tx,
		tenantContext,
		current,
		"44444444-4444-4444-8444-444444444444",
		"Imovel E2E",
		"VIMOB-001",
		"active",
		"",
	)
	if err != nil {
		t.Fatalf("notify interested leads: %v", err)
	}
	if deliveredCount != 1 {
		t.Fatalf("bulk delivered count = %d, want 1", deliveredCount)
	}
	if tx.execCount != 1 {
		t.Fatalf("write count = %d, want one set-based write", tx.execCount)
	}
	query := strings.ToLower(strings.Join(strings.Fields(tx.query), " "))
	for _, required := range []string{
		"with targets as materialized",
		"and exists ( select 1 from public.properties property",
		"coalesce(lead.deal_status, 'open') not in ('won', 'lost')",
		"coalesce(reserved_lead.deal_status, 'open') = 'won'",
		"insert into public.activities",
		"insert into public.notifications",
		"'event_key', 'interest_property_reserved'",
		"payload.metadata || jsonb_build_object( 'dispatch', jsonb_build_object( 'push', jsonb_build_object( 'status', 'pending', 'required', true ) ) )",
		"on conflict do nothing",
	} {
		if !strings.Contains(query, required) {
			t.Fatalf("bulk reservation notification query missing %q: %s", required, query)
		}
	}
	if len(tx.args) != 9 ||
		tx.args[3] != "44444444-4444-4444-8444-444444444444" {
		t.Fatalf("bulk reservation notification args = %#v", tx.args)
	}
}

type propertyReservationOutboxTx struct {
	pgx.Tx
	tableAvailable   bool
	jobAvailable     bool
	propertyReleased bool
	queries          []string
	queryArgs        [][]any
	execQueries      []string
	execArgs         [][]any
}

func (tx *propertyReservationOutboxTx) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	tx.queries = append(tx.queries, query)
	tx.queryArgs = append(tx.queryArgs, args)
	query = strings.ToLower(strings.Join(strings.Fields(query), " "))
	switch {
	case strings.Contains(query, "to_regclass('public.events')"):
		return propertyReservationOutboxRow{scan: func(destinations ...any) error {
			*destinations[0].(*bool) = tx.tableAvailable
			return nil
		}}
	case strings.Contains(query, "insert into public.events"):
		return propertyReservationOutboxRow{scan: func(destinations ...any) error {
			*destinations[0].(*string) = "55555555-5555-4555-8555-555555555555"
			return nil
		}}
	case strings.Contains(query, "from public.events"):
		return propertyReservationOutboxRow{scan: func(destinations ...any) error {
			if !tx.jobAvailable {
				return pgx.ErrNoRows
			}
			values := []string{
				"55555555-5555-4555-8555-555555555555",
				"11111111-1111-4111-8111-111111111111",
				"44444444-4444-4444-8444-444444444444",
				"Imovel E2E",
				"VIMOB-001",
				"22222222-2222-4222-8222-222222222222",
				"Corretor",
				"33333333-3333-4333-8333-333333333333",
				"Lead ganho",
				"active",
				`[{"lead_id":"66666666-6666-4666-8666-666666666666","lead_name":"Lead interessado","user_id":"77777777-7777-4777-8777-777777777777"}]`,
			}
			for index, value := range values {
				*destinations[index].(*string) = value
			}
			return nil
		}}
	case strings.Contains(query, "from public.properties property"):
		return propertyReservationOutboxRow{scan: func(destinations ...any) error {
			if tx.propertyReleased {
				return pgx.ErrNoRows
			}
			*destinations[0].(*string) = "reserved"
			*destinations[1].(*string) = "55555555-5555-4555-8555-555555555555"
			return nil
		}}
	default:
		return propertyReservationOutboxRow{scan: func(...any) error {
			return errors.New("unexpected outbox query")
		}}
	}
}

func (tx *propertyReservationOutboxTx) Exec(_ context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	tx.execQueries = append(tx.execQueries, query)
	tx.execArgs = append(tx.execArgs, args)
	if strings.Contains(strings.ToLower(query), "update public.events") {
		return pgconn.NewCommandTag("UPDATE 1"), nil
	}
	return pgconn.NewCommandTag("INSERT 0 199"), nil
}

type propertyReservationOutboxRow struct {
	scan func(destinations ...any) error
}

func (row propertyReservationOutboxRow) Scan(destinations ...any) error {
	return row.scan(destinations...)
}

func TestEnqueuePropertyReservationNotificationJobCreatesOnePendingHistoricalEvent(t *testing.T) {
	tx := &propertyReservationOutboxTx{tableAvailable: true}
	jobID, eventsAvailable, err := (Repository{}).enqueuePropertyReservationNotificationJob(
		context.Background(),
		tx,
		propertyReservationNotificationJob{
			ID:                 "55555555-5555-4555-8555-555555555555",
			OrganizationID:     "11111111-1111-4111-8111-111111111111",
			PropertyID:         "44444444-4444-4444-8444-444444444444",
			PropertyTitle:      "Imovel E2E",
			PropertyCode:       "VIMOB-001",
			ReservedByUserID:   "22222222-2222-4222-8222-222222222222",
			ReservedByUserName: "Corretor",
			ReservedByLeadID:   "33333333-3333-4333-8333-333333333333",
			ReservedByLeadName: "Lead ganho",
			OldStatus:          "active",
			OldPublishedOnSite: true,
			OldAnnounce:        true,
		},
	)
	if err != nil {
		t.Fatalf("enqueue reservation notification job: %v", err)
	}
	if !eventsAvailable || jobID != "55555555-5555-4555-8555-555555555555" {
		t.Fatalf("enqueue result = %q/%t", jobID, eventsAvailable)
	}
	if len(tx.queries) != 2 || len(tx.execQueries) != 0 {
		t.Fatalf("enqueue statements = %d query rows/%d execs, want 2/0", len(tx.queries), len(tx.execQueries))
	}
	insertQuery := strings.ToLower(strings.Join(strings.Fields(tx.queries[1]), " "))
	for _, required := range []string{
		"with targets as materialized",
		"jsonb_agg",
		"insert into public.events",
		"'property'",
		"'pending'",
		"'target_count'",
		"'delivered_count'",
		"'audience_resolution', 'reservation_time'",
		"returning id::text",
	} {
		if !strings.Contains(insertQuery, required) {
			t.Fatalf("pending historical event query missing %q: %s", required, insertQuery)
		}
	}
	if len(tx.queryArgs[1]) != 6 ||
		tx.queryArgs[1][1] != propertyReservationNotificationEventType ||
		tx.queryArgs[1][4] != "33333333-3333-4333-8333-333333333333" ||
		tx.queryArgs[1][5] != "55555555-5555-4555-8555-555555555555" {
		t.Fatalf("pending historical event args = %#v", tx.queryArgs[1])
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(tx.queryArgs[1][3].(string)), &payload); err != nil {
		t.Fatalf("decode historical event payload: %v", err)
	}
	for key, want := range map[string]string{
		"reserved_by_lead_id": "33333333-3333-4333-8333-333333333333",
		"property_id":         "44444444-4444-4444-8444-444444444444",
		"old_status":          "active",
		"new_status":          "reserved",
	} {
		if payload[key] != want {
			t.Fatalf("historical event payload[%q] = %#v, want %q", key, payload[key], want)
		}
	}
}

func TestReservationEventPreservesNullablePreReservationValues(t *testing.T) {
	tx := &propertyReservationOutboxTx{tableAvailable: true}
	_, available, err := (Repository{}).enqueuePropertyReservationNotificationJob(context.Background(), tx, propertyReservationNotificationJob{
		ID:                   "55555555-5555-4555-8555-555555555555",
		OrganizationID:       "11111111-1111-4111-8111-111111111111",
		PropertyID:           "44444444-4444-4444-8444-444444444444",
		ReservedByLeadID:     "33333333-3333-4333-8333-333333333333",
		ExactRestoreSnapshot: true,
	})
	if err != nil || !available {
		t.Fatalf("write exact nullable snapshot: available=%t error=%v", available, err)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(tx.queryArgs[1][3].(string)), &payload); err != nil {
		t.Fatalf("decode exact nullable snapshot: %v", err)
	}
	if payload["exact_restore_snapshot"] != true || payload["old_status"] != nil || payload["old_published_on_site"] != nil || payload["old_anunciar"] != nil {
		t.Fatalf("nullable pre-reservation values were changed: %#v", payload)
	}
}

func TestEnqueuePropertyReservationNotificationJobSignalsInlineFallbackWithoutEvents(t *testing.T) {
	tx := &propertyReservationOutboxTx{tableAvailable: false}
	jobID, eventsAvailable, err := (Repository{}).enqueuePropertyReservationNotificationJob(
		context.Background(),
		tx,
		propertyReservationNotificationJob{ID: "55555555-5555-4555-8555-555555555555"},
	)
	if err != nil {
		t.Fatalf("detect missing events table: %v", err)
	}
	if eventsAvailable || jobID != "" {
		t.Fatalf("missing events result = %q/%t, want empty/false", jobID, eventsAvailable)
	}
	if len(tx.queries) != 1 || len(tx.execQueries) != 0 {
		t.Fatalf("missing events statements = %d query rows/%d execs, want 1/0", len(tx.queries), len(tx.execQueries))
	}
}

func TestProcessPropertyReservationNotificationJobWritesFanoutBeforeAtomicProcessedMark(t *testing.T) {
	tx := &propertyReservationOutboxTx{
		tableAvailable: true,
		jobAvailable:   true,
	}
	processed, err := (Repository{}).processPropertyReservationNotificationJobTx(
		context.Background(),
		tx,
		"55555555-5555-4555-8555-555555555555",
	)
	if err != nil {
		t.Fatalf("process reservation notification job: %v", err)
	}
	if !processed {
		t.Fatal("reservation notification job was not processed")
	}
	if len(tx.queries) != 3 || len(tx.execQueries) != 2 {
		t.Fatalf("processing statements = %d query rows/%d execs, want 3/2", len(tx.queries), len(tx.execQueries))
	}
	claimQuery := strings.ToLower(strings.Join(strings.Fields(tx.queries[1]), " "))
	for _, required := range []string{
		"status = 'pending'",
		"for update skip locked",
		"event_type = $2",
		"when payload ? 'targets'",
	} {
		if !strings.Contains(claimQuery, required) {
			t.Fatalf("outbox claim query missing %q: %s", required, claimQuery)
		}
	}
	fanoutQuery := strings.ToLower(strings.Join(strings.Fields(tx.execQueries[0]), " "))
	if !strings.Contains(fanoutQuery, "insert into public.notifications") ||
		!strings.Contains(fanoutQuery, "insert into public.activities") ||
		!strings.Contains(fanoutQuery, "jsonb_to_recordset") ||
		!strings.Contains(fanoutQuery, "join public.leads existing_lead") ||
		!strings.Contains(fanoutQuery, "join public.users existing_user") {
		t.Fatalf("first outbox write is not the bulk fan-out: %s", fanoutQuery)
	}
	for _, forbidden := range []string{
		"deal_status",
		"interest_property_id",
		"lead.property_id",
		"assigned_user_id is not null",
	} {
		if strings.Contains(fanoutQuery, forbidden) {
			t.Fatalf("snapshot fan-out unexpectedly refilters mutable state %q: %s", forbidden, fanoutQuery)
		}
	}
	if len(tx.execArgs[0]) != 10 ||
		tx.execArgs[0][9] != `[{"lead_id":"66666666-6666-4666-8666-666666666666","lead_name":"Lead interessado","user_id":"77777777-7777-4777-8777-777777777777"}]` {
		t.Fatalf("snapshot fan-out args = %#v", tx.execArgs[0])
	}
	processedQuery := strings.ToLower(strings.Join(strings.Fields(tx.execQueries[1]), " "))
	for _, required := range []string{
		"update public.events",
		"status = 'processed'",
		"processed_at = now()",
		"'delivered_count', $2::int",
		"and status = 'pending'",
	} {
		if !strings.Contains(processedQuery, required) {
			t.Fatalf("processed mark query missing %q: %s", required, processedQuery)
		}
	}
	if len(tx.execArgs[1]) != 3 || tx.execArgs[1][1] != int64(199) || tx.execArgs[1][2] != "processed" {
		t.Fatalf("processed mark args = %#v, want delivered_count 199", tx.execArgs[1])
	}
}

func TestProcessPropertyReservationNotificationJobSkipsReleasedProperty(t *testing.T) {
	tx := &propertyReservationOutboxTx{tableAvailable: true, jobAvailable: true, propertyReleased: true}
	processed, err := (Repository{}).processPropertyReservationNotificationJobTx(
		context.Background(), tx, "55555555-5555-4555-8555-555555555555",
	)
	if err != nil || !processed {
		t.Fatalf("skip stale reservation notification: processed=%t error=%v", processed, err)
	}
	if len(tx.execQueries) != 1 || strings.Contains(tx.execQueries[0], "insert into public.notifications") {
		t.Fatalf("stale reservation sent a notice: %#v", tx.execQueries)
	}
	if len(tx.execArgs[0]) != 3 || tx.execArgs[0][1] != int64(0) || tx.execArgs[0][2] != "skipped_inactive" {
		t.Fatalf("stale reservation completion = %#v", tx.execArgs[0])
	}
}

func TestProcessPropertyReservationNotificationJobIsNoOpAfterProcessed(t *testing.T) {
	tx := &propertyReservationOutboxTx{
		tableAvailable: true,
		jobAvailable:   false,
	}
	processed, err := (Repository{}).processPropertyReservationNotificationJobTx(
		context.Background(),
		tx,
		"55555555-5555-4555-8555-555555555555",
	)
	if err != nil {
		t.Fatalf("replay processed reservation notification job: %v", err)
	}
	if processed {
		t.Fatal("processed reservation notification job was replayed")
	}
	if len(tx.execQueries) != 0 {
		t.Fatalf("processed reservation replay wrote %d statements", len(tx.execQueries))
	}
}
