package whatsapp

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestWhatsAppMediaQueueIntegrationDeduplicatesNineteenSessions(t *testing.T) {
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

	var migrationReady bool
	if err := postgres.Pool().QueryRow(ctx, `
		select
			to_regprocedure('private.claim_whatsapp_media_job(text,interval,uuid[])') is not null
			and exists (
				select 1
				from pg_constraint
				where conrelid = 'public.media_jobs'::regclass
				  and conname = 'media_jobs_message_key_minimal_check'
				  and convalidated = true
			)
	`).Scan(&migrationReady); err != nil {
		t.Fatal(err)
	}
	if !migrationReady {
		t.Fatal("both WhatsApp media queue migrations are not applied to WHATSAPP_TEST_DATABASE_URL")
	}
	var serviceCanInsert, serviceCanSelect, serviceCanUpdate, serviceCanReadBreaker, serviceCanClaim bool
	if err := postgres.Pool().QueryRow(ctx, `
		select
			has_table_privilege('service_role', 'public.media_jobs', 'insert'),
			has_table_privilege('service_role', 'public.media_jobs', 'select'),
			has_table_privilege('service_role', 'public.media_jobs', 'update'),
			has_table_privilege('service_role', 'private.whatsapp_media_worker_state', 'select'),
			has_function_privilege('service_role', 'private.claim_whatsapp_media_job(text, interval, uuid[])', 'execute')
	`).Scan(
		&serviceCanInsert,
		&serviceCanSelect,
		&serviceCanUpdate,
		&serviceCanReadBreaker,
		&serviceCanClaim,
	); err != nil {
		t.Fatal(err)
	}
	if serviceCanInsert || serviceCanSelect || serviceCanUpdate || serviceCanReadBreaker || serviceCanClaim {
		t.Fatalf(
			"media queue privileges = insert:%v select:%v update:%v breaker_select:%v claim:%v",
			serviceCanInsert,
			serviceCanSelect,
			serviceCanUpdate,
			serviceCanReadBreaker,
			serviceCanClaim,
		)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.media_jobs as job
		set status = 'failed',
		    failed_at = now(),
		    error_code = 'test_fixture_retired',
		    error_message = 'stale integration-test fixture retired',
		    locked_at = null,
		    lease_expires_at = null,
		    lease_duration = null,
		    locked_by = null,
		    lease_token = null,
		    provider_started_at = null,
		    updated_at = now()
		from public.organizations as organization
		where organization.id = job.organization_id
		  and organization.slug like 'wa-media-queue-%'
		  and job.status in ('pending', 'processing')
	`); err != nil {
		t.Fatal(err)
	}
	resetMediaBreaker := func(resetCtx context.Context) error {
		_, resetErr := postgres.Pool().Exec(resetCtx, `
			update private.whatsapp_media_worker_state
			set breaker_open = false,
			    breaker_opened_at = null,
			    breaker_reason = null,
			    breaker_job_id = null,
			    updated_at = now()
			where singleton = true
		`)
		return resetErr
	}
	if err := resetMediaBreaker(ctx); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_ = resetMediaBreaker(cleanupCtx)
	})

	mediaBytes, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nKAAAAAASUVORK5CYII=")
	if err != nil {
		t.Fatal(err)
	}
	plainDigest := sha256.Sum256(mediaBytes)
	fileSHA256 := base64.StdEncoding.EncodeToString(plainDigest[:])
	encodedMedia := base64.StdEncoding.EncodeToString(mediaBytes)

	var providerCalls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/message/downloadmedia" {
			http.NotFound(response, request)
			return
		}
		providerCalls.Add(1)
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Errorf("provider request: %v", err)
		}
		if len(mapFromAny(mapFromAny(body["message"])["imageMessage"])) == 0 {
			t.Errorf("provider did not receive the queued image block: %#v", body)
		}
		if stringFromAny(body["messageId"]) == "provider-media-transport-unknown" {
			hijacker, ok := response.(http.Hijacker)
			if !ok {
				t.Error("provider response does not support connection hijacking")
				return
			}
			connection, _, hijackErr := hijacker.Hijack()
			if hijackErr != nil {
				t.Errorf("provider connection hijack: %v", hijackErr)
				return
			}
			_ = connection.Close()
			return
		}
		response.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(response).Encode(map[string]any{
			"message": "success",
			"data": map[string]any{
				"base64": "data:image/png;base64," + encodedMedia,
			},
		})
	}))
	defer provider.Close()

	var storageCalls atomic.Int32
	var storagePathsMu sync.Mutex
	storagePaths := []string{}
	storage := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || !strings.HasPrefix(request.URL.Path, "/storage/v1/object/whatsapp-media/") {
			http.NotFound(response, request)
			return
		}
		storageCalls.Add(1)
		storagePathsMu.Lock()
		storagePaths = append(storagePaths, strings.TrimPrefix(request.URL.Path, "/storage/v1/object/whatsapp-media/"))
		storagePathsMu.Unlock()
		response.WriteHeader(http.StatusOK)
	}))
	defer storage.Close()

	suffix := fmt.Sprintf("wa-media-queue-%d", time.Now().UnixNano())
	var organizationID, userID string
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

	type enqueueInput struct {
		sessionID      string
		conversationID string
		messageRowID   string
		message        nativeEvolutionMessage
	}
	enqueueInputs := make([]enqueueInput, 0, 19)
	var expectedAssetKey string
	for index := 0; index < 19; index++ {
		instanceName := fmt.Sprintf("%s-%02d", suffix, index)
		providerMessageID := fmt.Sprintf("provider-media-%02d", index)
		var sessionID, conversationID, messageRowID string
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.whatsapp_sessions (
				organization_id, owner_user_id, instance_name, instance_id,
				provider, status, is_active, advanced_settings
			) values (
				$1::uuid, $2::uuid, $3, $3,
				'evolution_go', 'connected', true, '{}'::jsonb
			)
			returning id::text
		`, organizationID, userID, instanceName).Scan(&sessionID); err != nil {
			t.Fatal(err)
		}
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.whatsapp_conversations (
				organization_id, session_id, remote_jid, contact_phone, contact_name
			) values (
				$1::uuid, $2::uuid, $3, $4, $5
			)
			returning id::text
		`, organizationID, sessionID, fmt.Sprintf("55119999%04d@s.whatsapp.net", index), fmt.Sprintf("55119999%04d", index), instanceName).Scan(&conversationID); err != nil {
			t.Fatal(err)
		}
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.whatsapp_messages (
				organization_id, conversation_id, session_id,
				provider_message_id, message_id, from_me, direction,
				message_type, media_mime_type, media_status, media_size, status, sent_at
			) values (
				$1::uuid, $2::uuid, $3::uuid,
				$4, $4, false, 'inbound',
				'image', 'image/png', 'pending', $5, 'received', now()
			)
			returning id::text
		`, organizationID, conversationID, sessionID, providerMessageID, len(mediaBytes)).Scan(&messageRowID); err != nil {
			t.Fatal(err)
		}

		message := nativeEvolutionMessage{
			ProviderMessageID: providerMessageID,
			MessageType:       "image",
			MediaMimeType:     "image/png",
			MediaSize:         int64(len(mediaBytes)),
			Raw: map[string]any{
				"message": map[string]any{
					"imageMessage": map[string]any{
						"directPath":    fmt.Sprintf("/media/%02d", index),
						"fileLength":    len(mediaBytes),
						"fileSha256":    fileSHA256,
						"fileEncSha256": testWhatsAppMediaDigest(fmt.Sprintf("encrypted-digest-%02d", index)),
						"jpegThumbnail": base64.StdEncoding.EncodeToString([]byte("thumbnail-only")),
					},
				},
			},
		}
		_, assetKey, _, _ := whatsappMediaQueueKeys(organizationID, sessionID, message)
		if expectedAssetKey == "" {
			expectedAssetKey = assetKey
		} else if assetKey != expectedAssetKey {
			t.Fatalf("session %d asset key = %q, want %q", index, assetKey, expectedAssetKey)
		}

		enqueueInputs = append(enqueueInputs, enqueueInput{
			sessionID:      sessionID,
			conversationID: conversationID,
			messageRowID:   messageRowID,
			message:        message,
		})
	}

	type enqueueResult struct {
		queued bool
		err    error
	}
	enqueueStart := make(chan struct{})
	enqueueResults := make(chan enqueueResult, len(enqueueInputs))
	var enqueueGroup sync.WaitGroup
	for _, input := range enqueueInputs {
		input := input
		enqueueGroup.Add(1)
		go func() {
			defer enqueueGroup.Done()
			<-enqueueStart
			tx, beginErr := postgres.Pool().Begin(ctx)
			if beginErr != nil {
				enqueueResults <- enqueueResult{err: beginErr}
				return
			}
			if lockErr := lockWhatsAppMediaMutation(ctx, tx); lockErr != nil {
				_ = tx.Rollback(ctx)
				enqueueResults <- enqueueResult{err: lockErr}
				return
			}
			queued, enqueueErr := enqueueNativeEvolutionMediaJob(ctx, tx, nativeEvolutionSession{
				ID:             input.sessionID,
				OrganizationID: organizationID,
			}, input.conversationID, input.message, input.messageRowID)
			if enqueueErr != nil {
				_ = tx.Rollback(ctx)
				enqueueResults <- enqueueResult{err: enqueueErr}
				return
			}
			if commitErr := tx.Commit(ctx); commitErr != nil {
				enqueueResults <- enqueueResult{err: commitErr}
				return
			}
			enqueueResults <- enqueueResult{queued: queued}
		}()
	}
	close(enqueueStart)
	enqueueGroup.Wait()
	close(enqueueResults)
	queuedCount := 0
	for result := range enqueueResults {
		if result.err != nil {
			t.Fatalf("simultaneous media enqueue failed: %v", result.err)
		}
		if result.queued {
			queuedCount++
		}
	}
	if queuedCount != 19 {
		t.Fatalf("simultaneously queued jobs = %d, want 19", queuedCount)
	}

	repo := NewRepository(postgres, nil, StorageConfig{
		ProjectURL: storage.URL,
		APIKey:     "sb_secret_media_queue_test",
		EvolutionGo: EvolutionGoConfig{
			APIURL: provider.URL,
			APIKey: "provider-key",
		},
	})
	type claimResult struct {
		job queuedWhatsAppMediaJob
		err error
	}
	claimResults := make(chan claimResult, 19)
	var claimGroup sync.WaitGroup
	claimStart := make(chan struct{})
	for index := 0; index < 19; index++ {
		claimGroup.Add(1)
		go func() {
			defer claimGroup.Done()
			<-claimStart
			job, claimErr := repo.claimWhatsAppMediaJob(ctx, 5*time.Minute, []string{enqueueInputs[0].sessionID})
			claimResults <- claimResult{job: job, err: claimErr}
		}()
	}
	close(claimStart)
	claimGroup.Wait()
	close(claimResults)

	claimedJobs := []queuedWhatsAppMediaJob{}
	for result := range claimResults {
		switch {
		case result.err == nil:
			claimedJobs = append(claimedJobs, result.job)
		case errors.Is(result.err, pgx.ErrNoRows):
		default:
			t.Fatalf("concurrent media claim failed: %v", result.err)
		}
	}
	if len(claimedJobs) != 1 {
		t.Fatalf("concurrent claims = %d, want exactly one global lease", len(claimedJobs))
	}
	if claimedJobs[0].SessionID != enqueueInputs[0].sessionID {
		t.Fatalf("canary claim session = %q, want %q", claimedJobs[0].SessionID, enqueueInputs[0].sessionID)
	}
	if _, err := repo.claimWhatsAppMediaJob(ctx, 30*time.Second, []string{enqueueInputs[0].sessionID}); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("30-second claimant expired another worker's 5-minute lease: %v", err)
	}
	type mediaIdentitySnapshot struct {
		providerMessageID string
		messageKey        string
		declaredSize      int64
		fileSHA256        string
		fileEncSHA256     string
		assetKey          string
	}
	loadIdentity := func(messageRowID string) mediaIdentitySnapshot {
		var snapshot mediaIdentitySnapshot
		if err := postgres.Pool().QueryRow(ctx, `
			select coalesce(provider_message_id, ''),
			       message_key::text,
			       coalesce(declared_size, 0),
			       coalesce(file_sha256, ''),
			       coalesce(file_enc_sha256, ''),
			       asset_key
			from public.media_jobs
			where organization_id = $1::uuid and message_id = $2::uuid
			  and error_code is distinct from 'media_legacy_job_retired'
		`, organizationID, messageRowID).Scan(
			&snapshot.providerMessageID,
			&snapshot.messageKey,
			&snapshot.declaredSize,
			&snapshot.fileSHA256,
			&snapshot.fileEncSHA256,
			&snapshot.assetKey,
		); err != nil {
			t.Fatal(err)
		}
		return snapshot
	}
	var claimedInput enqueueInput
	for _, input := range enqueueInputs {
		if input.messageRowID == claimedJobs[0].MessageID {
			claimedInput = input
			break
		}
	}
	processingIdentity := loadIdentity(claimedJobs[0].MessageID)
	mutatedRedelivery := claimedInput.message
	mutatedRedelivery.MessageType = "video"
	mutatedRedelivery.MediaSize++
	mutatedRedelivery.MediaMimeType = "video/mp4"
	mutatedRedelivery.Raw = map[string]any{
		"message": map[string]any{
			"videoMessage": map[string]any{
				"directPath":    "/media/mutated-redelivery",
				"fileLength":    mutatedRedelivery.MediaSize,
				"fileSha256":    testWhatsAppMediaDigest("mutated-processing-plain"),
				"fileEncSha256": testWhatsAppMediaDigest("mutated-processing-encrypted"),
			},
		},
	}
	tx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	queued, enqueueErr := enqueueNativeEvolutionMediaJob(ctx, tx, nativeEvolutionSession{
		ID:             claimedInput.sessionID,
		OrganizationID: organizationID,
	}, claimedInput.conversationID, mutatedRedelivery, claimedInput.messageRowID)
	if enqueueErr != nil || queued {
		_ = tx.Rollback(ctx)
		t.Fatalf("processing redelivery = queued:%v error:%v", queued, enqueueErr)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if after := loadIdentity(claimedJobs[0].MessageID); after != processingIdentity {
		t.Fatalf("processing redelivery mutated identity: before:%+v after:%+v", processingIdentity, after)
	}
	code, permanent, err := repo.processQueuedWhatsAppMediaJob(ctx, claimedJobs[0])
	if err != nil {
		t.Fatalf("claimed media process = code:%q permanent:%v error:%v", code, permanent, err)
	}
	processed, err := repo.drainOneWhatsAppMediaJob(ctx, time.Minute, []string{"*"})
	if err != nil || processed {
		t.Fatalf("second media drain = processed:%v error:%v, want empty queue", processed, err)
	}
	completedIdentity := loadIdentity(claimedJobs[0].MessageID)
	mutatedRedelivery.MediaSize++
	tx, err = postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	queued, enqueueErr = enqueueNativeEvolutionMediaJob(ctx, tx, nativeEvolutionSession{
		ID:             claimedInput.sessionID,
		OrganizationID: organizationID,
	}, claimedInput.conversationID, mutatedRedelivery, claimedInput.messageRowID)
	if enqueueErr != nil || queued {
		_ = tx.Rollback(ctx)
		t.Fatalf("completed redelivery = queued:%v error:%v", queued, enqueueErr)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if after := loadIdentity(claimedJobs[0].MessageID); after != completedIdentity {
		t.Fatalf("completed redelivery mutated identity: before:%+v after:%+v", completedIdentity, after)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_messages
		set media_storage_path = null,
		    media_status = 'failed',
		    media_error = 'simulated_stale_message'
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, claimedJobs[0].MessageID); err != nil {
		t.Fatal(err)
	}
	alreadyReady, err := repo.enqueueManualWhatsAppMediaJob(ctx, retryMediaMessage{
		ID:             claimedJobs[0].MessageID,
		OrganizationID: organizationID,
	})
	if err != nil || !alreadyReady.alreadyReady || !alreadyReady.deduplicated || alreadyReady.jobID != claimedJobs[0].ID || alreadyReady.storagePath == "" {
		t.Fatalf("completed manual retry = %+v error:%v", alreadyReady, err)
	}
	var repairedStatus, repairedPath, completedJobStatus string
	if err := postgres.Pool().QueryRow(ctx, `
		select coalesce(message.media_status, ''),
		       coalesce(message.media_storage_path, ''),
		       job.status
		from public.whatsapp_messages as message
		join public.media_jobs as job
		  on job.organization_id = message.organization_id
		 and job.message_id = message.id
		 and job.error_code is distinct from 'media_legacy_job_retired'
		where message.organization_id = $1::uuid and message.id = $2::uuid
	`, organizationID, claimedJobs[0].MessageID).Scan(&repairedStatus, &repairedPath, &completedJobStatus); err != nil {
		t.Fatal(err)
	}
	if repairedStatus != "ready" || repairedPath != alreadyReady.storagePath || completedJobStatus != "completed" {
		t.Fatalf("completed retry repair = message:%q path:%q job:%q", repairedStatus, repairedPath, completedJobStatus)
	}

	if got := providerCalls.Load(); got != 1 {
		t.Fatalf("provider calls = %d, want exactly one for nineteen sessions", got)
	}
	if got := storageCalls.Load(); got != 1 {
		t.Fatalf("storage uploads = %d, want exactly one for nineteen sessions", got)
	}
	storagePathsMu.Lock()
	paths := append([]string(nil), storagePaths...)
	storagePathsMu.Unlock()
	expectedPath := fmt.Sprintf("orgs/%s/assets/%s.png", organizationID, expectedAssetKey)
	if len(paths) != 1 || paths[0] != expectedPath {
		t.Fatalf("storage paths = %#v, want [%q]", paths, expectedPath)
	}

	var completedJobs, distinctJobPaths, readyMessages, distinctMessagePaths int
	if err := postgres.Pool().QueryRow(ctx, `
		select
			count(*) filter (where status = 'completed')::integer,
			count(distinct storage_path)::integer
		from public.media_jobs
		where organization_id = $1::uuid and asset_key = $2
	`, organizationID, expectedAssetKey).Scan(&completedJobs, &distinctJobPaths); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select
			count(*) filter (where media_status = 'ready')::integer,
			count(distinct media_storage_path)::integer
		from public.whatsapp_messages
		where organization_id = $1::uuid and message_type = 'image'
	`, organizationID).Scan(&readyMessages, &distinctMessagePaths); err != nil {
		t.Fatal(err)
	}
	if completedJobs != 19 || distinctJobPaths != 1 || readyMessages != 19 || distinctMessagePaths != 1 {
		t.Fatalf(
			"dedupe state = jobs:%d job_paths:%d messages:%d message_paths:%d",
			completedJobs, distinctJobPaths, readyMessages, distinctMessagePaths,
		)
	}

	disconnectedProviderMessageID := "provider-media-disconnected"
	var disconnectedMessageRowID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_messages (
			organization_id, conversation_id, session_id,
			provider_message_id, message_id, from_me, direction,
			message_type, media_mime_type, media_status, media_size, status, sent_at
		) values (
			$1::uuid, $2::uuid, $3::uuid,
			$4, $4, false, 'inbound',
			'image', 'image/png', 'pending', $5, 'received', now()
		)
		returning id::text
	`, organizationID, enqueueInputs[1].conversationID, enqueueInputs[1].sessionID,
		disconnectedProviderMessageID, len(mediaBytes)).Scan(&disconnectedMessageRowID); err != nil {
		t.Fatal(err)
	}
	disconnectedMessage := nativeEvolutionMessage{
		ProviderMessageID: disconnectedProviderMessageID,
		MessageType:       "image",
		MediaMimeType:     "image/png",
		MediaSize:         int64(len(mediaBytes)),
		Raw: map[string]any{
			"message": map[string]any{
				"imageMessage": map[string]any{
					"directPath": "/media/disconnected",
					"fileLength": len(mediaBytes),
					"fileSha256": testWhatsAppMediaDigest("disconnected-media"),
				},
			},
		},
	}
	tx, err = postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	queued, enqueueErr = enqueueNativeEvolutionMediaJob(ctx, tx, nativeEvolutionSession{
		ID:             enqueueInputs[1].sessionID,
		OrganizationID: organizationID,
	}, enqueueInputs[1].conversationID, disconnectedMessage, disconnectedMessageRowID)
	if enqueueErr != nil || !queued {
		_ = tx.Rollback(ctx)
		t.Fatalf("disconnected-session fixture enqueue = queued:%v error:%v", queued, enqueueErr)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_sessions
		set status = 'disconnected'
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, enqueueInputs[1].sessionID); err != nil {
		t.Fatal(err)
	}
	processed, err = repo.drainOneWhatsAppMediaJob(ctx, time.Minute, []string{"*"})
	if err != nil || !processed {
		t.Fatalf("disconnected-session drain = processed:%v error:%v", processed, err)
	}
	if got := providerCalls.Load(); got != 1 {
		t.Fatalf("disconnected session called provider %d times, want original single call only", got)
	}
	var disconnectedJobStatus, disconnectedMessageStatus, disconnectedMessageError string
	var disconnectedAttempts int
	if err := postgres.Pool().QueryRow(ctx, `
		select job.status, job.attempts, coalesce(message.media_status, ''), coalesce(message.media_error, '')
		from public.media_jobs as job
		join public.whatsapp_messages as message on message.id = job.message_id
		where job.organization_id = $1::uuid and job.message_id = $2::uuid
	`, organizationID, disconnectedMessageRowID).Scan(
		&disconnectedJobStatus,
		&disconnectedAttempts,
		&disconnectedMessageStatus,
		&disconnectedMessageError,
	); err != nil {
		t.Fatal(err)
	}
	if disconnectedJobStatus != "pending" || disconnectedAttempts != 0 || disconnectedMessageStatus != "pending" || disconnectedMessageError != mediaErrorRetry {
		t.Fatalf(
			"disconnected session state = job:%q attempts:%d message:%q error:%q",
			disconnectedJobStatus,
			disconnectedAttempts,
			disconnectedMessageStatus,
			disconnectedMessageError,
		)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.media_jobs
		set status = 'failed',
		    failed_at = now(),
		    error_code = 'test_fixture_retired',
		    error_message = 'disconnected-session assertion complete',
		    next_retry_at = now() + interval '1 day'
		where organization_id = $1::uuid and message_id = $2::uuid
	`, organizationID, disconnectedMessageRowID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_sessions
		set status = 'connected'
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, enqueueInputs[1].sessionID); err != nil {
		t.Fatal(err)
	}

	sparseProviderMessageID := "provider-media-sparse-redelivery"
	var sparseMessageRowID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_messages (
			organization_id, conversation_id, session_id,
			provider_message_id, message_id, from_me, direction,
			message_type, media_mime_type, media_status, status, sent_at
		) values (
			$1::uuid, $2::uuid, $3::uuid,
			$4, $4, false, 'inbound',
			'image', 'image/png', 'failed', 'received', now()
		)
		returning id::text
	`, organizationID, enqueueInputs[2].conversationID, enqueueInputs[2].sessionID,
		sparseProviderMessageID).Scan(&sparseMessageRowID); err != nil {
		t.Fatal(err)
	}
	sparseMessage := nativeEvolutionMessage{
		ProviderMessageID: sparseProviderMessageID,
		MessageType:       "image",
		MediaMimeType:     "image/png",
		Raw: map[string]any{
			"message": map[string]any{
				"imageMessage": map[string]any{"directPath": "/media/sparse"},
			},
		},
	}
	tx, err = postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	queued, enqueueErr = enqueueNativeEvolutionMediaJob(ctx, tx, nativeEvolutionSession{
		ID:             enqueueInputs[2].sessionID,
		OrganizationID: organizationID,
	}, enqueueInputs[2].conversationID, sparseMessage, sparseMessageRowID)
	if enqueueErr != nil || queued {
		_ = tx.Rollback(ctx)
		t.Fatalf("sparse fixture enqueue = queued:%v error:%v", queued, enqueueErr)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	richMessage := sparseMessage
	richMessage.MediaSize = int64(len(mediaBytes))
	richMessage.Raw = map[string]any{
		"message": map[string]any{
			"imageMessage": map[string]any{
				"directPath": "/media/sparse",
				"fileLength": len(mediaBytes),
				"fileSha256": fileSHA256,
			},
		},
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_messages
		set media_size = $3, media_status = 'pending', media_error = null
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, sparseMessageRowID, len(mediaBytes)); err != nil {
		t.Fatal(err)
	}
	tx, err = postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	queued, enqueueErr = enqueueNativeEvolutionMediaJob(ctx, tx, nativeEvolutionSession{
		ID:             enqueueInputs[2].sessionID,
		OrganizationID: organizationID,
	}, enqueueInputs[2].conversationID, richMessage, sparseMessageRowID)
	if enqueueErr != nil || !queued {
		_ = tx.Rollback(ctx)
		t.Fatalf("enriched redelivery enqueue = queued:%v error:%v", queued, enqueueErr)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var enrichedStatus, enrichedAssetKey string
	var enrichedSize int64
	if err := postgres.Pool().QueryRow(ctx, `
		select status, asset_key, coalesce(declared_size, 0)
		from public.media_jobs
		where organization_id = $1::uuid and message_id = $2::uuid
	`, organizationID, sparseMessageRowID).Scan(&enrichedStatus, &enrichedAssetKey, &enrichedSize); err != nil {
		t.Fatal(err)
	}
	if enrichedStatus != "pending" || enrichedAssetKey != expectedAssetKey || enrichedSize != int64(len(mediaBytes)) {
		t.Fatalf("enriched redelivery = status:%q asset:%q size:%d", enrichedStatus, enrichedAssetKey, enrichedSize)
	}
	processed, err = repo.drainOneWhatsAppMediaJob(ctx, time.Minute, []string{"*"})
	if err != nil || !processed {
		t.Fatalf("enriched redelivery drain = processed:%v error:%v", processed, err)
	}
	if providerCalls.Load() != 1 || storageCalls.Load() != 1 {
		t.Fatalf("enriched dedupe I/O = provider:%d storage:%d, want 1/1", providerCalls.Load(), storageCalls.Load())
	}

	corruptExpectedBytes := append([]byte(nil), mediaBytes...)
	corruptExpectedBytes[len(corruptExpectedBytes)-1] ^= 0xff
	corruptExpectedDigest := sha256.Sum256(corruptExpectedBytes)
	corruptExpectedSHA256 := base64.StdEncoding.EncodeToString(corruptExpectedDigest[:])
	corruptProviderMessageID := "provider-media-corrupt"
	var corruptMessageRowID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_messages (
			organization_id, conversation_id, session_id,
			provider_message_id, message_id, from_me, direction,
			message_type, media_mime_type, media_status, media_size, status, sent_at
		) values (
			$1::uuid, $2::uuid, $3::uuid,
			$4, $4, false, 'inbound',
			'image', 'image/png', 'pending', $5, 'received', now()
		)
		returning id::text
	`, organizationID, enqueueInputs[0].conversationID, enqueueInputs[0].sessionID, corruptProviderMessageID, len(mediaBytes)).Scan(&corruptMessageRowID); err != nil {
		t.Fatal(err)
	}
	corruptMessage := nativeEvolutionMessage{
		ProviderMessageID: corruptProviderMessageID,
		MessageType:       "image",
		MediaMimeType:     "image/png",
		MediaSize:         int64(len(mediaBytes)),
		Raw: map[string]any{
			"message": map[string]any{
				"imageMessage": map[string]any{
					"directPath":    "/media/corrupt",
					"fileLength":    len(mediaBytes),
					"fileSha256":    corruptExpectedSHA256,
					"jpegThumbnail": base64.StdEncoding.EncodeToString([]byte("thumbnail-only")),
				},
			},
		},
	}
	tx, err = postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	queued, enqueueErr = enqueueNativeEvolutionMediaJob(ctx, tx, nativeEvolutionSession{
		ID:             enqueueInputs[0].sessionID,
		OrganizationID: organizationID,
	}, enqueueInputs[0].conversationID, corruptMessage, corruptMessageRowID)
	if enqueueErr != nil || !queued {
		_ = tx.Rollback(ctx)
		t.Fatalf("corrupt provider fixture enqueue = queued:%v error:%v", queued, enqueueErr)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	processed, err = repo.drainOneWhatsAppMediaJob(ctx, time.Minute, []string{"*"})
	if err != nil || !processed {
		t.Fatalf("corrupt provider fixture drain = processed:%v error:%v", processed, err)
	}
	var corruptMessageStatus, corruptMessageError, corruptJobStatus string
	if err := postgres.Pool().QueryRow(ctx, `
		select coalesce(message.media_status, ''), coalesce(message.media_error, ''), job.status
		from public.whatsapp_messages as message
		join public.media_jobs as job on job.message_id = message.id
		where message.organization_id = $1::uuid and message.id = $2::uuid
	`, organizationID, corruptMessageRowID).Scan(&corruptMessageStatus, &corruptMessageError, &corruptJobStatus); err != nil {
		t.Fatal(err)
	}
	if corruptMessageStatus != "failed" || corruptMessageError != mediaErrorFailed || corruptJobStatus != "failed" {
		t.Fatalf("corrupt provider state = message:%q error:%q job:%q", corruptMessageStatus, corruptMessageError, corruptJobStatus)
	}
	if providerCalls.Load() != 2 || storageCalls.Load() != 1 {
		t.Fatalf("corrupt provider I/O = provider:%d storage:%d, want 2/1", providerCalls.Load(), storageCalls.Load())
	}

	racingResult, err := repo.enqueueManualWhatsAppMediaJob(ctx, retryMediaMessage{
		ID:             corruptMessageRowID,
		OrganizationID: organizationID,
		ConversationID: enqueueInputs[0].conversationID,
		SessionID:      enqueueInputs[0].sessionID,
		MessageID:      corruptProviderMessageID,
		MessageType:    "image",
		MediaMimeType:  "image/png",
		MediaSize:      int64(len(mediaBytes)),
		Metadata:       map[string]any{"raw": corruptMessage.Raw},
	})
	if err != nil {
		t.Fatal(err)
	}
	racingJobID := racingResult.jobID
	raceFollowerProviderMessageID := "provider-media-breaker-race-follower"
	var raceFollowerMessageRowID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_messages (
			organization_id, conversation_id, session_id,
			provider_message_id, message_id, from_me, direction,
			message_type, media_mime_type, media_status, media_size, status, sent_at
		) values (
			$1::uuid, $2::uuid, $3::uuid,
			$4, $4, false, 'inbound',
			'image', 'image/png', 'pending', $5, 'received', now()
		)
		returning id::text
	`, organizationID, enqueueInputs[5].conversationID, enqueueInputs[5].sessionID,
		raceFollowerProviderMessageID, len(mediaBytes)).Scan(&raceFollowerMessageRowID); err != nil {
		t.Fatal(err)
	}
	raceFollowerMessage := nativeEvolutionMessage{
		ProviderMessageID: raceFollowerProviderMessageID,
		MessageType:       "image",
		MediaMimeType:     "image/png",
		MediaSize:         int64(len(mediaBytes)),
		Raw: map[string]any{
			"message": map[string]any{
				"imageMessage": map[string]any{
					"directPath": "/media/breaker-race-follower",
					"fileLength": len(mediaBytes),
					"fileSha256": testWhatsAppMediaDigest("breaker-race-follower"),
				},
			},
		},
	}
	tx, err = postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	queued, enqueueErr = enqueueNativeEvolutionMediaJob(ctx, tx, nativeEvolutionSession{
		ID:             enqueueInputs[5].sessionID,
		OrganizationID: organizationID,
	}, enqueueInputs[5].conversationID, raceFollowerMessage, raceFollowerMessageRowID)
	if enqueueErr != nil || !queued {
		_ = tx.Rollback(ctx)
		t.Fatalf("breaker race follower enqueue = queued:%v error:%v", queued, enqueueErr)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	racingJob, err := repo.claimWhatsAppMediaJob(ctx, 5*time.Minute, []string{"*"})
	if err != nil {
		t.Fatal(err)
	}
	if racingJob.ID != racingJobID || !racingJob.ManualRequested {
		t.Fatalf("breaker race claimed job = %q manual:%v, want %q", racingJob.ID, racingJob.ManualRequested, racingJobID)
	}
	if err := repo.markWhatsAppMediaProviderStarted(ctx, racingJob); err != nil {
		t.Fatal(err)
	}
	raceStart := make(chan struct{})
	raceClaims := make(chan error, 19)
	raceOutcome := make(chan error, 1)
	var raceGroup sync.WaitGroup
	raceGroup.Add(1)
	go func() {
		defer raceGroup.Done()
		<-raceStart
		raceOutcome <- repo.retryOrFailWhatsAppMediaJob(
			ctx,
			racingJob,
			mediaErrorOutcomeUnknown,
			true,
			fmt.Errorf("%w: simulated provider transport outcome", ErrProviderOutcomeUnknown),
		)
	}()
	for index := 0; index < 19; index++ {
		raceGroup.Add(1)
		go func() {
			defer raceGroup.Done()
			<-raceStart
			_, claimErr := repo.claimWhatsAppMediaJob(ctx, 30*time.Second, []string{"*"})
			raceClaims <- claimErr
		}()
	}
	close(raceStart)
	raceGroup.Wait()
	close(raceClaims)
	if err := <-raceOutcome; err != nil {
		t.Fatalf("breaker race outcome transaction failed: %v", err)
	}
	for claimErr := range raceClaims {
		if !errors.Is(claimErr, pgx.ErrNoRows) {
			t.Fatalf("breaker race allowed a follower claim: %v", claimErr)
		}
	}
	var raceFollowerJobStatus string
	var raceBreakerOpen bool
	if err := postgres.Pool().QueryRow(ctx, `
		select follower.status, state.breaker_open
		from public.media_jobs as follower
		cross join private.whatsapp_media_worker_state as state
		where follower.organization_id = $1::uuid
		  and follower.message_id = $2::uuid
		  and state.singleton = true
	`, organizationID, raceFollowerMessageRowID).Scan(&raceFollowerJobStatus, &raceBreakerOpen); err != nil {
		t.Fatal(err)
	}
	if raceFollowerJobStatus != "pending" || !raceBreakerOpen {
		t.Fatalf("breaker race state = follower:%q breaker:%v", raceFollowerJobStatus, raceBreakerOpen)
	}
	if err := resetMediaBreaker(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.media_jobs
		set status = 'failed', error_code = 'test_retired', error_message = 'fixture retired', failed_at = now()
		where organization_id = $1::uuid and message_id = $2::uuid
	`, organizationID, raceFollowerMessageRowID); err != nil {
		t.Fatal(err)
	}

	staleProviderMessageID := "provider-media-stale-outcome"
	var staleMessageRowID, staleJobID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_messages (
			organization_id, conversation_id, session_id,
			provider_message_id, message_id, from_me, direction,
			message_type, media_mime_type, media_status, media_size, status, sent_at
		) values (
			$1::uuid, $2::uuid, $3::uuid,
			$4, $4, false, 'inbound',
			'image', 'image/png', 'pending', $5, 'received', now()
		)
		returning id::text
	`, organizationID, enqueueInputs[3].conversationID, enqueueInputs[3].sessionID,
		staleProviderMessageID, len(mediaBytes)).Scan(&staleMessageRowID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.media_jobs (
			organization_id, session_id, conversation_id, message_id,
			provider_message_id, message_key, media_type, media_mime_type,
			status, attempts, max_attempts, next_retry_at,
			dedupe_key, asset_key, declared_size, file_sha256,
			locked_at, lease_expires_at, lease_duration, locked_by, lease_token,
			provider_started_at
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, '{}'::jsonb, 'image', 'image/png',
			'processing', 1, 3, now(),
			$6, $7, $8, $9,
			now() - interval '10 minutes', now() - interval '5 minutes', interval '5 minutes',
			'crashed-worker', gen_random_uuid(), now() - interval '10 minutes'
		)
		returning id::text
	`, organizationID, enqueueInputs[3].sessionID, enqueueInputs[3].conversationID,
		staleMessageRowID, staleProviderMessageID,
		hashWhatsAppMediaKey("stale-job", staleProviderMessageID),
		hashWhatsAppMediaKey("stale-asset", staleProviderMessageID),
		len(mediaBytes), fileSHA256).Scan(&staleJobID); err != nil {
		t.Fatal(err)
	}
	processed, err = repo.drainOneWhatsAppMediaJob(ctx, time.Minute, []string{"*"})
	if processed || !errors.Is(err, errWhatsAppMediaBreakerOpen) {
		t.Fatalf("expired provider lease drain = processed:%v error:%v, want durable breaker", processed, err)
	}
	var staleJobStatus, staleJobError, staleMessageStatus, staleMessageError string
	if err := postgres.Pool().QueryRow(ctx, `
		select job.status, coalesce(job.error_code, ''),
		       coalesce(message.media_status, ''), coalesce(message.media_error, '')
		from public.media_jobs as job
		join public.whatsapp_messages as message on message.id = job.message_id
		where job.id = $1::uuid
	`, staleJobID).Scan(&staleJobStatus, &staleJobError, &staleMessageStatus, &staleMessageError); err != nil {
		t.Fatal(err)
	}
	if staleJobStatus != "failed" || staleJobError != mediaErrorOutcomeUnknown ||
		staleMessageStatus != "failed" || staleMessageError != mediaErrorOutcomeUnknown {
		t.Fatalf(
			"expired provider outcome = job:%q/%q message:%q/%q",
			staleJobStatus,
			staleJobError,
			staleMessageStatus,
			staleMessageError,
		)
	}
	restartedRepo := NewRepository(postgres, nil, StorageConfig{
		ProjectURL: storage.URL,
		APIKey:     "sb_secret_media_queue_test",
		EvolutionGo: EvolutionGoConfig{
			APIURL: provider.URL,
			APIKey: "provider-key",
		},
	})
	if processed, err := restartedRepo.drainOneWhatsAppMediaJob(ctx, time.Minute, []string{"*"}); processed || !errors.Is(err, errWhatsAppMediaBreakerOpen) {
		t.Fatalf("restarted worker ignored durable breaker = processed:%v error:%v", processed, err)
	}
	_, err = repo.enqueueManualWhatsAppMediaJob(ctx, retryMediaMessage{
		ID:             staleMessageRowID,
		OrganizationID: organizationID,
		ConversationID: enqueueInputs[3].conversationID,
		SessionID:      enqueueInputs[3].sessionID,
		MessageID:      staleProviderMessageID,
		MessageType:    "image",
		MediaMimeType:  "image/png",
		MediaSize:      int64(len(mediaBytes)),
		Metadata:       map[string]any{"raw": map[string]any{}},
	})
	if !errors.Is(err, ErrProviderFailed) {
		t.Fatalf("manual retry resurrected outcome-unknown job: %v", err)
	}
	if processed, err := restartedRepo.drainOneWhatsAppMediaJob(ctx, time.Minute, []string{"*"}); processed || !errors.Is(err, errWhatsAppMediaBreakerOpen) {
		t.Fatalf("manual retry reopened durable breaker = processed:%v error:%v", processed, err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.media_jobs
		set status = 'failed', error_code = 'test_retired', error_message = 'fixture retired', failed_at = now()
		where id = $1::uuid
	`, staleJobID); err != nil {
		t.Fatal(err)
	}
	if err := resetMediaBreaker(ctx); err != nil {
		t.Fatal(err)
	}

	transportProviderMessageID := "provider-media-transport-unknown"
	var transportMessageRowID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_messages (
			organization_id, conversation_id, session_id,
			provider_message_id, message_id, from_me, direction,
			message_type, media_mime_type, media_status, media_size, status, sent_at
		) values (
			$1::uuid, $2::uuid, $3::uuid,
			$4, $4, false, 'inbound',
			'image', 'image/png', 'pending', $5, 'received', now()
		)
		returning id::text
	`, organizationID, enqueueInputs[4].conversationID, enqueueInputs[4].sessionID,
		transportProviderMessageID, len(mediaBytes)).Scan(&transportMessageRowID); err != nil {
		t.Fatal(err)
	}
	transportMessage := nativeEvolutionMessage{
		ProviderMessageID: transportProviderMessageID,
		MessageType:       "image",
		MediaMimeType:     "image/png",
		MediaSize:         int64(len(mediaBytes)),
		Raw: map[string]any{
			"message": map[string]any{
				"imageMessage": map[string]any{
					"directPath": "/media/transport",
					"fileLength": len(mediaBytes),
					"fileSha256": testWhatsAppMediaDigest("transport-media"),
				},
			},
		},
	}
	tx, err = postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	queued, enqueueErr = enqueueNativeEvolutionMediaJob(ctx, tx, nativeEvolutionSession{
		ID:             enqueueInputs[4].sessionID,
		OrganizationID: organizationID,
	}, enqueueInputs[4].conversationID, transportMessage, transportMessageRowID)
	if enqueueErr != nil || !queued {
		_ = tx.Rollback(ctx)
		t.Fatalf("transport fixture enqueue = queued:%v error:%v", queued, enqueueErr)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	processed, err = repo.drainOneWhatsAppMediaJob(ctx, time.Minute, []string{"*"})
	if err != nil || !processed {
		t.Fatalf("transport fixture drain = processed:%v error:%v", processed, err)
	}
	var transportJobStatus, transportJobError string
	var breakerOpen bool
	var breakerJobID string
	if err := postgres.Pool().QueryRow(ctx, `
		select job.status, coalesce(job.error_code, ''),
		       state.breaker_open, coalesce(state.breaker_job_id::text, '')
		from public.media_jobs as job
		cross join private.whatsapp_media_worker_state as state
		where job.organization_id = $1::uuid
		  and job.message_id = $2::uuid
		  and state.singleton = true
	`, organizationID, transportMessageRowID).Scan(
		&transportJobStatus,
		&transportJobError,
		&breakerOpen,
		&breakerJobID,
	); err != nil {
		t.Fatal(err)
	}
	if transportJobStatus != "failed" || transportJobError != mediaErrorOutcomeUnknown || !breakerOpen || breakerJobID == "" {
		t.Fatalf(
			"transport outcome = job:%q/%q breaker:%v/%q",
			transportJobStatus,
			transportJobError,
			breakerOpen,
			breakerJobID,
		)
	}
	if providerCalls.Load() != 3 || storageCalls.Load() != 1 {
		t.Fatalf("transport provider I/O = provider:%d storage:%d, want 3/1", providerCalls.Load(), storageCalls.Load())
	}
	if processed, err := restartedRepo.drainOneWhatsAppMediaJob(ctx, time.Minute, []string{"*"}); processed || !errors.Is(err, errWhatsAppMediaBreakerOpen) {
		t.Fatalf("transport breaker did not survive repository restart = processed:%v error:%v", processed, err)
	}

	legacyProviderMessageID := "provider-media-legacy-manual"
	var legacyMessageRowID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_messages (
			organization_id, conversation_id, session_id,
			provider_message_id, message_id, from_me, direction,
			message_type, media_mime_type, media_status, media_size,
			metadata, status, sent_at
		) values (
			$1::uuid, $2::uuid, $3::uuid,
			$4, $4, false, 'inbound',
			'image', 'image/png', 'failed', $5,
			'{}'::jsonb, 'received', now()
		)
		returning id::text
	`, organizationID, enqueueInputs[6].conversationID, enqueueInputs[6].sessionID,
		legacyProviderMessageID, len(mediaBytes)).Scan(&legacyMessageRowID); err != nil {
		t.Fatal(err)
	}
	var legacyJobID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.media_jobs (
			organization_id, session_id, conversation_id, message_id,
			provider_message_id, message_key, media_type, media_mime_type,
			status, attempts, max_attempts, next_retry_at,
			dedupe_key, asset_key, declared_size,
			error_code, error_message, failed_at
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, '{}'::jsonb, 'image', 'image/png',
			'failed', 0, 3, now(),
			$6, $6, null,
			'media_legacy_job_retired', 'legacy fixture', now()
		)
		returning id::text
	`, organizationID, enqueueInputs[6].sessionID, enqueueInputs[6].conversationID,
		legacyMessageRowID, legacyProviderMessageID,
		"legacy:"+legacyMessageRowID).Scan(&legacyJobID); err != nil {
		t.Fatal(err)
	}
	manualInput := retryMediaMessage{
		ID:             legacyMessageRowID,
		OrganizationID: organizationID,
	}
	type manualResult struct {
		result manualWhatsAppMediaEnqueueResult
		err    error
	}
	manualStart := make(chan struct{})
	manualResults := make(chan manualResult, 2)
	var manualGroup sync.WaitGroup
	for index := 0; index < 2; index++ {
		manualGroup.Add(1)
		go func() {
			defer manualGroup.Done()
			<-manualStart
			result, enqueueErr := repo.enqueueManualWhatsAppMediaJob(ctx, manualInput)
			manualResults <- manualResult{result: result, err: enqueueErr}
		}()
	}
	close(manualStart)
	manualGroup.Wait()
	close(manualResults)
	manualJobIDs := map[string]struct{}{}
	for result := range manualResults {
		if result.err != nil {
			t.Fatalf("concurrent manual enqueue failed: %v", result.err)
		}
		manualJobIDs[result.result.jobID] = struct{}{}
		if result.result.jobID == legacyJobID {
			t.Fatal("manual enqueue resurrected the retired legacy job")
		}
	}
	manualRedelivery := nativeEvolutionMessage{
		ProviderMessageID: legacyProviderMessageID,
		MessageType:       "image",
		MediaMimeType:     "image/png",
		MediaSize:         int64(len(mediaBytes)),
		Raw: map[string]any{
			"message": map[string]any{
				"imageMessage": map[string]any{
					"directPath": "/media/manual-redelivery",
					"fileLength": len(mediaBytes),
					"fileSha256": fileSHA256,
				},
			},
		},
	}
	tx, err = postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	queued, enqueueErr = enqueueNativeEvolutionMediaJob(ctx, tx, nativeEvolutionSession{
		ID:             enqueueInputs[6].sessionID,
		OrganizationID: organizationID,
	}, enqueueInputs[6].conversationID, manualRedelivery, legacyMessageRowID)
	if enqueueErr != nil || !queued {
		_ = tx.Rollback(ctx)
		t.Fatalf("native redelivery after manual enqueue = queued:%v error:%v", queued, enqueueErr)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var canonicalJobs, retiredJobs int
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*) filter (where error_code is distinct from 'media_legacy_job_retired')::integer,
		       count(*) filter (where error_code = 'media_legacy_job_retired')::integer
		from public.media_jobs
		where organization_id = $1::uuid and message_id = $2::uuid
	`, organizationID, legacyMessageRowID).Scan(&canonicalJobs, &retiredJobs); err != nil {
		t.Fatal(err)
	}
	if len(manualJobIDs) != 1 || canonicalJobs != 1 || retiredJobs != 1 {
		t.Fatalf("manual canonicalization = ids:%d canonical:%d retired:%d", len(manualJobIDs), canonicalJobs, retiredJobs)
	}
}
