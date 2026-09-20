package teams

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// CRM_SAVE_FLOW_TEST_DATABASE_URL must point to a disposable loopback database
// with the complete migration chain applied.
func TestTeamCreateUpdateRepeatSaveAndReload(t *testing.T) {
	databaseURL := localSaveFlowDatabaseURL(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:           databaseURL,
		MaxConns:      4,
		HealthTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("connect local PostgreSQL: %v", err)
	}
	t.Cleanup(postgres.Close)
	pool := postgres.Pool()

	var organizationID, userID string
	if err := pool.QueryRow(ctx, `
		insert into public.organizations (name, slug, is_active)
		values ('Team save flow contract', 'team-save-flow-' || gen_random_uuid()::text, true)
		returning id::text
	`).Scan(&organizationID); err != nil {
		t.Fatalf("insert organization: %v", err)
	}
	if err := pool.QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&userID); err != nil {
		t.Fatalf("generate user id: %v", err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		if _, err := pool.Exec(cleanupCtx, `
			update public.users set organization_id = null where id = $1::uuid;
			delete from public.organization_members where user_id = $1::uuid;
			delete from public.organizations where id = $2::uuid;
			delete from public.users where id = $1::uuid;
			delete from auth.users where id = $1::uuid
		`, userID, organizationID); err != nil {
			t.Errorf("cleanup team save-flow fixture: %v", err)
		}
	})

	email := fmt.Sprintf("team-save-flow-%s@example.test", strings.ReplaceAll(userID, "-", ""))
	if _, err := pool.Exec(ctx, `
		insert into auth.users (
			id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		) values (
			$1::uuid, 'authenticated', 'authenticated', $2, '', now(),
			'{}'::jsonb, '{}'::jsonb, now(), now()
		);
		insert into public.users (
			id, organization_id, name, email, role, is_active
		) values ($1::uuid, $3::uuid, 'Team save-flow member', $2, 'admin', true)
		on conflict (id) do update
		set organization_id = excluded.organization_id,
		    name = excluded.name,
		    email = excluded.email,
		    role = excluded.role,
		    is_active = excluded.is_active;
		insert into public.organization_members (
			organization_id, user_id, role, is_active
		) values ($3::uuid, $1::uuid, 'admin', true)
		on conflict (user_id, organization_id) do update
		set role = excluded.role,
		    is_active = excluded.is_active,
		    deleted_at = null
	`, userID, email, organizationID); err != nil {
		t.Fatalf("insert team save-flow user: %v", err)
	}

	admin := tenant.Context{
		OrganizationID: organizationID,
		UserID:         userID,
		MemberRole:     "admin",
	}
	repo := NewRepository(postgres, StorageConfig{})
	createWeek := integrationAvailabilityWeek("22:00", "08:00")
	created, err := repo.Create(ctx, admin, CreateTeamRequest{
		Name: "Equipe noturna",
		Members: []TeamMemberInput{{
			UserID:       userID,
			IsLeader:     true,
			Availability: createWeek,
		}},
	})
	if err != nil {
		t.Fatalf("create team: %v", err)
	}
	if created.ID == "" || len(created.Members) != 1 {
		t.Fatalf("created team shape = id %q, members %d", created.ID, len(created.Members))
	}
	memberID := created.Members[0].ID
	assertIntegrationOvernightAvailability(t, ctx, repo, admin, memberID, "22:00:00", "08:00:00")

	updatedName := "Equipe noturna editada"
	updateWeek := integrationAvailabilityWeek("23:00", "07:00")
	updateRequest := UpdateTeamRequest{
		Name: &updatedName,
		Members: []TeamMemberInput{{
			UserID:       userID,
			IsLeader:     true,
			Availability: updateWeek,
		}},
	}
	updated, err := repo.Update(ctx, admin, created.ID, updateRequest)
	if err != nil {
		t.Fatalf("update team: %v", err)
	}
	if updated.ID != created.ID || updated.Name != updatedName || len(updated.Members) != 1 || updated.Members[0].ID != memberID {
		t.Fatalf("unexpected updated team identity: %#v", updated)
	}

	repeated, err := repo.Update(ctx, admin, created.ID, updateRequest)
	if err != nil {
		t.Fatalf("repeat identical team save: %v", err)
	}
	if repeated.ID != created.ID || len(repeated.Members) != 1 || repeated.Members[0].ID != memberID {
		t.Fatalf("repeat save changed team/member identity: %#v", repeated)
	}

	reloaded, err := repo.Get(ctx, admin, created.ID)
	if err != nil {
		t.Fatalf("reload team: %v", err)
	}
	if reloaded.Name != updatedName || len(reloaded.Members) != 1 || reloaded.Members[0].ID != memberID {
		t.Fatalf("unexpected reloaded team: %#v", reloaded)
	}
	assertIntegrationOvernightAvailability(t, ctx, repo, admin, memberID, "23:00:00", "07:00:00")

	var memberCount, availabilityCount int
	if err := pool.QueryRow(ctx, `
		select
			(select count(*) from public.team_members where organization_id = $1::uuid and team_id = $2::uuid),
			(select count(*) from public.member_availability where organization_id = $1::uuid and team_member_id = $3::uuid)
	`, organizationID, created.ID, memberID).Scan(&memberCount, &availabilityCount); err != nil {
		t.Fatalf("count persisted team rows: %v", err)
	}
	if memberCount != 1 || availabilityCount != 7 {
		t.Fatalf("persisted row counts = members %d, availability %d; want 1 and 7", memberCount, availabilityCount)
	}
}

func localSaveFlowDatabaseURL(t *testing.T) string {
	t.Helper()
	databaseURL := strings.TrimSpace(os.Getenv("CRM_SAVE_FLOW_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set CRM_SAVE_FLOW_TEST_DATABASE_URL to run local save-flow integration contracts")
	}
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse CRM_SAVE_FLOW_TEST_DATABASE_URL: %v", err)
	}
	switch strings.ToLower(target.Hostname()) {
	case "127.0.0.1", "localhost", "::1":
	default:
		t.Fatalf("CRM_SAVE_FLOW_TEST_DATABASE_URL must use a loopback host, got %q", target.Hostname())
	}
	return databaseURL
}

func integrationAvailabilityWeek(overnightStart string, overnightEnd string) []AvailabilityRequest {
	week := make([]AvailabilityRequest, 0, 7)
	for day := 0; day < 7; day++ {
		start, end := "08:00", "18:00"
		if day == 1 {
			start, end = overnightStart, overnightEnd
		}
		active := true
		allDay := false
		week = append(week, AvailabilityRequest{
			DayOfWeek: day,
			StartTime: &start,
			EndTime:   &end,
			IsAllDay:  &allDay,
			IsActive:  &active,
		})
	}
	return week
}

func assertIntegrationOvernightAvailability(
	t *testing.T,
	ctx context.Context,
	repo Repository,
	tenantContext tenant.Context,
	memberID string,
	wantStart string,
	wantEnd string,
) {
	t.Helper()
	availability, err := repo.ListAvailability(ctx, tenantContext, []string{memberID})
	if err != nil {
		t.Fatalf("list member availability: %v", err)
	}
	if len(availability) != 7 {
		t.Fatalf("availability rows = %d, want 7", len(availability))
	}
	for _, entry := range availability {
		if entry.DayOfWeek != 1 {
			continue
		}
		if entry.StartTime == nil || entry.EndTime == nil || *entry.StartTime != wantStart || *entry.EndTime != wantEnd {
			t.Fatalf("overnight availability = %v-%v, want %s-%s", entry.StartTime, entry.EndTime, wantStart, wantEnd)
		}
		return
	}
	t.Fatal("overnight Monday availability not found")
}
