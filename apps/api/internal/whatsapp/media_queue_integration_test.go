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

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)

	var migrationReady bool
	if err := postgres.Pool().QueryRow(ctx, `
		select to_regprocedure('private.claim_whatsapp_media_job(text,interval,integer,uuid[],boolean)') is not null
	`).Scan(&migrationReady); err != nil {
		t.Fatal(err)
	}
	if !migrationReady {
		t.Fatal("WhatsApp media queue migration is not applied to WHATSAPP_TEST_DATABASE_URL")
	}
	var serviceCanInsert, serviceCanSelect, serviceCanUpdate, serviceCanReadLegacyState bool
	var serviceCanClaimLegacy, serviceCanClaimCompat, serviceCanClaimTyped bool
	if err := postgres.Pool().QueryRow(ctx, `
		select
			has_table_privilege('service_role', 'public.media_jobs', 'insert'),
			has_table_privilege('service_role', 'public.media_jobs', 'select'),
			has_table_privilege('service_role', 'public.media_jobs', 'update'),
			has_table_privilege('service_role', 'private.whatsapp_media_worker_state', 'select'),
			has_function_privilege('service_role', 'private.claim_whatsapp_media_job(text, interval)', 'execute'),
			has_function_privilege('service_role', 'private.claim_whatsapp_media_job(text, interval, integer, text[])', 'execute'),
			has_function_privilege('service_role', 'private.claim_whatsapp_media_job(text, interval, integer, uuid[], boolean)', 'execute')
	`).Scan(
		&serviceCanInsert,
		&serviceCanSelect,
		&serviceCanUpdate,
		&serviceCanReadLegacyState,
		&serviceCanClaimLegacy,
		&serviceCanClaimCompat,
		&serviceCanClaimTyped,
	); err != nil {
		t.Fatal(err)
	}
	if !serviceCanInsert || serviceCanSelect || serviceCanUpdate || serviceCanReadLegacyState ||
		serviceCanClaimLegacy || serviceCanClaimCompat || serviceCanClaimTyped {
		t.Fatalf(
			"media queue privileges = insert:%v select:%v update:%v legacy_state_select:%v legacy_claim:%v compat_claim:%v typed_claim:%v",
			serviceCanInsert,
			serviceCanSelect,
			serviceCanUpdate,
			serviceCanReadLegacyState,
			serviceCanClaimLegacy,
			serviceCanClaimCompat,
			serviceCanClaimTyped,
		)
	}

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
	var storageExistenceCalls atomic.Int32
	var directMediaURLCalls atomic.Int32
	var storagePathsMu sync.Mutex
	storagePaths := []string{}
	storedObjects := map[string]bool{}
	storage := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method == http.MethodGet && strings.HasPrefix(request.URL.Path, "/direct-media/") {
			directMediaURLCalls.Add(1)
			response.Header().Set("Content-Type", "application/octet-stream")
			_, _ = response.Write([]byte("encrypted-media-must-not-be-read-directly"))
			return
		}
		const storageObjectPrefix = "/storage/v1/object/whatsapp-media/"
		if !strings.HasPrefix(request.URL.Path, storageObjectPrefix) {
			http.NotFound(response, request)
			return
		}
		objectPath := strings.TrimPrefix(request.URL.Path, storageObjectPrefix)
		switch request.Method {
		case http.MethodGet:
			storageExistenceCalls.Add(1)
			if request.Header.Get("Range") != "bytes=0-0" {
				t.Errorf("Storage existence Range = %q, want bytes=0-0", request.Header.Get("Range"))
			}
			storagePathsMu.Lock()
			exists := storedObjects[objectPath]
			storagePathsMu.Unlock()
			if !exists {
				http.NotFound(response, request)
				return
			}
			response.Header().Set("Content-Range", "bytes 0-0/1")
			response.WriteHeader(http.StatusPartialContent)
			_, _ = response.Write([]byte{0})
		case http.MethodPost:
			storageCalls.Add(1)
			storagePathsMu.Lock()
			storagePaths = append(storagePaths, objectPath)
			storedObjects[objectPath] = true
			storagePathsMu.Unlock()
			response.WriteHeader(http.StatusOK)
		default:
			http.NotFound(response, request)
		}
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
			MediaURL:          fmt.Sprintf("%s/direct-media/%02d.enc", storage.URL, index),
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
			job, claimErr := repo.claimWhatsAppMediaJob(ctx, 5*time.Minute)
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
	if _, err := repo.claimWhatsAppMediaJob(ctx, 30*time.Second); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("30-second claimant expired another worker's 5-minute lease: %v", err)
	}
	code, permanent, err := repo.processQueuedWhatsAppMediaJob(ctx, claimedJobs[0])
	if err != nil {
		t.Fatalf("claimed media process = code:%q permanent:%v error:%v", code, permanent, err)
	}
	processed, err := repo.drainOneWhatsAppMediaJob(ctx, time.Minute)
	if err != nil || processed {
		t.Fatalf("second media drain = processed:%v error:%v, want empty queue", processed, err)
	}

	if got := providerCalls.Load(); got != 1 {
		t.Fatalf("provider calls = %d, want exactly one for nineteen sessions", got)
	}
	if got := storageCalls.Load(); got != 1 {
		t.Fatalf("storage uploads = %d, want exactly one for nineteen sessions", got)
	}
	if got := directMediaURLCalls.Load(); got != 0 {
		t.Fatalf("encrypted direct media URL reads = %d, want zero", got)
	}
	storagePathsMu.Lock()
	paths := append([]string(nil), storagePaths...)
	storagePathsMu.Unlock()
	expectedPath := fmt.Sprintf("orgs/%s/assets/%s/%s.png", organizationID, whatsappMediaAssetVersion, expectedAssetKey)
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
	tx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	queued, enqueueErr := enqueueNativeEvolutionMediaJob(ctx, tx, nativeEvolutionSession{
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
	claimedDisconnectedJob, err := repo.claimWhatsAppMediaJob(ctx, time.Minute)
	if err != nil {
		t.Fatalf("claim before connection flap: %v", err)
	}
	if claimedDisconnectedJob.MessageID != disconnectedMessageRowID || claimedDisconnectedJob.Attempts != 1 {
		t.Fatalf(
			"claim before connection flap = message:%q attempts:%d",
			claimedDisconnectedJob.MessageID,
			claimedDisconnectedJob.Attempts,
		)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_sessions
		set status = 'disconnected'
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, enqueueInputs[1].sessionID); err != nil {
		t.Fatal(err)
	}
	_, _, processDisconnectedErr := repo.processQueuedWhatsAppMediaJob(ctx, claimedDisconnectedJob)
	if !errors.Is(processDisconnectedErr, errWhatsAppMediaSessionDisconnected) {
		t.Fatalf("connection flap process error = %v, want disconnected sentinel", processDisconnectedErr)
	}
	if err := repo.deferWhatsAppMediaJobDisconnected(ctx, claimedDisconnectedJob, false); err != nil {
		t.Fatalf("release disconnected media claim: %v", err)
	}
	processed, err = repo.drainOneWhatsAppMediaJob(ctx, time.Minute)
	if err != nil || processed {
		t.Fatalf("disconnected-session hot claim = processed:%v error:%v", processed, err)
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
	if disconnectedJobStatus != "pending" || disconnectedAttempts != 0 || disconnectedMessageStatus != "pending" || disconnectedMessageError != "" {
		t.Fatalf(
			"disconnected session state = job:%q attempts:%d message:%q error:%q",
			disconnectedJobStatus,
			disconnectedAttempts,
			disconnectedMessageStatus,
			disconnectedMessageError,
		)
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
	processed, err = repo.drainOneWhatsAppMediaJob(ctx, time.Minute)
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
	processed, err = repo.drainOneWhatsAppMediaJob(ctx, time.Minute)
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

	racingJobID, _, err := repo.enqueueManualWhatsAppMediaJob(ctx, retryMediaMessage{
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
	racingJob, err := repo.claimWhatsAppMediaJob(ctx, 5*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if racingJob.ID != racingJobID || !racingJob.ManualRequested {
		t.Fatalf("breaker race claimed job = %q manual:%v, want %q", racingJob.ID, racingJob.ManualRequested, racingJobID)
	}
	if err := repo.markWhatsAppMediaProviderStarted(ctx, racingJob); err != nil {
		t.Fatal(err)
	}
	if err := repo.retryOrFailWhatsAppMediaJob(
		ctx,
		racingJob,
		mediaErrorOutcomeUnknown,
		true,
		fmt.Errorf("%w: simulated provider transport outcome", ErrProviderOutcomeUnknown),
	); err != nil {
		t.Fatalf("isolated provider outcome transaction failed: %v", err)
	}
	followerJob, err := repo.claimWhatsAppMediaJobForSessions(
		ctx,
		30*time.Second,
		4,
		[]string{enqueueInputs[5].sessionID},
	)
	if err != nil {
		t.Fatalf("unrelated session was blocked by another session's provider outcome: %v", err)
	}
	if followerJob.MessageID != raceFollowerMessageRowID || followerJob.SessionID != enqueueInputs[5].sessionID {
		t.Fatalf("isolated follower claim = message:%q session:%q", followerJob.MessageID, followerJob.SessionID)
	}
	var legacyBreakerOpen bool
	if err := postgres.Pool().QueryRow(ctx, `
		select breaker_open
		from private.whatsapp_media_worker_state
		where singleton = true
	`).Scan(&legacyBreakerOpen); err != nil {
		t.Fatal(err)
	}
	if legacyBreakerOpen {
		t.Fatal("isolated provider outcome reopened the retired global media breaker")
	}
	if err := repo.retryOrFailWhatsAppMediaJob(
		ctx,
		followerJob,
		"test_retired",
		true,
		errors.New("fixture retired after isolation assertion"),
	); err != nil {
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
			processing_slot, provider_started_at
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, '{}'::jsonb, 'image', 'image/png',
			'processing', 1, 3, now(),
			$6, $7, $8, $9,
			now() - interval '10 minutes', now() - interval '5 minutes', interval '5 minutes',
			'crashed-worker', gen_random_uuid(), 1, now() - interval '10 minutes'
		)
		returning id::text
	`, organizationID, enqueueInputs[3].sessionID, enqueueInputs[3].conversationID,
		staleMessageRowID, staleProviderMessageID,
		hashWhatsAppMediaKey("stale-job", staleProviderMessageID),
		hashWhatsAppMediaKey("stale-asset", staleProviderMessageID),
		len(mediaBytes), fileSHA256).Scan(&staleJobID); err != nil {
		t.Fatal(err)
	}
	processed, err = repo.drainOneWhatsAppMediaJob(ctx, time.Minute)
	if processed || err != nil {
		t.Fatalf("expired provider lease drain = processed:%v error:%v, want isolated cooldown", processed, err)
	}
	var staleJobStatus, staleJobError, staleMessageStatus, staleMessageError string
	var staleProviderMarkerCleared bool
	if err := postgres.Pool().QueryRow(ctx, `
		select job.status, coalesce(job.error_code, ''),
		       coalesce(message.media_status, ''), coalesce(message.media_error, ''),
		       job.provider_started_at is null
		from public.media_jobs as job
		join public.whatsapp_messages as message on message.id = job.message_id
		where job.id = $1::uuid
	`, staleJobID).Scan(&staleJobStatus, &staleJobError, &staleMessageStatus, &staleMessageError, &staleProviderMarkerCleared); err != nil {
		t.Fatal(err)
	}
	if staleJobStatus != "pending" || staleJobError != mediaErrorOutcomeUnknown ||
		staleMessageStatus != "pending" || staleMessageError != mediaErrorRetry || !staleProviderMarkerCleared {
		t.Fatalf(
			"expired provider outcome = job:%q/%q message:%q/%q marker-cleared:%v",
			staleJobStatus,
			staleJobError,
			staleMessageStatus,
			staleMessageError,
			staleProviderMarkerCleared,
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
	if processed, err := restartedRepo.drainOneWhatsAppMediaJob(ctx, time.Minute); processed || err != nil {
		t.Fatalf("restarted worker ignored isolated retry cooldown = processed:%v error:%v", processed, err)
	}
	manualJobID, deduplicated, err := repo.enqueueManualWhatsAppMediaJob(ctx, retryMediaMessage{
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
	if err != nil || !deduplicated || manualJobID != staleJobID {
		t.Fatalf("manual retry of isolated job = job:%q deduplicated:%v error:%v", manualJobID, deduplicated, err)
	}
	var quarantineReason string
	var quarantineStillActive bool
	if err := postgres.Pool().QueryRow(ctx, `
		select reason, quarantined_until > now()
		from private.whatsapp_media_session_quarantine
		where session_id = $1::uuid
	`, enqueueInputs[3].sessionID).Scan(&quarantineReason, &quarantineStillActive); err != nil {
		t.Fatal(err)
	}
	if quarantineReason != mediaErrorOutcomeUnknown || !quarantineStillActive {
		t.Fatalf(
			"manual retry mutated provider outcome quarantine = reason:%q active:%v",
			quarantineReason,
			quarantineStillActive,
		)
	}
	manualClaim, err := restartedRepo.claimWhatsAppMediaJobForSessions(
		ctx,
		time.Minute,
		4,
		[]string{enqueueInputs[3].sessionID},
	)
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf(
			"manual retry bypassed active provider outcome quarantine = job:%q manual:%v error:%v",
			manualClaim.ID,
			manualClaim.ManualRequested,
			err,
		)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update private.whatsapp_media_session_quarantine
		set quarantined_until = now() - interval '1 second', updated_at = now()
		where session_id = $1::uuid
		  and reason = $2
	`, enqueueInputs[3].sessionID, mediaErrorOutcomeUnknown); err != nil {
		t.Fatal(err)
	}
	manualClaim, err = restartedRepo.claimWhatsAppMediaJobForSessions(
		ctx,
		time.Minute,
		4,
		[]string{enqueueInputs[3].sessionID},
	)
	if err != nil || manualClaim.ID != staleJobID || !manualClaim.ManualRequested {
		t.Fatalf("manual retry was not claimable after quarantine expiry = job:%q manual:%v error:%v", manualClaim.ID, manualClaim.ManualRequested, err)
	}
	if err := restartedRepo.retryOrFailWhatsAppMediaJob(
		ctx,
		manualClaim,
		"test_retired",
		true,
		errors.New("fixture retired after isolated stale recovery assertion"),
	); err != nil {
		t.Fatal(err)
	}

	preProviderCrashID := "provider-media-pre-provider-crash"
	var preProviderCrashMessageRowID, preProviderCrashJobID string
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
	`, organizationID, enqueueInputs[6].conversationID, enqueueInputs[6].sessionID,
		preProviderCrashID, len(mediaBytes)).Scan(&preProviderCrashMessageRowID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.media_jobs (
			organization_id, session_id, conversation_id, message_id,
			provider_message_id, message_key, media_type, media_mime_type,
			status, attempts, max_attempts, next_retry_at,
			dedupe_key, asset_key, declared_size,
			locked_at, lease_expires_at, lease_duration, locked_by, lease_token,
			processing_slot, provider_started_at
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, '{}'::jsonb, 'image', 'image/png',
			'processing', 3, 3, now(),
			$6, $7, $8,
			now() - interval '10 minutes', now() - interval '5 minutes', interval '5 minutes',
			'crashed-before-provider', gen_random_uuid(), 1, null
		)
		returning id::text
	`, organizationID, enqueueInputs[6].sessionID, enqueueInputs[6].conversationID,
		preProviderCrashMessageRowID, preProviderCrashID,
		hashWhatsAppMediaKey("pre-provider-crash-job", preProviderCrashID),
		hashWhatsAppMediaKey("pre-provider-crash-asset", preProviderCrashID),
		len(mediaBytes)).Scan(&preProviderCrashJobID); err != nil {
		t.Fatal(err)
	}
	preProviderReclaim, err := repo.claimWhatsAppMediaJobForSessions(
		ctx,
		time.Minute,
		4,
		[]string{enqueueInputs[6].sessionID},
	)
	if err != nil {
		t.Fatalf("reclaim crashed pre-provider final attempt: %v", err)
	}
	if preProviderReclaim.ID != preProviderCrashJobID || preProviderReclaim.Attempts != 3 {
		t.Fatalf(
			"pre-provider final-attempt reclaim = id:%q attempts:%d, want id:%q attempts:3",
			preProviderReclaim.ID,
			preProviderReclaim.Attempts,
			preProviderCrashJobID,
		)
	}
	if err := repo.retryOrFailWhatsAppMediaJob(
		ctx,
		preProviderReclaim,
		"test_retired",
		true,
		errors.New("fixture retired after pre-provider attempt recovery assertion"),
	); err != nil {
		t.Fatal(err)
	}

	legacyPoisonProviderMessageID := "provider-media-legacy-pending-poison"
	var legacyPoisonMessageRowID, legacyPoisonJobID string
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
	`, organizationID, enqueueInputs[7].conversationID, enqueueInputs[7].sessionID,
		legacyPoisonProviderMessageID, len(mediaBytes)).Scan(&legacyPoisonMessageRowID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.media_jobs (
			organization_id, session_id, conversation_id, message_id,
			provider_message_id, message_key, media_type, media_mime_type,
			status, attempts, max_attempts, next_retry_at,
			dedupe_key, asset_key, declared_size,
			locked_at, lease_expires_at, lease_duration, locked_by, lease_token,
			processing_slot, provider_started_at
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, '{}'::jsonb, 'image', 'image/png',
			'pending', 3, 3, now() - interval '5 minutes',
			$6, $7, $8,
			null, null, null, null, null,
			null, null
		)
		returning id::text
	`, organizationID, enqueueInputs[7].sessionID, enqueueInputs[7].conversationID,
		legacyPoisonMessageRowID, legacyPoisonProviderMessageID,
		hashWhatsAppMediaKey("legacy-pending-poison-job", legacyPoisonProviderMessageID),
		hashWhatsAppMediaKey("legacy-pending-poison-asset", legacyPoisonProviderMessageID),
		len(mediaBytes)).Scan(&legacyPoisonJobID); err != nil {
		t.Fatal(err)
	}
	legacyPoisonReclaim, err := repo.claimWhatsAppMediaJobForSessions(
		ctx,
		time.Minute,
		4,
		[]string{enqueueInputs[7].sessionID},
	)
	if err != nil {
		t.Fatalf("repair legacy pending pre-provider final attempt: %v", err)
	}
	if legacyPoisonReclaim.ID != legacyPoisonJobID || legacyPoisonReclaim.Attempts != 3 {
		t.Fatalf(
			"legacy pending poison reclaim = id:%q attempts:%d, want id:%q attempts:3",
			legacyPoisonReclaim.ID,
			legacyPoisonReclaim.Attempts,
			legacyPoisonJobID,
		)
	}
	if err := repo.retryOrFailWhatsAppMediaJob(
		ctx,
		legacyPoisonReclaim,
		"test_retired",
		true,
		errors.New("fixture retired after legacy pending poison recovery assertion"),
	); err != nil {
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
	processed, err = repo.drainOneWhatsAppMediaJob(ctx, time.Minute)
	if err != nil || !processed {
		t.Fatalf("transport fixture drain = processed:%v error:%v", processed, err)
	}
	var transportJobStatus, transportJobError string
	var legacyTransportBreakerOpen, transportSessionQuarantined bool
	if err := postgres.Pool().QueryRow(ctx, `
		select job.status, coalesce(job.error_code, ''),
		       state.breaker_open,
		       exists (
		         select 1
		         from private.whatsapp_media_session_quarantine as quarantine
		         where quarantine.session_id = job.session_id
		           and quarantine.job_id = job.id
		           and quarantine.reason = 'media_provider_outcome_unknown'
		           and quarantine.quarantined_until > now()
		       )
		from public.media_jobs as job
		cross join private.whatsapp_media_worker_state as state
		where job.organization_id = $1::uuid
		  and job.message_id = $2::uuid
		  and state.singleton = true
	`, organizationID, transportMessageRowID).Scan(
		&transportJobStatus,
		&transportJobError,
		&legacyTransportBreakerOpen,
		&transportSessionQuarantined,
	); err != nil {
		t.Fatal(err)
	}
	if transportJobStatus != "pending" || transportJobError != mediaErrorOutcomeUnknown ||
		legacyTransportBreakerOpen || !transportSessionQuarantined {
		t.Fatalf(
			"transport outcome = job:%q/%q legacy-breaker:%v session-quarantine:%v",
			transportJobStatus,
			transportJobError,
			legacyTransportBreakerOpen,
			transportSessionQuarantined,
		)
	}
	if providerCalls.Load() != 3 || storageCalls.Load() != 1 {
		t.Fatalf("transport provider I/O = provider:%d storage:%d, want 3/1", providerCalls.Load(), storageCalls.Load())
	}
	if processed, err := restartedRepo.drainOneWhatsAppMediaJob(ctx, time.Minute); processed || err != nil {
		t.Fatalf("transport retry backoff did not survive repository restart = processed:%v error:%v", processed, err)
	}

	uploadIntentProviderMessageID := "provider-media-upload-intent-committed"
	var uploadIntentMessageRowID string
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
	`, organizationID, enqueueInputs[8].conversationID, enqueueInputs[8].sessionID,
		uploadIntentProviderMessageID, len(mediaBytes)).Scan(&uploadIntentMessageRowID); err != nil {
		t.Fatal(err)
	}
	uploadIntentAssetKey := hashWhatsAppMediaKey("upload-intent-committed-asset", uploadIntentProviderMessageID)
	uploadIntentJobShape := queuedWhatsAppMediaJob{
		OrganizationID: organizationID,
		SessionID:      enqueueInputs[8].sessionID,
		MessageID:      uploadIntentMessageRowID,
		MediaType:      "image",
		MediaMimeType:  "image/png",
		DeclaredSize:   int64(len(mediaBytes)),
		AssetKey:       uploadIntentAssetKey,
	}
	uploadIntentPath := whatsappMediaObjectPath(uploadIntentJobShape, "image/png", "")
	uploadIntentMessageKey := jsonb(map[string]any{
		"provider_message_id":          uploadIntentProviderMessageID,
		whatsappMediaUploadPathKey:     uploadIntentPath,
		whatsappMediaUploadMIMEKey:     "image/png",
		whatsappMediaUploadSizeKey:     len(mediaBytes),
		whatsappMediaUploadFailuresKey: 1,
	})
	storagePathsMu.Lock()
	storedObjects[uploadIntentPath] = true
	storagePathsMu.Unlock()
	var uploadIntentJobID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.media_jobs (
			organization_id, session_id, conversation_id, message_id,
			provider_message_id, message_key, media_type, media_mime_type,
			status, attempts, max_attempts, next_retry_at,
			dedupe_key, asset_key, declared_size, file_sha256
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, $6::jsonb, 'image', 'image/png',
			'pending', 2, 3, now(),
			$7, $8, $9, $10
		)
		returning id::text
	`, organizationID, enqueueInputs[8].sessionID, enqueueInputs[8].conversationID,
		uploadIntentMessageRowID, uploadIntentProviderMessageID, uploadIntentMessageKey,
		hashWhatsAppMediaKey("upload-intent-committed-job", uploadIntentProviderMessageID),
		uploadIntentAssetKey, len(mediaBytes), fileSHA256).Scan(&uploadIntentJobID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_sessions
		set status = 'deleted', is_active = false
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, enqueueInputs[8].sessionID); err != nil {
		t.Fatal(err)
	}
	providerCallsBeforeIntent := providerCalls.Load()
	storageUploadsBeforeIntent := storageCalls.Load()
	storageReadsBeforeIntent := storageExistenceCalls.Load()
	claimedUploadIntent, err := repo.claimWhatsAppMediaJobForSessions(
		ctx,
		time.Minute,
		4,
		[]string{enqueueInputs[8].sessionID},
	)
	if err != nil || claimedUploadIntent.ID != uploadIntentJobID {
		t.Fatalf(
			"claim committed upload intent for soft-deleted session = job:%q error:%v",
			claimedUploadIntent.ID,
			err,
		)
	}
	code, permanent, err = repo.processQueuedWhatsAppMediaJob(ctx, claimedUploadIntent)
	if err != nil || code != "" || permanent {
		t.Fatalf(
			"finalize committed upload intent for soft-deleted session = code:%q permanent:%v error:%v",
			code,
			permanent,
			err,
		)
	}
	if providerCalls.Load() != providerCallsBeforeIntent || storageCalls.Load() != storageUploadsBeforeIntent {
		t.Fatalf(
			"committed upload intent repeated external I/O = provider:%d->%d storage_post:%d->%d",
			providerCallsBeforeIntent,
			providerCalls.Load(),
			storageUploadsBeforeIntent,
			storageCalls.Load(),
		)
	}
	if storageExistenceCalls.Load() != storageReadsBeforeIntent+1 {
		t.Fatalf(
			"committed upload intent Storage existence reads = %d, want %d",
			storageExistenceCalls.Load(),
			storageReadsBeforeIntent+1,
		)
	}
	var uploadIntentJobStatus, uploadIntentMessageStatus, persistedUploadIntentPath string
	var uploadIntentMetadataCleared bool
	if err := postgres.Pool().QueryRow(ctx, `
		select job.status,
		       coalesce(message.media_status, ''),
		       coalesce(job.storage_path, ''),
		       not (job.message_key ? $2 or job.message_key ? $3 or job.message_key ? $4 or job.message_key ? $5)
		from public.media_jobs as job
		join public.whatsapp_messages as message on message.id = job.message_id
		where job.id = $1::uuid
	`, uploadIntentJobID,
		whatsappMediaUploadPathKey,
		whatsappMediaUploadMIMEKey,
		whatsappMediaUploadSizeKey,
		whatsappMediaUploadFailuresKey,
	).Scan(
		&uploadIntentJobStatus,
		&uploadIntentMessageStatus,
		&persistedUploadIntentPath,
		&uploadIntentMetadataCleared,
	); err != nil {
		t.Fatal(err)
	}
	if uploadIntentJobStatus != "completed" || uploadIntentMessageStatus != "ready" ||
		persistedUploadIntentPath != uploadIntentPath || !uploadIntentMetadataCleared {
		t.Fatalf(
			"committed upload intent final state = job:%q message:%q path:%q metadata-cleared:%v",
			uploadIntentJobStatus,
			uploadIntentMessageStatus,
			persistedUploadIntentPath,
			uploadIntentMetadataCleared,
		)
	}

	repairProviderMessageID := "provider-media-invalid-storage-repair"
	invalidStoragePath := fmt.Sprintf(
		"orgs/%s/sessions/%s/incoming/%s.audio",
		organizationID,
		enqueueInputs[0].sessionID,
		repairProviderMessageID,
	)
	repairRaw := map[string]any{
		"message": map[string]any{
			"imageMessage": map[string]any{
				"directPath":    "/media/invalid-storage-repair",
				"fileLength":    len(mediaBytes),
				"fileSha256":    fileSHA256,
				"fileEncSha256": testWhatsAppMediaDigest("invalid-storage-repair-ciphertext"),
			},
		},
	}
	var repairMessageRowID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_messages (
			organization_id, conversation_id, session_id,
			provider_message_id, message_id, from_me, direction,
			message_type, media_mime_type, media_status, media_storage_path,
			media_size, metadata, status, sent_at
		) values (
			$1::uuid, $2::uuid, $3::uuid,
			$4, $4, false, 'inbound',
			'image', 'image/png', 'ready', $5,
			$6, $7::jsonb, 'received', now()
		)
		returning id::text
	`, organizationID, enqueueInputs[0].conversationID, enqueueInputs[0].sessionID,
		repairProviderMessageID, invalidStoragePath, len(mediaBytes), jsonb(map[string]any{"raw": repairRaw}),
	).Scan(&repairMessageRowID); err != nil {
		t.Fatal(err)
	}
	repairMessage := retryMediaMessage{
		ID:               repairMessageRowID,
		OrganizationID:   organizationID,
		ConversationID:   enqueueInputs[0].conversationID,
		SessionID:        enqueueInputs[0].sessionID,
		MessageID:        repairProviderMessageID,
		MessageType:      "image",
		MediaMimeType:    "image/png",
		MediaStoragePath: invalidStoragePath,
		MediaSize:        int64(len(mediaBytes)),
		Metadata:         map[string]any{"raw": repairRaw},
	}
	repairDedupeKey, repairAssetKey, repairFileSHA256, repairFileEncSHA256 := whatsappMediaQueueKeys(
		organizationID,
		enqueueInputs[0].sessionID,
		nativeEvolutionMessage{
			ProviderMessageID: repairProviderMessageID,
			MessageType:       "image",
			MediaMimeType:     "image/png",
			MediaSize:         int64(len(mediaBytes)),
			Raw:               repairRaw,
		},
	)
	var originalRepairJobID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.media_jobs (
			organization_id, session_id, conversation_id, message_id,
			provider_message_id, message_key, media_type, media_mime_type,
			status, attempts, max_attempts, next_retry_at,
			dedupe_key, asset_key, declared_size, file_sha256, file_enc_sha256,
			storage_path, actual_size, completed_at
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, '{}'::jsonb, 'image', 'image/png',
			'completed', 1, 3, now(),
			$6, $7, $8, nullif($9, ''), nullif($10, ''),
			$11, $8, now()
		)
		returning id::text
	`, organizationID, enqueueInputs[0].sessionID, enqueueInputs[0].conversationID,
		repairMessageRowID, repairProviderMessageID, repairDedupeKey, repairAssetKey,
		len(mediaBytes), repairFileSHA256, repairFileEncSHA256, invalidStoragePath,
	).Scan(&originalRepairJobID); err != nil {
		t.Fatal(err)
	}

	repairSiblingProviderMessageID := "provider-media-invalid-storage-repair-sibling"
	var repairSiblingMessageRowID, repairSiblingJobID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_messages (
			organization_id, conversation_id, session_id,
			provider_message_id, message_id, from_me, direction,
			message_type, media_mime_type, media_status, media_storage_path,
			media_size, metadata, status, sent_at
		) values (
			$1::uuid, $2::uuid, $3::uuid,
			$4, $4, false, 'inbound',
			'image', 'image/png', 'ready', $5,
			$6, '{}'::jsonb, 'received', now()
		)
		returning id::text
	`, organizationID, enqueueInputs[9].conversationID, enqueueInputs[9].sessionID,
		repairSiblingProviderMessageID, invalidStoragePath, len(mediaBytes),
	).Scan(&repairSiblingMessageRowID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.media_jobs (
			organization_id, session_id, conversation_id, message_id,
			provider_message_id, message_key, media_type, media_mime_type,
			status, attempts, max_attempts, next_retry_at,
			dedupe_key, asset_key, declared_size, file_sha256,
			storage_path, actual_size, completed_at
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, '{}'::jsonb, 'image', 'image/png',
			'completed', 1, 3, now(),
			$6, $7, $8, nullif($9, ''),
			$10, $8, now()
		)
		returning id::text
	`, organizationID, enqueueInputs[9].sessionID, enqueueInputs[9].conversationID,
		repairSiblingMessageRowID, repairSiblingProviderMessageID,
		hashWhatsAppMediaKey("repair-sibling-job", repairSiblingProviderMessageID),
		repairAssetKey, len(mediaBytes), repairFileSHA256, invalidStoragePath,
	).Scan(&repairSiblingJobID); err != nil {
		t.Fatal(err)
	}
	firstRepairJobID, firstDeduplicated, err := repo.enqueueManualWhatsAppMediaJob(ctx, repairMessage)
	if err != nil || !firstDeduplicated || firstRepairJobID != originalRepairJobID {
		t.Fatalf("first invalid-object repair enqueue = job:%q deduplicated:%v error:%v", firstRepairJobID, firstDeduplicated, err)
	}
	secondRepairJobID, secondDeduplicated, err := repo.enqueueManualWhatsAppMediaJob(ctx, repairMessage)
	if err != nil || !secondDeduplicated || secondRepairJobID != firstRepairJobID {
		t.Fatalf(
			"idempotent invalid-object repair enqueue = first:%q second:%q deduplicated:%v error:%v",
			firstRepairJobID,
			secondRepairJobID,
			secondDeduplicated,
			err,
		)
	}
	var repairMessageStatus, persistedRepairPath, queuedRepairPath string
	if err := postgres.Pool().QueryRow(ctx, `
		select coalesce(message.media_status, ''),
		       coalesce(message.media_storage_path, ''),
		       coalesce(job.message_key ->> $3, '')
		from public.whatsapp_messages as message
		join public.media_jobs as job
		  on job.organization_id = message.organization_id
		 and job.message_id = message.id
		where message.organization_id = $1::uuid
		  and message.id = $2::uuid
	`, organizationID, repairMessageRowID, whatsappMediaRepairPathKey).Scan(
		&repairMessageStatus,
		&persistedRepairPath,
		&queuedRepairPath,
	); err != nil {
		t.Fatal(err)
	}
	if repairMessageStatus != "pending" || persistedRepairPath != "" || queuedRepairPath != invalidStoragePath {
		t.Fatalf(
			"invalid-object repair state = status:%q message_path:%q queued_path:%q",
			repairMessageStatus,
			persistedRepairPath,
			queuedRepairPath,
		)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.media_jobs
		set next_retry_at = now() + interval '1 hour'
		where id = $1::uuid and status = 'pending'
	`, racingJobID); err != nil {
		t.Fatal(err)
	}
	repairProviderCallsBefore := providerCalls.Load()
	repairStorageCallsBefore := storageCalls.Load()
	repairStorageReadsBefore := storageExistenceCalls.Load()
	claimedRepairJob, err := repo.claimWhatsAppMediaJobForSessions(
		ctx,
		time.Minute,
		4,
		[]string{enqueueInputs[0].sessionID},
	)
	if err != nil || claimedRepairJob.ID != firstRepairJobID {
		t.Fatalf(
			"claim completed-asset repair = job:%q error:%v, want %q",
			claimedRepairJob.ID,
			err,
			firstRepairJobID,
		)
	}
	expectedRepairPath := whatsappMediaObjectPath(claimedRepairJob, "image/png", invalidStoragePath)
	repairCompletionBlocker, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repairCompletionBlocker.Exec(ctx, `
		select id
		from public.whatsapp_messages
		where id = $1::uuid
		for update
	`, repairSiblingMessageRowID); err != nil {
		_ = repairCompletionBlocker.Rollback(ctx)
		t.Fatal(err)
	}
	blockedRepairCtx, cancelBlockedRepair := context.WithTimeout(ctx, 2*time.Second)
	code, permanent, err = repo.processQueuedWhatsAppMediaJob(blockedRepairCtx, claimedRepairJob)
	cancelBlockedRepair()
	if rollbackErr := repairCompletionBlocker.Rollback(ctx); rollbackErr != nil && !errors.Is(rollbackErr, pgx.ErrTxClosed) {
		t.Fatal(rollbackErr)
	}
	if !errors.Is(err, errWhatsAppMediaLocalFinalizePending) || code != mediaErrorFinalizeLocal || permanent {
		t.Fatalf(
			"blocked completed-asset repair finalization = code:%q permanent:%v error:%v",
			code,
			permanent,
			err,
		)
	}
	if providerCalls.Load() != repairProviderCallsBefore+1 || storageCalls.Load() != repairStorageCallsBefore+1 {
		t.Fatalf(
			"completed-asset sibling repair external I/O = provider:%d->%d storage:%d->%d, want one each",
			repairProviderCallsBefore,
			providerCalls.Load(),
			repairStorageCallsBefore,
			storageCalls.Load(),
		)
	}
	if storageExistenceCalls.Load() != repairStorageReadsBefore {
		t.Fatalf(
			"completed-asset sibling repair unexpectedly reconciled Storage %d times",
			storageExistenceCalls.Load()-repairStorageReadsBefore,
		)
	}
	var repairDurablePath, persistedRepairMarker, repairJobStatus string
	var repairDurableSize int64
	if err := postgres.Pool().QueryRow(ctx, `
		select status, coalesce(storage_path, ''), coalesce(actual_size, 0),
		       coalesce(message_key->>$2, '')
		from public.media_jobs
		where id = $1::uuid
	`, firstRepairJobID, whatsappMediaRepairPathKey).Scan(
		&repairJobStatus,
		&repairDurablePath,
		&repairDurableSize,
		&persistedRepairMarker,
	); err != nil {
		t.Fatal(err)
	}
	if repairJobStatus != "processing" || repairDurablePath != expectedRepairPath ||
		repairDurableSize != int64(len(mediaBytes)) || persistedRepairMarker != invalidStoragePath {
		t.Fatalf(
			"repair crash boundary = status:%q path:%q size:%d marker:%q",
			repairJobStatus,
			repairDurablePath,
			repairDurableSize,
			persistedRepairMarker,
		)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.media_jobs
		set lease_expires_at = now() - interval '1 second',
		    locked_at = now() - interval '2 minutes'
		where id = $1::uuid and status = 'processing'
	`, firstRepairJobID); err != nil {
		t.Fatal(err)
	}
	resumedRepairJob, err := repo.claimWhatsAppMediaJobForSessions(
		ctx,
		time.Minute,
		4,
		[]string{enqueueInputs[0].sessionID},
	)
	if err != nil || resumedRepairJob.ID != firstRepairJobID ||
		resumedRepairJob.StoragePath != expectedRepairPath ||
		firstString(resumedRepairJob.MessageKey, whatsappMediaRepairPathKey) != invalidStoragePath {
		t.Fatalf(
			"reclaim durable repair after worker crash = job:%q path:%q marker:%q error:%v",
			resumedRepairJob.ID,
			resumedRepairJob.StoragePath,
			firstString(resumedRepairJob.MessageKey, whatsappMediaRepairPathKey),
			err,
		)
	}
	repairProviderCallsBeforeResume := providerCalls.Load()
	repairStorageCallsBeforeResume := storageCalls.Load()
	repairStorageReadsBeforeResume := storageExistenceCalls.Load()
	code, permanent, err = repo.processQueuedWhatsAppMediaJob(ctx, resumedRepairJob)
	if err != nil || code != "" || permanent {
		t.Fatalf(
			"resume database-only sibling repair = code:%q permanent:%v error:%v",
			code,
			permanent,
			err,
		)
	}
	if providerCalls.Load() != repairProviderCallsBeforeResume ||
		storageCalls.Load() != repairStorageCallsBeforeResume ||
		storageExistenceCalls.Load() != repairStorageReadsBeforeResume {
		t.Fatalf(
			"database-only sibling repair repeated external I/O = provider:%d->%d storage_post:%d->%d storage_get:%d->%d",
			repairProviderCallsBeforeResume,
			providerCalls.Load(),
			repairStorageCallsBeforeResume,
			storageCalls.Load(),
			repairStorageReadsBeforeResume,
			storageExistenceCalls.Load(),
		)
	}
	var repairedJobs, repairedMessages, distinctRepairedJobPaths, distinctRepairedMessagePaths int
	var repairedJobsScrubbed bool
	if err := postgres.Pool().QueryRow(ctx, `
		select
		  count(*) filter (where status = 'completed' and storage_path = $2)::integer,
		  count(distinct storage_path)::integer,
		  bool_and(message_key = '{}'::jsonb)
		from public.media_jobs
		where id = any($1::uuid[])
	`, []string{firstRepairJobID, repairSiblingJobID}, expectedRepairPath).Scan(
		&repairedJobs,
		&distinctRepairedJobPaths,
		&repairedJobsScrubbed,
	); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select
		  count(*) filter (where media_status = 'ready' and media_storage_path = $2)::integer,
		  count(distinct media_storage_path)::integer
		from public.whatsapp_messages
		where id = any($1::uuid[])
	`, []string{repairMessageRowID, repairSiblingMessageRowID}, expectedRepairPath).Scan(
		&repairedMessages,
		&distinctRepairedMessagePaths,
	); err != nil {
		t.Fatal(err)
	}
	if repairedJobs != 2 || repairedMessages != 2 || distinctRepairedJobPaths != 1 ||
		distinctRepairedMessagePaths != 1 || !repairedJobsScrubbed || expectedRepairPath == invalidStoragePath {
		t.Fatalf(
			"completed-asset sibling repair final state = jobs:%d messages:%d job_paths:%d message_paths:%d scrubbed:%v old:%q new:%q",
			repairedJobs,
			repairedMessages,
			distinctRepairedJobPaths,
			distinctRepairedMessagePaths,
			repairedJobsScrubbed,
			invalidStoragePath,
			expectedRepairPath,
		)
	}

	type scaleJobFixture struct {
		sessionID string
		messageID string
		jobID     string
		assetKey  string
	}
	insertScaleSession := func(index int) (string, string) {
		t.Helper()
		instanceName := fmt.Sprintf("%s-scale-%02d", suffix, index)
		var sessionID, conversationID string
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
		`, organizationID, sessionID,
			fmt.Sprintf("55118888%04d@s.whatsapp.net", index),
			fmt.Sprintf("55118888%04d", index),
			instanceName,
		).Scan(&conversationID); err != nil {
			t.Fatal(err)
		}
		return sessionID, conversationID
	}
	insertScaleJob := func(label, sessionID, conversationID, assetKey string, priority int) scaleJobFixture {
		t.Helper()
		providerMessageID := "provider-media-scale-" + label
		var messageID, jobID string
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
		`, organizationID, conversationID, sessionID, providerMessageID, len(mediaBytes)).Scan(&messageID); err != nil {
			t.Fatal(err)
		}
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.media_jobs (
				organization_id, session_id, conversation_id, message_id,
				provider_message_id, message_key, media_type, media_mime_type,
				status, attempts, max_attempts, next_retry_at, priority,
				dedupe_key, asset_key, declared_size
			) values (
				$1::uuid, $2::uuid, $3::uuid, $4::uuid,
				$5, $6::jsonb, 'image', 'image/png',
				'pending', 0, 3, now(), $7,
				$8, $9, $10
			)
			returning id::text
		`, organizationID, sessionID, conversationID, messageID, providerMessageID,
			jsonb(map[string]any{"provider_message_id": providerMessageID, "raw": map[string]any{}}),
			priority,
			hashWhatsAppMediaKey("scale-job", label, providerMessageID),
			assetKey,
			len(mediaBytes),
		).Scan(&jobID); err != nil {
			t.Fatal(err)
		}
		return scaleJobFixture{sessionID: sessionID, messageID: messageID, jobID: jobID, assetKey: assetKey}
	}

	const scaleConcurrency = 4
	scaleSessionIDs := make([]string, 0, 6)
	scaleConversationIDs := make([]string, 0, 6)
	for index := 0; index < 6; index++ {
		sessionID, conversationID := insertScaleSession(index)
		scaleSessionIDs = append(scaleSessionIDs, sessionID)
		scaleConversationIDs = append(scaleConversationIDs, conversationID)
	}
	primaryScaleJobs := make([]scaleJobFixture, 0, scaleConcurrency)
	for index := 0; index < scaleConcurrency; index++ {
		label := fmt.Sprintf("primary-%02d", index)
		primaryScaleJobs = append(primaryScaleJobs, insertScaleJob(
			label,
			scaleSessionIDs[index],
			scaleConversationIDs[index],
			hashWhatsAppMediaKey("scale-primary-asset", label),
			100,
		))
	}
	sameSessionBlocked := insertScaleJob(
		"same-session-blocked",
		scaleSessionIDs[0],
		scaleConversationIDs[0],
		hashWhatsAppMediaKey("scale-same-session-blocked-asset"),
		90,
	)
	sameAssetBlocked := insertScaleJob(
		"same-asset-blocked",
		scaleSessionIDs[4],
		scaleConversationIDs[4],
		primaryScaleJobs[0].assetKey,
		90,
	)
	waitingScaleJob := insertScaleJob(
		"next-distinct",
		scaleSessionIDs[5],
		scaleConversationIDs[5],
		hashWhatsAppMediaKey("scale-next-distinct-asset"),
		80,
	)

	scaleClaimStart := make(chan struct{})
	scaleClaimResults := make(chan claimResult, 8)
	var scaleClaimGroup sync.WaitGroup
	for index := 0; index < 8; index++ {
		scaleClaimGroup.Add(1)
		go func() {
			defer scaleClaimGroup.Done()
			<-scaleClaimStart
			job, claimErr := repo.claimWhatsAppMediaJobForSessions(
				ctx,
				5*time.Minute,
				scaleConcurrency,
				scaleSessionIDs,
			)
			scaleClaimResults <- claimResult{job: job, err: claimErr}
		}()
	}
	close(scaleClaimStart)
	scaleClaimGroup.Wait()
	close(scaleClaimResults)
	scaleClaimedJobs := make([]queuedWhatsAppMediaJob, 0, scaleConcurrency)
	for result := range scaleClaimResults {
		switch {
		case result.err == nil:
			scaleClaimedJobs = append(scaleClaimedJobs, result.job)
		case errors.Is(result.err, pgx.ErrNoRows):
		default:
			t.Fatalf("scaled concurrent media claim failed: %v", result.err)
		}
	}
	if len(scaleClaimedJobs) != scaleConcurrency {
		t.Fatalf("scaled concurrent claims = %d, want %d", len(scaleClaimedJobs), scaleConcurrency)
	}
	primaryIDs := make(map[string]struct{}, len(primaryScaleJobs))
	for _, fixture := range primaryScaleJobs {
		primaryIDs[fixture.jobID] = struct{}{}
	}
	claimedSessions := make(map[string]struct{}, scaleConcurrency)
	claimedAssets := make(map[string]struct{}, scaleConcurrency)
	claimedSlots := make(map[int]struct{}, scaleConcurrency)
	for _, job := range scaleClaimedJobs {
		if _, expected := primaryIDs[job.ID]; !expected {
			t.Fatalf("scaled claim selected non-primary job %q", job.ID)
		}
		claimedSessions[job.SessionID] = struct{}{}
		claimedAssets[job.AssetKey] = struct{}{}
		claimedSlots[job.ProcessingSlot] = struct{}{}
	}
	if len(claimedSessions) != scaleConcurrency || len(claimedAssets) != scaleConcurrency || len(claimedSlots) != scaleConcurrency {
		t.Fatalf(
			"scaled claim uniqueness = sessions:%d assets:%d slots:%d, want %d each",
			len(claimedSessions),
			len(claimedAssets),
			len(claimedSlots),
			scaleConcurrency,
		)
	}
	for slot := 1; slot <= scaleConcurrency; slot++ {
		if _, found := claimedSlots[slot]; !found {
			t.Fatalf("scaled claims did not occupy slot %d: %#v", slot, claimedSlots)
		}
	}
	if _, err := repo.claimWhatsAppMediaJobForSessions(
		ctx,
		time.Minute,
		scaleConcurrency,
		scaleSessionIDs,
	); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("claim exceeded configured concurrency %d: %v", scaleConcurrency, err)
	}
	var sameSessionStatus, sameAssetStatus string
	if err := postgres.Pool().QueryRow(ctx, `
		select
		  (select status from public.media_jobs where id = $1::uuid),
		  (select status from public.media_jobs where id = $2::uuid)
	`, sameSessionBlocked.jobID, sameAssetBlocked.jobID).Scan(&sameSessionStatus, &sameAssetStatus); err != nil {
		t.Fatal(err)
	}
	if sameSessionStatus != "pending" || sameAssetStatus != "pending" {
		t.Fatalf("scaled exclusion state = same-session:%q same-asset:%q", sameSessionStatus, sameAssetStatus)
	}
	var releasedScaleJob queuedWhatsAppMediaJob
	for _, job := range scaleClaimedJobs {
		if job.ID == primaryScaleJobs[1].jobID {
			releasedScaleJob = job
			break
		}
	}
	if releasedScaleJob.ID == "" {
		t.Fatalf("scaled fixture did not claim releasable primary job %q", primaryScaleJobs[1].jobID)
	}
	if err := repo.retryOrFailWhatsAppMediaJob(
		ctx,
		releasedScaleJob,
		"test_scale_release",
		true,
		errors.New("fixture releases one processing slot"),
	); err != nil {
		t.Fatal(err)
	}
	nextScaleClaim, err := repo.claimWhatsAppMediaJobForSessions(
		ctx,
		time.Minute,
		scaleConcurrency,
		scaleSessionIDs,
	)
	if err != nil || nextScaleClaim.ID != waitingScaleJob.jobID {
		t.Fatalf(
			"claim after releasing one slot = job:%q error:%v, want %q",
			nextScaleClaim.ID,
			err,
			waitingScaleJob.jobID,
		)
	}
}

func TestWhatsAppMediaCompletionUsesMessageBeforeJobLockIntegration(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)

	var migrationReady bool
	if err := postgres.Pool().QueryRow(ctx, `
		select
		  to_regprocedure('private.claim_whatsapp_media_job(text,interval,integer,uuid[],boolean)') is not null
		  and exists (
		    select 1
		    from information_schema.columns
		    where table_schema = 'public'
		      and table_name = 'media_jobs'
		      and column_name = 'processing_slot'
		  )
	`).Scan(&migrationReady); err != nil {
		t.Fatal(err)
	}
	if !migrationReady {
		t.Skip("scaled WhatsApp media queue migration is not applied")
	}

	suffix := fmt.Sprintf("wa-media-lock-order-%d", time.Now().UnixNano())
	var organizationID, userID, sessionID, conversationID, messageID string
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
		) values (
			$1::uuid, $2::uuid, '5511999999999@s.whatsapp.net', '5511999999999', $3
		)
		returning id::text
	`, organizationID, sessionID, suffix).Scan(&conversationID); err != nil {
		t.Fatal(err)
	}
	providerMessageID := suffix + "-provider"
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_messages (
			organization_id, conversation_id, session_id,
			provider_message_id, message_id, from_me, direction,
			message_type, media_mime_type, media_status, media_size, status, sent_at
		) values (
			$1::uuid, $2::uuid, $3::uuid,
			$4, $4, false, 'inbound',
			'image', 'image/png', 'pending', 1, 'received', now()
		)
		returning id::text
	`, organizationID, conversationID, sessionID, providerMessageID).Scan(&messageID); err != nil {
		t.Fatal(err)
	}

	assetKey := hashWhatsAppMediaKey("lock-order-asset", suffix)
	lockedBy := "lock-order-worker"
	var jobID, leaseToken string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.media_jobs (
			organization_id, session_id, conversation_id, message_id,
			provider_message_id, message_key, media_type, media_mime_type,
			status, attempts, max_attempts, next_retry_at,
			dedupe_key, asset_key, declared_size,
			locked_at, lease_expires_at, lease_duration, locked_by, lease_token,
			processing_slot, manual_requested
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, '{}'::jsonb, 'image', 'image/png',
			'processing', 1, 3, now(),
			$6, $7, 1,
			now(), now() + interval '5 minutes', interval '5 minutes', $8, gen_random_uuid(),
			1, false
		)
		returning id::text, lease_token::text
	`, organizationID, sessionID, conversationID, messageID, providerMessageID,
		hashWhatsAppMediaKey("lock-order-job", suffix), assetKey, lockedBy).Scan(&jobID, &leaseToken); err != nil {
		t.Fatal(err)
	}

	blocker, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer blocker.Rollback(context.Background())
	if _, err := blocker.Exec(ctx, `set local lock_timeout = '3s'`); err != nil {
		t.Fatal(err)
	}
	var lockedMessageID string
	if err := blocker.QueryRow(ctx, `
		select id::text
		from public.whatsapp_messages
		where id = $1::uuid
		for update
	`, messageID).Scan(&lockedMessageID); err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(postgres, nil, StorageConfig{})
	completionDone := make(chan error, 1)
	go func() {
		completionDone <- repo.completeWhatsAppMediaJob(ctx, queuedWhatsAppMediaJob{
			ID:             jobID,
			OrganizationID: organizationID,
			MessageID:      messageID,
			AssetKey:       assetKey,
			LockedBy:       lockedBy,
			LeaseToken:     leaseToken,
		}, completedWhatsAppMediaAsset{
			storagePath: fmt.Sprintf("orgs/%s/assets/%s/%s.png", organizationID, whatsappMediaAssetVersion, assetKey),
			contentType: "image/png",
			actualSize:  1,
		})
	}()

	waitDeadline := time.NewTimer(5 * time.Second)
	defer waitDeadline.Stop()
	waitPoll := time.NewTicker(20 * time.Millisecond)
	defer waitPoll.Stop()
	completionWaitingOnMessage := false
	for !completionWaitingOnMessage {
		select {
		case completionErr := <-completionDone:
			t.Fatalf("completion returned before the message lock was released: %v", completionErr)
		case <-waitDeadline.C:
			t.Fatal("completion did not wait on the pre-held message lock")
		case <-waitPoll.C:
			if err := postgres.Pool().QueryRow(ctx, `
				select exists (
				  select 1
				  from pg_catalog.pg_stat_activity as activity
				  where activity.pid <> pg_backend_pid()
				    and activity.wait_event_type = 'Lock'
				    and activity.query ilike '%from public.whatsapp_messages as message%'
				    and activity.query ilike '%for update of message%'
				)
			`).Scan(&completionWaitingOnMessage); err != nil {
				t.Fatal(err)
			}
		}
	}

	// This reproduces the second half of a duplicate webhook transaction: it
	// already owns whatsapp_messages and now needs media_jobs. With the old
	// worker order, this statement deadlocked against completion.
	if _, err := blocker.Exec(ctx, `
		update public.media_jobs
		set updated_at = updated_at
		where id = $1::uuid
	`, jobID); err != nil {
		t.Fatalf("message-first duplicate transaction could not lock media job: %v", err)
	}
	if err := blocker.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-completionDone; err != nil {
		t.Fatalf("completion after canonical lock handoff: %v", err)
	}

	var jobStatus, messageStatus, storagePath string
	if err := postgres.Pool().QueryRow(ctx, `
		select job.status, coalesce(message.media_status, ''), coalesce(job.storage_path, '')
		from public.media_jobs as job
		join public.whatsapp_messages as message
		  on message.organization_id = job.organization_id
		 and message.id = job.message_id
		where job.id = $1::uuid
	`, jobID).Scan(&jobStatus, &messageStatus, &storagePath); err != nil {
		t.Fatal(err)
	}
	if jobStatus != "completed" || messageStatus != "ready" || storagePath == "" {
		t.Fatalf("completion state = job:%q message:%q path:%q", jobStatus, messageStatus, storagePath)
	}
}
