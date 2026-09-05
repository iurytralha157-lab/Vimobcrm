package whatsapp

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestWhatsAppMediaQueueRetentionMigrationContract(t *testing.T) {
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve current test file")
	}
	repoRoot := filepath.Clean(filepath.Join(filepath.Dir(currentFile), "..", "..", "..", ".."))
	migrationPath := filepath.Join(repoRoot, "supabase", "migrations", "20260905003206_harden_whatsapp_media_queue_retention.sql")
	raw, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("read retention migration: %v", err)
	}
	migration := strings.ToLower(string(raw))

	for _, required := range []string{
		"media_jobs_message_key_minimal_check",
		"with retired_legacy_jobs as",
		"btrim(job.dedupe_key) like 'legacy:%'",
		"btrim(job.asset_key) like 'legacy:%'",
		"job.error_code is distinct from 'media_legacy_job_retired'",
		"$media_jobs_relationship_preflight$",
		"session.organization_id is distinct from job.organization_id",
		"conversation.organization_id is distinct from job.organization_id",
		"conversation.session_id is distinct from job.session_id",
		"message.organization_id is distinct from job.organization_id",
		"message.session_id is distinct from job.session_id",
		"message.conversation_id is distinct from job.conversation_id",
		"error_code = 'media_legacy_job_retired'",
		"job.status = 'completed'",
		"stored_message.media_storage_path",
		"status = 'completed'",
		"status = 'failed'",
		"coalesce(media_job.completed_at, media_job.updated_at) < now() - interval '30 days'",
		"coalesce(media_job.failed_at, media_job.updated_at) < now() - interval '30 days'",
		"worker_state.breaker_job_id = media_job.id",
		"create index if not exists media_jobs_completed_retention_idx",
		"create index if not exists media_jobs_failed_retention_idx",
		"create index if not exists media_jobs_pending_created_idx",
		"set search_path = ''",
		"revoke all on function public.cleanup_whatsapp_retention() from public, anon, authenticated",
		"revoke all on table public.media_jobs from public, anon, authenticated, service_role",
		"pg_catalog.pg_try_advisory_xact_lock(",
		"pg_catalog.hashtextextended('vimob:whatsapp-media:global-claim', 0)",
		"pg_catalog.hashtextextended('vimob:whatsapp-media:mutation', 0)",
		"retention_batch_limit constant integer := 500",
		"limit retention_batch_limit",
		"for update of meta_event skip locked",
		"candidate_message_ids uuid[]",
		"candidate_conversation_ids uuid[]",
		"candidate_job_ids uuid[]",
		"message.id = any(candidate_message_ids)",
		"conversation.id = any(candidate_conversation_ids)",
		"media_job.id = any(candidate_job_ids)",
		"linked_message.conversation_id = conversation.id",
		"active_job.message_id = message.id",
		"active_job.conversation_id = conversation.id",
		"message.sent_at < now() - interval '15 days'",
		"last_message_at < now() - interval '30 days'",
		"active_job.status in ('pending', 'processing')",
		"active_job.provider_started_at is not null",
		"delete from public.meta_webhook_events",
	} {
		if !strings.Contains(migration, required) {
			t.Fatalf("retention migration does not contain %q", required)
		}
	}

	for _, forbidden := range []string{
		"delete from storage.objects",
		"delete from storage.",
		"grant insert on table public.media_jobs",
		"active_job.organization_id = message.organization_id",
	} {
		if strings.Contains(migration, forbidden) {
			t.Fatalf("retention migration contains forbidden mutation %q", forbidden)
		}
	}
	if got := strings.Count(migration, "active_job.status in ('pending', 'processing')"); got != 4 {
		t.Fatalf("active media retention guards = %d, want 4", got)
	}
	if got := strings.Count(migration, "limit retention_batch_limit"); got != 4 {
		t.Fatalf("bounded retention relations = %d, want 4", got)
	}
	cleanupStart := strings.Index(migration, "create or replace function public.cleanup_whatsapp_retention()")
	cleanupEnd := strings.Index(migration, "alter function public.cleanup_whatsapp_retention() owner to postgres")
	if cleanupStart < 0 || cleanupEnd <= cleanupStart {
		t.Fatal("could not isolate cleanup_whatsapp_retention function")
	}
	cleanupBody := migration[cleanupStart:cleanupEnd]
	if strings.Contains(cleanupBody, "pg_catalog.pg_advisory_xact_lock(") {
		t.Fatal("runtime retention cleanup must not block on media advisory locks")
	}
	if got := strings.Count(cleanupBody, "pg_catalog.pg_try_advisory_xact_lock("); got != 2 {
		t.Fatalf("runtime retention try-locks = %d, want 2", got)
	}
	candidateScanIndex := strings.Index(cleanupBody, "into candidate_message_ids")
	tryLockIndex := strings.Index(cleanupBody, "pg_catalog.pg_try_advisory_xact_lock(")
	deleteIndexInFunction := strings.Index(cleanupBody, "delete from public.whatsapp_messages")
	if candidateScanIndex < 0 || tryLockIndex <= candidateScanIndex || deleteIndexInFunction <= tryLockIndex {
		t.Fatalf("retention critical section order candidate=%d try-lock=%d delete=%d", candidateScanIndex, tryLockIndex, deleteIndexInFunction)
	}
	globalLockIndex := strings.Index(migration, "pg_catalog.hashtextextended('vimob:whatsapp-media:global-claim', 0)")
	mutationLockIndex := strings.Index(migration, "pg_catalog.hashtextextended('vimob:whatsapp-media:mutation', 0)")
	deleteIndex := strings.Index(migration, "delete from public.whatsapp_messages")
	if globalLockIndex < 0 || mutationLockIndex < 0 || deleteIndex < 0 || globalLockIndex >= mutationLockIndex || mutationLockIndex >= deleteIndex {
		t.Fatalf("retention lock order global=%d mutation=%d first-delete=%d", globalLockIndex, mutationLockIndex, deleteIndex)
	}
}

func TestWhatsAppMediaQueuePrimaryMigrationIsRerunnable(t *testing.T) {
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve current test file")
	}
	repoRoot := filepath.Clean(filepath.Join(filepath.Dir(currentFile), "..", "..", "..", ".."))
	migrationPath := filepath.Join(repoRoot, "supabase", "migrations", "20260904225214_harden_whatsapp_media_queue.sql")
	raw, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("read primary media migration: %v", err)
	}
	migration := strings.ToLower(string(raw))

	for _, required := range []string{
		"add column if not exists media_queue_hardening_legacy_v1 boolean",
		"set media_queue_hardening_legacy_v1 = true",
		"and job.media_queue_hardening_legacy_v1 is true",
		"drop column if exists media_queue_hardening_legacy_v1",
		"begin;",
		"set local lock_timeout = '5s'",
		"set local statement_timeout = '5min'",
		"commit;",
		"revoke all on table public.media_jobs from public, anon, authenticated, service_role",
		"create index if not exists media_jobs_session_id_idx",
		"on public.media_jobs (session_id)",
		"create index if not exists media_jobs_conversation_id_idx",
		"on public.media_jobs (conversation_id)",
	} {
		if !strings.Contains(migration, required) {
			t.Fatalf("primary media migration is missing rerun guard %q", required)
		}
	}
	if strings.Contains(migration, "grant insert on table public.media_jobs to service_role") {
		t.Fatal("primary media migration must not reopen the legacy service_role writer")
	}
	if got := strings.Count(migration, "and job.media_queue_hardening_legacy_v1 is true"); got < 2 {
		t.Fatalf("legacy retirement guards = %d, want at least 2", got)
	}
}
