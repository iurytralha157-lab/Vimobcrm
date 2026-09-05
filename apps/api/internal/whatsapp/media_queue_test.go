package whatsapp

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestAutomaticWhatsAppMediaPolicy(t *testing.T) {
	tests := []struct {
		name        string
		messageType string
		mimeType    string
		size        int64
		automatic   bool
		errorCode   string
	}{
		{name: "unknown size", messageType: "audio", size: 0, errorCode: mediaErrorUnknownSize},
		{name: "negative size", messageType: "image", size: -1, errorCode: mediaErrorUnknownSize},
		{name: "image at limit", messageType: "image", size: whatsappMediaImageAutoMax, automatic: true},
		{name: "image above limit", messageType: "image", size: whatsappMediaImageAutoMax + 1, errorCode: mediaErrorTooLarge},
		{name: "audio at limit", messageType: "audio", size: whatsappMediaAudioAutoMax, automatic: true},
		{name: "audio codecs normalized", messageType: "audio", mimeType: "audio/ogg; codecs=opus", size: 1024, automatic: true},
		{name: "audio declared as video", messageType: "audio", mimeType: "video/mp4", size: 1024, errorCode: mediaErrorManualOnly},
		{name: "audio above absolute limit", messageType: "audio", size: whatsappMediaAudioAutoMax + 1, errorCode: mediaErrorTooLarge},
		{name: "sticker at limit", messageType: "sticker", size: whatsappMediaStickerAutoMax, automatic: true},
		{name: "sticker above limit", messageType: "sticker", size: whatsappMediaStickerAutoMax + 1, errorCode: mediaErrorTooLarge},
		{name: "video is manual", messageType: "video", size: 1024, errorCode: mediaErrorManualOnly},
		{name: "document is manual", messageType: "document", mimeType: "application/pdf", size: 1024, errorCode: mediaErrorManualOnly},
		{name: "PDF disguised as image", messageType: "image", mimeType: "application/pdf", size: 1024, errorCode: mediaErrorManualOnly},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := automaticWhatsAppMediaPolicy(test.messageType, test.mimeType, test.size)
			if got.automatic != test.automatic || got.errorCode != test.errorCode {
				t.Fatalf("policy = %#v, want automatic=%v error=%q", got, test.automatic, test.errorCode)
			}
		})
	}
}

func TestWhatsAppMediaWorkerRequiresFullNativeOwnership(t *testing.T) {
	for _, test := range []struct {
		name      string
		mode      string
		allowlist []string
		want      bool
	}{
		{name: "edge wildcard", mode: webhookProcessorEdge, allowlist: []string{"*"}},
		{name: "native without wildcard", mode: webhookProcessorNative},
		{name: "native fallback partial", mode: webhookProcessorNativeFallback, allowlist: []string{"session-a"}},
		{name: "native wildcard", mode: webhookProcessorNative, allowlist: []string{"*"}, want: true},
		{name: "native fallback wildcard", mode: webhookProcessorNativeFallback, allowlist: []string{"*"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := whatsappMediaWorkerOwnsAllSessions(functionsClient{
				webhookProcessorMode:     test.mode,
				webhookRolloutSessionIDs: test.allowlist,
			})
			if got != test.want {
				t.Fatalf("full native ownership = %v, want %v", got, test.want)
			}
		})
	}
	if DefaultWorkerConfig().MediaWorkerEnabled {
		t.Fatal("media worker must remain fail-closed until the operator enables the full native cutover")
	}
	if len(DefaultWorkerConfig().MediaWorkerSessionIDs) != 0 {
		t.Fatal("media worker session allowlist must default to empty")
	}
}

func TestWhatsAppMediaBase64RejectsEncodedPayloadBeforeDecode(t *testing.T) {
	limit := whatsappMediaBase64EncodedLimit(whatsappMediaAbsoluteMaxBytes)
	tooLarge := strings.Repeat("A", int(limit+1))
	if err := validateWhatsAppMediaBase64Size(tooLarge, whatsappMediaAbsoluteMaxBytes); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("raw base64 error = %v, want ErrInvalidInput", err)
	}
	if _, err := decodeFlexibleBase64Media(tooLarge); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("decode oversized base64 error = %v, want pre-decode ErrInvalidInput", err)
	}
	dataURL := "data:application/octet-stream;base64," + tooLarge
	if err := validateWhatsAppMediaBase64Size(dataURL, whatsappMediaAbsoluteMaxBytes); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("data URL base64 error = %v, want ErrInvalidInput", err)
	}
	if err := validateWhatsAppMediaBase64Size("SGVsbG8", 16); err != nil {
		t.Fatalf("small raw URL base64 was rejected: %v", err)
	}
}

func TestWhatsAppMediaPlaintextDigestValidation(t *testing.T) {
	payload := []byte("verified WhatsApp media")
	digest := sha256.Sum256(payload)
	for _, encoded := range []string{
		base64.StdEncoding.EncodeToString(digest[:]),
		base64.RawURLEncoding.EncodeToString(digest[:]),
		hex.EncodeToString(digest[:]),
	} {
		if err := validateWhatsAppMediaPlaintextDigest(encoded, payload); err != nil {
			t.Fatalf("matching digest %q failed: %v", encoded, err)
		}
	}
	if err := validateWhatsAppMediaPlaintextDigest(base64.StdEncoding.EncodeToString(digest[:]), []byte("corrupted provider response")); err == nil {
		t.Fatal("corrupted provider response passed the plaintext SHA-256 check")
	}
}

func TestWhatsAppMediaEffectiveMIMERejectsDisguisedVideoOrPDF(t *testing.T) {
	for _, fixture := range []struct {
		name    string
		payload []byte
		want    string
	}{
		{name: "PDF", payload: []byte("%PDF-1.7\n1 0 obj\n"), want: "application/pdf"},
		{name: "MP4", payload: append([]byte{0, 0, 0, 24}, []byte("ftypmp42\x00\x00\x00\x00mp42isom")...), want: "video/mp4"},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			job := queuedWhatsAppMediaJob{MediaType: "image", MediaMimeType: "image/png"}
			detected, effective := effectiveWhatsAppMediaContentType(job, recoveredWhatsAppMedia{
				bytes:       fixture.payload,
				contentType: "image/png",
			})
			if detected != fixture.want || effective != fixture.want {
				t.Fatalf("effective MIME = detected:%q effective:%q, want %q", detected, effective, fixture.want)
			}
			policy := automaticWhatsAppMediaPolicy(job.MediaType, effective, int64(len(fixture.payload)))
			if policy.automatic || policy.errorCode != mediaErrorManualOnly {
				t.Fatalf("disguised %s policy = %#v", fixture.name, policy)
			}
		})
	}
}

func TestWhatsAppMediaOversizeIsTerminalBeforeDecodeOrRetry(t *testing.T) {
	contentLengthResponse := &http.Response{
		ContentLength: whatsappMediaAbsoluteMaxBytes + 1,
		Body:          io.NopCloser(strings.NewReader("")),
	}
	if _, err := readLimitedWhatsAppMedia(contentLengthResponse); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("content-length oversize error = %v, want ErrInvalidInput", err)
	}

	chunkedResponse := &http.Response{
		ContentLength: -1,
		Body: io.NopCloser(io.LimitReader(
			whatsappMediaRepeatingReader{},
			whatsappMediaAbsoluteMaxBytes+1,
		)),
	}
	if _, err := readLimitedWhatsAppMedia(chunkedResponse); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("chunked oversize error = %v, want ErrInvalidInput", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_, _ = io.CopyN(response, whatsappMediaRepeatingReader{}, 65)
	}))
	defer server.Close()
	client := functionsClient{
		evolutionGoAPIURL: server.URL,
		evolutionGoAPIKey: "test-key",
		httpClient:        server.Client(),
	}
	_, err := client.evolutionFetch(context.Background(), http.MethodPost, "/media", evolutionFetchOptions{
		Body:             map[string]any{"message": "fixture"},
		MaxResponseBytes: 64,
	})
	if !errors.Is(err, errWhatsAppMediaTooLarge) {
		t.Fatalf("Evolution response oversize error = %v, want size sentinel", err)
	}
	code, permanent := classifyWhatsAppMediaDownloadError(err)
	if code != mediaErrorTooLarge || !permanent {
		t.Fatalf("Evolution response oversize classification = code:%q permanent:%v", code, permanent)
	}
	code, permanent = classifyWhatsAppMediaDownloadError(fmt.Errorf("%w: timeout", ErrProviderOutcomeUnknown))
	if code != mediaErrorOutcomeUnknown || !permanent {
		t.Fatalf("unknown provider outcome classification = code:%q permanent:%v", code, permanent)
	}
}

func TestEvolutionMediaRecoveryUsesDedicatedTimeoutAndKnownRejections(t *testing.T) {
	if got := evolutionRequestTimeout("message.downloadMedia"); got != evolutionMediaRecoveryTimeout || got <= 90*time.Second {
		t.Fatalf("download-media timeout = %s, want dedicated timeout above 90s", got)
	}
	if got := evolutionRequestTimeout("instance.status"); got != 0 {
		t.Fatalf("ordinary Evolution timeout override = %s, want global client behavior", got)
	}

	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		time.Sleep(15 * time.Millisecond)
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()
	shortClient := server.Client()
	shortClient.Timeout = time.Millisecond
	client := functionsClient{
		evolutionGoAPIURL: server.URL,
		evolutionGoAPIKey: "test-key",
		httpClient:        shortClient,
	}
	if _, err := client.evolutionFetch(context.Background(), http.MethodPost, "/media", evolutionFetchOptions{
		Body:           map[string]any{"message": "fixture"},
		RequestTimeout: 100 * time.Millisecond,
	}); err != nil {
		t.Fatalf("dedicated media timeout did not override the shorter global client timeout: %v", err)
	}

	conflict := nativeEvolutionMediaRejection(http.StatusConflict)
	if !errors.Is(conflict, ErrProviderFailed) || errors.Is(conflict, ErrProviderOutcomeUnknown) || errors.Is(conflict, errWhatsAppMediaTooLarge) {
		t.Fatalf("409 rejection classification = %v", conflict)
	}
	tooLarge := nativeEvolutionMediaRejection(http.StatusRequestEntityTooLarge)
	if !errors.Is(tooLarge, ErrProviderFailed) || !errors.Is(tooLarge, errWhatsAppMediaTooLarge) || errors.Is(tooLarge, ErrProviderOutcomeUnknown) {
		t.Fatalf("413 rejection classification = %v", tooLarge)
	}
}

func TestWhatsAppMediaURLRetriesAreBoundedAndNeverOpenPOSTBreaker(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		calls++
		if request.Header.Get("apikey") != "media-key" {
			t.Errorf("provider-host GET did not receive configured credentials")
		}
		http.Error(response, "temporary", http.StatusServiceUnavailable)
	}))
	defer server.Close()

	repo := NewRepository(nil, nil, StorageConfig{
		EvolutionGo: EvolutionGoConfig{APIURL: server.URL, APIKey: "media-key"},
	})
	repo.functions.httpClient = server.Client()
	_, err := repo.downloadWhatsAppMediaURL(context.Background(), server.URL+"/media")
	if !errors.Is(err, ErrProviderFailed) || errors.Is(err, ErrProviderOutcomeUnknown) {
		t.Fatalf("GET retry error = %v, want known ErrProviderFailed only", err)
	}
	if code, permanent := classifyWhatsAppMediaDownloadError(err); code != mediaErrorFailed || permanent {
		t.Fatalf("GET retry classification = %q permanent:%v, want retryable without breaker", code, permanent)
	}
	if calls != whatsappMediaURLDownloadMaxAttempts {
		t.Fatalf("GET attempts = %d, want bounded %d", calls, whatsappMediaURLDownloadMaxAttempts)
	}
}

func TestNativeMediaThumbnailIsNeverTreatedAsFullFile(t *testing.T) {
	message, ok := normalizeNativeEvolutionMessage(map[string]any{
		"Info": map[string]any{
			"ID":     "thumbnail-metadata-only",
			"Chat":   "5511999999999@s.whatsapp.net",
			"Sender": "5511999999999@s.whatsapp.net",
		},
		"Message": map[string]any{
			"imageMessage": map[string]any{
				"mimetype":      "image/jpeg",
				"fileLength":    2048,
				"fileSha256":    "full-file-sha256",
				"jpegThumbnail": base64.StdEncoding.EncodeToString([]byte("thumbnail only")),
			},
		},
	})
	if !ok {
		t.Fatal("metadata-only thumbnail fixture did not normalize")
	}
	if message.MessageType != "image" || message.MediaSize != 2048 {
		t.Fatalf("normalized media metadata = type:%q size:%d", message.MessageType, message.MediaSize)
	}
	if message.MediaBase64 != "" {
		t.Fatal("jpegThumbnail was promoted to full media bytes")
	}
	if _, err := nativeEvolutionProviderMessage(message); err != nil {
		t.Fatalf("metadata-only message cannot be sent to the provider downloader: %v", err)
	}
}

func TestNativeMediaNonPositiveSizeNormalizesToUnknown(t *testing.T) {
	for _, declared := range []any{-12, 0, "-4", "0"} {
		message, ok := normalizeNativeEvolutionMessage(map[string]any{
			"Info": map[string]any{
				"ID":     fmt.Sprintf("unknown-size-%v", declared),
				"Chat":   "5511999999999@s.whatsapp.net",
				"Sender": "5511999999999@s.whatsapp.net",
			},
			"Message": map[string]any{
				"audioMessage": map[string]any{
					"mimetype":   "audio/ogg",
					"fileLength": declared,
				},
			},
		})
		if !ok {
			t.Fatalf("declared size %v did not normalize", declared)
		}
		if message.MediaSize != 0 {
			t.Fatalf("declared size %v normalized to %d, want unknown zero", declared, message.MediaSize)
		}
	}
}

func TestWhatsAppMediaLeaseLossCancelsSlowProviderWork(t *testing.T) {
	var active, maximum int
	var mutex sync.Mutex
	processErr, leaseErr := superviseWhatsAppMediaLease(
		context.Background(),
		time.Millisecond,
		func(context.Context) (bool, error) { return false, nil },
		func(ctx context.Context) error {
			mutex.Lock()
			active++
			if active > maximum {
				maximum = active
			}
			mutex.Unlock()
			defer func() {
				mutex.Lock()
				active--
				mutex.Unlock()
			}()
			<-ctx.Done()
			return ctx.Err()
		},
	)
	if !errors.Is(processErr, context.Canceled) || !errors.Is(leaseErr, errWhatsAppMediaLeaseLost) {
		t.Fatalf("lease supervision = process:%v lease:%v", processErr, leaseErr)
	}
	mutex.Lock()
	defer mutex.Unlock()
	if active != 0 || maximum != 1 {
		t.Fatalf("provider concurrency after lease loss = active:%d max:%d", active, maximum)
	}
}

func TestWhatsAppMediaManualDownloadPolicy(t *testing.T) {
	for _, test := range []struct {
		name        string
		messageType string
		size        int64
		allowed     bool
	}{
		{name: "video at absolute limit", messageType: "video", size: whatsappMediaAbsoluteMaxBytes, allowed: true},
		{name: "document below limit", messageType: "document", size: 1024, allowed: true},
		{name: "oversized image", messageType: "image", size: whatsappMediaImageAutoMax + 1, allowed: true},
		{name: "unknown size", messageType: "audio", size: 0},
		{name: "above absolute limit", messageType: "video", size: whatsappMediaAbsoluteMaxBytes + 1},
		{name: "not media", messageType: "text", size: 1024},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := whatsappMediaManualDownloadAllowed(test.messageType, test.size); got != test.allowed {
				t.Fatalf("allowed = %v, want %v", got, test.allowed)
			}
		})
	}
}

func TestWhatsAppMediaQueueKeysDeduplicateNineteenSessions(t *testing.T) {
	const organizationID = "11111111-1111-1111-1111-111111111111"
	plaintextSHA256 := testWhatsAppMediaDigest("plain-sha256-shared-across-sessions")

	type result struct {
		jobKey   string
		assetKey string
	}
	results := make(chan result, 19)
	var group sync.WaitGroup
	for index := 0; index < 19; index++ {
		group.Add(1)
		go func(index int) {
			defer group.Done()
			message := testWhatsAppMediaQueueMessage(
				"provider-message-"+string(rune('a'+index)),
				plaintextSHA256,
				testWhatsAppMediaDigest("encrypted-sha256-that-varies-"+string(rune('a'+index))),
			)
			jobKey, assetKey, _, _ := whatsappMediaQueueKeys(
				organizationID,
				"22222222-2222-2222-2222-"+strings.Repeat(string(rune('a'+index)), 12),
				message,
			)
			results <- result{jobKey: jobKey, assetKey: assetKey}
		}(index)
	}
	group.Wait()
	close(results)

	jobKeys := map[string]struct{}{}
	assetKeys := map[string]struct{}{}
	for item := range results {
		jobKeys[item.jobKey] = struct{}{}
		assetKeys[item.assetKey] = struct{}{}
	}
	if len(jobKeys) != 19 {
		t.Fatalf("job dedupe keys = %d, want one durable job per session/message", len(jobKeys))
	}
	if len(assetKeys) != 1 {
		t.Fatalf("asset keys = %d, want one organization-scoped stored asset", len(assetKeys))
	}
}

func TestWhatsAppMediaQueueKeysScopeAndHashFallback(t *testing.T) {
	message := testWhatsAppMediaQueueMessage(
		"provider-message",
		testWhatsAppMediaDigest("plain-sha"),
		testWhatsAppMediaDigest("encrypted-sha-a"),
	)
	_, firstAsset, _, _ := whatsappMediaQueueKeys("org-a", "session-a", message)

	message.Raw["message"].(map[string]any)["imageMessage"].(map[string]any)["fileEncSha256"] = testWhatsAppMediaDigest("encrypted-sha-b")
	_, samePlaintextAsset, _, _ := whatsappMediaQueueKeys("org-a", "session-b", message)
	if firstAsset != samePlaintextAsset {
		t.Fatal("encrypted hash variation defeated plaintext media deduplication")
	}

	_, foreignOrganizationAsset, _, _ := whatsappMediaQueueKeys("org-b", "session-b", message)
	if firstAsset == foreignOrganizationAsset {
		t.Fatal("asset key crossed organization scope")
	}

	fallback := testWhatsAppMediaQueueMessage("provider-message-fallback", "", testWhatsAppMediaDigest("encrypted-sha-shared"))
	_, fallbackA, _, _ := whatsappMediaQueueKeys("org-a", "session-a", fallback)
	_, fallbackB, _, _ := whatsappMediaQueueKeys("org-a", "session-b", fallback)
	if fallbackA != fallbackB {
		t.Fatal("encrypted digest fallback did not deduplicate the asset")
	}

	invalidDigests := testWhatsAppMediaQueueMessage("provider-message-invalid-digests", "not-a-sha", "also-not-a-sha")
	invalidJob, invalidAsset, _, _ := whatsappMediaQueueKeys("org-a", "session-a", invalidDigests)
	if invalidAsset != invalidJob {
		t.Fatal("invalid untrusted digest metadata was used as a shared asset key")
	}

	withoutHash := testWhatsAppMediaQueueMessage("provider-message-no-hash", "", "")
	jobA, assetA, _, _ := whatsappMediaQueueKeys("org-a", "session-a", withoutHash)
	jobB, assetB, _, _ := whatsappMediaQueueKeys("org-a", "session-b", withoutHash)
	if assetA != jobA || assetB != jobB || assetA == assetB {
		t.Fatal("hashless media must stay isolated by its per-message job key")
	}
}

func TestWhatsAppMediaRetryBackoff(t *testing.T) {
	for attempt, want := range map[int]time.Duration{
		1: 30 * time.Second,
		2: 2 * time.Minute,
		3: 10 * time.Minute,
	} {
		if got := whatsappMediaRetryDelay(attempt); got != want {
			t.Fatalf("attempt %d delay = %s, want %s", attempt, got, want)
		}
	}
}

func TestWhatsAppMediaQueueSourceContracts(t *testing.T) {
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime caller unavailable")
	}
	whatsappDir := filepath.Dir(sourceFile)
	processor := mustReadWhatsAppMediaContractFile(t, filepath.Join(whatsappDir, "webhook_native_processor.go"))
	if !strings.Contains(processor, "enqueueNativeEvolutionMediaJob(ctx, tx") {
		t.Fatal("native webhook does not enqueue media in its canonical transaction")
	}
	if strings.Contains(processor, "prepareNativeEvolutionMedia(") {
		t.Fatal("native webhook still performs the legacy synchronous media preparation")
	}

	retry := mustReadWhatsAppMediaContractFile(t, filepath.Join(whatsappDir, "media_retry_operations.go"))
	if !strings.Contains(retry, "enqueueManualWhatsAppMediaJob(ctx, message)") {
		t.Fatal("manual retry does not enqueue the global media worker")
	}
	if strings.Contains(retry, "media, err := repo.recoverWhatsAppMedia(ctx, message)") {
		t.Fatal("manual retry still downloads media inline")
	}
	queue := mustReadWhatsAppMediaContractFile(t, filepath.Join(whatsappDir, "media_queue.go"))
	for _, required := range []string{
		"whatsappMediaSessionCanDownload(ctx, job)",
		"markWhatsAppMediaProviderStarted(ctx, job)",
		"if code == mediaErrorOutcomeUnknown",
		"pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:global-claim', 0))",
		"storage upload outcome is unknown",
		"storage upload succeeded but database completion is unknown",
		"and media_jobs.provider_started_at is null",
		"and media_jobs.error_code is distinct from 'media_provider_outcome_unknown'",
		"and candidate.error_code is distinct from 'media_provider_outcome_unknown'",
		"and asset_key = $4",
	} {
		if !strings.Contains(queue, required) {
			t.Fatalf("media queue implementation is missing %q", required)
		}
	}

	migration := mustReadWhatsAppMediaContractFile(t, filepath.Join(
		whatsappDir, "..", "..", "..", "..", "supabase", "migrations", "20260904225214_harden_whatsapp_media_queue.sql",
	))
	for _, required := range []string{
		"for update skip locked",
		"media_jobs_one_global_processing_uidx",
		"where status = 'processing'",
		"security definer",
		"alter table public.media_jobs enable row level security",
		"revoke all on table public.media_jobs from public, anon, authenticated, service_role",
		"private.claim_whatsapp_media_job",
		"private.claim_whatsapp_media_job(text, interval, uuid[])",
		"private.renew_whatsapp_media_job",
		"lease_expires_at = now() + p_lease",
		"lease_expires_at = now() + lease_duration",
		"provider_started_at",
		"private.whatsapp_media_worker_state",
		"media_provider_outcome_unknown",
		"media_legacy_job_retired",
		"media_jobs_org_message_canonical_uidx",
		"media_jobs_asset_active_idx",
		"declared_size is null or declared_size > 0",
	} {
		if !strings.Contains(strings.ToLower(migration), strings.ToLower(required)) {
			t.Fatalf("media queue migration is missing %q", required)
		}
	}
	for _, forbidden := range []string{
		"grant insert on table public.media_jobs to service_role",
		"grant select on table public.media_jobs to service_role",
		"grant update on table public.media_jobs to service_role",
		"grant delete on table public.media_jobs to service_role",
	} {
		if strings.Contains(strings.ToLower(migration), forbidden) {
			t.Fatalf("legacy Edge worker privilege was restored by %q", forbidden)
		}
	}
}

type whatsappMediaRepeatingReader struct{}

func (whatsappMediaRepeatingReader) Read(payload []byte) (int, error) {
	for index := range payload {
		payload[index] = 'x'
	}
	return len(payload), nil
}

func testWhatsAppMediaQueueMessage(providerMessageID string, fileSHA256 string, fileEncSHA256 string) nativeEvolutionMessage {
	return nativeEvolutionMessage{
		ProviderMessageID: providerMessageID,
		MessageType:       "image",
		MediaMimeType:     "image/png",
		MediaSize:         1024,
		Raw: map[string]any{
			"message": map[string]any{
				"imageMessage": map[string]any{
					"directPath":    "/media/path",
					"fileLength":    1024,
					"fileSha256":    fileSHA256,
					"fileEncSha256": fileEncSHA256,
				},
			},
		},
	}
}

func testWhatsAppMediaDigest(seed string) string {
	digest := sha256.Sum256([]byte(seed))
	return base64.StdEncoding.EncodeToString(digest[:])
}

func mustReadWhatsAppMediaContractFile(t *testing.T, path string) string {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}
