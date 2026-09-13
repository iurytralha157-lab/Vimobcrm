package schedule

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
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/propertyscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestSchedulePropertyScopeAgainstLocalPostgresRollback(t *testing.T) {
	if os.Getenv("VIMOB_RUN_DB_TESTS") != "1" {
		t.Skip("set VIMOB_RUN_DB_TESTS=1 to run database integration tests")
	}
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if databaseURL == "" {
		t.Fatal("DATABASE_URL is required")
	}
	parsedURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse DATABASE_URL: %v", err)
	}
	switch strings.ToLower(parsedURL.Hostname()) {
	case "localhost", "127.0.0.1", "::1":
	default:
		t.Fatalf("schedule property-scope integration requires loopback PostgreSQL, got %q", parsedURL.Hostname())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL: databaseURL, MaxConns: 2, MinConns: 0, HealthTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("connect local PostgreSQL: %v", err)
	}
	t.Cleanup(postgres.Close)

	tx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatalf("begin schedule property-scope rollback fixture: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	organizationID := insertScheduleScopeOrganization(t, ctx, tx, "Schedule property scope "+suffix)
	otherOrganizationID := insertScheduleScopeOrganization(t, ctx, tx, "Schedule property scope other "+suffix)
	actorID := insertScheduleScopeUser(t, ctx, tx, organizationID, "schedule-actor-"+suffix)
	teammateID := insertScheduleScopeUser(t, ctx, tx, organizationID, "schedule-teammate-"+suffix)
	outsiderID := insertScheduleScopeUser(t, ctx, tx, organizationID, "schedule-outsider-"+suffix)
	neutralID := insertScheduleScopeUser(t, ctx, tx, organizationID, "schedule-neutral-"+suffix)
	otherUserID := insertScheduleScopeUser(t, ctx, tx, otherOrganizationID, "schedule-other-"+suffix)

	var teamID string
	if err := tx.QueryRow(ctx, `
		insert into public.teams (organization_id, name, is_active)
		values ($1::uuid, $2, true)
		returning id::text
	`, organizationID, "Schedule property scope team "+suffix).Scan(&teamID); err != nil {
		t.Fatalf("insert team fixture: %v", err)
	}
	if _, err := tx.Exec(ctx, `
		insert into public.team_members (organization_id, team_id, user_id, is_leader, is_active)
		values
			($1::uuid, $2::uuid, $3::uuid, true, true),
			($1::uuid, $2::uuid, $4::uuid, false, true)
	`, organizationID, teamID, actorID, teammateID); err != nil {
		t.Fatalf("insert team membership fixtures: %v", err)
	}

	ownPropertyID := insertScheduleScopeProperty(t, ctx, tx, organizationID, "SCH-OWN-"+suffix, actorID, neutralID)
	teamPropertyID := insertScheduleScopeProperty(t, ctx, tx, organizationID, "SCH-TEAM-"+suffix, teammateID, neutralID)
	outsiderPropertyID := insertScheduleScopeProperty(t, ctx, tx, organizationID, "SCH-OUT-"+suffix, outsiderID, neutralID)
	otherPropertyID := insertScheduleScopeProperty(t, ctx, tx, otherOrganizationID, "SCH-OTHER-"+suffix, otherUserID, otherUserID)

	insertScheduleScopeEvent(t, ctx, tx, organizationID, actorID, ownPropertyID, "event-own")
	insertScheduleScopeEvent(t, ctx, tx, organizationID, actorID, teamPropertyID, "event-team")
	insertScheduleScopeEvent(t, ctx, tx, organizationID, actorID, outsiderPropertyID, "event-outsider")

	ownViewer := tenant.Context{
		OrganizationID: organizationID,
		UserID:         actorID,
		MemberRole:     "user",
		Permissions:    []string{permissions.ScheduleView, permissions.PropertyView},
	}
	teamLeader := ownViewer
	teamLeader.IsTeamLeader = true
	outsiderViewer := tenant.Context{
		OrganizationID: organizationID,
		UserID:         outsiderID,
		MemberRole:     "user",
		Permissions:    []string{permissions.ScheduleView, permissions.PropertyView},
	}
	manager := tenant.Context{
		OrganizationID: organizationID,
		UserID:         actorID,
		MemberRole:     "user",
		Permissions:    []string{permissions.ScheduleView, permissions.PropertyManage},
	}

	assertSchedulePropertyValidation(t, ctx, tx, ownViewer, ownPropertyID, true)
	assertSchedulePropertyValidation(t, ctx, tx, ownViewer, teamPropertyID, false)
	assertSchedulePropertyValidation(t, ctx, tx, ownViewer, outsiderPropertyID, false)
	assertSchedulePropertyValidation(t, ctx, tx, ownViewer, otherPropertyID, false)
	assertSchedulePropertyValidation(t, ctx, tx, teamLeader, teamPropertyID, true)
	assertSchedulePropertyValidation(t, ctx, tx, outsiderViewer, outsiderPropertyID, true)
	assertSchedulePropertyValidation(t, ctx, tx, manager, ownPropertyID, true)
	assertSchedulePropertyValidation(t, ctx, tx, manager, teamPropertyID, true)
	assertSchedulePropertyValidation(t, ctx, tx, manager, outsiderPropertyID, true)
	assertSchedulePropertyValidation(t, ctx, tx, manager, otherPropertyID, false)

	assertSchedulePropertyProjection(t, ctx, tx, ownViewer, map[string]bool{
		"event-own": true, "event-team": false, "event-outsider": false,
	})
	assertSchedulePropertyProjection(t, ctx, tx, teamLeader, map[string]bool{
		"event-own": true, "event-team": true, "event-outsider": false,
	})
	assertSchedulePropertyProjection(t, ctx, tx, outsiderViewer, map[string]bool{
		"event-own": false, "event-team": false, "event-outsider": true,
	})
	assertSchedulePropertyProjection(t, ctx, tx, manager, map[string]bool{
		"event-own": true, "event-team": true, "event-outsider": true,
	})
	withoutPropertyAccess := tenant.Context{
		OrganizationID: organizationID,
		UserID:         actorID,
		MemberRole:     "user",
		Permissions:    []string{permissions.ScheduleView},
	}
	assertSchedulePropertyProjection(t, ctx, tx, withoutPropertyAccess, map[string]bool{
		"event-own": false, "event-team": false, "event-outsider": false,
	})

	if err := tx.Rollback(ctx); err != nil {
		t.Fatalf("rollback schedule property-scope fixture: %v", err)
	}
	var fixtureExists bool
	if err := postgres.Pool().QueryRow(ctx, `
		select exists (select 1 from public.organizations where id = $1::uuid)
	`, organizationID).Scan(&fixtureExists); err != nil {
		t.Fatalf("verify schedule property-scope rollback: %v", err)
	}
	if fixtureExists {
		t.Fatal("schedule property-scope fixture survived rollback")
	}
}

func assertSchedulePropertyValidation(t *testing.T, ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, propertyID string, wantVisible bool) {
	t.Helper()
	err := (Repository{}).validateProperty(ctx, tx, tenantContext, &propertyID)
	if wantVisible && err != nil {
		t.Fatalf("visible property %s validation returned error: %v", propertyID, err)
	}
	if !wantVisible && !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("hidden property %s validation error = %v, want ErrInvalidReference", propertyID, err)
	}
}

func assertSchedulePropertyProjection(t *testing.T, ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, visibility map[string]bool) {
	t.Helper()
	rows, err := tx.Query(ctx, `
		select se.title, p.id::text, p.title, p.code
		from public.schedule_events se
		`+schedulePropertyJoinSQL("se", "p", "$2", "$3", "$4", "$5")+`
		where se.organization_id = $1::uuid
		order by se.title
	`,
		tenantContext.OrganizationID,
		canViewProperties(tenantContext),
		propertyscope.CanViewAll(tenantContext),
		tenantContext.UserID,
		propertyscope.CanViewTeam(tenantContext),
	)
	if err != nil {
		t.Fatalf("query schedule property projection: %v", err)
	}
	defer rows.Close()

	seen := map[string]bool{}
	for rows.Next() {
		var eventTitle string
		var propertyID, propertyTitle, propertyCode pgtype.Text
		if err := rows.Scan(&eventTitle, &propertyID, &propertyTitle, &propertyCode); err != nil {
			t.Fatalf("scan schedule property projection: %v", err)
		}
		wantVisible, belongsToFixture := visibility[eventTitle]
		if !belongsToFixture {
			continue
		}
		seen[eventTitle] = true
		if wantVisible {
			if !propertyID.Valid || !propertyTitle.Valid || !propertyCode.Valid {
				t.Fatalf("visible property projection %q was incomplete: id=%#v title=%#v code=%#v", eventTitle, propertyID, propertyTitle, propertyCode)
			}
			continue
		}
		if propertyID.Valid || propertyTitle.Valid || propertyCode.Valid {
			t.Fatalf("hidden property projection %q leaked id/title/code: id=%#v title=%#v code=%#v", eventTitle, propertyID, propertyTitle, propertyCode)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate schedule property projection: %v", err)
	}
	for eventTitle := range visibility {
		if !seen[eventTitle] {
			t.Fatalf("schedule fixture event %q was not returned", eventTitle)
		}
	}
}

func insertScheduleScopeOrganization(t *testing.T, ctx context.Context, tx pgx.Tx, name string) string {
	t.Helper()
	var id string
	if err := tx.QueryRow(ctx, `
		insert into public.organizations (name, is_active)
		values ($1, true)
		returning id::text
	`, name).Scan(&id); err != nil {
		t.Fatalf("insert organization fixture: %v", err)
	}
	return id
}

func insertScheduleScopeUser(t *testing.T, ctx context.Context, tx pgx.Tx, organizationID string, label string) string {
	t.Helper()
	var id string
	if err := tx.QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&id); err != nil {
		t.Fatalf("generate user fixture id: %v", err)
	}
	email := label + "@example.test"
	if _, err := tx.Exec(ctx, `
		insert into auth.users (
			id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		)
		values (
			$1::uuid, 'authenticated', 'authenticated', $2, '', now(),
			'{}'::jsonb, '{}'::jsonb, now(), now()
		)
	`, id, email); err != nil {
		t.Fatalf("insert auth user fixture: %v", err)
	}
	commandTag, err := tx.Exec(ctx, `
		update public.users
		set email = $2, name = $3, organization_id = $4::uuid, role = 'user', is_active = true
		where id = $1::uuid
	`, id, email, label, organizationID)
	if err != nil {
		t.Fatalf("update auth-created user fixture: %v", err)
	}
	if commandTag.RowsAffected() != 1 {
		t.Fatalf("update auth-created user fixture affected %d rows, want 1", commandTag.RowsAffected())
	}
	if _, err := tx.Exec(ctx, `
		insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($1::uuid, $2::uuid, 'user', true)
		on conflict (user_id, organization_id) do update
		set role = excluded.role, is_active = excluded.is_active
	`, organizationID, id); err != nil {
		t.Fatalf("insert organization membership fixture: %v", err)
	}
	return id
}

func insertScheduleScopeProperty(t *testing.T, ctx context.Context, tx pgx.Tx, organizationID string, code string, responsibleUserID string, createdBy string) string {
	t.Helper()
	var id string
	if err := tx.QueryRow(ctx, `
		insert into public.properties (
			organization_id, code, title, tipo_de_negocio, status,
			responsible_user_id, created_by, is_demo
		)
		values ($1::uuid, $2, $2, 'venda', 'active', $3::uuid, $4::uuid, false)
		returning id::text
	`, organizationID, code, responsibleUserID, createdBy).Scan(&id); err != nil {
		t.Fatalf("insert property fixture %q: %v", code, err)
	}
	return id
}

func insertScheduleScopeEvent(t *testing.T, ctx context.Context, tx pgx.Tx, organizationID string, userID string, propertyID string, title string) {
	t.Helper()
	if _, err := tx.Exec(ctx, `
		insert into public.schedule_events (
			organization_id, user_id, property_id, title, event_type,
			start_time, end_time, is_all_day, status, visibility
		)
		values (
			$1::uuid, $2::uuid, $3::uuid, $4, 'task',
			now() + interval '1 day', now() + interval '1 day 1 hour', false, 'scheduled', 'public'
		)
	`, organizationID, userID, propertyID, title); err != nil {
		t.Fatalf("insert schedule event fixture %q: %v", title, err)
	}
}
