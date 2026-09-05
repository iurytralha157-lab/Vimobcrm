package whatsapp

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestWhatsAppMediaMutationLockPrecedesMixedRowMutations(t *testing.T) {
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve current test file")
	}
	repoRoot := filepath.Clean(filepath.Join(filepath.Dir(currentFile), "..", "..", "..", ".."))

	readSource := func(relativePath string) string {
		raw, err := os.ReadFile(filepath.Join(repoRoot, filepath.FromSlash(relativePath)))
		if err != nil {
			t.Fatalf("read %s: %v", relativePath, err)
		}
		return string(raw)
	}
	functionBody := func(source, start, end string) string {
		startIndex := strings.Index(source, start)
		if startIndex < 0 {
			t.Fatalf("source is missing %q", start)
		}
		body := source[startIndex:]
		if end != "" {
			endIndex := strings.Index(body[len(start):], end)
			if endIndex < 0 {
				t.Fatalf("body %q is missing terminator %q", start, end)
			}
			body = body[:len(start)+endIndex]
		}
		return body
	}
	assertBefore := func(name, source, first, second string) {
		t.Helper()
		firstIndex := strings.Index(source, first)
		secondIndex := strings.Index(source, second)
		if firstIndex < 0 || secondIndex < 0 || firstIndex >= secondIndex {
			t.Fatalf("%s lock order invalid: %q index=%d, %q index=%d", name, first, firstIndex, second, secondIndex)
		}
	}

	queueSource := readSource("apps/api/internal/whatsapp/media_queue.go")
	completeBody := functionBody(queueSource, "func (repo Repository) completeWhatsAppMediaJob", "func (repo Repository) retryOrFailWhatsAppMediaJob")
	assertBefore("completion", completeBody, "lockWhatsAppMediaMutation(ctx, tx)", "for update")

	retryBody := functionBody(queueSource, "func (repo Repository) retryOrFailWhatsAppMediaJob", "func whatsappMediaRetryDelay")
	assertBefore("outcome-unknown", retryBody, "vimob:whatsapp-media:global-claim", "lockWhatsAppMediaMutation(ctx, tx)")
	assertBefore("retry", retryBody, "lockWhatsAppMediaMutation(ctx, tx)", "update public.media_jobs")

	manualBody := functionBody(queueSource, "func (repo Repository) enqueueManualWhatsAppMediaJob", "type manualWhatsAppMediaJob")
	assertBefore("manual enqueue", manualBody, "lockWhatsAppMediaMutation(ctx, tx)", "whatsapp-media-manual:")

	processorSource := readSource("apps/api/internal/whatsapp/webhook_native_processor.go")
	processorBody := functionBody(processorSource, "func (repo Repository) processNativeEvolutionMessages", "func loadNativeEvolutionSession")
	assertBefore("native webhook", processorBody, "lockWhatsAppMediaMutation(ctx, tx)", "loadNativeEvolutionSession(ctx, tx, item)")

	migration := readSource("supabase/migrations/20260904225214_harden_whatsapp_media_queue.sql")
	claimBody := functionBody(migration, "create or replace function private.claim_whatsapp_media_job", "create or replace function private.renew_whatsapp_media_job")
	assertBefore("claim global order", claimBody, "pg_try_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:global-claim'", "pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:mutation'")
	assertBefore("claim row order", claimBody, "pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:mutation'", "select stale.id")
}

func TestWhatsAppMediaMutationLockSerializesConcurrentTransactions(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer postgres.Close()

	first, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Rollback(context.Background())
	if err := lockWhatsAppMediaMutation(ctx, first); err != nil {
		t.Fatal(err)
	}

	second, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Rollback(context.Background())
	waitCtx, waitCancel := context.WithTimeout(ctx, 150*time.Millisecond)
	err = lockWhatsAppMediaMutation(waitCtx, second)
	waitCancel()
	if err == nil || waitCtx.Err() == nil {
		t.Fatalf("concurrent media mutation lock = %v, want context timeout while first transaction owns it", err)
	}

	if err := first.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	third, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer third.Rollback(context.Background())
	if err := lockWhatsAppMediaMutation(ctx, third); err != nil {
		t.Fatalf("media mutation lock after owner commit: %v", err)
	}
	if err := third.Commit(ctx); err != nil {
		t.Fatal(err)
	}
}
