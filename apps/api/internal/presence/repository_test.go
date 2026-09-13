package presence

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

type repositoryTestRow struct {
	userID       string
	name         string
	avatarURL    pgtype.Text
	memberRole   string
	isTeamLeader bool
	status       string
	lastSeenAt   pgtype.Timestamptz
	idleSinceAt  pgtype.Timestamptz
}

type repositoryTestRows struct {
	items     []repositoryTestRow
	index     int
	err       error
	closed    bool
	scanError error
}

func (rows *repositoryTestRows) Close() {
	rows.closed = true
}

func (rows *repositoryTestRows) Err() error {
	return rows.err
}

func (rows *repositoryTestRows) Next() bool {
	return rows.index < len(rows.items)
}

func (rows *repositoryTestRows) Scan(dest ...any) error {
	if rows.scanError != nil {
		return rows.scanError
	}
	if len(dest) != 8 || rows.index >= len(rows.items) {
		return fmt.Errorf("unexpected scan")
	}
	item := rows.items[rows.index]
	rows.index++
	*(dest[0].(*string)) = item.userID
	*(dest[1].(*string)) = item.name
	*(dest[2].(*pgtype.Text)) = item.avatarURL
	*(dest[3].(*string)) = item.memberRole
	*(dest[4].(*bool)) = item.isTeamLeader
	*(dest[5].(*string)) = item.status
	*(dest[6].(*pgtype.Timestamptz)) = item.lastSeenAt
	*(dest[7].(*pgtype.Timestamptz)) = item.idleSinceAt
	return nil
}

type recordingQueryer struct {
	query string
	args  []any
	rows  rowIterator
	err   error
}

func (queryer *recordingQueryer) Query(_ context.Context, query string, args ...any) (rowIterator, error) {
	queryer.query = query
	queryer.args = append([]any(nil), args...)
	return queryer.rows, queryer.err
}

func TestRepositoryListsMinimalPresenceRowsForOrganization(t *testing.T) {
	lastSeen := time.Date(2026, time.September, 2, 14, 0, 1, 123000000, time.UTC)
	idleSince := lastSeen.Add(-5 * time.Minute)
	rows := &repositoryTestRows{items: []repositoryTestRow{
		{
			userID:       "e64b6d6d-ff1a-49fb-b68f-34aaf4826054",
			name:         "Ana",
			avatarURL:    pgtype.Text{String: "https://cdn.example.test/ana.png", Valid: true},
			memberRole:   "admin",
			isTeamLeader: true,
			status:       "idle",
			lastSeenAt:   pgtype.Timestamptz{Time: lastSeen, Valid: true},
			idleSinceAt:  pgtype.Timestamptz{Time: idleSince, Valid: true},
		},
		{
			userID:     "20e7e9b4-e22a-421b-b3a8-fc33aa4a84a8",
			name:       "Usuário",
			memberRole: "user",
			status:     "offline",
		},
	}}
	queryer := &recordingQueryer{rows: rows}
	repository := Repository{queryer: queryer}
	freshSince := lastSeen.Add(-3 * time.Minute)

	users, err := repository.List(t.Context(), ListScope{
		OrganizationID: "25415af4-ee44-4b0d-a1a6-895699450251",
	}, freshSince)
	if err != nil {
		t.Fatalf("List returned error: %v", err)
	}
	if !rows.closed {
		t.Fatal("rows were not closed")
	}
	if len(queryer.args) != 4 || queryer.args[0] != "25415af4-ee44-4b0d-a1a6-895699450251" {
		t.Fatalf("query args = %#v", queryer.args)
	}
	cutoff, ok := queryer.args[1].(time.Time)
	if !ok || !cutoff.Equal(freshSince.UTC()) {
		t.Fatalf("fresh cutoff = %#v", queryer.args[1])
	}
	if len(users) != 2 {
		t.Fatalf("users = %#v", users)
	}
	if users[0].AvatarURL == nil || *users[0].AvatarURL != "https://cdn.example.test/ana.png" {
		t.Fatalf("avatar_url = %#v", users[0].AvatarURL)
	}
	if !users[0].IsTeamLeader {
		t.Fatalf("is_team_leader = %t", users[0].IsTeamLeader)
	}
	if users[0].LastSeenAt == nil || *users[0].LastSeenAt != "2026-09-02T14:00:01.123Z" {
		t.Fatalf("last_seen_at = %#v", users[0].LastSeenAt)
	}
	if users[0].IdleSinceAt == nil || *users[0].IdleSinceAt != "2026-09-02T13:55:01.123Z" {
		t.Fatalf("idle_since_at = %#v", users[0].IdleSinceAt)
	}
	if users[1].AvatarURL != nil || users[1].LastSeenAt != nil || users[1].IdleSinceAt != nil || users[1].PresenceStatus != StatusOffline {
		t.Fatalf("offline user = %#v", users[1])
	}
}

func TestRepositoryQueryEnforcesTenantRosterAggregationAndPrivacy(t *testing.T) {
	normalized := strings.ToLower(strings.Join(strings.Fields(listUsersQuery), " "))

	for _, required := range []string{
		"with active_team_leaders as",
		"roster as",
		"fresh_activity as",
		"presence as",
		"from public.team_members member",
		"join public.teams team",
		"coalesce(member.is_leader, false) = true",
		"coalesce(team.is_active, true) = true",
		"from public.organization_members om",
		"from public.user_activity_sessions activity",
		"where om.organization_id = $1::uuid",
		"not $3::boolean or om.user_id = any($4::uuid[])",
		"not $3::boolean or activity.user_id = any($4::uuid[])",
		"coalesce(om.is_active, false) = true",
		"om.deleted_at is null",
		"coalesce(u.is_active, false) = true",
		"lower(btrim(coalesce(u.role, ''))) <> 'super_admin'",
		"nullif(btrim(u.avatar_url), '') as avatar_url",
		"team_leader.user_id is not null as is_team_leader",
		"activity.disconnected_at is null",
		"activity.last_seen_at >= $2::timestamptz",
		"activity.status in ('online', 'idle')",
		"group by activity.organization_id, activity.user_id",
		"bool_and( activity.idle_since_at is not null ) filter",
		"max(activity.idle_since_at) filter",
		"left join fresh_activity fresh",
		"fresh.user_id = roster.user_uuid",
		"left join lateral",
		"activity.user_id = roster.user_uuid",
		"order by activity.last_seen_at desc, activity.id desc limit 1",
		"latest_activity.last_seen_at",
		"fresh.idle_since_at",
		"when 'online' then 0 when 'idle' then 1 else 2",
		"last_seen_at desc nulls last",
	} {
		if !strings.Contains(normalized, required) {
			t.Fatalf("presence query is missing %q: %s", required, normalized)
		}
	}

	onlineAt := strings.Index(normalized, "activity.status = 'online'")
	idleAt := strings.Index(normalized, "activity.status = 'idle'")
	if onlineAt < 0 || idleAt < 0 || onlineAt >= idleAt {
		t.Fatalf("status precedence must be online before idle: %s", normalized)
	}

	for _, forbidden := range []string{
		"u.email",
		"left join public.user_activity_sessions activity",
		"current_path",
		"current_page_title",
		"user_agent",
		"session_id",
		"metadata",
		"select *",
	} {
		if strings.Contains(normalized, forbidden) {
			t.Fatalf("presence query includes forbidden field %q: %s", forbidden, normalized)
		}
	}
}

func TestRepositoryPassesRestrictedLeaderAllowList(t *testing.T) {
	rows := &repositoryTestRows{}
	queryer := &recordingQueryer{rows: rows}
	repository := Repository{queryer: queryer}
	userIDs := []string{
		"e9200000-0000-4000-8000-000000000010",
		"e9200000-0000-4000-8000-000000000011",
	}

	_, err := repository.List(t.Context(), ListScope{
		OrganizationID:    "e9100000-0000-4000-8000-000000000001",
		RestrictToUserIDs: true,
		UserIDs:           userIDs,
	}, time.Unix(0, 0))
	if err != nil {
		t.Fatalf("List returned error: %v", err)
	}
	if len(queryer.args) != 4 || queryer.args[2] != true {
		t.Fatalf("query args = %#v", queryer.args)
	}
	actualUserIDs, ok := queryer.args[3].([]string)
	if !ok || len(actualUserIDs) != len(userIDs) {
		t.Fatalf("visible user ids = %#v", queryer.args[3])
	}
	for index := range userIDs {
		if actualUserIDs[index] != userIDs[index] {
			t.Fatalf("visible user ids = %#v, want %#v", actualUserIDs, userIDs)
		}
	}
}

func TestRepositoryFailsClosedForEmptyRestrictedScope(t *testing.T) {
	queryer := &recordingQueryer{rows: &repositoryTestRows{}}
	repository := Repository{queryer: queryer}

	users, err := repository.List(t.Context(), ListScope{
		OrganizationID:    "e9100000-0000-4000-8000-000000000001",
		RestrictToUserIDs: true,
	}, time.Unix(0, 0))
	if err != nil {
		t.Fatalf("List returned error: %v", err)
	}
	if len(users) != 0 {
		t.Fatalf("users = %#v", users)
	}
	if queryer.query != "" {
		t.Fatalf("restricted empty scope queried the database: %s", queryer.query)
	}
}

func TestRepositoryPropagatesQueryAndRowErrors(t *testing.T) {
	databaseError := errors.New("database unavailable")
	repository := Repository{queryer: &recordingQueryer{err: databaseError}}
	if _, err := repository.List(t.Context(), ListScope{OrganizationID: "organization"}, time.Now()); !errors.Is(err, databaseError) {
		t.Fatalf("query error = %v", err)
	}

	rows := &repositoryTestRows{err: databaseError}
	repository = Repository{queryer: &recordingQueryer{rows: rows}}
	if _, err := repository.List(t.Context(), ListScope{OrganizationID: "organization"}, time.Now()); !errors.Is(err, databaseError) {
		t.Fatalf("rows error = %v", err)
	}
	if !rows.closed {
		t.Fatal("rows were not closed after terminal error")
	}
}

func TestRepositoryRejectsUnexpectedPresenceStatus(t *testing.T) {
	rows := &repositoryTestRows{items: []repositoryTestRow{{status: "away"}}}
	repository := Repository{queryer: &recordingQueryer{rows: rows}}

	if _, err := repository.List(t.Context(), ListScope{OrganizationID: "organization"}, time.Now()); err == nil || !strings.Contains(err.Error(), "unsupported presence status") {
		t.Fatalf("status error = %v", err)
	}
}
