package leads

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"sort"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestConcurrentWonContendersReserveSharedPropertyOnce(t *testing.T) {
	if os.Getenv("VIMOB_RUN_PROPERTY_CONTENTION_TEST") != "LOCAL_WRITE_TEST" {
		t.Skip("set VIMOB_RUN_PROPERTY_CONTENTION_TEST=LOCAL_WRITE_TEST for the local Postgres regression")
	}
	connectionString := os.Getenv("VIMOB_PROPERTY_CONTENTION_DATABASE_URL")
	target, err := url.Parse(connectionString)
	if err != nil ||
		(target.Hostname() != "127.0.0.1" && target.Hostname() != "localhost") ||
		target.User.Username() != "postgres" ||
		target.Path != "/postgres" {
		t.Fatal("property contention test requires the local postgres database")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	setup, err := pgx.Connect(ctx, connectionString)
	if err != nil {
		t.Fatalf("connect setup: %v", err)
	}
	defer setup.Close(context.Background())
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:           connectionString,
		MaxConns:      8,
		HealthTimeout: 2 * time.Second,
	})
	if err != nil {
		t.Fatalf("connect repository: %v", err)
	}
	defer database.Close()

	const organizationID = "11111111-1111-4111-8111-111111111111"
	const expectedAffectedLeads = 199
	const contenderCount = 100
	var userID string
	if err := setup.QueryRow(ctx, `
		select om.user_id::text
		from public.organization_members om
		where om.organization_id = $1::uuid
		  and coalesce(om.is_active, false) = true
		order by om.created_at
		limit 1
	`, organizationID).Scan(&userID); err != nil {
		t.Fatalf("resolve local E2E user: %v", err)
	}

	marker := fmt.Sprintf("LOCK-%d", time.Now().UnixNano())
	var propertyID string
	if err := setup.QueryRow(ctx, `
		insert into public.properties (
			organization_id, code, title, status, preco,
			commission_percentage, published_on_site, anunciar
		)
		values ($1::uuid, $2, $2, 'active', 750000, 5, true, true)
		returning id::text
	`, organizationID, marker).Scan(&propertyID); err != nil {
		t.Fatalf("create property fixture: %v", err)
	}

	contenderLeadIDs := make([]string, 0, contenderCount)
	allLeadIDs := make([]string, 0, expectedAffectedLeads+1)
	defer func() {
		cleanupPropertyContentionFixture(setup, organizationID, propertyID, allLeadIDs, marker)
	}()
	for index := 0; index < contenderCount; index++ {
		var leadID string
		if err := setup.QueryRow(ctx, `
			insert into public.leads (
				organization_id, assigned_user_id, property_id,
				interest_property_id, name, source, deal_status,
				valor_interesse, commission_percentage, metadata
			)
			values (
				$1::uuid, $2::uuid, $3::uuid, $3::uuid,
				$4, 'manual', 'open', 750000, 5,
				jsonb_build_object('property_contention_test', $5::text)
			)
			returning id::text
		`, organizationID, userID, propertyID, fmt.Sprintf("%s-%d", marker, index), marker).Scan(&leadID); err != nil {
			t.Fatalf("create lead fixture %d: %v", index, err)
		}
		contenderLeadIDs = append(contenderLeadIDs, leadID)
		allLeadIDs = append(allLeadIDs, leadID)
	}

	rows, err := setup.Query(ctx, `
		insert into public.leads (
			organization_id, assigned_user_id, property_id,
			interest_property_id, name, source, deal_status,
			valor_interesse, commission_percentage, metadata
		)
		select
			$1::uuid, $2::uuid, $3::uuid,
			$3::uuid, format('%s-interested-%s', $4::text, series),
			'manual', 'open', 750000, 5,
			jsonb_build_object('property_contention_test', $4::text)
		from generate_series(1, $5::int) series
		returning id::text
	`, organizationID, userID, propertyID, marker, expectedAffectedLeads+1-contenderCount)
	if err != nil {
		t.Fatalf("create interested lead fixtures: %v", err)
	}
	for rows.Next() {
		var leadID string
		if err := rows.Scan(&leadID); err != nil {
			rows.Close()
			t.Fatalf("scan interested lead fixture: %v", err)
		}
		allLeadIDs = append(allLeadIDs, leadID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		t.Fatalf("iterate interested lead fixtures: %v", err)
	}
	rows.Close()
	if len(allLeadIDs) != expectedAffectedLeads+1 {
		t.Fatalf("lead fixture count = %d, want %d", len(allLeadIDs), expectedAffectedLeads+1)
	}

	repository := NewRepository(database, nil)
	tenantContext := tenant.Context{
		OrganizationID: organizationID,
		UserID:         userID,
		IsSuperAdmin:   true,
	}
	won := "won"
	interestValue := "750000"
	input := updateInput{
		DealStatus:    patchString{Set: true, Value: &won},
		InterestValue: patchString{Set: true, Value: &interestValue},
	}

	provisionalTx, err := database.Pool().Begin(ctx)
	if err != nil {
		t.Fatalf("begin provisional reservation: %v", err)
	}
	provisionalReservation, err := repository.lockWonLeadPropertyForUpdate(
		ctx,
		provisionalTx,
		organizationID,
		leadSnapshot{
			ID:                 contenderLeadIDs[0],
			Name:               marker + "-0",
			DealStatus:         "open",
			InterestPropertyID: propertyID,
		},
		input,
	)
	if err != nil {
		_ = provisionalTx.Rollback(ctx)
		t.Fatalf("take provisional reservation before rollback: %v", err)
	}
	if provisionalReservation == nil || provisionalReservation.OldStatus != "active" {
		_ = provisionalTx.Rollback(ctx)
		t.Fatalf("provisional reservation snapshot = %#v", provisionalReservation)
	}
	if err := provisionalTx.Rollback(ctx); err != nil {
		t.Fatalf("rollback provisional reservation: %v", err)
	}
	var statusAfterRollback string
	if err := setup.QueryRow(ctx, `
		select coalesce(status, '')
		from public.properties
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, organizationID, propertyID).Scan(&statusAfterRollback); err != nil {
		t.Fatalf("inspect property after provisional rollback: %v", err)
	}
	if statusAfterRollback != "active" {
		t.Fatalf("property status after provisional rollback = %q, want active", statusAfterRollback)
	}

	start := make(chan struct{})
	type contenderResult struct {
		err      error
		duration time.Duration
	}
	results := make(chan contenderResult, len(contenderLeadIDs))
	for _, leadID := range contenderLeadIDs {
		leadID := leadID
		go func() {
			<-start
			startedAt := time.Now()
			_, updateErr := repository.Update(ctx, tenantContext, leadID, input)
			results <- contenderResult{err: updateErr, duration: time.Since(startedAt)}
		}()
	}
	close(start)

	successes := 0
	conflicts := 0
	durations := make([]time.Duration, 0, contenderCount)
	successDurations := make([]time.Duration, 0, 1)
	conflictDurations := make([]time.Duration, 0, contenderCount-1)
	for range contenderLeadIDs {
		result := <-results
		durations = append(durations, result.duration)
		switch {
		case result.err == nil:
			successes++
			successDurations = append(successDurations, result.duration)
		case errors.Is(result.err, ErrLeadPropertyUnavailable):
			conflicts++
			conflictDurations = append(conflictDurations, result.duration)
		default:
			t.Fatalf("unexpected contender result: %v", result.err)
		}
	}
	if successes != 1 || conflicts != contenderCount-1 {
		t.Fatalf(
			"contender results = %d success/%d conflict, want 1/%d",
			successes,
			conflicts,
			contenderCount-1,
		)
	}
	sort.Slice(durations, func(left, right int) bool {
		return durations[left] < durations[right]
	})
	sort.Slice(conflictDurations, func(left, right int) bool {
		return conflictDurations[left] < conflictDurations[right]
	})
	p95Index := (95*len(durations)+99)/100 - 1
	conflictP95Index := (95*len(conflictDurations)+99)/100 - 1
	t.Logf(
		"conditional property lock timing: contenders=%d winner=%s conflicts_p50=%s conflicts_p95=%s conflicts_max=%s overall_p95=%s",
		contenderCount,
		successDurations[0],
		conflictDurations[len(conflictDurations)/2],
		conflictDurations[conflictP95Index],
		conflictDurations[len(conflictDurations)-1],
		durations[p95Index],
	)

	var wonCount int
	var propertyStatus string
	var winningLeadID string
	if err := setup.QueryRow(ctx, `
		select
			(select count(*) from public.leads
			 where organization_id = $1::uuid and id = any($2::uuid[]) and deal_status = 'won'),
			(select coalesce(status, '') from public.properties
			 where organization_id = $1::uuid and id = $3::uuid),
			(select id::text from public.leads
			 where organization_id = $1::uuid and id = any($2::uuid[]) and deal_status = 'won'
			 limit 1)
	`, organizationID, contenderLeadIDs, propertyID).Scan(&wonCount, &propertyStatus, &winningLeadID); err != nil {
		t.Fatalf("inspect contender result: %v", err)
	}
	if wonCount != 1 || propertyStatus != "reserved" {
		t.Fatalf("persisted result = %d won/property %q, want 1/reserved", wonCount, propertyStatus)
	}

	var eventID, eventStatus string
	var eventProcessed bool
	var eventCount int
	var historicalOldStatus, historicalLeadID string
	var targetCount, deliveredCount int
	if err := setup.QueryRow(ctx, `
		select
			id::text,
			status,
			processed_at is not null,
			count(*) over(),
			payload->>'old_status',
			payload->>'reserved_by_lead_id',
			coalesce((payload->>'target_count')::int, -1),
			coalesce((payload->>'delivered_count')::int, -1)
		from public.events
		where organization_id = $1::uuid
		  and entity_type = 'property'
		  and entity_id = $2::uuid
		  and event_type = $3
		  and payload->>'reserved_by_lead_id' = $4
		order by created_at desc
		limit 1
	`, organizationID, propertyID, propertyReservationNotificationEventType, winningLeadID).Scan(
		&eventID,
		&eventStatus,
		&eventProcessed,
		&eventCount,
		&historicalOldStatus,
		&historicalLeadID,
		&targetCount,
		&deliveredCount,
	); err != nil {
		t.Fatalf("inspect reservation outbox event: %v", err)
	}
	if eventStatus != "pending" ||
		eventProcessed ||
		eventCount != 1 ||
		historicalOldStatus != "active" ||
		historicalLeadID != winningLeadID ||
		targetCount != expectedAffectedLeads ||
		deliveredCount != 0 {
		t.Fatalf(
			"reservation outbox event before recovery = status:%q processed:%t count:%d old:%q lead:%q targets:%d delivered:%d",
			eventStatus,
			eventProcessed,
			eventCount,
			historicalOldStatus,
			historicalLeadID,
			targetCount,
			deliveredCount,
		)
	}

	assertPropertyReservationFanoutCounts(
		t,
		ctx,
		setup,
		organizationID,
		propertyID,
		winningLeadID,
		0,
	)

	processed, err := repository.processPropertyReservationNotificationJob(ctx, eventID)
	if err != nil {
		t.Fatalf("recover pending reservation outbox event: %v", err)
	}
	if !processed {
		t.Fatal("pending reservation outbox event was not recovered")
	}
	if err := setup.QueryRow(ctx, `
		select
			status,
			processed_at is not null,
			coalesce((payload->>'delivered_count')::int, -1)
		from public.events
		where id = $1::uuid
	`, eventID).Scan(&eventStatus, &eventProcessed, &deliveredCount); err != nil {
		t.Fatalf("inspect recovered reservation outbox event: %v", err)
	}
	if eventStatus != "processed" ||
		!eventProcessed ||
		deliveredCount != expectedAffectedLeads {
		t.Fatalf(
			"reservation outbox event after recovery = status:%q processed:%t delivered:%d, want processed/true/%d",
			eventStatus,
			eventProcessed,
			deliveredCount,
			expectedAffectedLeads,
		)
	}
	assertPropertyReservationFanoutCounts(
		t,
		ctx,
		setup,
		organizationID,
		propertyID,
		winningLeadID,
		expectedAffectedLeads,
	)

	replayed, err := repository.processPropertyReservationNotificationJob(ctx, eventID)
	if err != nil {
		t.Fatalf("replay processed reservation outbox event: %v", err)
	}
	if replayed {
		t.Fatal("processed reservation outbox event replayed its fan-out")
	}
	assertPropertyReservationFanoutCounts(
		t,
		ctx,
		setup,
		organizationID,
		propertyID,
		winningLeadID,
		expectedAffectedLeads,
	)
}

func TestPropertyReservationOutboxKeepsAudienceSnapshotAcrossRecovery(t *testing.T) {
	if os.Getenv("VIMOB_RUN_PROPERTY_CONTENTION_TEST") != "LOCAL_WRITE_TEST" {
		t.Skip("set VIMOB_RUN_PROPERTY_CONTENTION_TEST=LOCAL_WRITE_TEST for the local Postgres regression")
	}
	connectionString := os.Getenv("VIMOB_PROPERTY_CONTENTION_DATABASE_URL")
	target, err := url.Parse(connectionString)
	if err != nil ||
		(target.Hostname() != "127.0.0.1" && target.Hostname() != "localhost") ||
		target.User.Username() != "postgres" ||
		target.Path != "/postgres" {
		t.Fatal("property reservation outbox test requires the local postgres database")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	setup, err := pgx.Connect(ctx, connectionString)
	if err != nil {
		t.Fatalf("connect setup: %v", err)
	}
	defer setup.Close(context.Background())
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:           connectionString,
		MaxConns:      4,
		HealthTimeout: 2 * time.Second,
	})
	if err != nil {
		t.Fatalf("connect repository: %v", err)
	}
	defer database.Close()

	const organizationID = "11111111-1111-4111-8111-111111111111"
	userRows, err := setup.Query(ctx, `
		select om.user_id::text
		from public.organization_members om
		join public.users u on u.id = om.user_id
		where om.organization_id = $1::uuid
		  and coalesce(om.is_active, false) = true
		  and coalesce(u.is_active, false) = true
		order by om.created_at, om.user_id
		limit 2
	`, organizationID)
	if err != nil {
		t.Fatalf("resolve local E2E users: %v", err)
	}
	userIDs := make([]string, 0, 2)
	for userRows.Next() {
		var userID string
		if err := userRows.Scan(&userID); err != nil {
			userRows.Close()
			t.Fatalf("scan local E2E user: %v", err)
		}
		userIDs = append(userIDs, userID)
	}
	if err := userRows.Err(); err != nil {
		userRows.Close()
		t.Fatalf("iterate local E2E users: %v", err)
	}
	userRows.Close()
	if len(userIDs) != 2 {
		t.Fatalf("property reservation outbox test requires two active local users, got %d", len(userIDs))
	}
	originalUserID := userIDs[0]
	reassignedUserID := userIDs[1]

	marker := fmt.Sprintf("SNAPSHOT-%d", time.Now().UnixNano())
	var propertyID string
	if err := setup.QueryRow(ctx, `
		insert into public.properties (
			organization_id, code, title, status, preco,
			commission_percentage, published_on_site, anunciar
		)
		values ($1::uuid, $2, $2, 'active', 750000, 5, true, true)
		returning id::text
	`, organizationID, marker).Scan(&propertyID); err != nil {
		t.Fatalf("create snapshot property fixture: %v", err)
	}

	leadIDs := make([]string, 0, 2)
	defer func() {
		cleanupPropertyContentionFixture(setup, organizationID, propertyID, leadIDs, marker)
	}()
	for _, name := range []string{marker + "-winner", marker + "-target"} {
		var leadID string
		if err := setup.QueryRow(ctx, `
			insert into public.leads (
				organization_id, assigned_user_id, property_id,
				interest_property_id, name, source, deal_status,
				valor_interesse, commission_percentage, metadata
			)
			values (
				$1::uuid, $2::uuid, $3::uuid, $3::uuid,
				$4, 'manual', 'open', 750000, 5,
				jsonb_build_object('property_snapshot_test', $5::text)
			)
			returning id::text
		`, organizationID, originalUserID, propertyID, name, marker).Scan(&leadID); err != nil {
			t.Fatalf("create snapshot lead fixture %q: %v", name, err)
		}
		leadIDs = append(leadIDs, leadID)
	}
	winningLeadID := leadIDs[0]
	affectedLeadID := leadIDs[1]

	tx, err := database.Pool().Begin(ctx)
	if err != nil {
		t.Fatalf("begin reservation snapshot transaction: %v", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		update public.leads
		set deal_status = 'won',
		    won_at = now(),
		    lost_at = null,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, organizationID, winningLeadID); err != nil {
		t.Fatalf("mark snapshot winner: %v", err)
	}

	repository := NewRepository(database, nil)
	won := "won"
	eventID, err := repository.reserveWonLeadProperty(
		ctx,
		tx,
		tenant.Context{
			OrganizationID: organizationID,
			UserID:         originalUserID,
			IsSuperAdmin:   true,
		},
		leadSnapshot{
			ID:                 winningLeadID,
			Name:               marker + "-winner",
			DealStatus:         "open",
			InterestPropertyID: propertyID,
		},
		updateInput{DealStatus: patchString{Set: true, Value: &won}},
		nil,
	)
	if err != nil {
		t.Fatalf("reserve property with audience snapshot: %v", err)
	}
	if eventID == "" {
		t.Fatal("reservation audience snapshot did not enqueue an event")
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit reservation audience snapshot: %v", err)
	}

	if _, err := setup.Exec(ctx, `
		update public.leads
		set deal_status = 'lost',
		    assigned_user_id = $3::uuid,
		    property_id = null,
		    interest_property_id = null,
		    won_at = null,
		    lost_at = now(),
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, organizationID, affectedLeadID, reassignedUserID); err != nil {
		t.Fatalf("mutate snapshotted target before recovery: %v", err)
	}

	processed, err := repository.processPropertyReservationNotificationJob(ctx, eventID)
	if err != nil {
		t.Fatalf("recover snapshotted reservation audience: %v", err)
	}
	if !processed {
		t.Fatal("pending snapshotted reservation audience was not recovered")
	}

	var currentStatus, currentAssignedUserID string
	var currentPropertyMissing bool
	var eventStatus, audienceResolution, snapshottedUserID string
	var targetCount, deliveredCount int
	var originalRecipientNotifications, reassignedRecipientNotifications, activities int
	if err := setup.QueryRow(ctx, `
		select
			lead.deal_status,
			lead.assigned_user_id::text,
			lead.property_id is null and lead.interest_property_id is null,
			event.status,
			coalesce(event.payload->>'audience_resolution', ''),
			coalesce(event.payload->'targets'->0->>'user_id', ''),
			coalesce((event.payload->>'target_count')::int, -1),
			coalesce((event.payload->>'delivered_count')::int, -1),
			(
				select count(*)
				from public.notifications notification
				where notification.organization_id = $1::uuid
				  and notification.lead_id = $2::uuid
				  and notification.user_id = $4::uuid
				  and notification.metadata->>'event_key' = 'interest_property_reserved'
			),
			(
				select count(*)
				from public.notifications notification
				where notification.organization_id = $1::uuid
				  and notification.lead_id = $2::uuid
				  and notification.user_id = $5::uuid
				  and notification.metadata->>'event_key' = 'interest_property_reserved'
			),
			(
				select count(*)
				from public.activities activity
				where activity.organization_id = $1::uuid
				  and activity.lead_id = $2::uuid
				  and activity.type = 'property_interest_reserved'
			)
		from public.leads lead
		join public.events event on event.id = $3::uuid
		where lead.organization_id = $1::uuid
		  and lead.id = $2::uuid
	`, organizationID, affectedLeadID, eventID, originalUserID, reassignedUserID).Scan(
		&currentStatus,
		&currentAssignedUserID,
		&currentPropertyMissing,
		&eventStatus,
		&audienceResolution,
		&snapshottedUserID,
		&targetCount,
		&deliveredCount,
		&originalRecipientNotifications,
		&reassignedRecipientNotifications,
		&activities,
	); err != nil {
		t.Fatalf("inspect recovered audience snapshot: %v", err)
	}
	if currentStatus != "lost" ||
		currentAssignedUserID != reassignedUserID ||
		!currentPropertyMissing ||
		eventStatus != "processed" ||
		audienceResolution != "reservation_time" ||
		snapshottedUserID != originalUserID ||
		targetCount != 1 ||
		deliveredCount != 1 ||
		originalRecipientNotifications != 1 ||
		reassignedRecipientNotifications != 0 ||
		activities != 1 {
		t.Fatalf(
			"recovered audience snapshot = current:%s/%s/no-property:%t event:%s/%s snapshot-user:%s targets:%d delivered:%d notifications:%d/%d activities:%d",
			currentStatus,
			currentAssignedUserID,
			currentPropertyMissing,
			eventStatus,
			audienceResolution,
			snapshottedUserID,
			targetCount,
			deliveredCount,
			originalRecipientNotifications,
			reassignedRecipientNotifications,
			activities,
		)
	}

	replayed, err := repository.processPropertyReservationNotificationJob(ctx, eventID)
	if err != nil {
		t.Fatalf("replay recovered audience snapshot: %v", err)
	}
	if replayed {
		t.Fatal("recovered audience snapshot replayed its fan-out")
	}
	var notificationCount, activityCount int
	if err := setup.QueryRow(ctx, `
		select
			(select count(*) from public.notifications
			 where organization_id = $1::uuid
			   and lead_id = $2::uuid
			   and metadata->>'event_key' = 'interest_property_reserved'),
			(select count(*) from public.activities
			 where organization_id = $1::uuid
			   and lead_id = $2::uuid
			   and type = 'property_interest_reserved')
	`, organizationID, affectedLeadID).Scan(&notificationCount, &activityCount); err != nil {
		t.Fatalf("inspect replayed audience snapshot: %v", err)
	}
	if notificationCount != 1 || activityCount != 1 {
		t.Fatalf("replayed audience snapshot counts = %d notifications/%d activities, want 1/1", notificationCount, activityCount)
	}
}

func assertPropertyReservationFanoutCounts(
	t *testing.T,
	ctx context.Context,
	conn *pgx.Conn,
	organizationID string,
	propertyID string,
	winningLeadID string,
	expected int,
) {
	t.Helper()

	var notifications, uniqueDedupeKeys, pushRequired, activities int
	if err := conn.QueryRow(ctx, `
		select
			(
				select count(*)
				from public.notifications
				where organization_id = $1::uuid
				  and metadata->>'event_key' = 'interest_property_reserved'
				  and metadata->>'property_id' = $2
				  and metadata->>'reserved_by_lead_id' = $3
			),
			(
				select count(distinct metadata->>'dedupe_key')
				from public.notifications
				where organization_id = $1::uuid
				  and metadata->>'event_key' = 'interest_property_reserved'
				  and metadata->>'property_id' = $2
				  and metadata->>'reserved_by_lead_id' = $3
			),
			(
				select count(*)
				from public.notifications
				where organization_id = $1::uuid
				  and metadata->>'event_key' = 'interest_property_reserved'
				  and metadata->>'property_id' = $2
				  and metadata->>'reserved_by_lead_id' = $3
				  and lower(coalesce(metadata->'dispatch'->'push'->>'required', 'false')) = 'true'
			),
			(
				select count(*)
				from public.activities
				where organization_id = $1::uuid
				  and type = 'property_interest_reserved'
				  and metadata->>'property_id' = $2
				  and metadata->>'reserved_by_lead_id' = $3
			)
	`, organizationID, propertyID, winningLeadID).Scan(
		&notifications,
		&uniqueDedupeKeys,
		&pushRequired,
		&activities,
	); err != nil {
		t.Fatalf("inspect reservation fan-out: %v", err)
	}
	if notifications != expected ||
		uniqueDedupeKeys != expected ||
		pushRequired != expected ||
		activities != expected {
		t.Fatalf(
			"reservation fan-out = notifications:%d dedupe:%d push:%d activities:%d, want %d each",
			notifications,
			uniqueDedupeKeys,
			pushRequired,
			activities,
			expected,
		)
	}
}

func cleanupPropertyContentionFixture(
	conn *pgx.Conn,
	organizationID string,
	propertyID string,
	leadIDs []string,
	marker string,
) {
	time.Sleep(300 * time.Millisecond)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _ = conn.Exec(ctx, `
		delete from realtime.messages
		where payload->>'auditId' in (
			select id::text from public.audit_logs
			where organization_id = $1::uuid and entity_id = any($2::text[])
		)
	`, organizationID, leadIDs)
	_, _ = conn.Exec(ctx, `
		delete from public.audit_logs
		where organization_id = $1::uuid and entity_id = any($2::text[])
	`, organizationID, leadIDs)
	_, _ = conn.Exec(ctx, `
		delete from public.events
		where organization_id = $1::uuid
		  and (entity_id = $3::uuid or payload->>'lead_id' = any($2::text[]))
	`, organizationID, leadIDs, propertyID)
	_, _ = conn.Exec(ctx, `
		delete from public.push_delivery_events
		where organization_id = $1::uuid
		  and notification_id in (
		    select id
		    from public.notifications
		    where organization_id = $1::uuid
		      and (
		        lead_id = any($2::uuid[])
		        or metadata->>'property_id' = $3
		      )
		  )
	`, organizationID, leadIDs, propertyID)
	_, _ = conn.Exec(ctx, `
		delete from public.notifications
		where organization_id = $1::uuid
		  and (
		    lead_id = any($2::uuid[])
		    or metadata->>'property_id' = $3
		  )
	`, organizationID, leadIDs, propertyID)
	_, _ = conn.Exec(ctx, `
		delete from public.activities
		where organization_id = $1::uuid
		  and (
		    lead_id = any($2::uuid[])
		    or metadata->>'property_id' = $3
		  )
	`, organizationID, leadIDs, propertyID)
	_, _ = conn.Exec(ctx, `
		delete from public.commissions
		where organization_id = $1::uuid and lead_id = any($2::uuid[])
	`, organizationID, leadIDs)
	_, _ = conn.Exec(ctx, `
		delete from public.financial_entries
		where organization_id = $1::uuid and lead_id = any($2::uuid[])
	`, organizationID, leadIDs)
	_, _ = conn.Exec(ctx, `
		delete from public.leads
		where organization_id = $1::uuid and id = any($2::uuid[])
	`, organizationID, leadIDs)
	_, _ = conn.Exec(ctx, `
		delete from public.properties
		where organization_id = $1::uuid and id = $2::uuid and code = $3
	`, organizationID, propertyID, marker)
}
