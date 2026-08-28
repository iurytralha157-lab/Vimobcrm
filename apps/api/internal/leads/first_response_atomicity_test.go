package leads

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type firstResponseLeadLockTx struct {
	pgx.Tx
	query string
}

func (tx *firstResponseLeadLockTx) QueryRow(_ context.Context, query string, _ ...any) pgx.Row {
	tx.query = query
	return firstResponseLeadLockRow{}
}

type firstResponseLeadLockRow struct{}

func (firstResponseLeadLockRow) Scan(...any) error {
	return pgx.ErrNoRows
}

func TestFirstResponseLeadLookupUsesNoKeyUpdateLock(t *testing.T) {
	tx := &firstResponseLeadLockTx{}

	_, _, _, err := (Repository{}).getFirstResponseLeadForUpdate(
		context.Background(),
		tx,
		"11111111-1111-4111-8111-111111111111",
		"22222222-2222-4222-8222-222222222222",
	)
	if !errors.Is(err, ErrLeadNotFound) {
		t.Fatalf("get first-response lead error = %v, want ErrLeadNotFound", err)
	}

	query := strings.ToLower(strings.Join(strings.Fields(tx.query), " "))
	if !strings.Contains(query, "for no key update of l") {
		t.Fatalf("first-response lookup must lock the lead with FOR NO KEY UPDATE OF l: %s", query)
	}
	if strings.Contains(query, "for update of l") {
		t.Fatalf("first-response lookup must not take the FK-blocking FOR UPDATE lock: %s", query)
	}
}

func TestRecordFirstResponseIsAtomicAgainstConcurrentCalls(t *testing.T) {
	if os.Getenv("VIMOB_RUN_FIRST_RESPONSE_ATOMICITY_TEST") != "LOCAL_WRITE_TEST" {
		t.Skip("set VIMOB_RUN_FIRST_RESPONSE_ATOMICITY_TEST=LOCAL_WRITE_TEST for the local Postgres regression")
	}

	connectionString := os.Getenv("VIMOB_FIRST_RESPONSE_DATABASE_URL")
	target, err := url.Parse(connectionString)
	if err != nil ||
		(target.Hostname() != "127.0.0.1" && target.Hostname() != "localhost") ||
		target.User.Username() != "postgres" ||
		target.Path != "/postgres" {
		t.Fatal("first-response atomicity test requires the local postgres database")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
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
	var actorUserID string
	if err := setup.QueryRow(ctx, `
		select om.user_id::text
		from public.organization_members om
		join public.users u on u.id = om.user_id
		where om.organization_id = $1::uuid
		  and coalesce(om.is_active, false) = true
		  and coalesce(u.is_active, false) = true
		order by
		  case when lower(coalesce(om.role, '')) = 'admin' then 0 else 1 end,
		  om.created_at,
		  om.user_id
		limit 1
	`, organizationID).Scan(&actorUserID); err != nil {
		t.Fatalf("resolve local E2E actor: %v", err)
	}

	marker := fmt.Sprintf("FIRST-RESPONSE-ATOMIC-%d", time.Now().UnixNano())
	var leadID string
	if err := setup.QueryRow(ctx, `
		insert into public.leads (
			organization_id,
			assigned_user_id,
			name,
			source,
			deal_status,
			assigned_at,
			created_at,
			metadata
		)
		values (
			$1::uuid,
			$2::uuid,
			$3,
			'manual',
			'open',
			now() - interval '5 minutes',
			now() - interval '5 minutes',
			jsonb_build_object('first_response_atomicity_test', $3::text)
		)
		returning id::text
	`, organizationID, actorUserID, marker).Scan(&leadID); err != nil {
		t.Fatalf("create lead fixture: %v", err)
	}
	defer cleanupFirstResponseFixture(setup, organizationID, leadID)

	repository := NewRepository(database, nil)
	input := recordFirstResponseInput{
		LeadID:      leadID,
		Channel:     "manual",
		ActorUserID: actorUserID,
	}

	deniedContext := tenant.Context{
		OrganizationID: organizationID,
		UserID:         "00000000-0000-4000-8000-000000000001",
	}
	if _, err := repository.RecordFirstResponse(ctx, deniedContext, input); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("denied first response error = %v, want organization access denied", err)
	}

	var changedBeforeRace bool
	var timelineBeforeRace int
	if err := setup.QueryRow(ctx, `
		select
			first_response_at is not null,
			(
				select count(*)::integer
				from public.lead_timeline_events event
				where event.organization_id = lead.organization_id
				  and event.lead_id = lead.id
				  and event.event_type = 'first_response'
			)
		from public.leads lead
		where lead.organization_id = $1::uuid
		  and lead.id = $2::uuid
	`, organizationID, leadID).Scan(&changedBeforeRace, &timelineBeforeRace); err != nil {
		t.Fatalf("inspect denied mutation: %v", err)
	}
	if changedBeforeRace || timelineBeforeRace != 0 {
		t.Fatalf("denied mutation changed lead=%t timeline=%d", changedBeforeRace, timelineBeforeRace)
	}

	authorizedContext := tenant.Context{
		OrganizationID: organizationID,
		UserID:         actorUserID,
		MemberRole:     "admin",
	}
	const contenderCount = 32
	type contenderResult struct {
		payload map[string]any
		err     error
	}
	start := make(chan struct{})
	results := make(chan contenderResult, contenderCount)
	for index := 0; index < contenderCount; index++ {
		go func() {
			<-start
			payload, err := repository.RecordFirstResponse(ctx, authorizedContext, input)
			results <- contenderResult{payload: payload, err: err}
		}()
	}
	close(start)

	recordedCount := 0
	skippedCount := 0
	for index := 0; index < contenderCount; index++ {
		result := <-results
		if result.err != nil {
			t.Fatalf("concurrent first response %d: %v", index, result.err)
		}
		if recorded, _ := result.payload["recorded"].(bool); recorded {
			recordedCount++
			continue
		}
		if skipped, _ := result.payload["skipped"].(bool); skipped {
			skippedCount++
			continue
		}
		t.Fatalf("concurrent first response %d returned unexpected payload %#v", index, result.payload)
	}
	if recordedCount != 1 || skippedCount != contenderCount-1 {
		t.Fatalf(
			"concurrent results recorded=%d skipped=%d, want recorded=1 skipped=%d",
			recordedCount,
			skippedCount,
			contenderCount-1,
		)
	}

	var (
		firstResponseRecorded bool
		channel               string
		isAutomation          bool
		persistedActorUserID  string
		responseSeconds       int
		timelineCount         int
	)
	if err := setup.QueryRow(ctx, `
		select
			lead.first_response_at is not null,
			coalesce(lead.first_response_channel, ''),
			coalesce(lead.first_response_is_automation, false),
			coalesce(lead.first_response_actor_user_id::text, ''),
			coalesce(lead.first_response_seconds, -1),
			(
				select count(*)::integer
				from public.lead_timeline_events event
				where event.organization_id = lead.organization_id
				  and event.lead_id = lead.id
				  and event.event_type = 'first_response'
			)
		from public.leads lead
		where lead.organization_id = $1::uuid
		  and lead.id = $2::uuid
	`, organizationID, leadID).Scan(
		&firstResponseRecorded,
		&channel,
		&isAutomation,
		&persistedActorUserID,
		&responseSeconds,
		&timelineCount,
	); err != nil {
		t.Fatalf("inspect persisted first response: %v", err)
	}
	if !firstResponseRecorded {
		t.Fatal("first response was not persisted")
	}
	if channel != input.Channel || isAutomation || persistedActorUserID != actorUserID {
		t.Fatalf(
			"persisted first response channel=%q automated=%t actor=%q",
			channel,
			isAutomation,
			persistedActorUserID,
		)
	}
	if responseSeconds < 0 {
		t.Fatalf("persisted response seconds = %d, want non-negative", responseSeconds)
	}
	if timelineCount != 1 {
		t.Fatalf("first-response timeline count = %d, want 1", timelineCount)
	}
}

func cleanupFirstResponseFixture(connection *pgx.Conn, organizationID string, leadID string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _ = connection.Exec(ctx, `
		delete from public.lead_timeline_events
		where organization_id = $1::uuid
		  and lead_id = $2::uuid
	`, organizationID, leadID)
	_, _ = connection.Exec(ctx, `
		delete from public.leads
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, organizationID, leadID)
}
