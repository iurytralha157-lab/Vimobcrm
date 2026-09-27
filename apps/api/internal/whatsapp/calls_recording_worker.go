package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	callRecordingMaxBytes   = int64(256 << 20)
	callRecordingPollPeriod = 10 * time.Second
	callRecordingJobLimit   = 5 * time.Minute
)

type callRecordingChannel struct {
	Channel     string `json:"channel"`
	SizeBytes   int64  `json:"sizeBytes"`
	ContentType string `json:"contentType"`
}

type callRecordingJob struct {
	ID             string
	OrganizationID string
	SessionID      string
	ProviderCallID string
	ProviderStatus string
	Attempts       int
	Manifest       []callRecordingChannel
	IncomingPath   *string
	OutgoingPath   *string
}

func callRecordingProviderHTTPClient(base *http.Client) http.Client {
	if base == nil {
		base = newEvolutionHTTPClient()
	}
	client := *base
	client.Timeout = callRecordingJobLimit
	// The provider request carries an instance API token in a custom header.
	// Never forward that header to a redirect target, even on the same host.
	client.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}
	return client
}

// Recordings have a separate serial lane. Provider file transfer never runs
// inside webhook intake or borrows a message/media worker slot.
func (handler Handler) StartCallRecordingWorker(ctx context.Context, logger *slog.Logger) {
	if logger == nil {
		logger = slog.Default()
	}
	if handler.repo.functions.evolutionGoAPIURL == "" ||
		handler.repo.storage.projectURL == "" || handler.repo.storage.apiKey == "" {
		return
	}
	var installed bool
	if err := handler.repo.db.Pool().QueryRow(ctx,
		"select to_regclass('public.whatsapp_calls') is not null").Scan(&installed); err != nil || !installed {
		logger.Warn("whatsapp call recording worker disabled until schema is available", "error", err)
		return
	}
	go handler.runCallRecordingWorker(ctx, logger)
}

func (handler Handler) runCallRecordingWorker(ctx context.Context, logger *slog.Logger) {
	ticker := time.NewTicker(callRecordingPollPeriod)
	defer ticker.Stop()
	for {
		for {
			replayed, replayErr := handler.repo.replayOneCallWebhook(ctx)
			if replayErr != nil {
				if !errors.Is(replayErr, context.Canceled) {
					logger.Error("whatsapp call webhook retry failed", "error", replayErr)
				}
				break
			}
			if replayed {
				continue
			}
			processed, err := handler.repo.drainOneCallRecording(ctx)
			if err != nil {
				if !errors.Is(err, context.Canceled) {
					logger.Error("whatsapp call recording worker failed", "error", err)
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

// A CallRecording callback can beat its CallState callback. The webhook keeps
// that manifest in the durable inbox, and this lane retries only call events.
// Ordinary messages remain owned by the existing webhook worker.
func (repo Repository) replayOneCallWebhook(ctx context.Context) (bool, error) {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	var id, eventType, payload string
	var attempts, maxAttempts int
	var session evolutionWebhookSession
	err = tx.QueryRow(ctx, `
		select i.id::text, i.event_type, i.payload::text,
		       i.attempts, i.max_attempts,
		       s.id::text, s.organization_id::text,
		       coalesce(s.instance_id,''), s.instance_name
		from public.whatsapp_webhook_inbox i
		join public.whatsapp_sessions s on s.id = i.session_id
		where i.status in ('pending','retry')
		  and i.next_attempt_at <= now()
		  and lower(replace(i.event_type, '_', '')) in ('callstate','callrecording')
		order by i.next_attempt_at, i.id
		for update of i skip locked
		limit 1
	`).Scan(&id, &eventType, &payload, &attempts, &maxAttempts,
		&session.ID, &session.OrganizationID, &session.InstanceID, &session.InstanceName)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if _, err := tx.Exec(ctx, `savepoint call_webhook_retry`); err != nil {
		return true, err
	}
	_, processErr := repo.applyEvolutionCallWebhook(ctx, tx, session, eventType, []byte(payload))
	if processErr != nil {
		if _, err := tx.Exec(ctx, `rollback to savepoint call_webhook_retry`); err != nil {
			return true, errors.Join(processErr, err)
		}
	}
	if _, err := tx.Exec(ctx, `release savepoint call_webhook_retry`); err != nil {
		return true, err
	}
	if processErr == nil {
		_, err = tx.Exec(ctx, `
			update public.whatsapp_webhook_inbox
			set status = 'processed', processed_at = now(), updated_at = now(),
			    last_error = null, expires_at = now() + interval '24 hours'
			where id = $1::uuid
		`, id)
	} else {
		attempts++
		status := "retry"
		if attempts >= maxAttempts {
			status = "dead"
		}
		delay := time.Duration(1<<min(attempts, 6)) * 5 * time.Second
		errorCode := "call_webhook_retry_failed"
		if errors.Is(processErr, errCallStateNotYetReceived) {
			errorCode = "call_state_not_yet_received"
		}
		_, err = tx.Exec(ctx, `
			update public.whatsapp_webhook_inbox
			set status = $2, attempts = $3, next_attempt_at = $4,
			    last_error = $5, updated_at = now(),
			    dead_lettered_at = case when $2 = 'dead' then now() else dead_lettered_at end
			where id = $1::uuid
		`, id, status, attempts, time.Now().Add(delay), errorCode)
	}
	if err != nil {
		return true, err
	}
	return true, tx.Commit(ctx)
}

func (repo Repository) claimCallRecording(ctx context.Context) (callRecordingJob, error) {
	var job callRecordingJob
	var manifestRaw []byte
	err := repo.db.Pool().QueryRow(ctx, `
		with candidate as (
		  select id from public.whatsapp_calls
		  where recording_status = 'pending'
		    and recording_next_attempt_at <= now()
		  order by recording_next_attempt_at, id
		  for update skip locked
		  limit 1
		)
		update public.whatsapp_calls c
		set recording_attempts = c.recording_attempts + 1,
		    recording_next_attempt_at = now() + interval '10 minutes'
		from candidate
		where c.id = candidate.id
		returning c.id::text, c.organization_id::text, c.session_id::text,
		          c.provider_call_id, coalesce(c.recording_provider_status,''),
		          c.recording_attempts, c.recording_manifest,
		          c.recording_incoming_path, c.recording_outgoing_path
	`).Scan(&job.ID, &job.OrganizationID, &job.SessionID,
		&job.ProviderCallID, &job.ProviderStatus, &job.Attempts, &manifestRaw,
		&job.IncomingPath, &job.OutgoingPath)
	if err != nil {
		return callRecordingJob{}, err
	}
	if err := json.Unmarshal(manifestRaw, &job.Manifest); err != nil {
		return callRecordingJob{}, err
	}
	return job, nil
}

func (repo Repository) drainOneCallRecording(ctx context.Context) (bool, error) {
	job, err := repo.claimCallRecording(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	processCtx, cancel := context.WithTimeout(ctx, callRecordingJobLimit)
	incoming, outgoing, processErr := repo.transferCallRecording(processCtx, job)
	cancel()
	if ctx.Err() != nil {
		return true, ctx.Err()
	}
	status := callRecordingCompletionStatus(job.ProviderStatus, incoming, outgoing)
	nextAt := time.Time{}
	if processErr != nil {
		status = "pending"
		if job.Attempts >= 5 {
			status = "failed"
			if incoming != nil || outgoing != nil {
				status = "partial"
			}
		} else {
			nextAt = time.Now().Add(time.Duration(job.Attempts*job.Attempts) * time.Minute)
		}
	}
	errorCode := ""
	if processErr != nil {
		errorCode = "recording_transfer_failed"
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return true, err
	}
	defer tx.Rollback(ctx)
	var storedID string
	err = tx.QueryRow(ctx, `
		update public.whatsapp_calls
		set recording_status = $3,
		    recording_incoming_path = coalesce($4, recording_incoming_path),
		    recording_outgoing_path = coalesce($5, recording_outgoing_path),
		    recording_next_attempt_at = $6,
		    recording_error = nullif($7,'')
		where id = $1::uuid and recording_status = 'pending'
		  and recording_attempts = $2
		returning id::text
	`, job.ID, job.Attempts, status, incoming, outgoing,
		nullableTime(nextAt), errorCode).Scan(&storedID)
	if errors.Is(err, pgx.ErrNoRows) {
		return true, nil
	}
	if err != nil {
		return true, err
	}
	if err := updateWhatsAppCallTimeline(ctx, tx, storedID); err != nil {
		return true, err
	}
	if err := tx.Commit(ctx); err != nil {
		return true, err
	}
	return true, processErr
}

func callRecordingCompletionStatus(providerStatus string, incoming, outgoing *string) string {
	if providerStatus == "partial" || incoming == nil || outgoing == nil {
		return "partial"
	}
	return "ready"
}

func nullableTime(value time.Time) *time.Time {
	if value.IsZero() {
		return nil
	}
	return &value
}

func (repo Repository) transferCallRecording(
	ctx context.Context,
	job callRecordingJob,
) (*string, *string, error) {
	providerSession, err := repo.functions.resolveEvolutionSession(ctx, map[string]any{"session_id": job.SessionID})
	if err != nil {
		return job.IncomingPath, job.OutgoingPath, err
	}
	instanceID := repo.functions.evolutionInstanceKey(providerSession, nil, nil)
	token := repo.functions.evolutionSessionToken(providerSession, nil)
	if instanceID == "" || token == "" {
		return job.IncomingPath, job.OutgoingPath, ErrProviderFailed
	}
	incoming, outgoing := job.IncomingPath, job.OutgoingPath
	var firstError error
	for _, channel := range job.Manifest {
		if !stringIn(channel.Channel, "incoming", "outgoing") ||
			channel.ContentType != "audio/wav" || channel.SizeBytes < 0 ||
			channel.SizeBytes > callRecordingMaxBytes {
			return incoming, outgoing, ErrInvalidInput
		}
		if channel.Channel == "incoming" && incoming != nil ||
			channel.Channel == "outgoing" && outgoing != nil {
			continue
		}
		path, err := repo.fetchAndStoreCallRecordingChannel(ctx, job, channel, instanceID, token)
		if err != nil {
			if firstError == nil {
				firstError = err
			}
			continue
		}
		if channel.Channel == "incoming" {
			incoming = &path
		} else {
			outgoing = &path
		}
	}
	if len(job.Manifest) == 0 {
		return incoming, outgoing, ErrInvalidInput
	}
	return incoming, outgoing, firstError
}

func (repo Repository) fetchAndStoreCallRecordingChannel(
	ctx context.Context,
	job callRecordingJob,
	channel callRecordingChannel,
	instanceID string,
	token string,
) (string, error) {
	endpoint, err := url.Parse(repo.functions.evolutionGoAPIURL)
	if err != nil || endpoint == nil || !stringIn(endpoint.Scheme, "http", "https") ||
		endpoint.Host == "" || endpoint.User != nil || endpoint.RawQuery != "" {
		return "", ErrFeatureUnavailable
	}
	endpoint.Path = strings.TrimRight(endpoint.Path, "/") + "/call/recording"
	endpoint.RawPath = ""
	query := url.Values{}
	query.Set("callId", job.ProviderCallID)
	query.Set("channel", channel.Channel)
	endpoint.RawQuery = query.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return "", err
	}
	request.Header.Set("apikey", token)
	request.Header.Set("instanceId", instanceID)
	request.Header.Set("Accept", "audio/wav")
	copyClient := callRecordingProviderHTTPClient(repo.functions.httpClient)
	response, err := copyClient.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("provider recording HTTP %d", response.StatusCode)
	}
	temporary, err := os.CreateTemp("", "vimob-call-recording-*.wav")
	if err != nil {
		return "", err
	}
	defer os.Remove(temporary.Name())
	defer temporary.Close()
	size, err := io.Copy(temporary, io.LimitReader(response.Body, callRecordingMaxBytes+1))
	if err != nil {
		return "", err
	}
	if size > callRecordingMaxBytes || size < 44 ||
		(channel.SizeBytes > 0 && size != channel.SizeBytes) {
		return "", errors.New("provider recording size is invalid")
	}
	var header [12]byte
	if _, err := temporary.ReadAt(header[:], 0); err != nil {
		return "", err
	}
	if string(header[:4]) != "RIFF" || string(header[8:12]) != "WAVE" {
		return "", errors.New("provider recording WAV header is invalid")
	}
	if _, err := temporary.Seek(0, io.SeekStart); err != nil {
		return "", err
	}
	path := job.OrganizationID + "/" + job.SessionID + "/" + job.ID + "/" + channel.Channel + ".wav"
	storage := repo.storage
	if storage.httpClient != nil {
		copyStorageClient := *storage.httpClient
		copyStorageClient.Timeout = callRecordingJobLimit
		storage.httpClient = &copyStorageClient
	}
	if err := storage.upload(ctx, whatsappCallRecordingBucket, path, "audio/wav", temporary, true); err != nil {
		return "", err
	}
	return path, nil
}
