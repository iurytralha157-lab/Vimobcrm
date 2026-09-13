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
	"net/url"
	"sort"
	"strings"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	whatsappMediaAbsoluteMaxBytes  = 25 * 1024 * 1024
	whatsappMediaImageAutoMax      = 10 * 1024 * 1024
	whatsappMediaAudioAutoMax      = 25 * 1024 * 1024
	whatsappMediaVideoAutoMax      = 25 * 1024 * 1024
	whatsappMediaStickerAutoMax    = 5 * 1024 * 1024
	whatsappMediaJobMaxAttempts    = 3
	whatsappMediaAssetVersion      = "v2"
	whatsappMediaRepairPathKey     = "repair_storage_path"
	whatsappMediaUploadPathKey     = "upload_intent_path"
	whatsappMediaUploadMIMEKey     = "upload_intent_content_type"
	whatsappMediaUploadSizeKey     = "upload_intent_size"
	whatsappMediaUploadFailuresKey = "upload_intent_failures"
	whatsappMediaCompletionMaxJobs = 100
	whatsappMediaRealtimePriority  = 100

	mediaErrorManualOnly     = "media_policy_manual_only_type"
	mediaErrorTooLarge       = "media_policy_too_large"
	mediaErrorUnknownSize    = "media_policy_unknown_size"
	mediaErrorManualQueued   = "media_manual_download_queued"
	mediaErrorRetry          = "media_download_retry_scheduled"
	mediaErrorFailed         = "media_download_failed"
	mediaErrorOutcomeUnknown = "media_provider_outcome_unknown"
	mediaErrorLocalStage     = "media_local_stage_pending"
	mediaErrorFinalizeLocal  = "media_local_finalization_pending"
)

var (
	whatsappMediaWorkerID                = "vimob-api-whatsapp-media-" + randomHex(8)
	whatsappMediaWorkerWake              = make(chan struct{}, maxWhatsAppMediaWorkerConcurrency)
	whatsappMediaWorkerCount             atomic.Int64
	errWhatsAppMediaLeaseLost            = errors.New("whatsapp media worker lease lost")
	errWhatsAppMediaTooLarge             = errors.New("whatsapp media exceeds the configured download limit")
	errWhatsAppMediaSessionDisconnected  = errors.New("whatsapp media session disconnected before provider recovery")
	errWhatsAppMediaProviderDisconnected = errors.New("whatsapp media provider definitively rejected recovery because the session disconnected")
	errWhatsAppMediaLocalStagePending    = errors.New("whatsapp media provider recovery finished and local persistence remains")
	errWhatsAppMediaLocalFinalizePending = errors.New("whatsapp media is durable and only local database finalization remains")
	errWhatsAppMediaProviderInFlight     = errors.New("whatsapp media provider recovery may remain in flight")
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
	FileEncSHA256     string
	AssetKey          string
	Attempts          int
	MaxAttempts       int
	ManualRequested   bool
	LockedBy          string
	LeaseToken        string
	ProcessingSlot    int
	StoragePath       string
	ActualSize        int64
	CreatedAt         time.Time
}

type completedWhatsAppMediaAsset struct {
	storagePath string
	contentType string
	actualSize  int64
}

type whatsappMediaTypeMetrics struct {
	claimed             atomic.Uint64
	completed           atomic.Uint64
	failed              atomic.Uint64
	maxQueueAgeMillis   atomic.Uint64
	maxProcessingMillis atomic.Uint64
}

type whatsappMediaTypeMetricsSnapshot struct {
	Claimed             uint64
	Completed           uint64
	Failed              uint64
	MaxQueueAgeMillis   uint64
	MaxProcessingMillis uint64
}

var (
	whatsappImageMediaMetrics whatsappMediaTypeMetrics
	whatsappAudioMediaMetrics whatsappMediaTypeMetrics
	whatsappVideoMediaMetrics whatsappMediaTypeMetrics
	whatsappOtherMediaMetrics whatsappMediaTypeMetrics
)

func whatsappMediaMetricsForType(messageType string) *whatsappMediaTypeMetrics {
	switch strings.ToLower(strings.TrimSpace(messageType)) {
	case "image":
		return &whatsappImageMediaMetrics
	case "audio":
		return &whatsappAudioMediaMetrics
	case "video":
		return &whatsappVideoMediaMetrics
	default:
		return &whatsappOtherMediaMetrics
	}
}

func updateWhatsAppMediaMetricMax(metric *atomic.Uint64, value uint64) {
	for current := metric.Load(); value > current; current = metric.Load() {
		if metric.CompareAndSwap(current, value) {
			return
		}
	}
}

func recordWhatsAppMediaClaim(job queuedWhatsAppMediaJob, now time.Time) {
	metrics := whatsappMediaMetricsForType(job.MediaType)
	metrics.claimed.Add(1)
	if job.CreatedAt.IsZero() {
		return
	}
	age := now.Sub(job.CreatedAt)
	if age < 0 {
		age = 0
	}
	updateWhatsAppMediaMetricMax(&metrics.maxQueueAgeMillis, uint64(age/time.Millisecond))
}

func recordWhatsAppMediaOutcome(messageType string, completed bool, elapsed time.Duration) {
	metrics := whatsappMediaMetricsForType(messageType)
	if completed {
		metrics.completed.Add(1)
	} else {
		metrics.failed.Add(1)
	}
	if elapsed < 0 {
		elapsed = 0
	}
	updateWhatsAppMediaMetricMax(&metrics.maxProcessingMillis, uint64(elapsed/time.Millisecond))
}

func snapshotWhatsAppMediaTypeMetrics(messageType string) whatsappMediaTypeMetricsSnapshot {
	metrics := whatsappMediaMetricsForType(messageType)
	return whatsappMediaTypeMetricsSnapshot{
		Claimed:             metrics.claimed.Swap(0),
		Completed:           metrics.completed.Swap(0),
		Failed:              metrics.failed.Swap(0),
		MaxQueueAgeMillis:   metrics.maxQueueAgeMillis.Swap(0),
		MaxProcessingMillis: metrics.maxProcessingMillis.Swap(0),
	}
}

func whatsappMediaSLO(messageType string) (queue time.Duration, processing time.Duration) {
	queue = 30 * time.Second
	switch strings.ToLower(strings.TrimSpace(messageType)) {
	case "image":
		processing = 30 * time.Second
	case "audio":
		processing = 45 * time.Second
	case "video":
		processing = 2 * time.Minute
	default:
		processing = 2 * time.Minute
	}
	return queue, processing
}

func logWhatsAppMediaMinute(logger *slog.Logger) {
	for _, messageType := range []string{"image", "audio", "video", "other"} {
		metrics := snapshotWhatsAppMediaTypeMetrics(messageType)
		queueSLO, processingSLO := whatsappMediaSLO(messageType)
		logger.Info(
			"whatsapp media minute",
			"media_type", messageType,
			"claimed", metrics.Claimed,
			"completed", metrics.Completed,
			"failed", metrics.Failed,
			"max_queue_age_ms", metrics.MaxQueueAgeMillis,
			"max_processing_ms", metrics.MaxProcessingMillis,
			"queue_slo_ms", queueSLO.Milliseconds(),
			"processing_slo_ms", processingSLO.Milliseconds(),
			"queue_slo_breached", metrics.MaxQueueAgeMillis > uint64(queueSLO/time.Millisecond),
			"processing_slo_breached", metrics.MaxProcessingMillis > uint64(processingSLO/time.Millisecond),
		)
	}
}

func automaticWhatsAppMediaPolicy(messageType string, mimeType string, declaredSize int64) whatsappMediaPolicy {
	if declaredSize < 0 {
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
	case "video":
		if declaredSize <= whatsappMediaVideoAutoMax {
			return whatsappMediaPolicy{automatic: true}
		}
		return whatsappMediaPolicy{errorCode: mediaErrorTooLarge}
	case "sticker":
		if declaredSize <= whatsappMediaStickerAutoMax {
			return whatsappMediaPolicy{automatic: true}
		}
		return whatsappMediaPolicy{errorCode: mediaErrorTooLarge}
	case "document":
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
	case "video":
		return whatsappMediaVideoAutoMax
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
		declaredSize >= 0 && declaredSize <= whatsappMediaAbsoluteMaxBytes
}

func wakeWhatsAppMediaWorker() {
	workerCount := int(whatsappMediaWorkerCount.Load())
	if workerCount < 1 || workerCount > maxWhatsAppMediaWorkerConcurrency {
		workerCount = defaultWhatsAppMediaWorkerConcurrency
	}
	for range workerCount {
		select {
		case whatsappMediaWorkerWake <- struct{}{}:
		default:
			return
		}
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
	if !whatsappMediaWorkerCanStart(handler.repo.functions) {
		logger.Warn(
			"whatsapp media worker remains disabled without a native rollout scope",
			"processor_mode", normalizeEvolutionWebhookProcessorMode(handler.repo.functions.webhookProcessorMode),
		)
		return
	}
	whatsappMediaWorkerCount.Store(int64(config.MediaWorkerConcurrency))
	go func() {
		metricsTicker := time.NewTicker(time.Minute)
		defer metricsTicker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-metricsTicker.C:
				logWhatsAppMediaMinute(logger)
			}
		}
	}()

	for range config.MediaWorkerConcurrency {
		go handler.runWhatsAppMediaWorker(ctx, logger, config)
	}
}

func (handler Handler) runWhatsAppMediaWorker(ctx context.Context, logger *slog.Logger, config WorkerConfig) {
	ticker := time.NewTicker(config.MediaWorkerInterval)
	defer ticker.Stop()
	for {
		for {
			processed, err := handler.repo.drainOneWhatsAppMediaJobForSessions(
				ctx,
				config.MediaWorkerLease,
				config.MediaWorkerConcurrency,
				handler.repo.functions.webhookRolloutSessionIDs,
			)
			if err != nil {
				if !errors.Is(err, context.Canceled) {
					logger.Error("whatsapp media worker failed", "error", err)
				}
				break
			}
			if !processed {
				break
			}
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-whatsappMediaWorkerWake:
		}
	}
}

func whatsappMediaWorkerCanStart(client functionsClient) bool {
	mode := normalizeEvolutionWebhookProcessorMode(client.webhookProcessorMode)
	if mode == webhookProcessorEdge {
		return false
	}
	for _, allowed := range client.webhookRolloutSessionIDs {
		if strings.TrimSpace(allowed) != "" {
			return true
		}
	}
	return false
}

func (repo Repository) drainOneWhatsAppMediaJob(ctx context.Context, lease time.Duration) (bool, error) {
	return repo.drainOneWhatsAppMediaJobForSessions(
		ctx,
		lease,
		defaultWhatsAppMediaWorkerConcurrency,
		[]string{"*"},
	)
}

func (repo Repository) drainOneWhatsAppMediaJobForSessions(
	ctx context.Context,
	lease time.Duration,
	maxConcurrency int,
	allowedSessionIDs []string,
) (bool, error) {
	job, err := repo.claimWhatsAppMediaJobForSessions(ctx, lease, maxConcurrency, allowedSessionIDs)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	startedAt := time.Now()
	recordWhatsAppMediaClaim(job, startedAt)

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
		recordWhatsAppMediaOutcome(job.MediaType, true, time.Since(startedAt))
		return true, nil
	}
	recordWhatsAppMediaOutcome(job.MediaType, false, time.Since(startedAt))
	if leaseErr != nil {
		return true, errors.Join(processErr, leaseErr)
	}
	if ctx.Err() != nil {
		return true, ctx.Err()
	}
	if deferDisconnected, providerStarted := whatsappMediaDisconnectedDeferral(processErr); deferDisconnected {
		// The dependency disappeared either before provider recovery started or
		// through a definitive disconnected response from that read-only call.
		// Release this fenced lease without spending the customer's retry budget.
		// The connected-session claim predicate and connection webhook wakeup
		// make the job eligible again after recovery.
		if err := repo.deferWhatsAppMediaJobDisconnected(ctx, job, providerStarted); err != nil {
			return true, errors.Join(processErr, err)
		}
		return true, nil
	}
	if errors.Is(processErr, errWhatsAppMediaLocalFinalizePending) {
		// Storage is already durably recorded on the fenced job. Return the
		// attempt and release the slot immediately so the next claim performs
		// database-only finalization, independent of provider availability and
		// without terminalizing on the provider retry budget.
		if err := repo.deferWhatsAppMediaLocalFinalization(ctx, job); err != nil {
			return true, errors.Join(processErr, err)
		}
		return true, nil
	}
	if errors.Is(processErr, errWhatsAppMediaLocalStagePending) {
		// Provider recovery returned before this marker is emitted. Give the
		// attempt back and keep any deterministic upload intent so a retry can
		// reconcile Storage before it considers another provider download.
		if err := repo.deferWhatsAppMediaLocalStage(ctx, job); err != nil {
			return true, errors.Join(processErr, err)
		}
		return true, nil
	}
	if err := repo.retryOrFailWhatsAppMediaJob(ctx, job, code, permanent, processErr); err != nil {
		return true, errors.Join(processErr, err)
	}
	return true, nil
}

func whatsappMediaDisconnectedDeferral(err error) (deferJob bool, providerStarted bool) {
	if errors.Is(err, errWhatsAppMediaSessionDisconnected) {
		return true, false
	}
	if errors.Is(err, errWhatsAppMediaProviderDisconnected) {
		return true, true
	}
	return false, false
}

func isWhatsAppMediaProviderDisconnected(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "not disconnected") {
		return false
	}
	for _, marker := range []string{
		"client disconnected",
		"client is disconnected",
		"not connected",
		"already closed",
		"logged out",
	} {
		if strings.Contains(message, marker) {
			return true
		}
	}
	return false
}

func normalizeWhatsAppMediaProviderRecoveryError(err error) error {
	if err == nil {
		return nil
	}
	// A provider/gateway body may say "client disconnected" even when the HTTP
	// outcome itself is ambiguous. The durable in-flight fence must win over
	// text heuristics or a reconnect could overlap the detached operation.
	if errors.Is(err, ErrProviderOutcomeUnknown) {
		return fmt.Errorf("%w: %w", errWhatsAppMediaProviderInFlight, err)
	}
	if isWhatsAppMediaProviderDisconnected(err) {
		return fmt.Errorf("%w: %v", errWhatsAppMediaProviderDisconnected, err)
	}
	return err
}

func (repo Repository) claimWhatsAppMediaJob(ctx context.Context, lease time.Duration) (queuedWhatsAppMediaJob, error) {
	return repo.claimWhatsAppMediaJobForSessions(
		ctx,
		lease,
		defaultWhatsAppMediaWorkerConcurrency,
		[]string{"*"},
	)
}

func (repo Repository) claimWhatsAppMediaJobForSessions(
	ctx context.Context,
	lease time.Duration,
	maxConcurrency int,
	allowedSessionIDs []string,
) (queuedWhatsAppMediaJob, error) {
	sessionIDs, allSessions, err := whatsappMediaClaimScope(allowedSessionIDs)
	if err != nil {
		return queuedWhatsAppMediaJob{}, err
	}
	var job queuedWhatsAppMediaJob
	var messageKeyJSON string
	claimCtx, cancelClaim := context.WithTimeout(ctx, 5*time.Second)
	defer cancelClaim()
	err = repo.db.Pool().QueryRow(claimCtx, `
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
			coalesce(job.file_enc_sha256, ''),
			job.asset_key,
			job.attempts,
			job.max_attempts,
			job.manual_requested,
			coalesce(job.locked_by, ''),
			job.lease_token::text,
			coalesce(job.processing_slot, 0),
			coalesce(job.storage_path, ''),
			coalesce(job.actual_size, 0),
			job.created_at
		from private.claim_whatsapp_media_job($1, $2::interval, $3, $4::uuid[], $5) as job
	`, whatsappMediaWorkerID, fmt.Sprintf("%.0f seconds", lease.Seconds()),
		normalizeMediaWorkerConcurrency(maxConcurrency), sessionIDs, allSessions).Scan(
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
		&job.FileEncSHA256,
		&job.AssetKey,
		&job.Attempts,
		&job.MaxAttempts,
		&job.ManualRequested,
		&job.LockedBy,
		&job.LeaseToken,
		&job.ProcessingSlot,
		&job.StoragePath,
		&job.ActualSize,
		&job.CreatedAt,
	)
	if err != nil {
		return queuedWhatsAppMediaJob{}, err
	}
	job.MessageKey = decodeObjectJSON(messageKeyJSON)
	return job, nil
}

func whatsappMediaClaimScope(values []string) ([]pgtype.UUID, bool, error) {
	if len(values) == 1 && strings.TrimSpace(values[0]) == "*" {
		return []pgtype.UUID{}, true, nil
	}

	ids := make([]pgtype.UUID, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if value == "*" {
			return nil, false, fmt.Errorf("%w: media worker scope must be either * or UUIDs", ErrInvalidInput)
		}
		normalized, ok := normalizeUUID(value)
		if !ok {
			return nil, false, fmt.Errorf("%w: invalid media worker session scope %q", ErrInvalidInput, value)
		}
		if _, duplicate := seen[normalized]; duplicate {
			continue
		}
		var id pgtype.UUID
		if scanErr := id.Scan(normalized); scanErr != nil || !id.Valid {
			return nil, false, fmt.Errorf("%w: invalid media worker session scope %q", ErrInvalidInput, value)
		}
		seen[normalized] = struct{}{}
		ids = append(ids, id)
	}
	return ids, false, nil
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
		if job.DeclaredSize < 0 {
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
	repairStoragePath := strings.TrimSpace(firstString(job.MessageKey, whatsappMediaRepairPathKey))
	if job.StoragePath != "" && job.ActualSize > 0 &&
		(repairStoragePath == "" || job.StoragePath != repairStoragePath) {
		if !whatsappMediaPathBelongsToOrganization(job.StoragePath, job.OrganizationID) {
			return mediaErrorFailed, true, fmt.Errorf("%w: uploaded media path escaped organization scope", ErrProviderFailed)
		}
		if err := repo.completeWhatsAppMediaJob(ctx, job, completedWhatsAppMediaAsset{
			storagePath: job.StoragePath,
			contentType: job.MediaMimeType,
			actualSize:  job.ActualSize,
		}); err != nil {
			return mediaErrorFinalizeLocal, false, fmt.Errorf("%w: %v", errWhatsAppMediaLocalFinalizePending, err)
		}
		return "", false, nil
	}

	intent, hasUploadIntent, intentErr := whatsappMediaUploadIntent(job, repairStoragePath)
	if intentErr != nil {
		return mediaErrorFailed, true, intentErr
	}
	if hasUploadIntent {
		exists, err := repo.storage.objectExists(ctx, whatsappMediaBucket, intent.storagePath)
		if err != nil {
			return mediaErrorLocalStage, false, fmt.Errorf("%w: reconcile upload intent: %v", errWhatsAppMediaLocalStagePending, err)
		}
		if exists {
			if err := repo.markWhatsAppMediaStorageUploaded(ctx, job, intent); err != nil {
				return mediaErrorLocalStage, false, fmt.Errorf("%w: record reconciled upload: %v", errWhatsAppMediaLocalStagePending, err)
			}
			if err := repo.completeWhatsAppMediaJob(ctx, job, intent); err != nil {
				return mediaErrorFinalizeLocal, false, fmt.Errorf("%w: %v", errWhatsAppMediaLocalFinalizePending, err)
			}
			return "", false, nil
		}
	}

	if repairStoragePath == "" {
		if ready, found, err := repo.findCompletedWhatsAppMediaAsset(ctx, job); err != nil {
			return mediaErrorFailed, false, err
		} else if found {
			if err := repo.markWhatsAppMediaStorageUploaded(ctx, job, ready); err != nil {
				return mediaErrorLocalStage, false, fmt.Errorf("%w: record deduplicated upload: %v", errWhatsAppMediaLocalStagePending, err)
			}
			if err := repo.completeWhatsAppMediaJob(ctx, job, ready); err != nil {
				return mediaErrorFinalizeLocal, false, fmt.Errorf("%w: %v", errWhatsAppMediaLocalFinalizePending, err)
			}
			return "", false, nil
		}
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

	providerCallStarted := false
	providerMessageAvailable := false
	if _, providerMessageErr := nativeEvolutionProviderMessage(message); providerMessageErr == nil {
		providerMessageAvailable = true
	}
	downloadFromProvider := func() (recoveredWhatsAppMedia, error) {
		connected, connectionErr := repo.whatsappMediaSessionCanDownload(ctx, job)
		if connectionErr != nil {
			return recoveredWhatsAppMedia{}, connectionErr
		}
		if !connected {
			return recoveredWhatsAppMedia{}, fmt.Errorf(
				"%w: WhatsApp media session is not an active connected Evolution Go session",
				errWhatsAppMediaSessionDisconnected,
			)
		}
		if err := repo.markWhatsAppMediaProviderStarted(ctx, job); err != nil {
			return recoveredWhatsAppMedia{}, err
		}
		providerCallStarted = true
		recovered, downloadErr := repo.downloadNativeEvolutionMedia(ctx, pendingEvolutionWebhook{
			OrganizationID: job.OrganizationID,
			SessionID:      job.SessionID,
		}, message, whatsappMediaJobDownloadMaxBytes(job))
		if downloadErr = normalizeWhatsAppMediaProviderRecoveryError(downloadErr); downloadErr != nil {
			return recoveredWhatsAppMedia{}, downloadErr
		}
		return recovered, nil
	}

	var recovered recoveredWhatsAppMedia
	var err error
	switch {
	case message.MediaBase64 != "":
		if err := validateWhatsAppMediaBase64Size(message.MediaBase64, whatsappMediaJobDownloadMaxBytes(job)); err != nil {
			return mediaErrorTooLarge, true, err
		}
		recovered.bytes, err = decodeFlexibleBase64Media(message.MediaBase64)
		recovered.contentType = firstNonEmpty(detectWhatsAppMediaMimeType(recovered.bytes), message.MediaMimeType, fallbackWhatsAppMediaMimeType(message.MessageType))
		recovered.source = "queued_webhook_base64"
	case whatsappMediaRequiresProviderDecryption(message):
		if !providerMessageAvailable {
			err = fmt.Errorf("%w: encrypted WhatsApp media is missing its provider message block", ErrProviderFailed)
			break
		}
		recovered, err = downloadFromProvider()
	case repo.whatsappMediaURLIsDemonstrablyPlaintext(message.MediaURL):
		recovered, err = repo.downloadWhatsAppMediaURL(ctx, message.MediaURL)
		if err != nil && providerMessageAvailable {
			recovered, err = downloadFromProvider()
		}
	case providerMessageAvailable:
		recovered, err = downloadFromProvider()
	default:
		err = fmt.Errorf("%w: media has neither verified plaintext bytes nor a provider recovery block", ErrProviderFailed)
	}

	var contentType string
	if err == nil {
		_, contentType, err = validateRecoveredWhatsAppMedia(job, recovered)
		if err != nil && !providerCallStarted && providerMessageAvailable {
			recovered, err = downloadFromProvider()
			if err == nil {
				_, contentType, err = validateRecoveredWhatsAppMedia(job, recovered)
			}
		}
	}
	if err != nil {
		code, permanent := classifyWhatsAppMediaDownloadError(err)
		return code, permanent, err
	}
	if !job.ManualRequested {
		actualPolicy := automaticWhatsAppMediaPolicy(job.MediaType, contentType, int64(len(recovered.bytes)))
		if !actualPolicy.automatic {
			return actualPolicy.errorCode, true, fmt.Errorf("%w: downloaded media violates the automatic media policy", ErrInvalidInput)
		}
	}
	objectPath := whatsappMediaObjectPath(job, contentType, repairStoragePath)
	asset := completedWhatsAppMediaAsset{
		storagePath: objectPath,
		contentType: contentType,
		actualSize:  int64(len(recovered.bytes)),
	}
	if err := repo.markWhatsAppMediaUploadIntent(ctx, job, asset); err != nil {
		return mediaErrorLocalStage, false, fmt.Errorf("%w: persist upload intent: %v", errWhatsAppMediaLocalStagePending, err)
	}
	if uploadErr := repo.storage.upload(ctx, whatsappMediaBucket, objectPath, contentType, bytes.NewReader(recovered.bytes), true); uploadErr != nil {
		exists, reconcileErr := repo.storage.objectExists(ctx, whatsappMediaBucket, objectPath)
		if reconcileErr != nil {
			return mediaErrorLocalStage, false, fmt.Errorf(
				"%w: upload returned %v and reconciliation failed: %v",
				errWhatsAppMediaLocalStagePending,
				uploadErr,
				reconcileErr,
			)
		}
		if !exists {
			return mediaErrorLocalStage, false, fmt.Errorf(
				"%w: Storage did not retain the deterministic upload: %v",
				errWhatsAppMediaLocalStagePending,
				uploadErr,
			)
		}
	}
	if err := repo.markWhatsAppMediaStorageUploaded(ctx, job, asset); err != nil {
		return mediaErrorLocalStage, false, fmt.Errorf("%w: record completed upload: %v", errWhatsAppMediaLocalStagePending, err)
	}

	if err := repo.completeWhatsAppMediaJob(ctx, job, asset); err != nil {
		// The upload is already durably recorded on the leased job. A retry will
		// resume at finalization without another provider download or Storage
		// upload, so a transient database failure must not terminalize the asset.
		return mediaErrorFinalizeLocal, false, fmt.Errorf("%w: %v", errWhatsAppMediaLocalFinalizePending, err)
	}
	return "", false, nil
}

func (repo Repository) markWhatsAppMediaProviderStarted(ctx context.Context, job queuedWhatsAppMediaJob) error {
	var sessionConnected bool
	var marked bool
	err := repo.db.Pool().QueryRow(ctx, `
		with session_state as materialized (
		  select exists (
		    select 1
		    from public.whatsapp_sessions as session
		    where session.id = $5::uuid
		      and session.organization_id = $4::uuid
		      and lower(btrim(coalesce(session.provider, ''))) = 'evolution_go'
		      and coalesce(session.is_active, true) = true
		      and lower(btrim(coalesce(session.status, ''))) = 'connected'
		      and not exists (
		        select 1
		        from private.whatsapp_media_session_quarantine as quarantine
		        where quarantine.session_id = session.id
		          and quarantine.quarantined_until > now()
		      )
		  ) as connected
		), marked as (
		  update public.media_jobs as job
		  set provider_started_at = coalesce(job.provider_started_at, now()),
		      updated_at = now()
		  from session_state
		  where job.id = $1::uuid
		    and job.status = 'processing'
		    and job.locked_by = $2
		    and job.lease_token = $3::uuid
		    and session_state.connected
		  returning true
		)
		select session_state.connected, exists(select 1 from marked)
		from session_state
	`, job.ID, job.LockedBy, job.LeaseToken, job.OrganizationID, job.SessionID).Scan(&sessionConnected, &marked)
	if err != nil {
		return err
	}
	if !sessionConnected {
		return errWhatsAppMediaSessionDisconnected
	}
	if !marked {
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
			  and coalesce(session.is_active, true) = true
			  and lower(btrim(coalesce(session.status, ''))) = 'connected'
			  and not exists (
			    select 1
			    from private.whatsapp_media_session_quarantine as quarantine
			    where quarantine.session_id = session.id
			      and quarantine.quarantined_until > now()
			  )
		)
	`, job.OrganizationID, job.SessionID).Scan(&connected)
	return connected, err
}

func classifyWhatsAppMediaDownloadError(err error) (string, bool) {
	if errors.Is(err, errWhatsAppMediaTooLarge) || errors.Is(err, ErrInvalidInput) {
		return mediaErrorTooLarge, true
	}
	if errors.Is(err, ErrProviderOutcomeUnknown) {
		// Media recovery is logically read-only. A transport ambiguity may leave
		// provider work running, but cannot duplicate a customer-visible message;
		// retry it with the queue's bounded concurrency and backoff.
		return mediaErrorOutcomeUnknown, false
	}
	return mediaErrorFailed, false
}

func whatsappMediaObjectPath(job queuedWhatsAppMediaJob, contentType string, repairStoragePath string) string {
	objectName := sanitizeWhatsAppMediaObjectPart(job.AssetKey)
	if strings.TrimSpace(repairStoragePath) != "" {
		repairKey := hashWhatsAppMediaKey("repair:v1", job.OrganizationID, job.MessageID, repairStoragePath)
		objectName += "-repair-" + repairKey[:16]
	}
	return fmt.Sprintf(
		"orgs/%s/assets/%s/%s.%s",
		job.OrganizationID,
		whatsappMediaAssetVersion,
		objectName,
		mediaExtension(contentType),
	)
}

func whatsappMediaUploadIntent(job queuedWhatsAppMediaJob, repairStoragePath string) (completedWhatsAppMediaAsset, bool, error) {
	path := strings.TrimSpace(firstString(job.MessageKey, whatsappMediaUploadPathKey))
	if path == "" {
		return completedWhatsAppMediaAsset{}, false, nil
	}
	contentType := normalizeWhatsAppMediaMIME(firstString(job.MessageKey, whatsappMediaUploadMIMEKey))
	actualSize := nativeInt64(job.MessageKey[whatsappMediaUploadSizeKey])
	asset := completedWhatsAppMediaAsset{storagePath: path, contentType: contentType, actualSize: actualSize}
	if !whatsappMediaPathBelongsToOrganization(path, job.OrganizationID) ||
		path != whatsappMediaObjectPath(job, contentType, repairStoragePath) {
		return completedWhatsAppMediaAsset{}, false, fmt.Errorf("%w: upload intent path is outside the deterministic asset scope", ErrProviderFailed)
	}
	if actualSize <= 0 || actualSize > whatsappMediaAbsoluteMaxBytes ||
		(job.DeclaredSize > 0 && actualSize != job.DeclaredSize) {
		return completedWhatsAppMediaAsset{}, false, fmt.Errorf("%w: upload intent size is invalid", ErrProviderFailed)
	}
	if contentType == "" || !whatsappMediaMIMEAllowedForType(job.MediaType, contentType) {
		return completedWhatsAppMediaAsset{}, false, fmt.Errorf("%w: upload intent MIME is invalid", ErrProviderFailed)
	}
	return asset, true, nil
}

func (repo Repository) markWhatsAppMediaUploadIntent(ctx context.Context, job queuedWhatsAppMediaJob, asset completedWhatsAppMediaAsset) error {
	command, err := repo.db.Pool().Exec(ctx, `
		update public.media_jobs
		set message_key = coalesce(message_key, '{}'::jsonb) || jsonb_build_object(
		      $4::text, $5::text,
		      $6::text, $7::text,
		      $8::text, $9::bigint
		    ),
		    updated_at = now()
		where id = $1::uuid
		  and status = 'processing'
		  and locked_by = $2
		  and lease_token = $3::uuid
	`, job.ID, job.LockedBy, job.LeaseToken,
		whatsappMediaUploadPathKey, asset.storagePath,
		whatsappMediaUploadMIMEKey, asset.contentType,
		whatsappMediaUploadSizeKey, asset.actualSize,
	)
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return errWhatsAppMediaLeaseLost
	}
	return nil
}

func (repo Repository) markWhatsAppMediaStorageUploaded(ctx context.Context, job queuedWhatsAppMediaJob, asset completedWhatsAppMediaAsset) error {
	command, err := repo.db.Pool().Exec(ctx, `
		update public.media_jobs
		set storage_path = $4,
		    media_mime_type = nullif($5, ''),
		    actual_size = $6,
		    -- Storage is now durable, so the provider JSON/base64 is redundant.
		    -- Scrub it before releasing the lease to keep customer media out of
		    -- Postgres WAL, backups and the completed-row retention window.
		    message_key = jsonb_strip_nulls(jsonb_build_object(
		      $7::text,
		      message_key->$7::text
		    )),
		    updated_at = now()
		where id = $1::uuid
		  and status = 'processing'
		  and locked_by = $2
		  and lease_token = $3::uuid
	`, job.ID, job.LockedBy, job.LeaseToken, asset.storagePath, asset.contentType, asset.actualSize,
		whatsappMediaRepairPathKey)
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return errWhatsAppMediaLeaseLost
	}
	return nil
}

func whatsappMediaRequiresProviderDecryption(message nativeEvolutionMessage) bool {
	messageNode := nativeFirstMap(message.Raw, "message", "Message")
	if len(messageNode) == 0 {
		messageNode = message.Raw
	}
	_, mediaBlock := nativeMediaBlock(messageNode, message.Raw, nativeFirstMap(message.Raw, "Info", "info"))
	if firstString(
		mediaBlock,
		"mediaKey", "MediaKey", "media_key",
		"directPath", "DirectPath", "direct_path",
		"fileSha256", "fileSHA256", "FileSHA256", "FileSha256",
		"fileEncSha256", "fileEncSHA256", "FileEncSHA256", "FileEncSha256",
	) != "" {
		return true
	}
	return whatsappMediaURLLooksEncrypted(firstNonEmpty(
		message.MediaURL,
		firstString(mediaBlock, "url", "URL", "mediaUrl", "media_url"),
	))
}

func whatsappMediaURLLooksEncrypted(rawURL string) bool {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed == nil {
		return false
	}
	path := strings.ToLower(strings.TrimSpace(parsed.EscapedPath()))
	return strings.HasSuffix(path, ".enc") || strings.Contains(path, ".enc/")
}

func (repo Repository) whatsappMediaURLIsDemonstrablyPlaintext(rawURL string) bool {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || !validWhatsAppMediaOriginURL(parsed) || whatsappMediaURLLooksEncrypted(rawURL) {
		return false
	}
	for _, configuredURL := range []string{repo.functions.evolutionGoAPIURL, repo.storage.projectURL} {
		configured, parseErr := url.Parse(strings.TrimSpace(configuredURL))
		if parseErr == nil && sameWhatsAppMediaOrigin(parsed, configured) {
			return true
		}
	}
	return false
}

func validateRecoveredWhatsAppMedia(job queuedWhatsAppMediaJob, recovered recoveredWhatsAppMedia) (string, string, error) {
	if len(recovered.bytes) == 0 {
		return "", "", fmt.Errorf("%w: provider returned empty media", ErrProviderFailed)
	}
	if len(recovered.bytes) > whatsappMediaAbsoluteMaxBytes {
		return "", "", fmt.Errorf("%w: arquivo acima do limite de 25MB", ErrInvalidInput)
	}
	if job.DeclaredSize > 0 && int64(len(recovered.bytes)) != job.DeclaredSize {
		return "", "", fmt.Errorf(
			"%w: downloaded media size %d differs from declared size %d",
			ErrProviderFailed,
			len(recovered.bytes),
			job.DeclaredSize,
		)
	}
	if whatsappMediaDigestMatches(job.FileEncSHA256, recovered.bytes) {
		return "", "", fmt.Errorf("%w: downloaded bytes match the encrypted WhatsApp media digest", ErrProviderFailed)
	}
	if err := validateWhatsAppMediaPlaintextDigest(job.FileSHA256, recovered.bytes); err != nil {
		return "", "", err
	}

	detectedContentType, contentType := effectiveWhatsAppMediaContentType(job, recovered)
	declaredContentType := normalizeWhatsAppMediaMIME(job.MediaMimeType)
	if !whatsappMediaMIMEAllowedForType(job.MediaType, declaredContentType) {
		return "", "", fmt.Errorf("%w: declared media type does not match the queued message", ErrInvalidInput)
	}
	if detectedContentType == "" || detectedContentType == "application/octet-stream" {
		if strings.ToLower(strings.TrimSpace(job.MediaType)) != "document" {
			return "", "", fmt.Errorf("%w: downloaded media has no verifiable container signature", ErrProviderFailed)
		}
	} else {
		if !whatsappMediaMIMEAllowedForType(job.MediaType, detectedContentType) {
			return "", "", fmt.Errorf("%w: downloaded media type does not match the queued message", ErrInvalidInput)
		}
		if !whatsappMediaMIMEsCompatible(job.MediaType, declaredContentType, detectedContentType) {
			return "", "", fmt.Errorf("%w: downloaded media MIME differs from WhatsApp metadata", ErrProviderFailed)
		}
	}
	return detectedContentType, contentType, nil
}

func whatsappMediaDigestMatches(expected string, payload []byte) bool {
	expectedBytes, err := decodeWhatsAppMediaSHA256(expected)
	if err != nil {
		return false
	}
	actual := sha256.Sum256(payload)
	return bytes.Equal(expectedBytes, actual[:])
}

func whatsappMediaMIMEsCompatible(messageType string, declared string, detected string) bool {
	if strings.EqualFold(strings.TrimSpace(messageType), "document") {
		// Office and other archive-based documents are commonly sniffed as ZIP.
		// Size and WhatsApp digests remain authoritative for opaque documents.
		return true
	}
	declared = normalizeWhatsAppMediaMIME(declared)
	detected = normalizeWhatsAppMediaMIME(detected)
	if declared == "" || declared == "application/octet-stream" || detected == "" || detected == "application/octet-stream" {
		return true
	}
	if declared == detected {
		return true
	}
	if strings.EqualFold(strings.TrimSpace(messageType), "audio") {
		if (declared == "audio/ogg" && detected == "application/ogg") ||
			(declared == "application/ogg" && detected == "audio/ogg") {
			return true
		}
		if declared == "audio/webm" && detected == "video/webm" {
			return true
		}
	}
	return false
}

func effectiveWhatsAppMediaContentType(job queuedWhatsAppMediaJob, recovered recoveredWhatsAppMedia) (string, string) {
	detected := normalizeWhatsAppMediaMIME(detectWhatsAppMediaMimeType(recovered.bytes))
	provider := normalizeWhatsAppMediaMIME(recovered.contentType)
	declared := normalizeWhatsAppMediaMIME(job.MediaMimeType)
	if strings.EqualFold(strings.TrimSpace(job.MediaType), "audio") && detected == "application/ogg" {
		return detected, firstNonEmpty(
			whatsappMediaAudioMIME(provider),
			whatsappMediaAudioMIME(declared),
			"audio/ogg",
		)
	}
	contentType := firstNonEmpty(detected, provider, declared, fallbackWhatsAppMediaMimeType(job.MediaType))
	if detected == "application/octet-stream" {
		contentType = firstNonEmpty(provider, declared, detected, fallbackWhatsAppMediaMimeType(job.MediaType))
	}
	return detected, contentType
}

func whatsappMediaAudioMIME(value string) string {
	value = normalizeWhatsAppMediaMIME(value)
	if strings.HasPrefix(value, "audio/") {
		return value
	}
	return ""
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
		  and storage_path like $4
		order by completed_at desc nulls last, id
		limit 1
	`, job.OrganizationID, job.AssetKey, job.ID,
		fmt.Sprintf("orgs/%s/assets/%s/%%", job.OrganizationID, whatsappMediaAssetVersion),
	).Scan(&asset.storagePath, &asset.contentType, &asset.actualSize)
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

type whatsappMediaCompletionCandidates struct {
	jobIDs     []string
	messageIDs []string
}

type whatsappMediaCompletionCandidate struct {
	jobID         string
	messageID     string
	repairSibling bool
}

func whatsappMediaCompletionLeaseMatches(
	job queuedWhatsAppMediaJob,
	candidateID string,
	status string,
	lockedBy string,
	leaseToken string,
) bool {
	return candidateID == job.ID &&
		status == "processing" &&
		lockedBy == job.LockedBy &&
		strings.EqualFold(leaseToken, job.LeaseToken)
}

func sortedUniqueWhatsAppMediaRowIDs(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	unique := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			unique[value] = struct{}{}
		}
	}
	result := make([]string, 0, len(unique))
	for value := range unique {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func boundWhatsAppMediaCompletionCandidates(
	ownJobID string,
	values []whatsappMediaCompletionCandidate,
) (whatsappMediaCompletionCandidates, bool) {
	ownJobID = strings.TrimSpace(ownJobID)
	byJobID := make(map[string]whatsappMediaCompletionCandidate, len(values))
	for _, value := range values {
		value.jobID = strings.TrimSpace(value.jobID)
		value.messageID = strings.TrimSpace(value.messageID)
		if value.jobID == "" || value.messageID == "" {
			continue
		}
		if existing, exists := byJobID[value.jobID]; !exists || (!existing.repairSibling && value.repairSibling) {
			byJobID[value.jobID] = value
		}
	}

	own, found := byJobID[ownJobID]
	if !found {
		return whatsappMediaCompletionCandidates{}, false
	}
	delete(byJobID, ownJobID)
	duplicates := make([]whatsappMediaCompletionCandidate, 0, len(byJobID))
	for _, value := range byJobID {
		duplicates = append(duplicates, value)
	}
	sort.Slice(duplicates, func(left int, right int) bool {
		return duplicates[left].jobID < duplicates[right].jobID
	})
	duplicateLimit := whatsappMediaCompletionMaxJobs - 1
	if len(duplicates) > duplicateLimit {
		duplicates = duplicates[:duplicateLimit]
	}
	bounded := append([]whatsappMediaCompletionCandidate{own}, duplicates...)
	result := whatsappMediaCompletionCandidates{
		jobIDs:     make([]string, 0, len(bounded)),
		messageIDs: make([]string, 0, len(bounded)),
	}
	for _, value := range bounded {
		result.jobIDs = append(result.jobIDs, value.jobID)
		result.messageIDs = append(result.messageIDs, value.messageID)
	}
	result.jobIDs = sortedUniqueWhatsAppMediaRowIDs(result.jobIDs)
	result.messageIDs = sortedUniqueWhatsAppMediaRowIDs(result.messageIDs)
	return result, true
}

func deriveWhatsAppMediaCompletionCandidates(
	ctx context.Context,
	tx pgx.Tx,
	job queuedWhatsAppMediaJob,
) (whatsappMediaCompletionCandidates, error) {
	repairStoragePath := strings.TrimSpace(firstString(job.MessageKey, whatsappMediaRepairPathKey))
	rows, err := tx.Query(ctx, `
		with own_job as (
		  select candidate.id, candidate.message_id, false as repair_sibling
		  from public.media_jobs as candidate
		  where candidate.organization_id = $1::uuid
		    and candidate.id = $3::uuid
		), duplicate_jobs as (
		  select candidate.id, candidate.message_id, false as repair_sibling
		  from public.media_jobs as candidate
		  where candidate.organization_id = $1::uuid
		    and candidate.asset_key = $2
		    and candidate.id <> $3::uuid
		    and coalesce(candidate.declared_size, 0) between 0 and $4
		    and (
		      candidate.status = 'pending'
		      or (
		        candidate.status = 'failed'
		        and coalesce(candidate.error_code, '') not like 'media_policy_%'
		      )
		    )
		    and not (
		      coalesce(candidate.error_code, '') = $6
		      and candidate.next_retry_at > now()
		    )
		  order by candidate.id
		  limit $5
		), repair_siblings as (
		  select candidate.id, candidate.message_id, true as repair_sibling
		  from public.media_jobs as candidate
		  where nullif($7, '') is not null
		    and candidate.organization_id = $1::uuid
		    and candidate.asset_key = $2
		    and candidate.id <> $3::uuid
		    and candidate.status = 'completed'
		    and candidate.storage_path = $7
		  order by candidate.id
		  limit $5
		)
		select bounded.id::text, bounded.message_id::text, bounded.repair_sibling
		from (
		  select own_job.id, own_job.message_id, own_job.repair_sibling from own_job
		  union all
		  select duplicate_jobs.id, duplicate_jobs.message_id, duplicate_jobs.repair_sibling from duplicate_jobs
		  union all
		  select repair_siblings.id, repair_siblings.message_id, repair_siblings.repair_sibling from repair_siblings
		) as bounded
		order by bounded.id
	`, job.OrganizationID, job.AssetKey, job.ID, whatsappMediaAbsoluteMaxBytes,
		whatsappMediaCompletionMaxJobs-1, mediaErrorOutcomeUnknown, repairStoragePath)
	if err != nil {
		return whatsappMediaCompletionCandidates{}, err
	}
	defer rows.Close()

	values := make([]whatsappMediaCompletionCandidate, 0, whatsappMediaCompletionMaxJobs)
	for rows.Next() {
		var jobID, messageID string
		var repairSibling bool
		if err := rows.Scan(&jobID, &messageID, &repairSibling); err != nil {
			return whatsappMediaCompletionCandidates{}, err
		}
		values = append(values, whatsappMediaCompletionCandidate{
			jobID:         jobID,
			messageID:     messageID,
			repairSibling: repairSibling,
		})
	}
	if err := rows.Err(); err != nil {
		return whatsappMediaCompletionCandidates{}, err
	}
	candidates, ownJobIncluded := boundWhatsAppMediaCompletionCandidates(job.ID, values)
	if !ownJobIncluded {
		return whatsappMediaCompletionCandidates{}, errWhatsAppMediaLeaseLost
	}
	return candidates, nil
}

func lockWhatsAppMediaCompletionMessages(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	messageIDs []string,
) error {
	if len(messageIDs) == 0 {
		return errWhatsAppMediaLeaseLost
	}
	rows, err := tx.Query(ctx, `
		select message.id::text
		from public.whatsapp_messages as message
		where message.organization_id = $1::uuid
		  and message.id = any($2::uuid[])
		order by message.id
		for update of message
	`, organizationID, messageIDs)
	if err != nil {
		return err
	}
	defer rows.Close()

	locked := 0
	for rows.Next() {
		var messageID string
		if err := rows.Scan(&messageID); err != nil {
			return err
		}
		locked++
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if locked != len(messageIDs) {
		return ErrMessageNotFound
	}
	return nil
}

func lockWhatsAppMediaCompletionJobs(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	jobIDs []string,
) error {
	if len(jobIDs) == 0 {
		return errWhatsAppMediaLeaseLost
	}
	rows, err := tx.Query(ctx, `
		select job.id::text
		from public.media_jobs as job
		where job.organization_id = $1::uuid
		  and job.id = any($2::uuid[])
		order by job.id
		for update of job
	`, organizationID, jobIDs)
	if err != nil {
		return err
	}
	defer rows.Close()

	locked := 0
	for rows.Next() {
		var jobID string
		if err := rows.Scan(&jobID); err != nil {
			return err
		}
		locked++
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if locked != len(jobIDs) {
		return errWhatsAppMediaLeaseLost
	}
	return nil
}

func revalidateWhatsAppMediaCompletionCandidates(
	ctx context.Context,
	tx pgx.Tx,
	job queuedWhatsAppMediaJob,
	candidateJobIDs []string,
) (whatsappMediaCompletionCandidates, error) {
	repairStoragePath := strings.TrimSpace(firstString(job.MessageKey, whatsappMediaRepairPathKey))
	rows, err := tx.Query(ctx, `
		select
		  candidate.id::text,
		  candidate.message_id::text,
		  candidate.status,
		  coalesce(candidate.locked_by, ''),
		  coalesce(candidate.lease_token::text, '')
		from public.media_jobs as candidate
		where candidate.organization_id = $1::uuid
		  and candidate.asset_key = $2
		  and candidate.id = any($3::uuid[])
		  and coalesce(candidate.declared_size, 0) between 0 and $4
		  and (
		    (
		      candidate.id = $5::uuid
		      and candidate.status = 'processing'
		      and candidate.locked_by = $6
		      and candidate.lease_token = $7::uuid
		    )
		    or (
		      candidate.id <> $5::uuid
		      and (
		        candidate.status = 'pending'
		        or (
		          candidate.status = 'failed'
		          and coalesce(candidate.error_code, '') not like 'media_policy_%'
		        )
		      )
		      and not (
		        coalesce(candidate.error_code, '') = $8
		        and candidate.next_retry_at > now()
		      )
		    )
		    or (
		      candidate.id <> $5::uuid
		      and nullif($9, '') is not null
		      and candidate.status = 'completed'
		      and candidate.storage_path = $9
		    )
		  )
		order by candidate.id
	`, job.OrganizationID, job.AssetKey, candidateJobIDs, whatsappMediaAbsoluteMaxBytes,
		job.ID, job.LockedBy, job.LeaseToken, mediaErrorOutcomeUnknown, repairStoragePath)
	if err != nil {
		return whatsappMediaCompletionCandidates{}, err
	}
	defer rows.Close()

	leaseStillOwned := false
	candidates := whatsappMediaCompletionCandidates{}
	for rows.Next() {
		var candidateID, messageID, status, lockedBy, leaseToken string
		if err := rows.Scan(&candidateID, &messageID, &status, &lockedBy, &leaseToken); err != nil {
			return whatsappMediaCompletionCandidates{}, err
		}
		candidates.jobIDs = append(candidates.jobIDs, candidateID)
		candidates.messageIDs = append(candidates.messageIDs, messageID)
		if whatsappMediaCompletionLeaseMatches(job, candidateID, status, lockedBy, leaseToken) {
			leaseStillOwned = true
		}
	}
	if err := rows.Err(); err != nil {
		return whatsappMediaCompletionCandidates{}, err
	}
	if !leaseStillOwned {
		return whatsappMediaCompletionCandidates{}, errWhatsAppMediaLeaseLost
	}
	candidates.jobIDs = sortedUniqueWhatsAppMediaRowIDs(candidates.jobIDs)
	candidates.messageIDs = sortedUniqueWhatsAppMediaRowIDs(candidates.messageIDs)
	return candidates, nil
}

func (repo Repository) completeWhatsAppMediaJob(ctx context.Context, job queuedWhatsAppMediaJob, asset completedWhatsAppMediaAsset) error {
	repairStoragePath := strings.TrimSpace(firstString(job.MessageKey, whatsappMediaRepairPathKey))
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// The native webhook and manual retry paths already own the message row
	// before they insert or update media_jobs. Completion must acquire the same
	// table order across every replica: whatsapp_messages, then media_jobs. The
	// first read intentionally does not lock jobs; it only defines the bounded
	// snapshot whose rows this completion may touch.
	candidates, err := deriveWhatsAppMediaCompletionCandidates(ctx, tx, job)
	if err != nil {
		return err
	}
	if err := lockWhatsAppMediaCompletionMessages(ctx, tx, job.OrganizationID, candidates.messageIDs); err != nil {
		return err
	}
	if err := lockWhatsAppMediaCompletionJobs(ctx, tx, job.OrganizationID, candidates.jobIDs); err != nil {
		return err
	}
	candidates, err = revalidateWhatsAppMediaCompletionCandidates(ctx, tx, job, candidates.jobIDs)
	if err != nil {
		return err
	}
	repairContinuation := false
	if repairStoragePath != "" {
		if err := tx.QueryRow(ctx, `
			select exists (
			  select 1
			  from public.media_jobs as sibling
			  where sibling.organization_id = $1::uuid
			    and sibling.asset_key = $2
			    and sibling.status = 'completed'
			    and sibling.storage_path = $3
			    and not (sibling.id = any($4::uuid[]))
			)
		`, job.OrganizationID, job.AssetKey, repairStoragePath, candidates.jobIDs).Scan(&repairContinuation); err != nil {
			return err
		}
	}

	messageCommand, err := tx.Exec(ctx, `
		update public.whatsapp_messages
		set media_storage_path = $3,
		    media_url = null,
		    media_mime_type = nullif($4, ''),
		    media_status = 'ready',
		    media_error = null,
		    media_size = $5,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = any($2::uuid[])
	`, job.OrganizationID, candidates.messageIDs, asset.storagePath, asset.contentType, asset.actualSize)
	if err != nil {
		return err
	}
	if messageCommand.RowsAffected() != int64(len(candidates.messageIDs)) {
		return fmt.Errorf("finalize WhatsApp media messages: updated %d of %d locked rows", messageCommand.RowsAffected(), len(candidates.messageIDs))
	}

	jobCommand, err := tx.Exec(ctx, `
		update public.media_jobs
		set status = 'completed',
		    media_mime_type = nullif($4, ''),
		    storage_path = $5,
		    actual_size = $6,
		    -- Completion is the retention boundary for every deduplicated job.
		    -- Durable columns now carry the canonical asset, so remove provider
		    -- JSON/base64 before the completed row enters long-lived retention.
		    message_key = '{}'::jsonb,
		    completed_at = now(),
		    failed_at = null,
		    error_code = null,
		    error_message = null,
		    locked_at = null,
		    lease_expires_at = null,
		    lease_duration = null,
		    locked_by = null,
		    lease_token = null,
		    processing_slot = null,
		    provider_started_at = null,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = any($2::uuid[])
		  and asset_key = $3
		  and coalesce(declared_size, 0) between 0 and $7
		  and (
		    (
		      id = $8::uuid
		      and status = 'processing'
		      and locked_by = $9
		      and lease_token = $10::uuid
		    )
		    or (
		      id <> $8::uuid
		      and (
		        status = 'pending'
		        or (status = 'failed' and coalesce(error_code, '') not like 'media_policy_%')
		      )
		      and not (
		        coalesce(error_code, '') = $11
		        and next_retry_at > now()
		      )
		    )
		    or (
		      id <> $8::uuid
		      and nullif($12, '') is not null
		      and status = 'completed'
		      and storage_path = $12
		    )
		  )
	`, job.OrganizationID, candidates.jobIDs, job.AssetKey, asset.contentType, asset.storagePath, asset.actualSize,
		whatsappMediaAbsoluteMaxBytes, job.ID, job.LockedBy, job.LeaseToken, mediaErrorOutcomeUnknown,
		repairStoragePath)
	if err != nil {
		return err
	}
	if jobCommand.RowsAffected() != int64(len(candidates.jobIDs)) {
		return fmt.Errorf("finalize WhatsApp media jobs: updated %d of %d locked rows", jobCommand.RowsAffected(), len(candidates.jobIDs))
	}
	if repairContinuation {
		continuationCommand, err := tx.Exec(ctx, `
			update public.media_jobs
			set status = 'pending',
			    attempts = greatest(attempts - 1, 0),
			    next_retry_at = now(),
			    message_key = jsonb_build_object($4::text, $5::text),
			    completed_at = null,
			    error_code = $6,
			    error_message = 'repair fan-out will continue with database-only finalization',
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
			  and asset_key = $3
			  and status = 'completed'
		`, job.OrganizationID, job.ID, job.AssetKey, whatsappMediaRepairPathKey,
			repairStoragePath, mediaErrorFinalizeLocal)
		if err != nil {
			return err
		}
		if continuationCommand.RowsAffected() != 1 {
			return errWhatsAppMediaLeaseLost
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}
	whatsappMediaSignedURLCache.Delete(asset.storagePath)
	if repairContinuation {
		wakeWhatsAppMediaWorker()
	}
	return nil
}

func (repo Repository) deferWhatsAppMediaJobDisconnected(ctx context.Context, job queuedWhatsAppMediaJob, providerStarted bool) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Preserve the global message -> media job lock order used by completion,
	// retries, stale recovery and manual retry.
	var lockedMessageID string
	if err := tx.QueryRow(ctx, `
		select message.id::text
		from public.whatsapp_messages as message
		where message.organization_id = $1::uuid
		  and message.id = $2::uuid
		for update of message
	`, job.OrganizationID, job.MessageID).Scan(&lockedMessageID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrMessageNotFound
		}
		return err
	}

	command, err := tx.Exec(ctx, `
		update public.media_jobs
		set status = 'pending',
		    attempts = greatest(attempts - 1, 0),
		    next_retry_at = greatest(
		      now() + interval '15 seconds',
		      case
		        when $4::boolean then now() + interval '10 minutes'
		        else coalesce((
		          select quarantine.quarantined_until
		          from private.whatsapp_media_session_quarantine as quarantine
		          where quarantine.session_id = $5::uuid
		            and quarantine.quarantined_until > now()
		        ), now() + interval '15 seconds')
		      end
		    ),
		    failed_at = null,
		    error_code = null,
		    error_message = null,
		    locked_at = null,
		    lease_expires_at = null,
		    lease_duration = null,
		    locked_by = null,
		    lease_token = null,
		    processing_slot = null,
		    provider_started_at = null,
		    updated_at = now()
		where id = $1::uuid
		  and status = 'processing'
		  and locked_by = $2
		  and lease_token = $3::uuid
		  and (
		    ($4::boolean and provider_started_at is not null)
		    or (not $4::boolean and provider_started_at is null)
		  )
	`, job.ID, job.LockedBy, job.LeaseToken, providerStarted, job.SessionID)
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return errWhatsAppMediaLeaseLost
	}
	if providerStarted {
		if _, err := tx.Exec(ctx, `
			insert into private.whatsapp_media_session_quarantine as quarantine (
				session_id, job_id, quarantined_until, reason, created_at, updated_at
			) values (
				$1::uuid, $2::uuid, now() + interval '10 minutes', $3, now(), now()
			)
			on conflict (session_id) do update
			set job_id = excluded.job_id,
			    quarantined_until = greatest(quarantine.quarantined_until, excluded.quarantined_until),
			    reason = excluded.reason,
			    updated_at = now()
		`, job.SessionID, job.ID, "media_provider_disconnected"); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `
		update public.whatsapp_messages
		set media_status = 'pending',
		    media_error = null,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and media_storage_path is null
	`, job.OrganizationID, job.MessageID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (repo Repository) deferWhatsAppMediaLocalFinalization(ctx context.Context, job queuedWhatsAppMediaJob) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Completion, webhook enqueue and manual retry all lock message first. Keep
	// that order while converting the owned lease into a provider-free retry.
	var lockedMessageID string
	if err := tx.QueryRow(ctx, `
		select message.id::text
		from public.whatsapp_messages as message
		where message.organization_id = $1::uuid
		  and message.id = $2::uuid
		for update of message
	`, job.OrganizationID, job.MessageID).Scan(&lockedMessageID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrMessageNotFound
		}
		return err
	}

	command, err := tx.Exec(ctx, `
		update public.media_jobs
		set status = 'pending',
		    attempts = greatest(attempts - 1, 0),
		    next_retry_at = now() + interval '15 seconds',
		    failed_at = null,
		    error_code = $4,
		    error_message = 'durable media is waiting for database-only finalization',
		    locked_at = null,
		    lease_expires_at = null,
		    lease_duration = null,
		    locked_by = null,
		    lease_token = null,
		    processing_slot = null,
		    provider_started_at = null,
		    updated_at = now()
		where id = $1::uuid
		  and status = 'processing'
		  and locked_by = $2
		  and lease_token = $3::uuid
		  and storage_path is not null
		  and actual_size > 0
		  and storage_path like 'orgs/' || organization_id::text || '/assets/v2/%'
	`, job.ID, job.LockedBy, job.LeaseToken, mediaErrorFinalizeLocal)
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return errWhatsAppMediaLeaseLost
	}
	if _, err := tx.Exec(ctx, `
		update public.whatsapp_messages
		set media_status = 'pending',
		    media_error = $3,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and media_storage_path is null
	`, job.OrganizationID, job.MessageID, mediaErrorRetry); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (repo Repository) deferWhatsAppMediaLocalStage(ctx context.Context, job queuedWhatsAppMediaJob) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Match the message -> job order used by every other media outcome path.
	var lockedMessageID string
	if err := tx.QueryRow(ctx, `
		select message.id::text
		from public.whatsapp_messages as message
		where message.organization_id = $1::uuid
		  and message.id = $2::uuid
		for update of message
	`, job.OrganizationID, job.MessageID).Scan(&lockedMessageID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrMessageNotFound
		}
		return err
	}

	command, err := tx.Exec(ctx, `
		with owned_job as materialized (
		  select
		    owned.id,
		    case
		      when coalesce(owned.message_key->>$5::text, '') ~ '^[0-9]{1,3}$'
		      then least((owned.message_key->>$5::text)::integer, 100)
		      else 0
		    end as local_failures
		  from public.media_jobs as owned
		  where owned.id = $1::uuid
		    and owned.status = 'processing'
		    and owned.locked_by = $2
		    and owned.lease_token = $3::uuid
		  for update
		)
		update public.media_jobs as job
		set status = 'pending',
		    attempts = greatest(job.attempts - 1, 0),
		    next_retry_at = now() + case
		      when owned_job.local_failures = 0 then interval '30 seconds'
		      when owned_job.local_failures = 1 then interval '2 minutes'
		      when owned_job.local_failures = 2 then interval '10 minutes'
		      else interval '30 minutes'
		    end,
		    message_key = jsonb_set(
		      coalesce(job.message_key, '{}'::jsonb),
		      array[$5::text],
		      to_jsonb(least(owned_job.local_failures + 1, 100)),
		      true
		    ),
		    failed_at = null,
		    error_code = $4,
		    error_message = 'provider recovery finished; deterministic local persistence will resume',
		    locked_at = null,
		    lease_expires_at = null,
		    lease_duration = null,
		    locked_by = null,
		    lease_token = null,
		    processing_slot = null,
		    provider_started_at = null,
		    updated_at = now()
		from owned_job
		where job.id = owned_job.id
	`, job.ID, job.LockedBy, job.LeaseToken, mediaErrorLocalStage, whatsappMediaUploadFailuresKey)
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return errWhatsAppMediaLeaseLost
	}
	if _, err := tx.Exec(ctx, `
		update public.whatsapp_messages
		set media_status = 'pending',
		    media_error = $3,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and media_storage_path is null
	`, job.OrganizationID, job.MessageID, mediaErrorRetry); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (repo Repository) retryOrFailWhatsAppMediaJob(ctx context.Context, job queuedWhatsAppMediaJob, code string, permanent bool, cause error) error {
	if code == "" {
		code = mediaErrorFailed
	}
	detail := strings.TrimSpace(cause.Error())
	if len(detail) > 1000 {
		detail = detail[:1000]
	}
	terminal := permanent || job.Attempts >= job.MaxAttempts
	quarantineProviderLane := errors.Is(cause, errWhatsAppMediaProviderInFlight)
	retryDelay := whatsappMediaRetryDelay(job.Attempts)
	if quarantineProviderLane && retryDelay < 10*time.Minute {
		retryDelay = 10 * time.Minute
	}
	nextAttempt := time.Now().UTC().Add(retryDelay)

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	status := "pending"
	messageStatus := mediaErrorRetry
	if terminal {
		status = "failed"
		messageStatus = code
	}
	// Lock the message before the fenced job update. Duplicate webhooks and
	// manual retries use this same order, so none can hold media_jobs while
	// waiting for a message row owned by this outcome transaction.
	var lockedMessageID string
	if err := tx.QueryRow(ctx, `
		select message.id::text
		from public.whatsapp_messages as message
		where message.organization_id = $1::uuid
		  and message.id = $2::uuid
		for update of message
	`, job.OrganizationID, job.MessageID).Scan(&lockedMessageID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrMessageNotFound
		}
		return err
	}
	command, err := tx.Exec(ctx, `
		update public.media_jobs
		set status = $4,
		    next_retry_at = case when $4 = 'pending' or $6 = $8 then $5 else next_retry_at end,
		    failed_at = case when $4 = 'failed' then now() else null end,
		    error_code = $6,
		    error_message = $7,
		    locked_at = null,
		    lease_expires_at = null,
		    lease_duration = null,
		    locked_by = null,
		    lease_token = null,
		    processing_slot = null,
		    provider_started_at = null,
		    updated_at = now()
		where id = $1::uuid
		  and status = 'processing'
		  and locked_by = $2
		  and lease_token = $3::uuid
	`, job.ID, job.LockedBy, job.LeaseToken, status, nextAttempt, code, detail, mediaErrorOutcomeUnknown)
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return errWhatsAppMediaLeaseLost
	}
	if quarantineProviderLane {
		if _, err := tx.Exec(ctx, `
			insert into private.whatsapp_media_session_quarantine as quarantine (
				session_id, job_id, quarantined_until, reason, created_at, updated_at
			) values (
				$1::uuid, $2::uuid, $3::timestamptz, $4, now(), now()
			)
			on conflict (session_id) do update
			set job_id = excluded.job_id,
			    quarantined_until = greatest(quarantine.quarantined_until, excluded.quarantined_until),
			    reason = excluded.reason,
			    updated_at = now()
		`, job.SessionID, job.ID, nextAttempt, mediaErrorOutcomeUnknown); err != nil {
			return err
		}
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

func (repo Repository) enqueueManualWhatsAppMediaJob(ctx context.Context, message retryMediaMessage) (string, bool, error) {
	if !whatsappMediaManualDownloadAllowed(message.MessageType, message.MediaSize) {
		return "", false, fmt.Errorf("%w: media size must be unknown or no greater than 25MB", ErrInvalidInput)
	}
	if strings.TrimSpace(message.SessionID) == "" {
		return "", false, fmt.Errorf("%w: media message has no provider session", ErrInvalidInput)
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
	if candidates := mediaBase64Candidates(raw, message.MessageType); len(candidates) > 0 {
		nativeMessage.MediaBase64 = candidates[0]
	}
	dedupeKey, assetKey, fileSHA256, fileEncSHA256 := whatsappMediaQueueKeys(message.OrganizationID, message.SessionID, nativeMessage)
	repairStoragePath := strings.TrimSpace(message.MediaStoragePath)
	messageKeyPayload := whatsappMediaQueueMessageKey(nativeMessage)
	if repairStoragePath != "" {
		messageKeyPayload[whatsappMediaRepairPathKey] = repairStoragePath
	}
	messageKey := jsonb(messageKeyPayload)

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return "", false, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		select pg_advisory_xact_lock(hashtextextended($1, 0))
	`, "whatsapp-media-manual:"+message.OrganizationID+":"+message.ID); err != nil {
		return "", false, err
	}
	// Match the native webhook and worker finalization lock order. The advisory
	// lock deduplicates only concurrent manual requests; the row lock prevents a
	// manual retry from taking media_jobs while a completion waits on its message.
	var lockedMessageID string
	if err := tx.QueryRow(ctx, `
		select target.id::text
		from public.whatsapp_messages as target
		where target.organization_id = $1::uuid
		  and target.id = $2::uuid
		for update of target
	`, message.OrganizationID, message.ID).Scan(&lockedMessageID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", false, ErrMessageNotFound
		}
		return "", false, err
	}

	var jobID string
	existing := false
	err = tx.QueryRow(ctx, `
		select id::text
		from public.media_jobs
		where organization_id = $1::uuid and message_id = $2::uuid
		order by created_at, id
		limit 1
		for update
	`, message.OrganizationID, message.ID).Scan(&jobID)
	if err == nil {
		existing = true
		if _, err := tx.Exec(ctx, `
			update public.media_jobs
			set status = case when status = 'processing' then status else 'pending' end,
			    attempts = case when status = 'processing' then attempts else 0 end,
			    max_attempts = $3,
			    message_key = case
			      when status = 'processing'
			        or nullif(btrim(coalesce(message_key->>'upload_intent_path', '')), '') is not null
			        or nullif(btrim(coalesce(message_key->>'repair_storage_path', '')), '') is not null
			      then message_key
			      else (
			        case
			          when $4::jsonb ? 'message' then jsonb_build_object('message', $4::jsonb->'message')
			          when coalesce(message_key, '{}'::jsonb) ? 'message' then jsonb_build_object('message', message_key->'message')
			          when $4::jsonb ? 'media_url' then jsonb_build_object('media_url', $4::jsonb->'media_url')
			          when coalesce(message_key, '{}'::jsonb) ? 'media_url' then jsonb_build_object('media_url', message_key->'media_url')
			          else '{}'::jsonb
			        end
			        || jsonb_strip_nulls(jsonb_build_object(
			          'repair_storage_path', $4::jsonb->'repair_storage_path'
			        ))
			      )
			    end,
			    provider_message_id = case
			      when status = 'processing'
			        or (storage_path like 'orgs/' || organization_id::text || '/assets/v2/%' and actual_size > 0)
			        or nullif(btrim(coalesce(message_key->>'upload_intent_path', '')), '') is not null
			        or nullif(btrim(coalesce(message_key->>'repair_storage_path', '')), '') is not null
			      then provider_message_id else coalesce(nullif($5, ''), provider_message_id) end,
			    media_type = case
			      when status = 'processing'
			        or (storage_path like 'orgs/' || organization_id::text || '/assets/v2/%' and actual_size > 0)
			        or nullif(btrim(coalesce(message_key->>'upload_intent_path', '')), '') is not null
			        or nullif(btrim(coalesce(message_key->>'repair_storage_path', '')), '') is not null
			      then media_type else $6 end,
			    media_mime_type = case
			      when status = 'processing'
			        or (storage_path like 'orgs/' || organization_id::text || '/assets/v2/%' and actual_size > 0)
			        or nullif(btrim(coalesce(message_key->>'upload_intent_path', '')), '') is not null
			        or nullif(btrim(coalesce(message_key->>'repair_storage_path', '')), '') is not null
			      then media_mime_type else nullif($7, '') end,
			    declared_size = case
			      when status = 'processing'
			        or (storage_path like 'orgs/' || organization_id::text || '/assets/v2/%' and actual_size > 0)
			        or nullif(btrim(coalesce(message_key->>'upload_intent_path', '')), '') is not null
			        or nullif(btrim(coalesce(message_key->>'repair_storage_path', '')), '') is not null
			      then declared_size else $8 end,
			    file_sha256 = case
			      when status = 'processing'
			        or (storage_path like 'orgs/' || organization_id::text || '/assets/v2/%' and actual_size > 0)
			        or nullif(btrim(coalesce(message_key->>'upload_intent_path', '')), '') is not null
			        or nullif(btrim(coalesce(message_key->>'repair_storage_path', '')), '') is not null
			      then file_sha256 else coalesce(nullif($9, ''), file_sha256) end,
			    file_enc_sha256 = case
			      when status = 'processing'
			        or (storage_path like 'orgs/' || organization_id::text || '/assets/v2/%' and actual_size > 0)
			        or nullif(btrim(coalesce(message_key->>'upload_intent_path', '')), '') is not null
			        or nullif(btrim(coalesce(message_key->>'repair_storage_path', '')), '') is not null
			      then file_enc_sha256 else coalesce(nullif($10, ''), file_enc_sha256) end,
			    asset_key = case
			      when status = 'processing'
			        or (storage_path like 'orgs/' || organization_id::text || '/assets/v2/%' and actual_size > 0)
			        or nullif(btrim(coalesce(message_key->>'upload_intent_path', '')), '') is not null
			        or nullif(btrim(coalesce(message_key->>'repair_storage_path', '')), '') is not null
			      then asset_key else $11 end,
			    next_retry_at = case when status = 'processing' then next_retry_at else now() end,
			    manual_requested = true,
			    failed_at = null,
			    completed_at = case
			      when status = 'processing'
			        or nullif(btrim(coalesce(message_key->>'upload_intent_path', '')), '') is not null
			        or (
			          not $12::boolean
			          and nullif(btrim(coalesce(message_key->>'repair_storage_path', '')), '') is null
			          and storage_path like 'orgs/' || organization_id::text || '/assets/v2/%'
			          and actual_size > 0
			        )
			      then completed_at else null end,
			    actual_size = case
			      when status = 'processing'
			        or nullif(btrim(coalesce(message_key->>'upload_intent_path', '')), '') is not null
			        or (
			          not $12::boolean
			          and nullif(btrim(coalesce(message_key->>'repair_storage_path', '')), '') is null
			          and storage_path like 'orgs/' || organization_id::text || '/assets/v2/%'
			          and actual_size > 0
			        )
			      then actual_size else null end,
			    storage_path = case
			      when status = 'processing'
			        or nullif(btrim(coalesce(message_key->>'upload_intent_path', '')), '') is not null
			        or (
			          not $12::boolean
			          and nullif(btrim(coalesce(message_key->>'repair_storage_path', '')), '') is null
			          and storage_path like 'orgs/' || organization_id::text || '/assets/v2/%'
			          and actual_size > 0
			        )
			      then storage_path else null end,
			    error_code = null,
			    error_message = null,
			    locked_at = case when status = 'processing' then locked_at else null end,
			    lease_expires_at = case when status = 'processing' then lease_expires_at else null end,
			    lease_duration = case when status = 'processing' then lease_duration else null end,
			    locked_by = case when status = 'processing' then locked_by else null end,
			    lease_token = case when status = 'processing' then lease_token else null end,
			    provider_started_at = case when status = 'processing' then provider_started_at else null end,
			    updated_at = now()
			where organization_id = $1::uuid and id = $2::uuid
		`, message.OrganizationID, jobID, whatsappMediaJobMaxAttempts, messageKey,
			message.MessageID, message.MessageType, message.MediaMimeType, message.MediaSize,
			fileSHA256, fileEncSHA256, assetKey, repairStoragePath != ""); err != nil {
			return "", false, err
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return "", false, err
	} else {
		if err := tx.QueryRow(ctx, `
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
			on conflict (organization_id, dedupe_key) do update
			set message_key = case
			      when media_jobs.status = 'processing'
			        or nullif(btrim(coalesce(media_jobs.message_key->>'upload_intent_path', '')), '') is not null
			        or nullif(btrim(coalesce(media_jobs.message_key->>'repair_storage_path', '')), '') is not null
			      then media_jobs.message_key
			      else coalesce(media_jobs.message_key, '{}'::jsonb) || excluded.message_key
			    end,
			    manual_requested = true,
			    status = case when media_jobs.status = 'processing' then media_jobs.status else 'pending' end,
			    attempts = case when media_jobs.status = 'processing' then media_jobs.attempts else 0 end,
			    next_retry_at = case when media_jobs.status = 'processing' then media_jobs.next_retry_at else now() end,
			    error_code = null,
			    error_message = null,
			    failed_at = null,
			    completed_at = case
			      when media_jobs.status = 'processing'
			        or nullif(btrim(coalesce(media_jobs.message_key->>'upload_intent_path', '')), '') is not null
			        or (
			          nullif(btrim(coalesce(media_jobs.message_key->>'repair_storage_path', '')), '') is null
			          and nullif(btrim(coalesce(excluded.message_key->>'repair_storage_path', '')), '') is null
			          and media_jobs.storage_path like 'orgs/' || media_jobs.organization_id::text || '/assets/v2/%'
			          and media_jobs.actual_size > 0
			        )
			      then media_jobs.completed_at else null end,
			    actual_size = case
			      when media_jobs.status = 'processing'
			        or nullif(btrim(coalesce(media_jobs.message_key->>'upload_intent_path', '')), '') is not null
			        or (
			          nullif(btrim(coalesce(media_jobs.message_key->>'repair_storage_path', '')), '') is null
			          and nullif(btrim(coalesce(excluded.message_key->>'repair_storage_path', '')), '') is null
			          and media_jobs.storage_path like 'orgs/' || media_jobs.organization_id::text || '/assets/v2/%'
			          and media_jobs.actual_size > 0
			        )
			      then media_jobs.actual_size else null end,
			    storage_path = case
			      when media_jobs.status = 'processing'
			        or nullif(btrim(coalesce(media_jobs.message_key->>'upload_intent_path', '')), '') is not null
			        or (
			          nullif(btrim(coalesce(media_jobs.message_key->>'repair_storage_path', '')), '') is null
			          and nullif(btrim(coalesce(excluded.message_key->>'repair_storage_path', '')), '') is null
			          and media_jobs.storage_path like 'orgs/' || media_jobs.organization_id::text || '/assets/v2/%'
			          and media_jobs.actual_size > 0
			        )
			      then media_jobs.storage_path else null end,
			    updated_at = now()
			returning id::text
		`, message.OrganizationID, message.SessionID, message.ConversationID, message.ID,
			message.MessageID, messageKey, message.MessageType, message.MediaMimeType,
			whatsappMediaJobMaxAttempts, dedupeKey, assetKey, message.MediaSize,
			fileSHA256, fileEncSHA256).Scan(&jobID); err != nil {
			return "", false, err
		}
	}

	if _, err := tx.Exec(ctx, `
		update public.whatsapp_messages
		set media_status = 'pending',
		    media_error = $3,
		    media_storage_path = case when $4 then null else media_storage_path end,
		    media_url = case when $4 then null else media_url end,
		    updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
	`, message.OrganizationID, message.ID, mediaErrorManualQueued, repairStoragePath != ""); err != nil {
		return "", false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", false, err
	}
	if repairStoragePath != "" {
		whatsappMediaSignedURLCache.Delete(repairStoragePath)
	}
	wakeWhatsAppMediaWorker()
	return jobID, existing, nil
}

func enqueueNativeEvolutionMediaJob(ctx context.Context, tx pgx.Tx, session nativeEvolutionSession, conversationID string, message nativeEvolutionMessage, messageRowID string) (bool, error) {
	if !nativeIsMediaType(message.MessageType) || message.MediaStoragePath != "" {
		return false, nil
	}
	policy := automaticWhatsAppMediaPolicy(message.MessageType, message.MediaMimeType, message.MediaSize)
	jobStatus := "pending"
	if !policy.automatic {
		jobStatus = "failed"
	}
	dedupeKey, assetKey, fileSHA256, fileEncSHA256 := whatsappMediaQueueKeys(session.OrganizationID, session.ID, message)
	messageKeyPayload := whatsappMediaQueueMessageKey(message)
	messageKey := jsonb(messageKeyPayload)

	var persistedStatus, persistedError, persistedStoragePath, persistedMimeType string
	var persistedActualSize int64
	err := tx.QueryRow(ctx, `
		insert into public.media_jobs (
			organization_id, session_id, conversation_id, message_id,
			provider_message_id, message_key, media_type, media_mime_type,
			status, attempts, max_attempts, next_retry_at,
			dedupe_key, asset_key, declared_size, file_sha256, file_enc_sha256,
			error_code, error_message, failed_at, manual_requested, priority
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, $6::jsonb, $7, nullif($8, ''),
			$9, 0, $10, now(),
			$11, $12, nullif($13, 0), nullif($14, ''), nullif($15, ''),
			nullif($16, ''), nullif($16, ''), case when $9 = 'failed' then now() end, false, $22
		)
		on conflict (organization_id, dedupe_key) do update
		set message_key = case
		      when media_jobs.status in ('processing', 'completed')
		        or nullif(btrim(coalesce(media_jobs.message_key->>$17::text, '')), '') is not null
		        or nullif(btrim(coalesce(media_jobs.message_key->>$21::text, '')), '') is not null
		      then media_jobs.message_key
			      else (
			        -- Keep one bounded recovery source. Prefer a provider message
			        -- block over a plaintext URL and never retain the webhook envelope.
			        case
			          when excluded.message_key ? 'message' then jsonb_build_object('message', excluded.message_key->'message')
			          when media_jobs.message_key ? 'message' then jsonb_build_object('message', media_jobs.message_key->'message')
			          when excluded.message_key ? 'media_url' then jsonb_build_object('media_url', excluded.message_key->'media_url')
			          when media_jobs.message_key ? 'media_url' then jsonb_build_object('media_url', media_jobs.message_key->'media_url')
			          else '{}'::jsonb
			        end
			      ) || jsonb_strip_nulls(jsonb_build_object(
			        $17::text, media_jobs.message_key->$17::text,
		        $18::text, media_jobs.message_key->$18::text,
		        $19::text, media_jobs.message_key->$19::text,
		        $20::text, media_jobs.message_key->$20::text,
		        $21::text, media_jobs.message_key->$21::text
		      ))
			    end,
			    priority = greatest(media_jobs.priority, excluded.priority),
		    provider_message_id = case
		      when media_jobs.status in ('processing', 'completed')
		        or nullif(btrim(coalesce(media_jobs.message_key->>$17::text, '')), '') is not null
		        or nullif(btrim(coalesce(media_jobs.message_key->>$21::text, '')), '') is not null
		      then media_jobs.provider_message_id
		      else coalesce(excluded.provider_message_id, media_jobs.provider_message_id)
		    end,
		    media_mime_type = case
		      when media_jobs.status in ('processing', 'completed')
		        or nullif(btrim(coalesce(media_jobs.message_key->>$17::text, '')), '') is not null
		        or nullif(btrim(coalesce(media_jobs.message_key->>$21::text, '')), '') is not null
		      then media_jobs.media_mime_type
		      else coalesce(media_jobs.media_mime_type, excluded.media_mime_type)
		    end,
		    declared_size = case
		      when media_jobs.status in ('processing', 'completed')
		        or nullif(btrim(coalesce(media_jobs.message_key->>$17::text, '')), '') is not null
		        or nullif(btrim(coalesce(media_jobs.message_key->>$21::text, '')), '') is not null
		      then media_jobs.declared_size
		      else coalesce(media_jobs.declared_size, excluded.declared_size)
		    end,
		    file_sha256 = case
		      when media_jobs.status in ('processing', 'completed')
		        or nullif(btrim(coalesce(media_jobs.message_key->>$17::text, '')), '') is not null
		        or nullif(btrim(coalesce(media_jobs.message_key->>$21::text, '')), '') is not null
		      then media_jobs.file_sha256
		      else coalesce(media_jobs.file_sha256, excluded.file_sha256)
		    end,
		    file_enc_sha256 = case
		      when media_jobs.status in ('processing', 'completed')
		        or nullif(btrim(coalesce(media_jobs.message_key->>$17::text, '')), '') is not null
		        or nullif(btrim(coalesce(media_jobs.message_key->>$21::text, '')), '') is not null
		      then media_jobs.file_enc_sha256
		      else coalesce(media_jobs.file_enc_sha256, excluded.file_enc_sha256)
		    end,
		    asset_key = case
		      when media_jobs.status in ('processing', 'completed')
		        or nullif(btrim(coalesce(media_jobs.message_key->>$17::text, '')), '') is not null
		        or nullif(btrim(coalesce(media_jobs.message_key->>$21::text, '')), '') is not null
		      then media_jobs.asset_key
		      when media_jobs.file_sha256 is not null then media_jobs.asset_key
		      when excluded.file_sha256 is not null then excluded.asset_key
		      when media_jobs.file_enc_sha256 is not null then media_jobs.asset_key
		      when excluded.file_enc_sha256 is not null then excluded.asset_key
		      else media_jobs.asset_key
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
		returning status,
		          coalesce(error_code, ''),
		          coalesce(storage_path, ''),
		          coalesce(media_mime_type, ''),
		          coalesce(actual_size, 0)
	`, session.OrganizationID, session.ID, conversationID, messageRowID,
		message.ProviderMessageID, messageKey, message.MessageType, message.MediaMimeType,
		jobStatus, whatsappMediaJobMaxAttempts, dedupeKey, assetKey, message.MediaSize,
		fileSHA256, fileEncSHA256, policy.errorCode,
		whatsappMediaUploadPathKey, whatsappMediaUploadMIMEKey, whatsappMediaUploadSizeKey,
		whatsappMediaUploadFailuresKey, whatsappMediaRepairPathKey, whatsappMediaRealtimePriority).Scan(
		&persistedStatus,
		&persistedError,
		&persistedStoragePath,
		&persistedMimeType,
		&persistedActualSize,
	)
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

func whatsappMediaQueueMessageKey(message nativeEvolutionMessage) map[string]any {
	messageNode := nativeFirstMap(message.Raw, "message", "Message")
	if len(messageNode) == 0 {
		messageNode = message.Raw
	}
	kind, block := nativeMediaBlock(messageNode, message.Raw, nativeFirstMap(message.Raw, "Info", "info"))
	blockNames := map[string]string{
		"image": "imageMessage", "video": "videoMessage", "audio": "audioMessage",
		"document": "documentMessage", "sticker": "stickerMessage",
	}
	cleaned := map[string]any{}
	copyString := func(key string, maxBytes int, aliases ...string) {
		value := strings.TrimSpace(stripNullBytes(firstString(block, aliases...)))
		if value != "" && len(value) <= maxBytes {
			cleaned[key] = value
		}
	}
	copyString("mediaKey", 4096, "mediaKey", "MediaKey", "media_key")
	copyString("fileSha256", 4096, "fileSha256", "fileSHA256", "FileSHA256", "FileSha256")
	copyString("fileEncSha256", 4096, "fileEncSha256", "fileEncSHA256", "FileEncSHA256", "FileEncSha256")
	copyString("fileLength", 64, "fileLength", "FileLength", "file_length")
	copyString("mediaKeyTimestamp", 64, "mediaKeyTimestamp", "MediaKeyTimestamp", "media_key_timestamp")
	copyString("mimetype", 512, "mimetype", "mimeType", "MimeType")

	if value := strings.TrimSpace(stripNullBytes(firstString(block, "url", "URL"))); whatsappMediaQueueHTTPURL(value) {
		cleaned["url"] = value
	}
	if value := strings.TrimSpace(stripNullBytes(firstString(block, "directPath", "DirectPath", "direct_path"))); len(value) <= 8192 && strings.HasPrefix(value, "/") {
		cleaned["directPath"] = value
	}
	if blockName := blockNames[kind]; blockName != "" && (cleaned["url"] != nil || cleaned["directPath"] != nil) {
		return map[string]any{"message": map[string]any{blockName: cleaned}}
	}

	mediaURL := strings.TrimSpace(stripNullBytes(message.MediaURL))
	if whatsappMediaQueueHTTPURL(mediaURL) {
		return map[string]any{"media_url": mediaURL}
	}
	return map[string]any{}
}

func whatsappMediaQueueHTTPURL(value string) bool {
	if value == "" || len(value) > 8192 {
		return false
	}
	parsed, err := url.Parse(value)
	return err == nil && parsed.Host != "" && (strings.EqualFold(parsed.Scheme, "http") || strings.EqualFold(parsed.Scheme, "https"))
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
