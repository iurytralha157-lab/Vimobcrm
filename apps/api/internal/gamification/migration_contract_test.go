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
	migrationsDirectory := filepath.Clean(filepath.Join(
		filepath.Dir(sourceFile),
		"..", "..", "..", "..",
		"supabase", "migrations",
	))
	migrationFiles := []string{
		"20260722000000_production_public_private_baseline.sql",
		"20260722000002_external_schema_objects.sql",
	}
	var migrationSQL strings.Builder
	for _, migrationFile := range migrationFiles {
		payload, err := os.ReadFile(filepath.Join(migrationsDirectory, migrationFile))
		if err != nil {
			t.Fatalf("read canonical migration %s: %v", migrationFile, err)
		}
		migrationSQL.Write(payload)
		migrationSQL.WriteByte('\n')
	}
	// The production migration is a schema snapshot and quotes every
	// identifier. Normalize it so this test validates the migration a fresh
	// environment actually applies, not the retired pre-squash source file.
	sql := strings.ToLower(strings.ReplaceAll(migrationSQL.String(), `"`, ""))

	required := []string{
		"create table if not exists public.gamification_outbox",
		"season_id uuid not null",
		"gamification_outbox_org_idempotency_canonical_key",
		"ensure_gamification_season_on_module_enable",
		"gamification_canonical_module_insert_season",
		"gamification_canonical_module_update_season",
		"exception\n  when others then",
		"alter publication supabase_realtime add table public.gamification_events",
		"alter publication supabase_realtime add table public.user_gamification_stats",
		"alter publication supabase_realtime add table public.gamification_seasons",
		"alter publication supabase_realtime add table public.gamification_participants",
		"alter publication supabase_realtime add table public.gamification_missions",
		"alter publication supabase_realtime add table public.gamification_manual_entries",
		"total_points bigint default 0",
		"occurred_at timestamp with time zone default now() not null",
		"'migration_baseline'",
		"create table if not exists private.gamification_activity_days",
		"create table if not exists private.gamification_legacy_mission_progress_archive",
		"on delete cascade;",
		"select auth.uid() as uid",
		"gamification members read canonical events",
		"gamification users read own manual entries",
	}
	for _, fragment := range required {
		if !strings.Contains(sql, fragment) {
			t.Errorf("canonical migration is missing contract fragment %q", fragment)
		}
	}
	enqueueStart := strings.Index(sql, "create or replace function private.enqueue_gamification_outbox")
	if enqueueStart < 0 {
		t.Fatal("canonical enqueue function is missing from the production baseline")
	}
	enqueueEnd := strings.Index(sql[enqueueStart:], "alter function private.enqueue_gamification_outbox")
	if enqueueEnd < 0 {
		t.Fatal("canonical enqueue function terminator is missing from the production baseline")
	}
	enqueueFunction := sql[enqueueStart : enqueueStart+enqueueEnd]
	if strings.Contains(enqueueFunction, "pg_advisory_xact_lock") {
		t.Fatal("hot-path enqueue must not use an organization-wide advisory lock")
	}
	if count := strings.Count(sql, "gamification producer % skipped"); count != 6 {
		t.Fatalf("expected six fail-open domain producers, got %d", count)
	}
	if strings.Contains(sql, "sum(event.points_earned)::integer") || strings.Contains(sql, "sum(event.xp_earned)::integer") {
		t.Fatal("ledger reconciliation must not narrow bigint totals back to integer")
	}
	for _, role := range []string{"anon", "authenticated"} {
		for _, privilege := range []string{"all", "select", "insert", "update", "delete"} {
			if strings.Contains(sql, "grant "+privilege+" on table public.gamification_outbox to "+role) {
				t.Fatalf("canonical outbox must not grant %s to %s", privilege, role)
			}
		}
	}
	if strings.Contains(sql, "execute function public.handle_gamification_event") {
		t.Fatal("retired direct ledger trigger must not be attached in the production baseline")
	}
}
