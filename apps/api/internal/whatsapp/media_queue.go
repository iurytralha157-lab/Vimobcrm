package whatsapp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	whatsappMediaAbsoluteMaxBytes = 25 * 1024 * 1024
	whatsappMediaImageAutoMax     = 10 * 1024 * 1024
	whatsappMediaAudioAutoMax     = 25 * 1024 * 1024
	whatsappMediaStickerAutoMax   = 5 * 1024 * 1024
	whatsappMediaJobMaxAttempts   = 3

	mediaErrorManualOnly     = "media_policy_manual_only_type"
	mediaErrorTooLarge       = "media_policy_too_large"
	mediaErrorUnknownSize    = "media_policy_unknown_size"
	mediaErrorManualQueued   = "media_manual_download_queued"
	mediaErrorRetry          = "media_download_retry_scheduled"
	mediaErrorFailed         = "media_download_failed"
	mediaErrorOutcomeUnknown = "media_provider_outcome_unknown"
	mediaErrorLegacyRetired  = "media_legacy_job_retired"
)

var (
	whatsappMediaWorkerID       = "vimob-api-whatsapp-media-" + randomHex(8)
	whatsappMediaWorkerWake     = make(chan struct{}, 1)
	errWhatsAppMediaLeaseLost   = errors.New("whatsapp media worker lease lost")
	errWhatsAppMediaTooLarge    = errors.New("whatsapp media exceeds the configured download limit")
	errWhatsAppMediaBreakerOpen = errors.New("whatsapp media provider breaker is open")
	errWhatsAppMediaSessionDown = errors.New("whatsapp media session is temporarily unavailable")
)

type whatsappMediaPolicy struct {
	automatic bool
	errorCode string
}

type queuedWhatsAppMediaJob struct {
	ID                string
	OrganizationID    string
	SessionID         string
	ConversationID    string
	MessageID         string
	ProviderMessageID string
	MessageKey        map[string]any
	MediaType         string
	MediaMimeType     string
	DeclaredSize      int64
	FileSHA256        string
	AssetKey          string
	Attempts          int
	MaxAttempts       int
	ManualRequested   bool
	LockedBy          string
	LeaseToken        string
}

type completedWhatsAppMediaAsset struct {
	storagePath string
	contentType string
	actualSize  int64
}

type manualWhatsAppMediaEnqueueResult struct {
	jobID        string
	deduplicated bool
	alreadyReady bool
	storagePath  string
	contentType  string
	actualSize   int64
}

func automaticWhatsAppMediaPolicy(messageType string, mimeType string, declaredSize int64) whatsappMediaPolicy {
	if declaredSize <= 0 {
		return whatsappMediaPolicy{errorCode: mediaErrorUnknownSize}
	}
	if declaredSize > whatsappMediaAbsoluteMaxBytes {
		return whatsappMediaPolicy{errorCode: mediaErrorTooLarge}
	}

	messageType = strings.ToLower(strings.TrimSpace(messageType))
	if !whatsappMediaMIMEAllowedForType(messageType, mimeType) {
		return whatsappMediaPolicy{errorCode: mediaErrorManualOnly}
	}

	switch messageType {
	case "image":
		if declaredSize <= whatsappMediaImageAutoMax {
			return whatsappMediaPolicy{automatic: true}
		}
		return whatsappMediaPolicy{errorCode: mediaErrorTooLarge}
	case "audio":
		if declaredSize <= whatsappMediaAudioAutoMax {
			return whatsappMediaPolicy{automatic: true}
		}
		return whatsappMediaPolicy{errorCode: mediaErrorTooLarge}
	case "sticker":
		if declaredSize <= whatsappMediaStickerAutoMax {
			return whatsappMediaPolicy{automatic: true}
		}
		return whatsappMediaPolicy{errorCode: mediaErrorTooLarge}
	case "video", "document":
		return whatsappMediaPolicy{errorCode: mediaErrorManualOnly}
	default:
		return whatsappMediaPolicy{errorCode: mediaErrorManualOnly}
	}
}

func normalizeWhatsAppMediaMIME(mimeType string) string {
	return strings.ToLower(strings.TrimSpace(strings.Split(mimeType, ";")[0]))
}

func whatsappMediaMIMEAllowedForType(messageType string, mimeType string) bool {
	mimeType = normalizeWhatsAppMediaMIME(mimeType)
	if mimeType == "" || mimeType == "application/octet-stream" {
		return true
	}
	switch strings.ToLower(strings.TrimSpace(messageType)) {
	case "image", "sticker":
		return strings.HasPrefix(mimeType, "image/")
	case "audio":
		return strings.HasPrefix(mimeType, "audio/") || mimeType == "application/ogg"
	case "video":
		return strings.HasPrefix(mimeType, "video/")
	case "document":
		return true
	default:
		return false
	}
}

func whatsappMediaAutomaticMaxBytes(messageType string) int64 {
	switch strings.ToLower(strings.TrimSpace(messageType)) {
	case "image":
		return whatsappMediaImageAutoMax
	case "audio":
		return whatsappMediaAudioAutoMax
	case "sticker":
		return whatsappMediaStickerAutoMax
	default:
		return 0
	}
}

func whatsappMediaJobDownloadMaxBytes(job queuedWhatsAppMediaJob) int64 {
	if job.ManualRequested {
		return whatsappMediaAbsoluteMaxBytes
	}
	return whatsappMediaAutomaticMaxBytes(job.MediaType)
}

func whatsappMediaBase64EncodedLimit(maxDecodedBytes int64) int64 {
	if maxDecodedBytes <= 0 {
		return 0
	}
	return ((maxDecodedBytes + 2) / 3) * 4
}

func validateWhatsAppMediaBase64Size(value string, maxDecodedBytes int64) error {
	value = strings.TrimSpace(value)
	encodedLimit := whatsappMediaBase64EncodedLimit(maxDecodedBytes)
	if encodedLimit == 0 || int64(len(value)) > encodedLimit+4096 {
		return fmt.Errorf("%w: encoded media exceeds the download limit", ErrInvalidInput)
	}
	if comma := strings.IndexByte(value, ','); comma >= 0 && strings.HasPrefix(strings.ToLower(value), "data:") {
		if comma > 4096 {
			return fmt.Errorf("%w: encoded media header exceeds the download limit", ErrInvalidInput)
		}
		value = value[comma+1:]
	}
	if int64(len(value)) > encodedLimit {
		return fmt.Errorf("%w: encoded media exceeds the download limit", ErrInvalidInput)
	}
	return nil
}

func whatsappMediaManualDownloadAllowed(messageType string, declaredSize int64) bool {
	return nativeIsMediaType(strings.ToLower(strings.TrimSpace(messageType))) &&
		declaredSize > 0 && declaredSize <= whatsappMediaAbsoluteMaxBytes
}

func wakeWhatsAppMediaWorker() {
	select {
	case whatsappMediaWorkerWake <- struct{}{}:
	default:
	}
}

func (handler Handler) StartMediaWorker(ctx context.Context, logger *slog.Logger) {
	config := handler.workerConfig.normalized()
	if !config.MediaWorkerEnabled {
		return
	}
	if logger == nil {
		logger = slog.Default()
	}
	if !whatsappMediaWorkerOwnsAllSessions(handler.repo.functions) {
		logger.Warn(
			"whatsapp media worker remains disabled until every webhook session is native",
			"processor_mode", normalizeEvolutionWebhookProcessorMode(handler.repo.functions.webhookProcessorMode),
		)
		return
	}
	if len(config.MediaWorkerSessionIDs) == 0 {
		logger.Error("whatsapp media worker remains disabled without an explicit session allowlist")
		return
	}

	go func() {
		ticker := time.NewTicker(config.MediaWorkerInterval)
		defer ticker.Stop()
		breakerReported := false

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			case <-whatsappMediaWorkerWake:
			}

			for {
				processed, err := handler.repo.drainOneWhatsAppMediaJob(ctx, config.MediaWorkerLease, config.MediaWorkerSessionIDs)
				if err != nil {
					if errors.Is(err, errWhatsAppMediaBreakerOpen) {
						if !breakerReported {
							logger.Error("whatsapp media worker stopped by durable provider breaker", "error", err)
							breakerReported = true
						}
					} else {
						logger.Error("whatsapp media worker failed", "error", err)
					}
					break
				}
				breakerReported = false
				if !processed {
					break
				}
			}
		}
	}()
}

func whatsappMediaWorkerOwnsAllSessions(client functionsClient) bool {
	mode := normalizeEvolutionWebhookProcessorMode(client.webhookProcessorMode)
	if mode != webhookProcessorNative {
		return false
	}
	for _, allowed := range client.webhookRolloutSessionIDs {
		if strings.TrimSpace(allowed) == "*" {
			return true
		}
	}
	return false
}

func (repo Repository) drainOneWhatsAppMediaJob(ctx context.Context, lease time.Duration, sessionIDs []string) (bool, error) {
	breakerOpen, breakerReason, err := repo.whatsappMediaProviderBreaker(ctx)
	if err != nil {
		return false, err
	}
	if breakerOpen {
		return false, fmt.Errorf("%w: %s", errWhatsAppMediaBreakerOpen, breakerReason)
	}
	job, err := repo.claimWhatsAppMediaJob(ctx, lease, sessionIDs)
	if errors.Is(err, pgx.ErrNoRows) {
		breakerOpen, breakerReason, breakerErr := repo.whatsappMediaProviderBreaker(ctx)
		if breakerErr != nil {
			return false, breakerErr
		}
		if breakerOpen {
			return false, fmt.Errorf("%w: %s", errWhatsAppMediaBreakerOpen, breakerReason)
		}
		return false, nil
	}
	if err != nil {
		return false, err
	}

	var code string
	var permanent bool
	processErr, leaseErr := superviseWhatsAppMediaLease(
		ctx,
		whatsappMediaLeaseHeartbeatInterval(lease),
		func(heartbeatCtx context.Context) (bool, error) {
			return repo.renewWhatsAppMediaJobLease(heartbeatCtx, job)
		},
		func(processCtx context.Context) error {
			var err error
			code, permanent, err = repo.processQueuedWhatsAppMediaJob(processCtx, job)
			return err
		},
	)
	if processErr == nil {
		return true, nil
	}
	if leaseErr != nil {
		return true, errors.Join(processErr, leaseErr)
	}
	if ctx.Err() != nil {
		return true, ctx.Err()
	}
	if err := repo.retryOrFailWhatsAppMediaJob(ctx, job, code, permanent, processErr); err != nil {
		return true, errors.Join(processErr, err)
	}
	return true, nil
}

func (repo Repository) claimWhatsAppMediaJob(ctx context.Context, lease time.Duration, sessionIDs []string) (queuedWhatsAppMediaJob, error) {
	if len(sessionIDs) == 0 {
		return queuedWhatsAppMediaJob{}, fmt.Errorf("%w: WhatsApp media worker session allowlist is empty", ErrInvalidInput)
	}
	var claimSessionIDs any = sessionIDs
	for _, sessionID := range sessionIDs {
		if strings.TrimSpace(sessionID) == "*" {
			claimSessionIDs = nil
			break
		}
	}
	var job queuedWhatsAppMediaJob
	var messageKeyJSON string
	err := repo.db.Pool().QueryRow(ctx, `
		select
			job.id::text,
			job.organization_id::text,
			job.session_id::text,
			job.conversation_id::text,
			job.message_id::text,
			coalesce(job.provider_message_id, ''),
			coalesce(job.message_key, '{}'::jsonb)::text,
			job.media_type,
			coalesce(job.media_mime_type, ''),
			coalesce(job.declared_size, 0),
			coalesce(job.file_sha256, ''),
			job.asset_key,
			job.attempts,
			job.max_attempts,
			job.manual_requested,
			coalesce(job.locked_by, ''),
			job.lease_token::text
		from private.claim_whatsapp_media_job($1, $2::interval, $3::uuid[]) as job
	`, whatsappMediaWorkerID, fmt.Sprintf("%.0f seconds", lease.Seconds()), claimSessionIDs).Scan(
		&job.ID,
		&job.OrganizationID,
		&job.SessionID,
		&job.ConversationID,
		&job.MessageID,
		&job.ProviderMessageID,
		&messageKeyJSON,
		&job.MediaType,
		&job.MediaMimeType,
		&job.DeclaredSize,
		&job.FileSHA256,
		&job.AssetKey,
		&job.Attempts,
		&job.MaxAttempts,
		&job.ManualRequested,
		&job.LockedBy,
		&job.LeaseToken,
	)
	if err != nil {
		return queuedWhatsAppMediaJob{}, err
	}
	job.MessageKey = decodeObjectJSON(messageKeyJSON)
	return job, nil
}

func whatsappMediaLeaseHeartbeatInterval(lease time.Duration) time.Duration {
	interval := lease / 3
	if interval < 10*time.Second {
		interval = 10 * time.Second
	}
	return interval
}

func superviseWhatsAppMediaLease(
	ctx context.Context,
	heartbeatInterval time.Duration,
	renew func(context.Context) (bool, error),
	process func(context.Context) error,
) (processErr error, leaseErr error) {
	processCtx, cancelProcess := context.WithCancel(ctx)
	defer cancelProcess()
	leaseResult := make(chan error, 1)
	go func() {
		ticker := time.NewTicker(heartbeatInterval)
		defer ticker.Stop()
		for {
			select {
			case <-processCtx.Done():
				leaseResult <- nil
				return
			case <-ticker.C:
				renewed, err := renew(processCtx)
				if err != nil {
					cancelProcess()
					leaseResult <- err
					return
				}
				if !renewed {
					cancelProcess()
					leaseResult <- errWhatsAppMediaLeaseLost
					return
				}
			}
		}
	}()

	processErr = process(processCtx)
	cancelProcess()
	leaseErr = <-leaseResult
	return processErr, leaseErr
}

func (repo Repository) renewWhatsAppMediaJobLease(ctx context.Context, job queuedWhatsAppMediaJob) (bool, error) {
	var renewed bool
	err := repo.db.Pool().QueryRow(ctx, `
		select private.renew_whatsapp_media_job($1::uuid, $2, $3::uuid)
	`, job.ID, job.LockedBy, job.LeaseToken).Scan(&renewed)
	return renewed, err
}

func (repo Repository) processQueuedWhatsAppMediaJob(ctx context.Context, job queuedWhatsAppMediaJob) (string, bool, error) {
	if !whatsappMediaManualDownloadAllowed(job.MediaType, job.DeclaredSize) {
		code := mediaErrorTooLarge
		if job.DeclaredSize <= 0 {
			code = mediaErrorUnknownSize
		}
		return code, true, fmt.Errorf("%w: media job violates the absolute download policy", ErrInvalidInput)
	}
	if !job.ManualRequested {
		policy := automaticWhatsAppMediaPolicy(job.MediaType, job.MediaMimeType, job.DeclaredSize)
		if !policy.automatic {
			return policy.errorCode, true, fmt.Errorf("%w: media job violates the automatic download policy", ErrInvalidInput)
		}
	}

	if ready, found, err := repo.findCompletedWhatsAppMediaAsset(ctx, job); err != nil {
		return mediaErrorFailed, false, err
	} else if found {
		return "", false, repo.completeWhatsAppMediaJob(ctx, job, ready)
	}
	connected, err := repo.whatsappMediaSessionCanDownload(ctx, job)
	if err != nil {
		return mediaErrorFailed, false, err
	}
	if !connected {
		return mediaErrorRetry, false, fmt.Errorf(
			"%w: WhatsApp media session is not an active connected Evolution Go session",
			errWhatsAppMediaSessionDown,
		)
	}

	message := nativeEvolutionMessage{
		ProviderMessageID: job.ProviderMessageID,
		MessageType:       job.MediaType,
		MediaMimeType:     job.MediaMimeType,
		MediaSize:         job.DeclaredSize,
		MediaURL:          firstString(job.MessageKey, "media_url", "mediaUrl"),
		MediaBase64:       firstString(job.MessageKey, "media_base64", "base64"),
		Raw:               mapFromAny(job.MessageKey["raw"]),
	}
	if len(message.Raw) == 0 {
		message.Raw = job.MessageKey
	}

	var recovered recoveredWhatsAppMedia
	evolutionPostStarted := false
	switch {
	case message.MediaBase64 != "":
		if err := validateWhatsAppMediaBase64Size(message.MediaBase64, whatsappMediaJobDownloadMaxBytes(job)); err != nil {
			return mediaErrorTooLarge, true, err
		}
		recovered.bytes, err = decodeFlexibleBase64Media(message.MediaBase64)
		recovered.contentType = firstNonEmpty(detectWhatsAppMediaMimeType(recovered.bytes), message.MediaMimeType, fallbackWhatsAppMediaMimeType(message.MessageType))
		recovered.source = "queued_webhook_base64"
	case message.MediaURL != "":
		recovered, err = repo.downloadWhatsAppMediaURL(ctx, message.MediaURL)
	default:
		if err := repo.markWhatsAppMediaProviderStarted(ctx, job); err != nil {
			return mediaErrorFailed, false, err
		}
		evolutionPostStarted = true
		recovered, err = repo.downloadNativeEvolutionMedia(ctx, pendingEvolutionWebhook{
			OrganizationID: job.OrganizationID,
			SessionID:      job.SessionID,
		}, message)
	}
	if err != nil {
		code, permanent := classifyWhatsAppMediaDownloadError(err)
		if evolutionPostStarted {
			// Keep POST recovery fail-closed. The hardened Evolution image honors
			// request cancellation, but transport failures still cannot prove
			// whether the upstream side completed before the connection was lost.
			permanent = true
		}
		return code, permanent, err
	}
	if len(recovered.bytes) == 0 {
		return mediaErrorFailed, true, fmt.Errorf("%w: provider returned empty media", ErrProviderFailed)
	}
	if len(recovered.bytes) > whatsappMediaAbsoluteMaxBytes {
		return mediaErrorTooLarge, true, fmt.Errorf("%w: arquivo acima do limite de 25MB", ErrInvalidInput)
	}
	if int64(len(recovered.bytes)) != job.DeclaredSize {
		return mediaErrorFailed, true, fmt.Errorf(
			"%w: downloaded media size %d differs from declared size %d",
			ErrProviderFailed,
			len(recovered.bytes),
			job.DeclaredSize,
		)
	}
	if err := validateWhatsAppMediaPlaintextDigest(job.FileSHA256, recovered.bytes); err != nil {
		return mediaErrorFailed, true, err
	}

	detectedContentType, contentType := effectiveWhatsAppMediaContentType(job, recovered)
	if !job.ManualRequested {
		actualPolicy := automaticWhatsAppMediaPolicy(job.MediaType, contentType, int64(len(recovered.bytes)))
		if !actualPolicy.automatic {
			return actualPolicy.errorCode, true, fmt.Errorf("%w: downloaded media violates the automatic media policy", ErrInvalidInput)
		}
		if detectedContentType != "" && detectedContentType != "application/octet-stream" &&
			!whatsappMediaMIMEAllowedForType(job.MediaType, detectedContentType) {
			return mediaErrorManualOnly, true, fmt.Errorf("%w: downloaded media type does not match the queued message", ErrInvalidInput)
		}
	}
	objectPath := fmt.Sprintf(
		"orgs/%s/assets/%s.%s",
		job.OrganizationID,
		sanitizeWhatsAppMediaObjectPart(job.AssetKey),
		mediaExtension(contentType),
	)
	// Storage upload is an irreversible external effect just like the provider
	// recovery POST. Persist the fence first so a lost lease can never replay the
	// provider call merely because the object/DB completion outcome is unclear.
	if err := repo.markWhatsAppMediaProviderStarted(ctx, job); err != nil {
		return mediaErrorFailed, false, err
	}
	if err := repo.storage.upload(ctx, whatsappMediaBucket, objectPath, contentType, bytes.NewReader(recovered.bytes), true); err != nil {
		return mediaErrorOutcomeUnknown, true, fmt.Errorf("%w: storage upload outcome is unknown: %v", ErrProviderOutcomeUnknown, err)
	}

	if err := repo.completeWhatsAppMediaJob(ctx, job, completedWhatsAppMediaAsset{
		storagePath: objectPath,
		contentType: contentType,
		actualSize:  int64(len(recovered.bytes)),
	}); err != nil {
		return mediaErrorOutcomeUnknown, true, fmt.Errorf("%w: storage upload succeeded but database completion is unknown: %v", ErrProviderOutcomeUnknown, err)
	}
	return "", false, nil
}

func (repo Repository) whatsappMediaProviderBreaker(ctx context.Context) (bool, string, error) {
	var open bool
	var reason string
	err := repo.db.Pool().QueryRow(ctx, `
		select breaker_open, coalesce(breaker_reason, '')
		from private.whatsapp_media_worker_state
		where singleton = true
	`).Scan(&open, &reason)
	return open, reason, err
}

func (repo Repository) markWhatsAppMediaProviderStarted(ctx context.Context, job queuedWhatsAppMediaJob) error {
	command, err := repo.db.Pool().Exec(ctx, `
		update public.media_jobs
		set provider_started_at = coalesce(provider_started_at, now()),
		    updated_at = now()
		where id = $1::uuid
		  and status = 'processing'
		  and locked_by = $2
		  and lease_token = $3::uuid
	`, job.ID, job.LockedBy, job.LeaseToken)
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return errWhatsAppMediaLeaseLost
	}
	return nil
}

func (repo Repository) whatsappMediaSessionCanDownload(ctx context.Context, job queuedWhatsAppMediaJob) (bool, error) {
	var connected bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.whatsapp_sessions as session
			where session.id = $2::uuid
			  and session.organization_id = $1::uuid
			  and lower(btrim(coalesce(session.provider, ''))) = 'evolution_go'
			  and coalesce(session.is_active, false) = true
			  and lower(btrim(coalesce(session.status, ''))) = 'connected'
		)
	`, job.OrganizationID, job.SessionID).Scan(&connected)
	return connected, err
}

func classifyWhatsAppMediaDownloadError(err error) (string, bool) {
	if errors.Is(err, errWhatsAppMediaTooLarge) || errors.Is(err, ErrInvalidInput) {
		return mediaErrorTooLarge, true
	}
	if errors.Is(err, ErrProviderOutcomeUnknown) {
		return mediaErrorOutcomeUnknown, true
	}
	return mediaErrorFailed, false
}

func effectiveWhatsAppMediaContentType(job queuedWhatsAppMediaJob, recovered recoveredWhatsAppMedia) (string, string) {
	detected := normalizeWhatsAppMediaMIME(detectWhatsAppMediaMimeType(recovered.bytes))
	provider := normalizeWhatsAppMediaMIME(recovered.contentType)
	declared := normalizeWhatsAppMediaMIME(job.MediaMimeType)
	contentType := firstNonEmpty(detected, provider, declared, fallbackWhatsAppMediaMimeType(job.MediaType))
	if detected == "application/octet-stream" {
		contentType = firstNonEmpty(provider, declared, detected, fallbackWhatsAppMediaMimeType(job.MediaType))
	}
	return detected, contentType
}

func (repo Repository) findCompletedWhatsAppMediaAsset(ctx context.Context, job queuedWhatsAppMediaJob) (completedWhatsAppMediaAsset, bool, error) {
	var asset completedWhatsAppMediaAsset
	err := repo.db.Pool().QueryRow(ctx, `
		select storage_path, coalesce(media_mime_type, ''), coalesce(actual_size, declared_size, 0)
		from public.media_jobs
		where organization_id = $1::uuid
		  and asset_key = $2
		  and status = 'completed'
		  and storage_path is not null
		  and id <> $3::uuid
		order by completed_at desc nulls last, id
		limit 1
	`, job.OrganizationID, job.AssetKey, job.ID).Scan(&asset.storagePath, &asset.contentType, &asset.actualSize)
	if errors.Is(err, pgx.ErrNoRows) {
		return completedWhatsAppMediaAsset{}, false, nil
	}
	if err != nil {
		return completedWhatsAppMediaAsset{}, false, err
	}
	if !whatsappMediaPathBelongsToOrganization(asset.storagePath, job.OrganizationID) {
		return completedWhatsAppMediaAsset{}, false, fmt.Errorf("%w: deduplicated media path escaped organization scope", ErrProviderFailed)
	}
	return asset, true, nil
}

func (repo Repository) completeWhatsAppMediaJob(ctx context.Context, job queuedWhatsAppMediaJob, asset completedWhatsAppMediaAsset) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := lockWhatsAppMediaMutation(ctx, tx); err != nil {
		return err
	}

	var lockedID string
	if err := tx.QueryRow(ctx, `
		select id::text
		from public.media_jobs
		where id = $1::uuid
		  and status = 'processing'
		  and locked_by = $2
		  and lease_token = $3::uuid
		for update
	`, job.ID, job.LockedBy, job.LeaseToken).Scan(&lockedID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errWhatsAppMediaLeaseLost
		}
		return err
	}

	if _, err := tx.Exec(ctx, `
		update public.whatsapp_messages as message
		set media_storage_path = $3,
		    media_url = null,
		    media_mime_type = nullif($4, ''),
		    media_status = 'ready',
		    media_error = null,
		    media_size = $5,
		    updated_at = now()
		where message.organization_id = $1::uuid
		  and message.id in (
		    select candidate.message_id
		    from public.media_jobs as candidate
		    where candidate.organization_id = $1::uuid
		      and candidate.asset_key = $2
		      and coalesce(candidate.declared_size, 0) between 1 and $6
		      and (
		        candidate.status in ('pending', 'processing')
		        or (
		          candidate.status = 'failed'
		          and coalesce(candidate.error_code, '') not like 'media_policy_%'
		        )
		      )
		  )
	`, job.OrganizationID, job.AssetKey, asset.storagePath, asset.contentType, asset.actualSize, whatsappMediaAbsoluteMaxBytes); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		update public.media_jobs
		set status = 'completed',
		    media_mime_type = nullif($3, ''),
		    storage_path = $4,
		    actual_size = $5,
		    completed_at = now(),
		    failed_at = null,
		    error_code = null,
		    error_message = null,
		    locked_at = null,
		    lease_expires_at = null,
		    lease_duration = null,
		    locked_by = null,
		    lease_token = null,
		    updated_at = now()
		where organization_id = $1::uuid
		  and asset_key = $2
		  and coalesce(declared_size, 0) between 1 and $6
		  and (
		    status in ('pending', 'processing')
		    or (status = 'failed' and coalesce(error_code, '') not like 'media_policy_%')
		  )
	`, job.OrganizationID, job.AssetKey, asset.contentType, asset.storagePath, asset.actualSize, whatsappMediaAbsoluteMaxBytes); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}
	whatsappMediaSignedURLCache.Delete(asset.storagePath)
	return nil
}

func (repo Repository) retryOrFailWhatsAppMediaJob(ctx context.Context, job queuedWhatsAppMediaJob, code string, permanent bool, cause error) error {
	if code == "" {
		code = mediaErrorFailed
	}
	detail := strings.TrimSpace(cause.Error())
	if len(detail) > 1000 {
		detail = detail[:1000]
	}
	restoreAttempt := errors.Is(cause, errWhatsAppMediaSessionDown)
	terminal := permanent || (!restoreAttempt && job.Attempts >= job.MaxAttempts)
	nextAttempt := time.Now().UTC().Add(whatsappMediaRetryDelay(job.Attempts))

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if code == mediaErrorOutcomeUnknown {
		if _, err := tx.Exec(ctx, `
			select pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:global-claim', 0))
		`); err != nil {
			return err
		}
	}
	if err := lockWhatsAppMediaMutation(ctx, tx); err != nil {
		return err
	}

	status := "pending"
	messageStatus := mediaErrorRetry
	if terminal {
		status = "failed"
		messageStatus = code
	}
	command, err := tx.Exec(ctx, `
		update public.media_jobs
		set status = $4,
		    attempts = case when $8 then greatest(attempts - 1, 0) else attempts end,
		    next_retry_at = case when $4 = 'pending' then $5 else next_retry_at end,
		    failed_at = case when $4 = 'failed' then now() else null end,
		    error_code = $6,
		    error_message = $7,
		    locked_at = null,
		    lease_expires_at = null,
		    lease_duration = null,
		    locked_by = null,
		    lease_token = null,
		    updated_at = now()
		where id = $1::uuid
		  and status = 'processing'
		  and locked_by = $2
		  and lease_token = $3::uuid
	`, job.ID, job.LockedBy, job.LeaseToken, status, nextAttempt, code, detail, restoreAttempt)
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return errWhatsAppMediaLeaseLost
	}
	if _, err := tx.Exec(ctx, `
		update public.whatsapp_messages
		set media_status = $3,
		    media_error = $4,
		    updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
	`, job.OrganizationID, job.MessageID, status, messageStatus); err != nil {
		return err
	}
	if code == mediaErrorOutcomeUnknown {
		if _, err := tx.Exec(ctx, `
			insert into private.whatsapp_media_worker_state (
				singleton, breaker_open, breaker_opened_at,
				breaker_reason, breaker_job_id, updated_at
			) values (
				true, true, now(), $1, $2::uuid, now()
			)
			on conflict (singleton) do update
			set breaker_open = true,
			    breaker_opened_at = coalesce(private.whatsapp_media_worker_state.breaker_opened_at, excluded.breaker_opened_at),
			    breaker_reason = excluded.breaker_reason,
			    breaker_job_id = excluded.breaker_job_id,
			    updated_at = now()
		`, mediaErrorOutcomeUnknown, job.ID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func whatsappMediaRetryDelay(attempt int) time.Duration {
	switch attempt {
	case 0, 1:
		return 30 * time.Second
	case 2:
		return 2 * time.Minute
	default:
		return 10 * time.Minute
	}
}

func (repo Repository) enqueueManualWhatsAppMediaJob(ctx context.Context, message retryMediaMessage) (manualWhatsAppMediaEnqueueResult, error) {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return manualWhatsAppMediaEnqueueResult{}, err
	}
	defer tx.Rollback(ctx)
	if err := lockWhatsAppMediaMutation(ctx, tx); err != nil {
		return manualWhatsAppMediaEnqueueResult{}, err
	}
	if _, err := tx.Exec(ctx, `
		select pg_advisory_xact_lock(hashtextextended($1, 0))
	`, "whatsapp-media-manual:"+message.OrganizationID+":"+message.ID); err != nil {
		return manualWhatsAppMediaEnqueueResult{}, err
	}

	existing, found, err := loadCanonicalManualWhatsAppMediaJob(ctx, tx, message.OrganizationID, message.ID)
	if err != nil {
		return manualWhatsAppMediaEnqueueResult{}, err
	}
	message, err = loadRetryMediaMessageForUpdate(ctx, tx, message.OrganizationID, message.ID)
	if err != nil {
		return manualWhatsAppMediaEnqueueResult{}, err
	}
	if strings.TrimSpace(message.MediaStoragePath) != "" {
		if !whatsappMediaPathBelongsToOrganization(message.MediaStoragePath, message.OrganizationID) {
			return manualWhatsAppMediaEnqueueResult{}, fmt.Errorf("%w: stored media path escaped organization scope", ErrProviderFailed)
		}
		if err := tx.Commit(ctx); err != nil {
			return manualWhatsAppMediaEnqueueResult{}, err
		}
		return manualWhatsAppMediaEnqueueResult{
			jobID:        existing.id,
			deduplicated: found,
			alreadyReady: true,
			storagePath:  message.MediaStoragePath,
			contentType:  message.MediaMimeType,
			actualSize:   message.MediaSize,
		}, nil
	}

	if found {
		result, queued, err := prepareExistingManualWhatsAppMediaJob(ctx, tx, message, existing)
		if err != nil {
			return manualWhatsAppMediaEnqueueResult{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return manualWhatsAppMediaEnqueueResult{}, err
		}
		if queued {
			wakeWhatsAppMediaWorker()
		}
		return result, nil
	}

	if !whatsappMediaManualDownloadAllowed(message.MessageType, message.MediaSize) {
		return manualWhatsAppMediaEnqueueResult{}, fmt.Errorf("%w: media must declare a positive size no greater than 25MB", ErrInvalidInput)
	}
	if strings.TrimSpace(message.SessionID) == "" {
		return manualWhatsAppMediaEnqueueResult{}, fmt.Errorf("%w: media message has no provider session", ErrInvalidInput)
	}

	raw := mapFromAny(message.Metadata["raw"])
	if len(raw) == 0 {
		raw = message.Metadata
	}
	nativeMessage := nativeEvolutionMessage{
		ProviderMessageID: message.MessageID,
		MessageType:       message.MessageType,
		MediaURL:          message.MediaURL,
		MediaMimeType:     message.MediaMimeType,
		MediaSize:         message.MediaSize,
		Raw:               raw,
	}
	dedupeKey, assetKey, fileSHA256, fileEncSHA256 := whatsappMediaQueueKeys(message.OrganizationID, message.SessionID, nativeMessage)
	messageKey := jsonb(minimalWhatsAppMediaMessageKey(nativeMessage))
	var jobID string
	err = tx.QueryRow(ctx, `
		insert into public.media_jobs (
			organization_id, session_id, conversation_id, message_id,
			provider_message_id, message_key, media_type, media_mime_type,
			status, attempts, max_attempts, next_retry_at,
			dedupe_key, asset_key, declared_size, file_sha256, file_enc_sha256,
			manual_requested
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, $6::jsonb, $7, nullif($8, ''),
			'pending', 0, $9, now(),
			$10, $11, $12, nullif($13, ''), nullif($14, ''), true
		)
		on conflict (organization_id, message_id)
		where error_code is distinct from 'media_legacy_job_retired'
		do nothing
		returning id::text
	`, message.OrganizationID, message.SessionID, message.ConversationID, message.ID,
		message.MessageID, messageKey, message.MessageType, message.MediaMimeType,
		whatsappMediaJobMaxAttempts, dedupeKey, assetKey, message.MediaSize,
		fileSHA256, fileEncSHA256).Scan(&jobID)
	if errors.Is(err, pgx.ErrNoRows) {
		existing, found, err = loadCanonicalManualWhatsAppMediaJob(ctx, tx, message.OrganizationID, message.ID)
		if err != nil {
			return manualWhatsAppMediaEnqueueResult{}, err
		}
		if !found {
			return manualWhatsAppMediaEnqueueResult{}, fmt.Errorf("%w: canonical media job was not created", ErrProviderFailed)
		}
		result, queued, err := prepareExistingManualWhatsAppMediaJob(ctx, tx, message, existing)
		if err != nil {
			return manualWhatsAppMediaEnqueueResult{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return manualWhatsAppMediaEnqueueResult{}, err
		}
		if queued {
			wakeWhatsAppMediaWorker()
		}
		return result, nil
	}
	if err != nil {
		return manualWhatsAppMediaEnqueueResult{}, err
	}

	if _, err := tx.Exec(ctx, `
		update public.whatsapp_messages
		set media_status = 'pending',
		    media_error = $3,
		    updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
	`, message.OrganizationID, message.ID, mediaErrorManualQueued); err != nil {
		return manualWhatsAppMediaEnqueueResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return manualWhatsAppMediaEnqueueResult{}, err
	}
	wakeWhatsAppMediaWorker()
	return manualWhatsAppMediaEnqueueResult{jobID: jobID}, nil
}

type manualWhatsAppMediaJob struct {
	id          string
	status      string
	errorCode   string
	storagePath string
	contentType string
	actualSize  int64
}

func loadCanonicalManualWhatsAppMediaJob(ctx context.Context, tx pgx.Tx, organizationID string, messageID string) (manualWhatsAppMediaJob, bool, error) {
	var job manualWhatsAppMediaJob
	err := tx.QueryRow(ctx, `
		select id::text,
		       status,
		       coalesce(error_code, ''),
		       coalesce(storage_path, ''),
		       coalesce(media_mime_type, ''),
		       coalesce(actual_size, declared_size, 0)
		from public.media_jobs
		where organization_id = $1::uuid
		  and message_id = $2::uuid
		  and error_code is distinct from 'media_legacy_job_retired'
		limit 1
		for update
	`, organizationID, messageID).Scan(
		&job.id,
		&job.status,
		&job.errorCode,
		&job.storagePath,
		&job.contentType,
		&job.actualSize,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return manualWhatsAppMediaJob{}, false, nil
	}
	return job, err == nil, err
}

func prepareExistingManualWhatsAppMediaJob(ctx context.Context, tx pgx.Tx, message retryMediaMessage, job manualWhatsAppMediaJob) (manualWhatsAppMediaEnqueueResult, bool, error) {
	result := manualWhatsAppMediaEnqueueResult{jobID: job.id, deduplicated: true}
	switch job.status {
	case "completed":
		if strings.TrimSpace(job.storagePath) == "" {
			return manualWhatsAppMediaEnqueueResult{}, false, fmt.Errorf("%w: completed media job has no stored object", ErrProviderFailed)
		}
		if !whatsappMediaPathBelongsToOrganization(job.storagePath, message.OrganizationID) {
			return manualWhatsAppMediaEnqueueResult{}, false, fmt.Errorf("%w: completed media path escaped organization scope", ErrProviderFailed)
		}
		if _, err := tx.Exec(ctx, `
			update public.whatsapp_messages
			set media_storage_path = $3,
			    media_url = null,
			    media_mime_type = nullif($4, ''),
			    media_status = 'ready',
			    media_error = null,
			    media_size = nullif($5, 0),
			    updated_at = now()
			where organization_id = $1::uuid and id = $2::uuid
		`, message.OrganizationID, message.ID, job.storagePath, job.contentType, job.actualSize); err != nil {
			return manualWhatsAppMediaEnqueueResult{}, false, err
		}
		result.alreadyReady = true
		result.storagePath = job.storagePath
		result.contentType = job.contentType
		result.actualSize = job.actualSize
		return result, false, nil
	case "processing", "pending":
		if _, err := tx.Exec(ctx, `
			update public.media_jobs
			set manual_requested = true,
			    updated_at = now()
			where organization_id = $1::uuid and id = $2::uuid
		`, message.OrganizationID, job.id); err != nil {
			return manualWhatsAppMediaEnqueueResult{}, false, err
		}
	case "failed":
		if job.errorCode == mediaErrorOutcomeUnknown || job.errorCode == mediaErrorLegacyRetired {
			return manualWhatsAppMediaEnqueueResult{}, false, fmt.Errorf("%w: media job cannot be replayed safely", ErrProviderFailed)
		}
		if !whatsappMediaManualDownloadAllowed(message.MessageType, message.MediaSize) {
			return manualWhatsAppMediaEnqueueResult{}, false, fmt.Errorf("%w: media must declare a positive size no greater than 25MB", ErrInvalidInput)
		}
		if strings.TrimSpace(message.SessionID) == "" {
			return manualWhatsAppMediaEnqueueResult{}, false, fmt.Errorf("%w: media message has no provider session", ErrInvalidInput)
		}
		if _, err := tx.Exec(ctx, `
			update public.media_jobs
			set status = 'pending',
			    attempts = 0,
			    max_attempts = $3,
			    next_retry_at = now(),
			    manual_requested = true,
			    failed_at = null,
			    error_code = null,
			    error_message = null,
			    provider_started_at = null,
			    updated_at = now()
			where organization_id = $1::uuid and id = $2::uuid
		`, message.OrganizationID, job.id, whatsappMediaJobMaxAttempts); err != nil {
			return manualWhatsAppMediaEnqueueResult{}, false, err
		}
	default:
		return manualWhatsAppMediaEnqueueResult{}, false, fmt.Errorf("%w: unsupported media job state", ErrProviderFailed)
	}

	if _, err := tx.Exec(ctx, `
		update public.whatsapp_messages
		set media_status = 'pending',
		    media_error = $3,
		    updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
	`, message.OrganizationID, message.ID, mediaErrorManualQueued); err != nil {
		return manualWhatsAppMediaEnqueueResult{}, false, err
	}
	return result, true, nil
}

func enqueueNativeEvolutionMediaJob(ctx context.Context, tx pgx.Tx, session nativeEvolutionSession, conversationID string, message nativeEvolutionMessage, messageRowID string) (bool, error) {
	if !nativeIsMediaType(message.MessageType) || message.MediaStoragePath != "" {
		return false, nil
	}
	if message.MediaSize <= 0 {
		message.MediaSize = 0
	}
	policy := automaticWhatsAppMediaPolicy(message.MessageType, message.MediaMimeType, message.MediaSize)
	jobStatus := "pending"
	if !policy.automatic {
		jobStatus = "failed"
	}
	dedupeKey, assetKey, fileSHA256, fileEncSHA256 := whatsappMediaQueueKeys(session.OrganizationID, session.ID, message)
	messageKey := jsonb(minimalWhatsAppMediaMessageKey(message))

	var persistedStatus, persistedError, persistedStoragePath, persistedMimeType string
	var persistedActualSize int64
	err := tx.QueryRow(ctx, `
		insert into public.media_jobs (
			organization_id, session_id, conversation_id, message_id,
			provider_message_id, message_key, media_type, media_mime_type,
			status, attempts, max_attempts, next_retry_at,
			dedupe_key, asset_key, declared_size, file_sha256, file_enc_sha256,
			error_code, error_message, failed_at, manual_requested
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, $6::jsonb, $7, nullif($8, ''),
			$9, 0, $10, now(),
			$11, $12, nullif($13, 0), nullif($14, ''), nullif($15, ''),
			nullif($16, ''), nullif($16, ''), case when $9 = 'failed' then now() end, false
		)
		on conflict (organization_id, message_id)
		where error_code is distinct from 'media_legacy_job_retired'
		do update
		set message_key = case
		      when media_jobs.status in ('processing', 'completed') then media_jobs.message_key
		      else excluded.message_key
		    end,
		    provider_message_id = case
		      when media_jobs.status in ('processing', 'completed') then media_jobs.provider_message_id
		      else coalesce(excluded.provider_message_id, media_jobs.provider_message_id)
		    end,
		    media_mime_type = case
		      when media_jobs.status in ('processing', 'completed') then media_jobs.media_mime_type
		      else coalesce(excluded.media_mime_type, media_jobs.media_mime_type)
		    end,
		    declared_size = case
		      when media_jobs.status in ('processing', 'completed') then media_jobs.declared_size
		      else coalesce(excluded.declared_size, media_jobs.declared_size)
		    end,
		    file_sha256 = case
		      when media_jobs.status in ('processing', 'completed') then media_jobs.file_sha256
		      else coalesce(excluded.file_sha256, media_jobs.file_sha256)
		    end,
		    file_enc_sha256 = case
		      when media_jobs.status in ('processing', 'completed') then media_jobs.file_enc_sha256
		      else coalesce(excluded.file_enc_sha256, media_jobs.file_enc_sha256)
		    end,
		    asset_key = case
		      when media_jobs.status in ('processing', 'completed') then media_jobs.asset_key
		      else excluded.asset_key
		    end,
		    status = case
		      when media_jobs.status = 'failed'
		       and coalesce(media_jobs.error_code, '') like 'media_policy_%'
		       and excluded.status = 'pending'
		      then 'pending'
		      else media_jobs.status
		    end,
		    attempts = case
		      when media_jobs.status = 'failed'
		       and coalesce(media_jobs.error_code, '') like 'media_policy_%'
		       and excluded.status = 'pending'
		      then 0
		      else media_jobs.attempts
		    end,
		    next_retry_at = case
		      when media_jobs.status = 'failed'
		       and coalesce(media_jobs.error_code, '') like 'media_policy_%'
		       and excluded.status = 'pending'
		      then now()
		      else media_jobs.next_retry_at
		    end,
		    error_code = case
		      when media_jobs.status = 'failed'
		       and coalesce(media_jobs.error_code, '') like 'media_policy_%'
		       and excluded.status = 'pending'
		      then null
		      else media_jobs.error_code
		    end,
		    error_message = case
		      when media_jobs.status = 'failed'
		       and coalesce(media_jobs.error_code, '') like 'media_policy_%'
		       and excluded.status = 'pending'
		      then null
		      else media_jobs.error_message
		    end,
		    failed_at = case
		      when media_jobs.status = 'failed'
		       and coalesce(media_jobs.error_code, '') like 'media_policy_%'
		       and excluded.status = 'pending'
		      then null
		      else media_jobs.failed_at
		    end,
		    updated_at = now()
		where media_jobs.status not in ('processing', 'completed')
		  and media_jobs.media_type = excluded.media_type
		returning status,
		          coalesce(error_code, ''),
		          coalesce(storage_path, ''),
		          coalesce(media_mime_type, ''),
		          coalesce(actual_size, 0)
	`, session.OrganizationID, session.ID, conversationID, messageRowID,
		message.ProviderMessageID, messageKey, message.MessageType, message.MediaMimeType,
		jobStatus, whatsappMediaJobMaxAttempts, dedupeKey, assetKey, message.MediaSize,
		fileSHA256, fileEncSHA256, policy.errorCode).Scan(
		&persistedStatus,
		&persistedError,
		&persistedStoragePath,
		&persistedMimeType,
		&persistedActualSize,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		// A canonical job already exists but is processing/completed, or the
		// provider redelivered the same message with a different media type.
		// Reflect its durable state without mutating its identity or lease.
		err = tx.QueryRow(ctx, `
			select status,
			       coalesce(error_code, ''),
			       coalesce(storage_path, ''),
			       coalesce(media_mime_type, ''),
			       coalesce(actual_size, 0)
			from public.media_jobs
			where organization_id = $1::uuid
			  and message_id = $2::uuid
			  and error_code is distinct from 'media_legacy_job_retired'
		`, session.OrganizationID, messageRowID).Scan(
			&persistedStatus,
			&persistedError,
			&persistedStoragePath,
			&persistedMimeType,
			&persistedActualSize,
		)
	}
	if err != nil {
		return false, err
	}
	if persistedStatus == "completed" && persistedStoragePath != "" {
		if !whatsappMediaPathBelongsToOrganization(persistedStoragePath, session.OrganizationID) {
			return false, fmt.Errorf("%w: completed media path escaped organization scope", ErrProviderFailed)
		}
		if _, err := tx.Exec(ctx, `
			update public.whatsapp_messages
			set media_storage_path = $3,
			    media_url = null,
			    media_mime_type = nullif($4, ''),
			    media_status = 'ready',
			    media_error = null,
			    media_size = nullif($5, 0),
			    updated_at = now()
			where organization_id = $1::uuid and id = $2::uuid
		`, session.OrganizationID, messageRowID, persistedStoragePath, persistedMimeType, persistedActualSize); err != nil {
			return false, err
		}
	} else if persistedStatus == "failed" {
		if _, err := tx.Exec(ctx, `
			update public.whatsapp_messages
			set media_status = 'failed',
			    media_error = nullif($3, ''),
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
			  and media_storage_path is null
		`, session.OrganizationID, messageRowID, persistedError); err != nil {
			return false, err
		}
	}
	return persistedStatus == "pending", nil
}

func whatsappMediaQueueKeys(organizationID string, sessionID string, message nativeEvolutionMessage) (string, string, string, string) {
	messageNode := nativeFirstMap(message.Raw, "message", "Message")
	if len(messageNode) == 0 {
		messageNode = message.Raw
	}
	_, mediaBlock := nativeMediaBlock(messageNode, message.Raw, nativeFirstMap(message.Raw, "Info", "info"))
	fileSHA256 := strings.TrimSpace(firstString(mediaBlock, "fileSha256", "fileSHA256", "FileSHA256", "FileSha256"))
	fileEncSHA256 := strings.TrimSpace(firstString(mediaBlock, "fileEncSha256", "fileEncSHA256", "FileEncSHA256", "FileEncSha256"))
	dedupeKey := hashWhatsAppMediaKey("job:v1", organizationID, sessionID, message.ProviderMessageID, message.MessageType)
	// Prefer the plaintext digest: encrypted media hashes can legitimately vary
	// with the media key even when the underlying asset is identical.
	fingerprint := canonicalWhatsAppMediaDigest(fileSHA256)
	if fingerprint == "" {
		fingerprint = canonicalWhatsAppMediaDigest(fileEncSHA256)
	}
	assetKey := dedupeKey
	if fingerprint != "" {
		assetKey = hashWhatsAppMediaKey("asset:v1", organizationID, fingerprint)
	}
	return dedupeKey, assetKey, fileSHA256, fileEncSHA256
}

func validateWhatsAppMediaPlaintextDigest(expected string, payload []byte) error {
	expected = strings.TrimSpace(expected)
	if expected == "" {
		return nil
	}
	expectedBytes, err := decodeWhatsAppMediaSHA256(expected)
	if err != nil {
		return fmt.Errorf("%w: invalid WhatsApp plaintext media digest", ErrInvalidInput)
	}
	actual := sha256.Sum256(payload)
	if !bytes.Equal(expectedBytes, actual[:]) {
		return fmt.Errorf("%w: downloaded media digest does not match WhatsApp metadata", ErrProviderFailed)
	}
	return nil
}

func canonicalWhatsAppMediaDigest(value string) string {
	decoded, err := decodeWhatsAppMediaSHA256(value)
	if err != nil {
		return ""
	}
	return base64.RawStdEncoding.EncodeToString(decoded)
}

func decodeWhatsAppMediaSHA256(value string) ([]byte, error) {
	value = strings.TrimSpace(value)
	for _, encoding := range []*base64.Encoding{
		base64.StdEncoding,
		base64.RawStdEncoding,
		base64.URLEncoding,
		base64.RawURLEncoding,
	} {
		decoded, err := encoding.DecodeString(value)
		if err == nil && len(decoded) == sha256.Size {
			return decoded, nil
		}
	}
	decoded, err := hex.DecodeString(value)
	if err == nil && len(decoded) == sha256.Size {
		return decoded, nil
	}
	return nil, errors.New("invalid SHA-256 digest")
}

func hashWhatsAppMediaKey(parts ...string) string {
	digest := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return hex.EncodeToString(digest[:])
}
