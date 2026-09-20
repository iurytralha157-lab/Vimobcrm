package whatsapp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/realtime"
)

const (
	whatsappAvatarWorkerID     = "api-whatsapp-avatar-worker"
	whatsappAvatarPollInterval = 2 * time.Second
	// Evolution Go can spend up to 75 seconds in sendIQ and keeps its avatar
	// handler alive for 80 seconds. Preserve headroom for the response, image
	// download, Storage upload and fenced database finalization.
	whatsappAvatarLease           = 3 * time.Minute
	whatsappAvatarProcessingLimit = 150 * time.Second
	whatsappAvatarRequestTimeout  = 90 * time.Second
	whatsappAvatarDownloadTimeout = 8 * time.Second
	whatsappAvatarClaimTimeout    = 5 * time.Second
	whatsappAvatarFinishTimeout   = 5 * time.Second
	whatsappAvatarMaxBytes        = int64(5 * 1024 * 1024)
	whatsappAvatarResponseMax     = int64(1 * 1024 * 1024)
)

const (
	whatsappAvatarOutcomeCompleted   = "completed"
	whatsappAvatarOutcomeUnavailable = "unavailable"
	whatsappAvatarOutcomeTransient   = "transient"
)

var errWhatsAppAvatarUnavailable = errors.New("whatsapp avatar is unavailable")

type queuedWhatsAppAvatarJob struct {
	ID              string
	OrganizationID  string
	LeadID          string
	SessionID       string
	ConversationID  string
	BindingID       string
	SourceMessageID string
	RemoteJID       string
	Attempts        int
	LeaseToken      string
}

type whatsappAvatarJobResult struct {
	Updated        bool
	OrganizationID string
	LeadID         string
	ConversationID string
}

type whatsappAvatarDescriptor struct {
	URL              string
	ProviderAvatarID string
}

type processedWhatsAppAvatar struct {
	StoragePath      string
	ProviderAvatarID string
}

func (handler Handler) StartAvatarWorker(ctx context.Context, logger *slog.Logger) {
	if logger == nil {
		logger = slog.Default()
	}

	// Avatar enrichment is intentionally one serial lane. It is best-effort and
	// must never borrow concurrency from webhook ingestion or the text outbox.
	go handler.runWhatsAppAvatarWorker(ctx, logger)
}

func (handler Handler) runWhatsAppAvatarWorker(ctx context.Context, logger *slog.Logger) {
	ticker := time.NewTicker(whatsappAvatarPollInterval)
	defer ticker.Stop()

	for {
		for {
			processed, err := handler.repo.drainOneWhatsAppAvatarJob(ctx)
			if err != nil {
				if !errors.Is(err, context.Canceled) {
					logger.Error("whatsapp avatar worker failed", "error", err)
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
		}
	}
}

func (repo Repository) drainOneWhatsAppAvatarJob(ctx context.Context) (bool, error) {
	job, err := repo.claimWhatsAppAvatarJob(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	processCtx, cancelProcess := context.WithTimeout(ctx, whatsappAvatarProcessingLimit)
	processed, processErr := repo.processWhatsAppAvatarJob(processCtx, job)
	cancelProcess()
	if ctx.Err() != nil {
		// Let the lease expire on shutdown. A replacement worker can safely claim
		// the same job and reconcile the deterministic Storage object.
		return true, ctx.Err()
	}

	outcome := whatsappAvatarOutcomeCompleted
	errorText := ""
	if processErr != nil {
		outcome = whatsappAvatarOutcomeTransient
		if errors.Is(processErr, errWhatsAppAvatarUnavailable) {
			outcome = whatsappAvatarOutcomeUnavailable
		} else {
			errorText = whatsappAvatarErrorText(processErr)
		}
	}

	finished, finishErr := repo.finishWhatsAppAvatarJob(ctx, job, outcome, processed, errorText)
	if finishErr != nil {
		if processErr != nil {
			stableProcessError := errorText
			if stableProcessError == "" {
				stableProcessError = "avatar_unavailable"
			}
			return true, errors.Join(errors.New(stableProcessError), finishErr)
		}
		return true, finishErr
	}
	if outcome == whatsappAvatarOutcomeCompleted && finished.Updated {
		repo.publishWhatsAppAvatarUpdated(finished.OrganizationID, finished.LeadID)
	}
	if outcome == whatsappAvatarOutcomeTransient {
		return true, errors.New(errorText)
	}

	return true, nil
}

func (repo Repository) publishWhatsAppAvatarUpdated(organizationID string, leadID string) {
	organizationID = strings.TrimSpace(organizationID)
	leadID = strings.TrimSpace(leadID)
	if organizationID == "" || leadID == "" || repo.leadPublisher == nil {
		return
	}

	repo.leadPublisher.Publish(realtime.NewEvent(
		"lead.whatsapp_avatar_updated",
		organizationID,
		"",
		map[string]any{"leadId": leadID},
	))
}

func (repo Repository) claimWhatsAppAvatarJob(ctx context.Context) (queuedWhatsAppAvatarJob, error) {
	var job queuedWhatsAppAvatarJob
	claimCtx, cancel := context.WithTimeout(ctx, whatsappAvatarClaimTimeout)
	defer cancel()

	err := repo.db.Pool().QueryRow(claimCtx, `
		select
			job.id::text,
			job.organization_id::text,
			job.lead_id::text,
			job.session_id::text,
			coalesce(job.conversation_id::text, ''),
			coalesce(job.binding_id::text, ''),
			coalesce(job.source_message_id::text, ''),
			coalesce(job.remote_jid, ''),
			coalesce(job.attempts, 0),
			job.lease_token::text
		from private.claim_whatsapp_avatar_job($1, $2::interval) as job
	`, whatsappAvatarWorkerID, fmt.Sprintf("%.0f seconds", whatsappAvatarLease.Seconds())).Scan(
		&job.ID,
		&job.OrganizationID,
		&job.LeadID,
		&job.SessionID,
		&job.ConversationID,
		&job.BindingID,
		&job.SourceMessageID,
		&job.RemoteJID,
		&job.Attempts,
		&job.LeaseToken,
	)
	return job, err
}

func (repo Repository) finishWhatsAppAvatarJob(
	ctx context.Context,
	job queuedWhatsAppAvatarJob,
	outcome string,
	processed processedWhatsAppAvatar,
	errorText string,
) (whatsappAvatarJobResult, error) {
	var result whatsappAvatarJobResult
	finishCtx, cancel := context.WithTimeout(ctx, whatsappAvatarFinishTimeout)
	defer cancel()

	err := repo.db.Pool().QueryRow(finishCtx, `
		select
			coalesce(result.updated, false),
			coalesce(result.organization_id::text, ''),
			coalesce(result.lead_id::text, ''),
			coalesce(result.conversation_id::text, '')
		from private.finish_whatsapp_avatar_job(
			$1::uuid,
			$2::uuid,
			$3,
			nullif($4::text, ''),
			nullif($5::text, ''),
			nullif($6::text, '')
		) as result
	`,
		job.ID,
		job.LeaseToken,
		outcome,
		processed.StoragePath,
		processed.ProviderAvatarID,
		errorText,
	).Scan(
		&result.Updated,
		&result.OrganizationID,
		&result.LeadID,
		&result.ConversationID,
	)
	return result, err
}

func (repo Repository) processWhatsAppAvatarJob(ctx context.Context, job queuedWhatsAppAvatarJob) (processedWhatsAppAvatar, error) {
	descriptor, outcome, err := repo.fetchWhatsAppAvatar(ctx, job)
	if err != nil {
		return processedWhatsAppAvatar{}, err
	}
	if outcome == whatsappAvatarOutcomeUnavailable {
		return processedWhatsAppAvatar{}, errWhatsAppAvatarUnavailable
	}

	payload, mimeType, extension, err := downloadWhatsAppAvatar(ctx, descriptor.URL)
	if err != nil {
		return processedWhatsAppAvatar{}, err
	}
	organizationID, organizationOK := normalizeUUID(job.OrganizationID)
	leadID, leadOK := normalizeUUID(job.LeadID)
	if !organizationOK || !leadOK {
		return processedWhatsAppAvatar{}, fmt.Errorf("avatar job contains an invalid organization or lead identifier")
	}

	digest := sha256.Sum256(payload)
	storagePath := fmt.Sprintf(
		"orgs/%s/profile-pictures/%s/%s.%s",
		organizationID,
		leadID,
		hex.EncodeToString(digest[:]),
		extension,
	)

	uploadErr := repo.storage.upload(
		ctx,
		whatsappMediaBucket,
		storagePath,
		mimeType,
		bytes.NewReader(payload),
		true,
	)
	if uploadErr != nil {
		// A process may have uploaded the deterministic object and exited before
		// the fenced database finalization. Treat the object as committed when
		// reconciliation proves it exists; otherwise keep the job transient.
		existsAfterUpload, reconcileErr := repo.storage.objectExists(ctx, whatsappMediaBucket, storagePath)
		if reconcileErr != nil {
			return processedWhatsAppAvatar{}, errors.Join(uploadErr, reconcileErr)
		}
		if !existsAfterUpload {
			return processedWhatsAppAvatar{}, uploadErr
		}
	}

	return processedWhatsAppAvatar{
		StoragePath:      storagePath,
		ProviderAvatarID: descriptor.ProviderAvatarID,
	}, nil
}

func (repo Repository) fetchWhatsAppAvatar(
	ctx context.Context,
	job queuedWhatsAppAvatarJob,
) (whatsappAvatarDescriptor, string, error) {
	response, err := repo.functions.invokeEvolutionDirectWithResponseLimit(
		ctx,
		"user.avatar",
		whatsappAvatarEvolutionPayload(job),
		whatsappAvatarResponseMax,
	)
	return classifyWhatsAppAvatarProviderResponse(response, err)
}

func whatsappAvatarEvolutionPayload(job queuedWhatsAppAvatarJob) map[string]any {
	return map[string]any{
		"session_id": job.SessionID,
		"body": map[string]any{
			// Preserve the qualified JID. Stripping non-digits corrupts LIDs and
			// makes provider-side identity resolution ambiguous.
			"number":  job.RemoteJID,
			"preview": true,
		},
	}
}

func classifyWhatsAppAvatarProviderResponse(
	response map[string]any,
	requestErr error,
) (whatsappAvatarDescriptor, string, error) {
	if requestErr != nil {
		classificationText := strings.ToLower(requestErr.Error())
		if whatsappAvatarUnavailableMessage(classificationText) {
			return whatsappAvatarDescriptor{}, whatsappAvatarOutcomeUnavailable, nil
		}
		return whatsappAvatarDescriptor{}, whatsappAvatarOutcomeTransient, errors.New(
			whatsappAvatarFailureCode(classificationText),
		)
	}

	descriptor := normalizeWhatsAppAvatarResponse(response)
	if providerResultOK(response) && descriptor.URL != "" {
		return descriptor, whatsappAvatarOutcomeCompleted, nil
	}
	if providerResultOK(response) {
		return whatsappAvatarDescriptor{}, whatsappAvatarOutcomeUnavailable, nil
	}

	message := providerErrorMessage(response, "provider avatar request failed")
	classificationText := strings.ToLower(message + " " + whatsappAvatarProviderResponseText(response))
	if whatsappAvatarUnavailableMessage(classificationText) {
		return whatsappAvatarDescriptor{}, whatsappAvatarOutcomeUnavailable, nil
	}
	return whatsappAvatarDescriptor{}, whatsappAvatarOutcomeTransient, errors.New(
		whatsappAvatarFailureCode(classificationText),
	)
}

func normalizeWhatsAppAvatarResponse(response map[string]any) whatsappAvatarDescriptor {
	queue := []map[string]any{response}
	visited := 0
	for len(queue) > 0 && visited < 16 {
		current := queue[0]
		queue = queue[1:]
		visited++

		if avatarURL := avatarStringForAliases(current,
			"url",
			"profilePictureUrl",
			"profilePicUrl",
			"pictureUrl",
			"picture",
			"wpiUrl",
			"avatarUrl",
			"avatar",
			"profilePicture",
		); avatarURL != "" {
			return whatsappAvatarDescriptor{
				URL: avatarURL,
				ProviderAvatarID: avatarStringForAliases(current,
					"id",
					"pictureId",
					"profilePictureId",
					"avatarId",
				),
			}
		}

		for _, wrapper := range []string{"data", "result", "response", "avatar", "picture", "profilePicture"} {
			if nested, ok := avatarValueForAlias(current, wrapper).(map[string]any); ok {
				queue = append(queue, nested)
			}
		}
	}
	return whatsappAvatarDescriptor{}
}

func avatarStringForAliases(value map[string]any, aliases ...string) string {
	for _, alias := range aliases {
		candidate := avatarValueForAlias(value, alias)
		if text := stringFromAny(candidate); text != "" {
			return text
		}
	}
	return ""
}

func avatarValueForAlias(value map[string]any, alias string) any {
	wanted := normalizeWhatsAppAvatarKey(alias)
	for key, candidate := range value {
		if normalizeWhatsAppAvatarKey(key) == wanted {
			return candidate
		}
	}
	return nil
}

func normalizeWhatsAppAvatarKey(value string) string {
	var builder strings.Builder
	for _, character := range strings.ToLower(value) {
		if unicode.IsLetter(character) || unicode.IsDigit(character) {
			builder.WriteRune(character)
		}
	}
	return builder.String()
}

func whatsappAvatarUnavailableMessage(message string) bool {
	message = strings.ToLower(strings.TrimSpace(message))
	for _, marker := range []string{
		"errprofilepictureunauthorized",
		"errprofilepicturenotset",
		"profile picture unauthorized",
		"profile photo unauthorized",
		"not authorized to get profile picture",
		"profile picture not set",
		"profile picture is not set",
		"profile photo not set",
		"profile picture not found",
		"profile photo not found",
		"no profile picture",
		"no profile photo",
		"profile picture unavailable",
		"profile photo unavailable",
		"profile picture privacy",
		"profile photo privacy",
	} {
		if strings.Contains(message, marker) {
			return true
		}
	}
	return false
}

func downloadWhatsAppAvatar(ctx context.Context, rawURL string) ([]byte, string, string, error) {
	avatarURL, err := validateWhatsAppAvatarURL(rawURL)
	if err != nil {
		return nil, "", "", err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, avatarURL.String(), nil)
	if err != nil {
		return nil, "", "", err
	}
	request.Header.Set("Accept", "image/jpeg,image/png,image/webp")
	request.Header.Set("User-Agent", "VimobCRM-AvatarWorker/1.0")

	client := &http.Client{
		Timeout: whatsappAvatarDownloadTimeout,
		CheckRedirect: func(request *http.Request, via []*http.Request) error {
			return whatsappAvatarRedirectPolicy(request, via)
		},
	}
	response, err := client.Do(request)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
			return nil, "", "", fmt.Errorf("avatar image download timed out")
		}
		// net/url errors include the complete signed URL. Keep provider query
		// credentials out of logs and the durable job error column.
		return nil, "", "", fmt.Errorf("avatar image download failed")
	}
	defer response.Body.Close()

	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, "", "", fmt.Errorf("avatar image download returned HTTP %d", response.StatusCode)
	}
	if response.ContentLength > whatsappAvatarMaxBytes {
		return nil, "", "", fmt.Errorf("avatar image exceeds the 5 MiB limit")
	}

	payload, err := readWhatsAppAvatarBytes(response.Body, whatsappAvatarMaxBytes)
	if err != nil {
		return nil, "", "", err
	}
	mimeType, extension, err := detectWhatsAppAvatarImage(payload)
	if err != nil {
		return nil, "", "", err
	}
	return payload, mimeType, extension, nil
}

func validateWhatsAppAvatarURL(rawURL string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return nil, fmt.Errorf("avatar URL is invalid")
	}
	if parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil {
		return nil, fmt.Errorf("avatar URL must use an authenticated-free HTTPS origin")
	}
	if port := parsed.Port(); port != "" && port != "443" {
		return nil, fmt.Errorf("avatar URL uses a forbidden port")
	}
	hostname := strings.ToLower(strings.TrimSuffix(parsed.Hostname(), "."))
	if !whatsappAvatarHostnameAllowed(hostname) {
		return nil, fmt.Errorf("avatar URL origin is not allowed")
	}
	return parsed, nil
}

func whatsappAvatarHostnameAllowed(hostname string) bool {
	hostname = strings.ToLower(strings.TrimSuffix(strings.TrimSpace(hostname), "."))
	for _, allowed := range []string{"whatsapp.net", "fbcdn.net", "fbsbx.com"} {
		if hostname == allowed || strings.HasSuffix(hostname, "."+allowed) {
			return true
		}
	}
	return false
}

func whatsappAvatarRedirectPolicy(request *http.Request, via []*http.Request) error {
	if len(via) >= 3 {
		return fmt.Errorf("avatar image redirect limit exceeded")
	}
	if _, err := validateWhatsAppAvatarURL(request.URL.String()); err != nil {
		return err
	}
	return nil
}

func readWhatsAppAvatarBytes(reader io.Reader, limit int64) ([]byte, error) {
	if limit <= 0 {
		limit = whatsappAvatarMaxBytes
	}
	payload, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil {
		return nil, fmt.Errorf("avatar image read failed: %w", err)
	}
	if int64(len(payload)) > limit {
		return nil, fmt.Errorf("avatar image exceeds the 5 MiB limit")
	}
	if len(payload) == 0 {
		return nil, fmt.Errorf("avatar image is empty")
	}
	return payload, nil
}

func detectWhatsAppAvatarImage(payload []byte) (string, string, error) {
	switch {
	case len(payload) >= 3 && payload[0] == 0xff && payload[1] == 0xd8 && payload[2] == 0xff:
		return "image/jpeg", "jpg", nil
	case len(payload) >= 8 && bytes.Equal(payload[:8], []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}):
		return "image/png", "png", nil
	case len(payload) >= 12 && bytes.Equal(payload[:4], []byte("RIFF")) && bytes.Equal(payload[8:12], []byte("WEBP")):
		return "image/webp", "webp", nil
	default:
		return "", "", fmt.Errorf("avatar image has an unsupported or invalid MIME signature")
	}
}

func whatsappAvatarErrorText(err error) string {
	if err == nil {
		return ""
	}
	return whatsappAvatarFailureCode(err.Error())
}

func whatsappAvatarFailureCode(value string) string {
	normalized := strings.ToLower(value)
	switch {
	case strings.Contains(normalized, "deadline exceeded"),
		strings.Contains(normalized, "timed out"),
		strings.Contains(normalized, "timeout"):
		return "avatar_timeout"
	case strings.Contains(normalized, "not connected"),
		strings.Contains(normalized, "not logged in"),
		strings.Contains(normalized, "no active session"),
		strings.Contains(normalized, "session unavailable"):
		return "avatar_provider_session_unavailable"
	case strings.Contains(normalized, "unauthorized"),
		strings.Contains(normalized, "not authorized"),
		strings.Contains(normalized, "forbidden"),
		strings.Contains(normalized, "apikey"),
		strings.Contains(normalized, "access token"):
		return "avatar_provider_auth_failed"
	case strings.Contains(normalized, "429"),
		strings.Contains(normalized, "rate limit"),
		strings.Contains(normalized, "too many requests"):
		return "avatar_provider_rate_limited"
	case strings.Contains(normalized, "invalid phone"),
		strings.Contains(normalized, "invalid jid"):
		return "avatar_provider_invalid_recipient"
	case strings.Contains(normalized, "storage"):
		return "avatar_storage_failed"
	case strings.Contains(normalized, "download"):
		return "avatar_download_failed"
	case strings.Contains(normalized, "mime"),
		strings.Contains(normalized, "unsupported or invalid"),
		strings.Contains(normalized, "image is empty"),
		strings.Contains(normalized, "5 mib limit"):
		return "avatar_invalid_image"
	default:
		return "avatar_enrichment_failed"
	}
}

func whatsappAvatarSafeMessage(value string) string {
	value = strings.TrimSpace(strings.Map(func(character rune) rune {
		if unicode.IsControl(character) {
			return ' '
		}
		return character
	}, value))
	runes := []rune(value)
	if len(runes) > 512 {
		value = string(runes[:512])
	}
	if value == "" {
		return "avatar enrichment failed"
	}
	return value
}

func whatsappAvatarProviderResponseText(response map[string]any) string {
	raw, _ := json.Marshal(response)
	return whatsappAvatarSafeMessage(string(raw))
}
