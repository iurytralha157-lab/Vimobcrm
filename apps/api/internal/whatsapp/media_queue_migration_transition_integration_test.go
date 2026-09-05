package whatsapp

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestWhatsAppMediaQueueFinalMigrationRetiresLegacyWindowAndRebuildsManualJob(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)

	var primaryReady bool
	if err := postgres.Pool().QueryRow(ctx, `
		select to_regprocedure('private.claim_whatsapp_media_job(text,interval,uuid[])') is not null
	`).Scan(&primaryReady); err != nil {
		t.Fatal(err)
	}
	if !primaryReady {
		t.Fatal("primary WhatsApp media queue migration is not applied")
	}

	suffix := fmt.Sprintf("wa-media-transition-%d", time.Now().UnixNano())
	var organizationID, userID, sessionID, conversationID, messageID, legacyJobID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.organizations (name, slug)
		values ($1, $1)
		returning id::text
	`, suffix).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from public.media_jobs where organization_id = $1::uuid`, organizationID)
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from public.whatsapp_messages where organization_id = $1::uuid`, organizationID)
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from public.whatsapp_conversations where organization_id = $1::uuid`, organizationID)
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from public.whatsapp_sessions where organization_id = $1::uuid`, organizationID)
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from public.users where organization_id = $1::uuid`, organizationID)
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from public.organizations where id = $1::uuid`, organizationID)
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from auth.users where id = $1::uuid`, userID)
	})

	if _, err := postgres.Pool().Exec(ctx, `
		insert into auth.users (
			id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		) values (
			$1::uuid, 'authenticated', 'authenticated', $2, '', now(),
			'{}'::jsonb, '{}'::jsonb, now(), now()
		)
	`, userID, suffix+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.users (id, organization_id, name, email, role, is_active)
		values ($1::uuid, $2::uuid, $3, $4, 'user', true)
		on conflict (id) do update
		set organization_id = excluded.organization_id,
		    name = excluded.name,
		    email = excluded.email,
		    role = excluded.role,
		    is_active = excluded.is_active
	`, userID, organizationID, suffix, suffix+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_sessions (
			organization_id, owner_user_id, instance_name, instance_id,
			provider, status, is_active, advanced_settings
		) values (
			$1::uuid, $2::uuid, $3, $3,
			'evolution_go', 'connected', true, '{}'::jsonb
		)
		returning id::text
	`, organizationID, userID, suffix).Scan(&sessionID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_conversations (
			organization_id, session_id, remote_jid, contact_phone, contact_name
		) values ($1::uuid, $2::uuid, '5511888888888@s.whatsapp.net', '5511888888888', $3)
		returning id::text
	`, organizationID, sessionID, suffix).Scan(&conversationID); err != nil {
		t.Fatal(err)
	}
	providerMessageID := suffix + "-provider"
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_messages (
			organization_id, conversation_id, session_id,
			provider_message_id, message_id, from_me, direction,
			message_type, media_url, media_mime_type, media_status, media_size,
			metadata, status, sent_at
		) values (
			$1::uuid, $2::uuid, $3::uuid,
			$4, $4, false, 'inbound',
			'image', 'https://media.example.invalid/transition/manual.png', 'image/png', 'pending', 1024,
			jsonb_build_object('raw', jsonb_build_object(
				'message', jsonb_build_object('imageMessage', jsonb_build_object(
					'directPath', '/transition/manual',
					'fileLength', 1024,
					'jpegThumbnail', 'must-not-survive'
				))
			)),
			'received', now()
		)
		returning id::text
	`, organizationID, conversationID, sessionID, providerMessageID).Scan(&messageID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.media_jobs (
			organization_id, session_id, conversation_id, message_id,
			provider_message_id, message_key, media_type, media_mime_type,
			status, attempts, max_attempts, next_retry_at,
			dedupe_key, asset_key, declared_size, manual_requested
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, '{}'::jsonb, 'image', 'image/png',
			'pending', 0, 3, now(),
			'legacy:' || gen_random_uuid()::text,
			'legacy:' || gen_random_uuid()::text,
			null, false
		)
		returning id::text
	`, organizationID, sessionID, conversationID, messageID, providerMessageID).Scan(&legacyJobID); err != nil {
		t.Fatal(err)
	}

	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve current integration test file")
	}
	repoRoot := filepath.Clean(filepath.Join(filepath.Dir(currentFile), "..", "..", "..", ".."))
	executeMigration := func(name string) error {
		t.Helper()
		migrationSQL, readErr := os.ReadFile(filepath.Join(repoRoot, "supabase", "migrations", name))
		if readErr != nil {
			return readErr
		}
		connection, acquireErr := postgres.Pool().Acquire(ctx)
		if acquireErr != nil {
			return acquireErr
		}
		results, execErr := connection.Conn().PgConn().Exec(ctx, string(migrationSQL)).ReadAll()
		connection.Release()
		if execErr != nil {
			return fmt.Errorf("apply %s: %w (results: %#v)", name, execErr, results)
		}
		return nil
	}

	if err := executeMigration("20260905003206_harden_whatsapp_media_queue_retention.sql"); err != nil {
		t.Fatal(err)
	}

	var legacyStatus, legacyError, messageStatus, messageError string
	var legacyProviderStarted *time.Time
	if err := postgres.Pool().QueryRow(ctx, `
		select job.status, coalesce(job.error_code, ''), job.provider_started_at,
		       coalesce(message.media_status, ''), coalesce(message.media_error, '')
		from public.media_jobs as job
		join public.whatsapp_messages as message
		  on message.organization_id = job.organization_id
		 and message.id = job.message_id
		where job.id = $1::uuid
	`, legacyJobID).Scan(&legacyStatus, &legacyError, &legacyProviderStarted, &messageStatus, &messageError); err != nil {
		t.Fatal(err)
	}
	if legacyStatus != "failed" || legacyError != mediaErrorLegacyRetired || legacyProviderStarted != nil {
		t.Fatalf("legacy transition job = status:%q error:%q provider_started:%v", legacyStatus, legacyError, legacyProviderStarted)
	}
	if messageStatus != "failed" || messageError != mediaErrorLegacyRetired {
		t.Fatalf("legacy transition message = status:%q error:%q", messageStatus, messageError)
	}
	// A manual retry must ignore the retired row, recover fresh size/key metadata
	// from the message, and create a new canonical pending job.
	repo := NewRepository(postgres, nil, StorageConfig{})
	result, err := repo.enqueueManualWhatsAppMediaJob(ctx, retryMediaMessage{
		ID:             messageID,
		OrganizationID: organizationID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.jobID == "" || result.jobID == legacyJobID || result.deduplicated || result.alreadyReady {
		t.Fatalf("manual rebuild result = %+v, legacy job=%s", result, legacyJobID)
	}

	var rebuiltStatus, rebuiltKey string
	var rebuiltSize int64
	if err := postgres.Pool().QueryRow(ctx, `
		select status, coalesce(declared_size, 0), message_key::text
		from public.media_jobs
		where id = $1::uuid
	`, result.jobID).Scan(&rebuiltStatus, &rebuiltSize, &rebuiltKey); err != nil {
		t.Fatal(err)
	}
	if rebuiltStatus != "pending" || rebuiltSize != 1024 {
		t.Fatalf("rebuilt job = status:%q size:%d", rebuiltStatus, rebuiltSize)
	}
	if !strings.Contains(rebuiltKey, `"media_url": "https://media.example.invalid/transition/manual.png"`) ||
		strings.Contains(strings.ToLower(rebuiltKey), "thumbnail") ||
		strings.Contains(strings.ToLower(rebuiltKey), "raw") {
		t.Fatalf("rebuilt message key is not minimal: %s", rebuiltKey)
	}

	// Reapplying final hardening must not let the already-retired legacy row
	// overwrite the rebuilt canonical message back to failed.
	if err := executeMigration("20260905003206_harden_whatsapp_media_queue_retention.sql"); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select job.status, coalesce(message.media_status, ''), coalesce(message.media_error, '')
		from public.media_jobs as job
		join public.whatsapp_messages as message
		  on message.organization_id = job.organization_id
		 and message.id = job.message_id
		where job.id = $1::uuid
	`, result.jobID).Scan(&rebuiltStatus, &messageStatus, &messageError); err != nil {
		t.Fatal(err)
	}
	if rebuiltStatus != "pending" || messageStatus != "pending" || messageError != mediaErrorManualQueued {
		t.Fatalf("final migration rerun mutated rebuilt state = job:%q message:%q error:%q", rebuiltStatus, messageStatus, messageError)
	}

	// Historical group retention must not cascade through a message/conversation
	// while its canonical media job is still pending.
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_conversations
		set is_group = true,
		    lead_id = null,
		    last_message_at = now() - interval '40 days'
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, conversationID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_messages
		set sent_at = now() - interval '20 days'
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, messageID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `select public.cleanup_whatsapp_retention()`); err != nil {
		t.Fatal(err)
	}
	var retainedRows int
	if err := postgres.Pool().QueryRow(ctx, `
		select
		  (select count(*) from public.whatsapp_conversations where id = $1::uuid)
		  + (select count(*) from public.whatsapp_messages where id = $2::uuid)
		  + (select count(*) from public.media_jobs where id = $3::uuid)
	`, conversationID, messageID, result.jobID).Scan(&retainedRows); err != nil {
		t.Fatal(err)
	}
	if retainedRows != 3 {
		t.Fatalf("active media retention preserved %d/3 linked rows", retainedRows)
	}

	// A manual rerun of the primary migration after final hardening must not
	// restore the temporary service-role INSERT privilege.
	if err := executeMigration("20260904225214_harden_whatsapp_media_queue.sql"); err != nil {
		t.Fatal(err)
	}
	var serviceCanInsert bool
	if err := postgres.Pool().QueryRow(ctx, `
		select has_table_privilege('service_role', 'public.media_jobs', 'insert')
	`).Scan(&serviceCanInsert); err != nil {
		t.Fatal(err)
	}
	if serviceCanInsert {
		t.Fatal("primary migration rerun reopened service_role INSERT after final hardening")
	}

	// Legacy conversations can still carry NULL tenant/session columns. The
	// runtime cleanup must preserve active jobs by their direct foreign-key IDs,
	// independently of those nullable legacy columns.
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_conversations
		set organization_id = null,
		    session_id = null
		where id = $1::uuid
	`, conversationID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		restoreCtx, restoreCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer restoreCancel()
		_, _ = postgres.Pool().Exec(restoreCtx, `
			update public.whatsapp_conversations
			set organization_id = $1::uuid,
			    session_id = $2::uuid
			where id = $3::uuid
		`, organizationID, sessionID, conversationID)
	})
	if _, err := postgres.Pool().Exec(ctx, `select public.cleanup_whatsapp_retention()`); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select
		  (select count(*) from public.whatsapp_conversations where id = $1::uuid)
		  + (select count(*) from public.whatsapp_messages where id = $2::uuid)
		  + (select count(*) from public.media_jobs where id = $3::uuid)
	`, conversationID, messageID, result.jobID).Scan(&retainedRows); err != nil {
		t.Fatal(err)
	}
	if retainedRows != 3 {
		t.Fatalf("NULL legacy conversation cleanup preserved %d/3 active rows", retainedRows)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_conversations
		set organization_id = $1::uuid,
		    session_id = $2::uuid
		where id = $3::uuid
	`, organizationID, sessionID, conversationID); err != nil {
		t.Fatal(err)
	}

	// Each invocation deletes at most one explicit batch from each relation.
	// Keep the active media message in the same conversation as a cascade guard.
	const retentionBatchSize = 500
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.whatsapp_messages (
			organization_id, conversation_id, session_id,
			provider_message_id, message_id, from_me, direction,
			message_type, content, metadata, status, sent_at
		)
		select
			$1::uuid, $2::uuid, $3::uuid,
			$4 || '-retention-batch-' || generated.ordinal::text,
			$4 || '-retention-batch-' || generated.ordinal::text,
			false, 'inbound', 'text', 'batch retention fixture', '{}'::jsonb,
			'received', timestamptz '2000-01-01 00:00:00+00' + generated.ordinal * interval '1 second'
		from generate_series(1, $5::integer + 1) as generated(ordinal)
	`, organizationID, conversationID, sessionID, suffix, retentionBatchSize); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `select public.cleanup_whatsapp_retention()`); err != nil {
		t.Fatal(err)
	}
	var remainingBatchMessages int
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer
		from public.whatsapp_messages
		where message_id like $1 || '-retention-batch-%'
	`, suffix).Scan(&remainingBatchMessages); err != nil {
		t.Fatal(err)
	}
	if remainingBatchMessages != 1 {
		t.Fatalf("bounded retention left %d batch messages, want 1", remainingBatchMessages)
	}

	// Cleanup must skip promptly rather than wait behind a live media mutation.
	lockTx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := lockTx.Exec(ctx, `
		select pg_advisory_xact_lock(
			hashtextextended('vimob:whatsapp-media:mutation', 0)
		)
	`); err != nil {
		_ = lockTx.Rollback(context.Background())
		t.Fatal(err)
	}
	cleanupCtx, cleanupCancel := context.WithTimeout(ctx, 2*time.Second)
	cleanupStarted := time.Now()
	_, cleanupErr := postgres.Pool().Exec(cleanupCtx, `select public.cleanup_whatsapp_retention()`)
	cleanupElapsed := time.Since(cleanupStarted)
	cleanupCancel()
	if rollbackErr := lockTx.Rollback(context.Background()); rollbackErr != nil {
		t.Fatal(rollbackErr)
	}
	if cleanupErr != nil {
		t.Fatalf("cleanup waited behind media mutation lock for %s: %v", cleanupElapsed, cleanupErr)
	}
	if cleanupElapsed >= 2*time.Second {
		t.Fatalf("cleanup try-lock took %s, want less than 2s", cleanupElapsed)
	}
	var afterSkippedCleanup int
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer
		from public.whatsapp_messages
		where message_id like $1 || '-retention-batch-%'
	`, suffix).Scan(&afterSkippedCleanup); err != nil {
		t.Fatal(err)
	}
	if afterSkippedCleanup != remainingBatchMessages {
		t.Fatalf("skipped cleanup deleted rows: before=%d after=%d", remainingBatchMessages, afterSkippedCleanup)
	}

	// Final hardening must detect NULL/mismatched conversation relationships
	// with IS DISTINCT FROM instead of silently letting NULL evade the preflight.
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_conversations
		set organization_id = null,
		    session_id = null
		where id = $1::uuid
	`, conversationID); err != nil {
		t.Fatal(err)
	}
	migrationErr := executeMigration("20260905003206_harden_whatsapp_media_queue_retention.sql")
	if migrationErr == nil {
		t.Fatal("final migration accepted an active job linked to a NULL legacy conversation")
	}
	if !strings.Contains(strings.ToLower(migrationErr.Error()), "relationship preflight failed") {
		t.Fatalf("unexpected relationship preflight error: %v", migrationErr)
	}
}
