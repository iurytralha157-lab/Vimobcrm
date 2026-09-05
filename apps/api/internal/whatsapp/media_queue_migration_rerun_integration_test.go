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

func TestWhatsAppMediaQueueMigrationRerunPreservesHardenedJobs(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)

	var processingExists bool
	if err := postgres.Pool().QueryRow(ctx, `
		select exists(select 1 from public.media_jobs where status = 'processing')
	`).Scan(&processingExists); err != nil {
		t.Fatal(err)
	}
	if processingExists {
		t.Skip("integration database already has a processing media job")
	}

	suffix := fmt.Sprintf("wa-media-rerun-%d", time.Now().UnixNano())
	var organizationID, userID, sessionID, conversationID string
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
		) values ($1::uuid, $2::uuid, $3, '5511999999999', $4)
		returning id::text
	`, organizationID, sessionID, "5511999999999@s.whatsapp.net", suffix).Scan(&conversationID); err != nil {
		t.Fatal(err)
	}

	statuses := []string{"pending", "processing", "completed"}
	for index, status := range statuses {
		providerMessageID := fmt.Sprintf("%s-%s", suffix, status)
		storagePath := ""
		mediaStatus := "pending"
		if status == "completed" {
			storagePath = fmt.Sprintf("orgs/%s/assets/%s.png", organizationID, providerMessageID)
			mediaStatus = "ready"
		}
		var messageID string
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.whatsapp_messages (
				organization_id, conversation_id, session_id,
				provider_message_id, message_id, from_me, direction,
				message_type, media_mime_type, media_status, media_size,
				media_storage_path, status, sent_at
			) values (
				$1::uuid, $2::uuid, $3::uuid,
				$4, $4, false, 'inbound',
				'image', 'image/png', $5, 1,
				nullif($6, ''), 'received', now()
			)
			returning id::text
		`, organizationID, conversationID, sessionID, providerMessageID, mediaStatus, storagePath).Scan(&messageID); err != nil {
			t.Fatal(err)
		}

		_, err := postgres.Pool().Exec(ctx, `
			insert into public.media_jobs (
				organization_id, session_id, conversation_id, message_id,
				provider_message_id, message_key, media_type, media_mime_type,
				status, attempts, max_attempts, next_retry_at,
				dedupe_key, asset_key, declared_size, priority,
				locked_at, lease_expires_at, lease_duration, locked_by, lease_token,
				completed_at, actual_size, storage_path, manual_requested
			) values (
				$1::uuid, $2::uuid, $3::uuid, $4::uuid,
				$5, '{"message":{"imageMessage":{"directPath":"/rerun/test","fileLength":1}}}'::jsonb, 'image', 'image/png',
				$6, $7, 3, now(),
				$8, $9, 1, 0,
				case when $6 = 'processing' then now() end,
				case when $6 = 'processing' then now() + interval '5 minutes' end,
				case when $6 = 'processing' then interval '5 minutes' end,
				case when $6 = 'processing' then 'rerun-worker' end,
				case when $6 = 'processing' then gen_random_uuid() end,
				case when $6 = 'completed' then now() end,
				case when $6 = 'completed' then 1 end,
				nullif($10, ''), false
			)
		`, organizationID, sessionID, conversationID, messageID,
			providerMessageID, status, index, "dedupe:"+providerMessageID,
			"asset:"+providerMessageID, storagePath)
		if err != nil {
			t.Fatal(err)
		}
	}

	loadSnapshots := func() map[string]string {
		rows, err := postgres.Pool().Query(ctx, `
			select provider_message_id,
			       jsonb_build_object(
			         'status', status,
			         'error_code', error_code,
			         'message_key', message_key,
			         'dedupe_key', dedupe_key,
			         'asset_key', asset_key,
			         'attempts', attempts,
			         'locked_by', locked_by,
			         'lease_token', lease_token,
			         'completed_at', completed_at,
			         'storage_path', storage_path,
			         'updated_at', updated_at
			       )::text
			from public.media_jobs
			where organization_id = $1::uuid
			order by provider_message_id
		`, organizationID)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		snapshots := make(map[string]string, len(statuses))
		for rows.Next() {
			var providerMessageID, snapshot string
			if err := rows.Scan(&providerMessageID, &snapshot); err != nil {
				t.Fatal(err)
			}
			snapshots[providerMessageID] = snapshot
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		return snapshots
	}

	before := loadSnapshots()
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve current integration test file")
	}
	repoRoot := filepath.Clean(filepath.Join(filepath.Dir(currentFile), "..", "..", "..", ".."))
	migrationSQL, err := os.ReadFile(filepath.Join(
		repoRoot,
		"supabase",
		"migrations",
		"20260904225214_harden_whatsapp_media_queue.sql",
	))
	if err != nil {
		t.Fatal(err)
	}
	connection, err := postgres.Pool().Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	results, execErr := connection.Conn().PgConn().Exec(ctx, string(migrationSQL)).ReadAll()
	connection.Release()
	if execErr != nil {
		t.Fatalf("rerun primary media migration: %v (results: %#v)", execErr, results)
	}

	after := loadSnapshots()
	if len(before) != len(statuses) || len(after) != len(statuses) {
		t.Fatalf("fixture snapshots before=%d after=%d, want %d", len(before), len(after), len(statuses))
	}
	for providerMessageID, beforeSnapshot := range before {
		if afterSnapshot := after[providerMessageID]; afterSnapshot != beforeSnapshot {
			t.Fatalf("migration rerun mutated hardened job %q\nbefore: %s\n after: %s", providerMessageID, beforeSnapshot, afterSnapshot)
		}
	}

	var failedMessages int
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer
		from public.whatsapp_messages
		where organization_id = $1::uuid
		  and media_error = 'media_legacy_job_retired'
	`, organizationID).Scan(&failedMessages); err != nil {
		t.Fatal(err)
	}
	if failedMessages != 0 {
		t.Fatalf("migration rerun retired %d hardened message(s)", failedMessages)
	}
}
