package whatsapp

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestWhatsAppAvatarQueueMigrationContract(t *testing.T) {
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to locate WhatsApp avatar migration contract test")
	}
	migrationPath := filepath.Clean(filepath.Join(
		filepath.Dir(sourceFile),
		"..", "..", "..", "..",
		"supabase", "migrations",
		"20260920170647_add_durable_whatsapp_lead_avatar_enrichment.sql",
	))
	raw, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}

	source := strings.ToLower(string(raw))
	compact := strings.Join(strings.Fields(source), " ")
	required := []string{
		"add column if not exists whatsapp_avatar_storage_path text",
		"'/[0-9a-f]{64}[.](jpg|png|webp)$'",
		"create table if not exists private.whatsapp_avatar_jobs",
		"eligible_contact_count smallint not null default 1",
		"check (eligible_contact_count between 1 and 2)",
		"last_contact_binding_id uuid not null",
		"references public.whatsapp_conversation_lead_bindings(id) on delete cascade",
		"create unique index if not exists whatsapp_avatar_jobs_lead_uidx on private.whatsapp_avatar_jobs (organization_id, lead_id)",
		"create unique index if not exists whatsapp_avatar_jobs_one_processing_per_session_uidx",
		"source_message_id uuid references public.whatsapp_messages(id) on delete set null",
		"last_contact_message_id uuid references public.whatsapp_messages(id) on delete set null",
		"alter table private.whatsapp_avatar_jobs enable row level security",
		"revoke all on table private.whatsapp_avatar_jobs from public, anon, authenticated, service_role",
		"create or replace function private.guard_whatsapp_avatar_storage_path_write()",
		"current_user in ('anon', 'authenticated', 'service_role')",
		"before insert on public.leads",
		"before update of whatsapp_avatar_storage_path on public.leads",
		"revoke all on function private.guard_whatsapp_avatar_storage_path_write() from public, anon, authenticated, service_role",
		"create or replace function private.enqueue_whatsapp_avatar_from_message()",
		"coalesce(new.from_me, false)",
		"lower(coalesce(new.direction, 'inbound')) = 'outbound'",
		"then lower(coalesce(new.status, '')) in ('sent', 'delivered', 'read')",
		"else lower(coalesce(new.status, '')) in ('received', 'delivered', 'read')",
		"coalesce(conversation.is_group, false) = false",
		"binding.session_id = new.session_id",
		"binding.lead_id = new.lead_id",
		"binding.active_to is null",
		"binding.stale = false",
		"job.last_contact_message_id is distinct from excluded.last_contact_message_id",
		"job.eligible_contact_count < 2",
		"eligible_contact_count = least(2, job.eligible_contact_count + 1)",
		"last_contact_eligible_at timestamptz not null",
		"excluded.last_contact_eligible_at >= job.last_contact_eligible_at",
		"clock_timestamp()",
		"job.status = 'stale'",
		"create or replace function private.claim_whatsapp_avatar_job(",
		"pg_catalog.pg_advisory_xact_lock",
		"for update of job skip locked",
		"job.eligible_contact_count = 2",
		"message.id = job.source_message_id",
		"message.id = job.last_contact_message_id",
		"and binding.id = job.binding_id",
		"and binding.id = job.last_contact_binding_id",
		"cross join lateral",
		"where active.session_id = contact.session_id",
		"avatar_contact_no_longer_current",
		"when stale.eligible_contact_count >= stale.max_attempts then 'not_available'",
		"invalid.eligible_contact_count >= 2",
		"source_binding.id = invalid.binding_id",
		"remaining_binding.id = invalid.last_contact_binding_id",
		"contact.message_id is distinct from job.source_message_id then job.max_attempts",
		"and session.provider = 'evolution_go'",
		"join public.whatsapp_sessions as claim_session",
		"and claim_session.status = 'connected'",
		"and coalesce(claim_session.is_active, true) = true",
		"job.attempts < job.max_attempts",
		"attempts = candidate.claimed_attempts",
		"last_attempt_message_id = candidate.source_message_id",
		"@(s[.]whatsapp[.]net|lid)",
		"create or replace function private.finish_whatsapp_avatar_job(",
		"p_outcome not in ('completed', 'unavailable', 'transient')",
		"binding.id = v_job.binding_id",
		"for no key update",
		"for share; v_binding_is_current := found",
		"message.id = v_job.last_attempt_message_id",
		"and nullif(btrim(lead.whatsapp_avatar_storage_path), '') is null",
		"whatsapp_avatar_storage_path = p_storage_path",
		"whatsapp_avatar_url = null",
		"whatsapp_avatar_synced_at = now()",
		"when v_job.attempts >= v_job.max_attempts then 'not_available'",
		"revoke all on function private.enqueue_whatsapp_avatar_from_message() from public, anon, authenticated, service_role",
		"revoke all on function private.claim_whatsapp_avatar_job(text, interval) from public, anon, authenticated, service_role",
		"revoke all on function private.finish_whatsapp_avatar_job( uuid, uuid, text, text, text, text ) from public, anon, authenticated, service_role",
	}
	for _, fragment := range required {
		if !strings.Contains(source, fragment) && !strings.Contains(compact, fragment) {
			t.Fatalf("WhatsApp avatar migration is missing %q", fragment)
		}
	}
	if count := strings.Count(compact, "security definer set search_path = ''"); count != 3 {
		t.Fatalf("WhatsApp avatar migration has %d hardened security-definer functions, want 3", count)
	}

	lateralStart := strings.Index(compact, "cross join lateral (")
	lateralEnd := strings.Index(compact, ") as contact join public.whatsapp_sessions as claim_session")
	connectedSessionCheck := strings.Index(compact, "and claim_session.status = 'connected'")
	processingSlotCheck := strings.Index(compact, "where active.session_id = contact.session_id")
	if lateralStart < 0 || lateralEnd < 0 || connectedSessionCheck < 0 || processingSlotCheck < 0 {
		t.Fatal("WhatsApp avatar claim is missing its structural-contact or session-capacity boundary")
	}
	if connectedSessionCheck <= lateralEnd || processingSlotCheck <= lateralEnd {
		t.Fatal("WhatsApp avatar claim must choose contact one/two before checking session connectivity or capacity")
	}

	recoveryStart := strings.Index(compact, "update private.whatsapp_avatar_jobs as stale set status = case")
	recoveryEnd := strings.Index(compact, "where stale.status = 'processing' and stale.lease_expires_at < now();")
	if recoveryStart < 0 || recoveryEnd <= recoveryStart {
		t.Fatal("WhatsApp avatar claim is missing its expired-lease recovery")
	}
	recovery := compact[recoveryStart:recoveryEnd]
	maxedAttempt := strings.Index(recovery, "when stale.attempts >= stale.max_attempts then 'not_available'")
	remainingContact := strings.Index(recovery, "when stale.last_contact_message_id is distinct from stale.last_attempt_message_id then 'pending'")
	frozenEligibility := strings.Index(recovery, "when stale.eligible_contact_count >= stale.max_attempts then 'not_available'")
	waitForSecond := strings.Index(recovery, "else 'awaiting_next_contact'")
	if maxedAttempt < 0 || remainingContact <= maxedAttempt || frozenEligibility <= remainingContact || waitForSecond <= frozenEligibility {
		t.Fatal("WhatsApp avatar lease recovery must prefer a recorded remaining contact, terminalize exhausted eligibility, then wait only for contact two")
	}

	finishStart := strings.Index(compact, "create or replace function private.finish_whatsapp_avatar_job(")
	if finishStart < 0 {
		t.Fatal("WhatsApp avatar migration is missing its finish function")
	}
	finish := compact[finishStart:]
	conversationLock := strings.Index(finish, "for no key update;")
	bindingLock := strings.Index(finish, "and binding.stale = false for update;")
	messageLock := strings.Index(finish, "and message.lead_id = v_job.lead_id for share;")
	jobRelock := strings.Index(finish, "and job.lease_expires_at >= now() for update;")
	if conversationLock < 0 || bindingLock <= conversationLock || messageLock <= bindingLock || jobRelock <= messageLock {
		t.Fatal("WhatsApp avatar completion must lock conversation, binding, message identity, then revalidate the job")
	}

	for _, forbidden := range []string{
		"http://",
		"https://",
		"/user/avatar",
		"p_avatar_reference",
		"regexp_replace(coalesce(lead.phone",
		"split_part(v_remote_jid",
		"grant select on table private.whatsapp_avatar_jobs to authenticated",
		"grant execute on function private.",
		"job.binding_id is distinct from excluded.binding_id",
		"for key share; v_binding_is_current := found",
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("WhatsApp avatar migration contains forbidden fragment %q", forbidden)
		}
	}
}
