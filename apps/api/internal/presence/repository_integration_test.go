package presence

import (
	"context"
	"net"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestRepositoryListExecutesAgainstLoopbackPostgres(t *testing.T) {
	databaseURL := requireLoopbackPresenceDatabaseURL(t)

	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:           databaseURL,
		MaxConns:      1,
		ForceReadOnly: true,
		HealthTimeout: 3 * time.Second,
	})
	if err != nil {
		t.Fatalf("connect to PostgreSQL: %v", err)
	}
	defer database.Close()

	repository := NewRepository(database)
	cutoff := time.Now().UTC().Add(-freshnessWindow)
	for name, scope := range map[string]ListScope{
		"organization": {
			OrganizationID: "e9100000-0000-4000-8000-000000000099",
		},
		"leader allow-list": {
			OrganizationID:    "e9100000-0000-4000-8000-000000000099",
			RestrictToUserIDs: true,
			UserIDs:           []string{"e9200000-0000-4000-8000-000000000099"},
		},
	} {
		t.Run(name, func(t *testing.T) {
			users, err := repository.List(ctx, scope, cutoff)
			if err != nil {
				t.Fatalf("execute presence list: %v", err)
			}
			if len(users) != 0 {
				t.Fatalf("unexpected users for isolated fixture scope: %#v", users)
			}
		})
	}
}

func TestRepositoryListAggregatesMultipleSessionsAgainstLoopbackPostgres(t *testing.T) {
	databaseURL := requireLoopbackPresenceDatabaseURL(t)
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()

	connection, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		t.Fatalf("connect to PostgreSQL: %v", err)
	}
	defer func() {
		closeContext, closeCancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer closeCancel()
		_ = connection.Close(closeContext)
	}()

	transaction, err := connection.Begin(ctx)
	if err != nil {
		t.Fatalf("begin fixture transaction: %v", err)
	}
	defer func() {
		rollbackContext, rollbackCancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer rollbackCancel()
		_ = transaction.Rollback(rollbackContext)
	}()

	if _, err := transaction.Exec(ctx, presenceAggregationFixtureSQL); err != nil {
		t.Fatalf("install presence aggregation fixtures: %v", err)
	}
	var expectedAllIdleSince time.Time
	if err := transaction.QueryRow(ctx, `
select max(idle_since_at)
from public.user_activity_sessions
where organization_id = $1::uuid
  and user_id = $2::uuid
  and status = 'idle'
`, presenceAggregationOrganizationID, presenceAggregationAllIdleUserID).Scan(&expectedAllIdleSince); err != nil {
		t.Fatalf("read expected all-idle timestamp: %v", err)
	}

	cutoff := time.Date(2026, time.September, 5, 12, 0, 0, 0, time.UTC)
	repository := Repository{queryer: transactionQueryer{transaction: transaction}}
	users, err := repository.List(ctx, ListScope{
		OrganizationID: presenceAggregationOrganizationID,
	}, cutoff)
	if err != nil {
		t.Fatalf("list fixture presence: %v", err)
	}
	if len(users) != 3 {
		t.Fatalf("fixture users = %#v", users)
	}

	usersByID := make(map[string]User, len(users))
	for _, user := range users {
		usersByID[user.UserID] = user
	}

	multipleSessions := usersByID[presenceAggregationMultiSessionUserID]
	if multipleSessions.PresenceStatus != StatusOnline {
		t.Fatalf("multiple-session status = %q, want online", multipleSessions.PresenceStatus)
	}
	if multipleSessions.IdleSinceAt != nil {
		t.Fatalf("online user idle_since_at = %#v", multipleSessions.IdleSinceAt)
	}
	assertPresenceTimestamp(t, multipleSessions.LastSeenAt, "2026-09-05T12:03:00Z")

	allIdle := usersByID[presenceAggregationAllIdleUserID]
	if allIdle.PresenceStatus != StatusIdle {
		t.Fatalf("all-idle status = %q, want idle", allIdle.PresenceStatus)
	}
	assertPresenceTimestamp(t, allIdle.LastSeenAt, "2026-09-05T12:02:00Z")
	assertPresenceTimestamp(t, allIdle.IdleSinceAt, expectedAllIdleSince.UTC().Format(time.RFC3339Nano))

	expired := usersByID[presenceAggregationExpiredUserID]
	if expired.PresenceStatus != StatusOffline {
		t.Fatalf("expired status = %q, want offline", expired.PresenceStatus)
	}
	if expired.IdleSinceAt != nil {
		t.Fatalf("expired user idle_since_at = %#v", expired.IdleSinceAt)
	}
	assertPresenceTimestamp(t, expired.LastSeenAt, "2026-09-05T11:59:00Z")
}

type transactionQueryer struct {
	transaction pgx.Tx
}

func (queryer transactionQueryer) Query(ctx context.Context, query string, args ...any) (rowIterator, error) {
	return queryer.transaction.Query(ctx, query, args...)
}

func requireLoopbackPresenceDatabaseURL(t *testing.T) string {
	t.Helper()
	databaseURL := strings.TrimSpace(os.Getenv("PRESENCE_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set PRESENCE_TEST_DATABASE_URL to run the PostgreSQL presence query contract")
	}
	parsedURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse PRESENCE_TEST_DATABASE_URL: %v", err)
	}
	host := parsedURL.Hostname()
	if host != "localhost" && !net.ParseIP(host).IsLoopback() {
		t.Fatalf("PRESENCE_TEST_DATABASE_URL must use a loopback host, got %q", host)
	}
	return databaseURL
}

func assertPresenceTimestamp(t *testing.T, actual *string, expected string) {
	t.Helper()
	if actual == nil || *actual != expected {
		t.Fatalf("timestamp = %#v, want %q", actual, expected)
	}
}

const (
	presenceAggregationOrganizationID     = "e9700000-0000-4000-8000-000000000001"
	presenceAggregationMultiSessionUserID = "e9710000-0000-4000-8000-000000000001"
	presenceAggregationAllIdleUserID      = "e9710000-0000-4000-8000-000000000002"
	presenceAggregationExpiredUserID      = "e9710000-0000-4000-8000-000000000003"
)

const presenceAggregationFixtureSQL = `
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  fixture.id,
  'authenticated',
  'authenticated',
  fixture.email,
  crypt('presence-test-password', gen_salt('bf', 4)),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  ''
from (
  values
    ('e9710000-0000-4000-8000-000000000001'::uuid, 'presence-multi-session@example.test'),
    ('e9710000-0000-4000-8000-000000000002'::uuid, 'presence-all-idle@example.test'),
    ('e9710000-0000-4000-8000-000000000003'::uuid, 'presence-expired@example.test')
) as fixture(id, email);

insert into public.organizations (id, name, slug, is_active)
values (
  'e9700000-0000-4000-8000-000000000001',
  'Presence Aggregation Integration',
  'presence-aggregation-integration',
  true
);

insert into public.users (id, organization_id, name, email, role, is_active)
values
  (
    'e9710000-0000-4000-8000-000000000001',
    'e9700000-0000-4000-8000-000000000001',
    'Multiple Sessions',
    'presence-multi-session@example.test',
    'user',
    true
  ),
  (
    'e9710000-0000-4000-8000-000000000002',
    'e9700000-0000-4000-8000-000000000001',
    'All Idle',
    'presence-all-idle@example.test',
    'user',
    true
  ),
  (
    'e9710000-0000-4000-8000-000000000003',
    'e9700000-0000-4000-8000-000000000001',
    'Expired',
    'presence-expired@example.test',
    'user',
    true
  )
on conflict (id) do update
set organization_id = excluded.organization_id,
    name = excluded.name,
    email = excluded.email,
    role = excluded.role,
    is_active = excluded.is_active;

insert into public.organization_members (
  organization_id,
  user_id,
  role,
  is_active,
  deleted_at
)
values
  (
    'e9700000-0000-4000-8000-000000000001',
    'e9710000-0000-4000-8000-000000000001',
    'user',
    true,
    null
  ),
  (
    'e9700000-0000-4000-8000-000000000001',
    'e9710000-0000-4000-8000-000000000002',
    'user',
    true,
    null
  ),
  (
    'e9700000-0000-4000-8000-000000000001',
    'e9710000-0000-4000-8000-000000000003',
    'user',
    true,
    null
  )
on conflict (user_id, organization_id) do update
set role = excluded.role,
    is_active = excluded.is_active,
    deleted_at = excluded.deleted_at;

insert into public.user_activity_sessions (
  organization_id,
  user_id,
  session_id,
  status,
  connected_at,
  last_seen_at,
  disconnected_at,
  idle_since_at
)
values
  (
    'e9700000-0000-4000-8000-000000000001',
    'e9710000-0000-4000-8000-000000000001',
    'presence-multi-idle',
    'idle',
    '2026-09-05 11:30:00+00',
    '2026-09-05 12:03:00+00',
    null,
    '2026-09-05 11:50:00+00'
  ),
  (
    'e9700000-0000-4000-8000-000000000001',
    'e9710000-0000-4000-8000-000000000001',
    'presence-multi-online',
    'online',
    '2026-09-05 11:30:00+00',
    '2026-09-05 12:01:00+00',
    null,
    null
  ),
  (
    'e9700000-0000-4000-8000-000000000001',
    'e9710000-0000-4000-8000-000000000002',
    'presence-idle-first',
    'idle',
    '2026-09-05 11:30:00+00',
    '2026-09-05 12:01:00+00',
    null,
    '2026-09-05 11:50:00+00'
  ),
  (
    'e9700000-0000-4000-8000-000000000001',
    'e9710000-0000-4000-8000-000000000002',
    'presence-idle-last',
    'idle',
    '2026-09-05 11:30:00+00',
    '2026-09-05 12:02:00+00',
    null,
    '2026-09-05 11:56:00+00'
  ),
  (
    'e9700000-0000-4000-8000-000000000001',
    'e9710000-0000-4000-8000-000000000003',
    'presence-expired-old',
    'online',
    '2026-09-05 11:20:00+00',
    '2026-09-05 11:40:00+00',
    null,
    null
  ),
  (
    'e9700000-0000-4000-8000-000000000001',
    'e9710000-0000-4000-8000-000000000003',
    'presence-expired-latest',
    'online',
    '2026-09-05 11:30:00+00',
    '2026-09-05 11:59:00+00',
    null,
    null
  );
`
