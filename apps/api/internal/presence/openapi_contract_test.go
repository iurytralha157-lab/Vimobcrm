package presence

import (
	"os"
	"strings"
	"testing"
)

func TestOpenAPIUserPresenceContractIsMinimalAndSnakeCase(t *testing.T) {
	raw, err := os.ReadFile("../../../../packages/contracts/openapi/v1.yaml")
	if err != nil {
		t.Fatalf("read OpenAPI contract: %v", err)
	}
	source := strings.ReplaceAll(string(raw), "\r\n", "\n")

	route := contractSection(t, source, "  /v1/user-presence:", "  /v1/user-summaries:")
	for _, required := range []string{
		"users_presence_view",
		"OrganizationIdHeader",
		"UserPresenceResponse",
		"Cache-Control:",
		"const: private, no-store",
		`"401"`,
		`"403"`,
	} {
		if !strings.Contains(route, required) {
			t.Fatalf("presence route contract is missing %q", required)
		}
	}

	schemas := contractSection(t, source, "    UserPresenceResponse:", "    PropertyMutationRequest:")
	for _, required := range []string{
		"additionalProperties: false",
		"required: [users, counts, generated_at]",
		"- user_id",
		"- name",
		"- avatar_url",
		"- member_role",
		"- is_team_leader",
		"- presence_status",
		"- last_seen_at",
		"- idle_since_at",
		"enum: [online, idle, offline]",
		"required: [total, online, idle, offline]",
		"format: date-time",
		"is_team_leader:\n          type: boolean",
	} {
		if !strings.Contains(schemas, required) {
			t.Fatalf("presence schema contract is missing %q", required)
		}
	}
	for _, forbidden := range []string{
		"email:",
		"session_id:",
		"current_path:",
		"current_page_title:",
		"user_agent:",
		"metadata:",
		"generatedAt:",
		"presenceStatus:",
		"idleSinceAt:",
	} {
		if strings.Contains(schemas, forbidden) {
			t.Fatalf("presence schemas expose forbidden or camelCase field %q", forbidden)
		}
	}
}

func TestUserActivityIdleSinceMigrationMaintainsServerTimestamp(t *testing.T) {
	raw, err := os.ReadFile("../../../../supabase/migrations/20260905093744_track_user_activity_idle_since.sql")
	if err != nil {
		t.Fatalf("read idle-since migration: %v", err)
	}
	normalized := strings.ToLower(strings.Join(strings.Fields(string(raw)), " "))

	for _, required := range []string{
		"add column if not exists idle_since_at timestamptz",
		"security invoker",
		"set search_path = ''",
		"if new.status <> 'idle' then new.idle_since_at := null;",
		"if tg_op = 'insert' then new.idle_since_at := pg_catalog.clock_timestamp();",
		"elsif old.status is distinct from 'idle' then new.idle_since_at := pg_catalog.clock_timestamp();",
		"else new.idle_since_at := old.idle_since_at;",
		"before insert or update of status, idle_since_at",
		"from public, anon, authenticated, service_role",
	} {
		if !strings.Contains(normalized, required) {
			t.Fatalf("idle-since migration is missing %q", required)
		}
	}

	if strings.Contains(normalized, "update public.user_activity_sessions set idle_since_at") {
		t.Fatal("legacy idle timestamps must not be reconstructed from heartbeat data")
	}
}

func TestUserActivityTimestampHardeningMigrationUsesDatabaseClockForAuthenticatedWrites(t *testing.T) {
	raw, err := os.ReadFile("../../../../supabase/migrations/20260905120830_harden_user_activity_timestamps.sql")
	if err != nil {
		t.Fatalf("read user-activity timestamp migration: %v", err)
	}
	normalized := strings.ToLower(strings.Join(strings.Fields(string(raw)), " "))

	for _, required := range []string{
		"create or replace function private.maintain_authenticated_user_activity_timestamps()",
		"security invoker",
		"set search_path = ''",
		"if current_user <> 'authenticated' then return new; end if;",
		"v_now := pg_catalog.clock_timestamp();",
		"if tg_op = 'insert' then new.connected_at := v_now; else new.connected_at := old.connected_at; end if;",
		"new.last_seen_at := v_now;",
		"if new.status = 'offline' then new.disconnected_at := v_now; else new.disconnected_at := null; end if;",
		"before insert or update on public.user_activity_sessions",
		"from public, anon, authenticated, service_role",
		"add constraint user_activity_sessions_idle_since_status_check check (idle_since_at is null or status = 'idle') not valid",
		"add constraint user_activity_sessions_disconnected_status_check check (disconnected_at is null or status = 'offline') not valid",
		"validate constraint user_activity_sessions_idle_since_status_check",
		"validate constraint user_activity_sessions_disconnected_status_check",
	} {
		if !strings.Contains(normalized, required) {
			t.Fatalf("user-activity timestamp migration is missing %q", required)
		}
	}

	if strings.Contains(normalized, "security definer") {
		t.Fatal("user-activity timestamp trigger must not bypass caller privileges")
	}
}

func TestUserActivityLegacyIdleRepairStartsAtReliableServerObservation(t *testing.T) {
	raw, err := os.ReadFile("../../../../supabase/migrations/20260910011500_repair_observed_legacy_idle_since.sql")
	if err != nil {
		t.Fatalf("read legacy idle repair migration: %v", err)
	}
	normalized := strings.ToLower(strings.Join(strings.Fields(string(raw)), " "))

	for _, required := range []string{
		"begin;",
		"set local lock_timeout = '5s'",
		"set local statement_timeout = '30s'",
		"create or replace function private.maintain_user_activity_idle_since()",
		"security invoker",
		"set search_path = ''",
		"elsif old.status is distinct from 'idle' or old.idle_since_at is null then new.idle_since_at := pg_catalog.clock_timestamp();",
		"else new.idle_since_at := old.idle_since_at;",
		"trigger.tgfoid = 'private.maintain_user_activity_idle_since()'::regprocedure",
		"raise exception 'maintain_user_activity_idle_since trigger is missing or detached'",
		"with candidates as materialized",
		"activity.last_seen_at >= pg_catalog.statement_timestamp() - interval '3 minutes'",
		"order by activity.id for update of activity skip locked limit 10000",
		"update public.user_activity_sessions as activity set idle_since_at = pg_catalog.clock_timestamp() from candidates where activity.id = candidates.id",
		"from public, anon, authenticated, service_role",
		"commit;",
	} {
		if !strings.Contains(normalized, required) {
			t.Fatalf("legacy idle repair migration is missing %q", required)
		}
	}

	if strings.Contains(normalized, "security definer") {
		t.Fatal("legacy idle repair trigger must not bypass caller privileges")
	}
	if strings.Contains(normalized, "set idle_since_at = last_seen_at") ||
		strings.Contains(normalized, "set idle_since_at = connected_at") {
		t.Fatal("legacy idle repair must not reconstruct absence from lifecycle timestamps")
	}
}

func contractSection(t *testing.T, source, startMarker, endMarker string) string {
	t.Helper()
	start := strings.Index(source, startMarker)
	if start < 0 {
		t.Fatalf("OpenAPI contract is missing %q", startMarker)
	}
	end := strings.Index(source[start+len(startMarker):], endMarker)
	if end < 0 {
		t.Fatalf("OpenAPI contract is missing %q after %q", endMarker, startMarker)
	}
	return source[start : start+len(startMarker)+end]
}
