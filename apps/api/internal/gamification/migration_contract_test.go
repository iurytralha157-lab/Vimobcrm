package gamification

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestCanonicalMigrationContract(t *testing.T) {
	t.Parallel()

	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to resolve test source path")
	}
	migrationPath := filepath.Clean(filepath.Join(
		filepath.Dir(sourceFile),
		"..", "..", "..", "..",
		"supabase", "migrations", "20260712200000_gamification_canonical_engine.sql",
	))
	payload, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("read canonical migration: %v", err)
	}
	sql := string(payload)

	required := []string{
		"create table if not exists public.gamification_outbox",
		"season_id uuid not null",
		"gamification_outbox_org_idempotency_canonical_key",
		"ensure_gamification_season_on_module_enable",
		"gamification_canonical_module_insert_season",
		"gamification_canonical_module_update_season",
		"exception\n  when others then",
		"'gamification_events'",
		"'user_gamification_stats'",
		"'gamification_seasons'",
		"'gamification_participants'",
		"'gamification_missions'",
		"'gamification_manual_entries'",
		"alter publication supabase_realtime add table public.%I",
		"revoke all on table public.gamification_outbox from public, anon, authenticated, service_role",
		"alter column total_points type bigint",
		"occurred_at timestamptz not null default now()",
		"'migration_baseline'",
		"create table if not exists private.gamification_activity_days",
		"create table if not exists private.gamification_legacy_mission_progress_archive",
		"sum(event.points_earned)::bigint as total_points",
		"on delete cascade;",
		"user_id = (select auth.uid())",
	}
	for _, fragment := range required {
		if !strings.Contains(sql, fragment) {
			t.Errorf("canonical migration is missing contract fragment %q", fragment)
		}
	}
	if strings.Contains(sql, "pg_advisory_xact_lock") {
		t.Fatal("hot-path enqueue must not use an organization-wide advisory lock")
	}
	if count := strings.Count(sql, "gamification producer % skipped"); count != 6 {
		t.Fatalf("expected six fail-open domain producers, got %d", count)
	}
	if strings.Contains(sql, "sum(event.points_earned)::integer") || strings.Contains(sql, "sum(event.xp_earned)::integer") {
		t.Fatal("ledger reconciliation must not narrow bigint totals back to integer")
	}
	normalizeAt := strings.Index(sql, "update public.gamification_rules\nset action_type = case")
	uniqueAt := strings.Index(sql, "add constraint gamification_rules_org_action_canonical_key")
	if normalizeAt < 0 || uniqueAt < 0 || normalizeAt > uniqueAt {
		t.Fatal("rule aliases must be normalized and deduplicated before the canonical unique constraint")
	}
}
