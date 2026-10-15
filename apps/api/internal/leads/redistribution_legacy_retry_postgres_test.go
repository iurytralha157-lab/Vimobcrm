package leads

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestHotfixPostgresLegacyWhatsAppReentryReactivatesCooledJob(t *testing.T) {
	ctx, repo := hotfixPostgres(t)
	q := newHotfixQueue(t, ctx, repo, 3)
	id := addHotfixWorkerJob(t, ctx, repo, q, -10)
	if _, err := repo.db.Pool().Exec(ctx, `update public.lead_redistribution_jobs set warning_retry_at=now()+interval '1 minute',redistribution_retry_at=now()+interval '1 minute' where id=$1`, id); err != nil {
		t.Fatal(err)
	}
	// Execute the unchanged production writer's UPDATE, not a reconstructed
	// equivalent. Its queue/context validation is outside this focused test;
	// the supplied variables represent a context already validated by it.
	path := filepath.Join("..", "..", "..", "..", "supabase", "migrations", "20260903045350_refine_managed_whatsapp_reentry_and_queue_tags.sql")
	source, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	const anchor = "update public.lead_redistribution_jobs as pending_job"
	start := strings.Index(string(source), anchor)
	if start < 0 {
		t.Fatal("missing production WhatsApp reentry writer")
	}
	end := strings.Index(string(source)[start:], ";")
	if end < 0 {
		t.Fatal("unterminated production WhatsApp reentry writer")
	}
	update := string(source)[start : start+end+1]
	if strings.Contains(update, "retry_at") {
		t.Fatal("test must exercise the legacy writer unaware of technical clocks")
	}
	legacy, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer legacy.Rollback(ctx)
	if _, err := legacy.Exec(ctx, `set local role service_role`); err != nil {
		t.Fatal(err)
	}
	_, err = legacy.Exec(ctx, fmt.Sprintf(`do $reentry$
		declare v_round_robin_id uuid:='%s'; v_assigned_user_id uuid:='%s';
		v_pending_max_attempts integer:=4; v_pending_timeout_minutes integer:=10;
		v_pending_warning_minutes integer:=2; v_now timestamptz:=clock_timestamp();
		v_entry_id uuid:='%s'; p_organization_id uuid:='%s'; p_lead_id uuid:='%s';
		v_pending_job_id uuid:='%s'; begin %s end $reentry$`, q.queue, q.users[0], hotfixUUID(t), q.org, q.lead, id, update))
	if err != nil {
		t.Fatal(err)
	}
	if err := legacy.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var ready bool
	err = repo.db.Pool().QueryRow(ctx, `select warning_retry_at is null and redistribution_retry_at is null and due_at<=now() and attempt_count=0 from public.lead_redistribution_jobs where id=$1`, id).Scan(&ready)
	if err != nil || !ready {
		t.Fatalf("legitimate reentry inherited old failure cooldown: ready=%t err=%v", ready, err)
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	jobs, err := repo.listDueRedistributionJobs(ctx, tx)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, job := range jobs {
		if job.ID == id && job.InitialDistributionPending && job.AllowAssignedRedistribution {
			found = true
		}
	}
	if !found {
		t.Fatal("reactivated legacy WhatsApp job is not immediately discoverable")
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	// Changing only the job owner is another legitimate reactivation, even
	// when no schedule field changes in that UPDATE.
	_, err = repo.db.Pool().Exec(ctx, `update public.lead_redistribution_jobs set warning_retry_at=now()+interval '1 minute',redistribution_retry_at=now()+interval '1 minute' where id=$1;
		update public.lead_redistribution_jobs set current_assigned_user_id=$2 where id=$1`, id, q.users[1])
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.db.Pool().QueryRow(ctx, `select warning_retry_at is null and redistribution_retry_at is null from public.lead_redistribution_jobs where id=$1`, id).Scan(&ready); err != nil || !ready {
		t.Fatalf("new owner retained the previous owner's failure cooldown: clear=%t err=%v", ready, err)
	}
}

func TestHotfixPostgresRetryColumnsDenyBrowserRoleWrites(t *testing.T) {
	ctx, repo := hotfixPostgres(t)
	q := newHotfixQueue(t, ctx, repo, 3)
	id := addHotfixWorkerJob(t, ctx, repo, q, -10)
	for _, role := range []string{"anon", "authenticated"} {
		tx, err := repo.db.Pool().Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, `set local role `+role); err != nil {
			_ = tx.Rollback(ctx)
			t.Fatal(err)
		}
		_, err = tx.Exec(ctx, `update public.lead_redistribution_jobs set warning_retry_at=clock_timestamp(),redistribution_retry_at=clock_timestamp() where id=$1`, id)
		_ = tx.Rollback(ctx)
		postgresErr, ok := err.(*pgconn.PgError)
		if !ok || postgresErr.Code != "42501" {
			t.Fatalf("browser role %s could influence internal retry clocks: %v", role, err)
		}
	}
}

func TestHotfixPostgresSuccessfulWarningPreservesDueFailureClock(t *testing.T) {
	ctx, repo := hotfixPostgres(t)
	q := newHotfixQueue(t, ctx, repo, 3)
	id := addHotfixWorkerJob(t, ctx, repo, q, 600)
	_, err := repo.db.Pool().Exec(ctx, `update public.lead_redistribution_jobs set warning_due_at=now()-interval '1 minute' where id=$1`, id)
	if err != nil {
		t.Fatal(err)
	}
	var before time.Time
	err = repo.db.Pool().QueryRow(ctx, `update public.lead_redistribution_jobs set warning_retry_at=now()-interval '1 second',redistribution_retry_at=now()+interval '1 minute' where id=$1 returning redistribution_retry_at`, id).Scan(&before)
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.ProcessLeadRedistribution(ctx); err != nil {
		t.Fatal(err)
	}
	var warningCleared bool
	var status string
	var after time.Time
	err = repo.db.Pool().QueryRow(ctx, `select status,warning_retry_at is null,redistribution_retry_at from public.lead_redistribution_jobs where id=$1`, id).Scan(&status, &warningCleared, &after)
	if err != nil || status != "warning_sent" || !warningCleared || !before.Equal(after) {
		t.Fatalf("warning success altered another phase: status=%s warningCleared=%t dueBefore=%v dueAfter=%v err=%v", status, warningCleared, before, after, err)
	}
}
