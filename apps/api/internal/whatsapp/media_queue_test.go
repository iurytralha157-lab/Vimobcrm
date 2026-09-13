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
		{name: "unknown audio size streams under hard cap", messageType: "audio", size: 0, automatic: true},
		{name: "unknown image size streams under hard cap", messageType: "image", mimeType: "image/jpeg", size: 0, automatic: true},
		{name: "negative size", messageType: "image", size: -1, errorCode: mediaErrorUnknownSize},
		{name: "image at limit", messageType: "image", size: whatsappMediaImageAutoMax, automatic: true},
		{name: "image above limit", messageType: "image", size: whatsappMediaImageAutoMax + 1, errorCode: mediaErrorTooLarge},
		{name: "audio at limit", messageType: "audio", size: whatsappMediaAudioAutoMax, automatic: true},
		{name: "audio codecs normalized", messageType: "audio", mimeType: "audio/ogg; codecs=opus", size: 1024, automatic: true},
		{name: "audio declared as video", messageType: "audio", mimeType: "video/mp4", size: 1024, errorCode: mediaErrorManualOnly},
		{name: "audio above absolute limit", messageType: "audio", size: whatsappMediaAudioAutoMax + 1, errorCode: mediaErrorTooLarge},
		{name: "sticker at limit", messageType: "sticker", size: whatsappMediaStickerAutoMax, automatic: true},
		{name: "sticker above limit", messageType: "sticker", size: whatsappMediaStickerAutoMax + 1, errorCode: mediaErrorTooLarge},
		{name: "video at limit", messageType: "video", mimeType: "video/mp4", size: whatsappMediaVideoAutoMax, automatic: true},
		{name: "video above limit", messageType: "video", mimeType: "video/mp4", size: whatsappMediaVideoAutoMax + 1, errorCode: mediaErrorTooLarge},
		{name: "video declared as image", messageType: "video", mimeType: "image/jpeg", size: 1024, errorCode: mediaErrorManualOnly},
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

func TestWhatsAppMediaWakeBroadcastsToConfiguredWorkers(t *testing.T) {
	for {
		select {
		case <-whatsappMediaWorkerWake:
			continue
		default:
			goto drained
		}
	}

drained:
	previous := whatsappMediaWorkerCount.Swap(3)
	defer whatsappMediaWorkerCount.Store(previous)
	defer func() {
		for {
			select {
			case <-whatsappMediaWorkerWake:
				continue
			default:
				return
			}
		}
	}()

	wakeWhatsAppMediaWorker()
	for worker := 0; worker < 3; worker++ {
		select {
		case <-whatsappMediaWorkerWake:
		default:
			t.Fatalf("configured media worker %d was not woken", worker+1)
		}
	}
	select {
	case <-whatsappMediaWorkerWake:
		t.Fatal("media wake emitted more signals than configured workers")
	default:
	}
}

func TestWhatsAppMediaMetricsExposePerTypeQueueAndProcessingSLO(t *testing.T) {
	_ = snapshotWhatsAppMediaTypeMetrics("video")
	t.Cleanup(func() { _ = snapshotWhatsAppMediaTypeMetrics("video") })

	now := time.Date(2026, time.September, 12, 12, 0, 0, 0, time.UTC)
	recordWhatsAppMediaClaim(queuedWhatsAppMediaJob{
		MediaType: "video",
		CreatedAt: now.Add(-1500 * time.Millisecond),
	}, now)
	recordWhatsAppMediaOutcome("video", true, 250*time.Millisecond)

	metrics := snapshotWhatsAppMediaTypeMetrics("video")
	if metrics.Claimed != 1 || metrics.Completed != 1 || metrics.Failed != 0 {
		t.Fatalf("video metrics = %#v, want one claimed and completed job", metrics)
	}
	if metrics.MaxQueueAgeMillis != 1500 || metrics.MaxProcessingMillis != 250 {
		t.Fatalf("video SLO metrics = %#v, want queue=1500ms processing=250ms", metrics)
	}
	for _, test := range []struct {
		messageType string
		processing  time.Duration
	}{
		{messageType: "image", processing: 30 * time.Second},
		{messageType: "audio", processing: 45 * time.Second},
		{messageType: "video", processing: 2 * time.Minute},
	} {
		queueSLO, processingSLO := whatsappMediaSLO(test.messageType)
		if queueSLO != 30*time.Second || processingSLO != test.processing {
			t.Fatalf("%s SLO = queue %s processing %s", test.messageType, queueSLO, processingSLO)
		}
	}
}

func TestWhatsAppMediaWorkerRequiresNativeRolloutScope(t *testing.T) {
	for _, test := range []struct {
		name      string
		mode      string
		allowlist []string
		want      bool
	}{
		{name: "edge wildcard", mode: webhookProcessorEdge, allowlist: []string{"*"}},
		{name: "native without rollout scope", mode: webhookProcessorNative},
		{name: "native fallback partial", mode: webhookProcessorNativeFallback, allowlist: []string{"session-a"}, want: true},
		{name: "native wildcard", mode: webhookProcessorNative, allowlist: []string{"*"}, want: true},
		{name: "native fallback wildcard", mode: webhookProcessorNativeFallback, allowlist: []string{"*"}, want: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := whatsappMediaWorkerCanStart(functionsClient{
				webhookProcessorMode:     test.mode,
				webhookRolloutSessionIDs: test.allowlist,
			})
			if got != test.want {
				t.Fatalf("native rollout ownership = %v, want %v", got, test.want)
			}
		})
	}
	if DefaultWorkerConfig().MediaWorkerEnabled {
		t.Fatal("media worker must remain fail-closed until the operator enables a native rollout scope")
	}
	if got := DefaultWorkerConfig().MediaWorkerConcurrency; got != 4 {
		t.Fatalf("default media concurrency = %d, want 4", got)
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

func TestWhatsAppMediaRecoverySourceTrust(t *testing.T) {
	repo := Repository{
		functions: functionsClient{evolutionGoAPIURL: "https://evolution.example.invalid"},
		storage:   storageClient{projectURL: "https://project.supabase.example.invalid"},
	}
	encrypted := nativeEvolutionMessage{
		MediaURL: "https://project.supabase.example.invalid/direct/audio.enc",
		Raw: map[string]any{
			"message": map[string]any{
				"audioMessage": map[string]any{
					"url":           "https://mmg.whatsapp.net/v/t62/audio.enc",
					"directPath":    "/v/t62/audio.enc",
					"mediaKey":      "provider-media-key",
					"fileSha256":    testWhatsAppMediaDigest("plaintext"),
					"fileEncSha256": testWhatsAppMediaDigest("ciphertext"),
				},
			},
		},
	}
	if !whatsappMediaRequiresProviderDecryption(encrypted) {
		t.Fatal("encrypted WhatsApp media block was not routed through message.downloadMedia")
	}
	if repo.whatsappMediaURLIsDemonstrablyPlaintext(encrypted.MediaURL) {
		t.Fatal(".enc URL was accepted as demonstrably plaintext")
	}

	plainURL := "https://project.supabase.example.invalid/storage/v1/object/sign/whatsapp-media/audio.ogg?token=test"
	plain := nativeEvolutionMessage{MediaURL: plainURL, Raw: map[string]any{}}
	if whatsappMediaRequiresProviderDecryption(plain) {
		t.Fatal("plain private Storage URL was classified as encrypted provider media")
	}
	if !repo.whatsappMediaURLIsDemonstrablyPlaintext(plainURL) {
		t.Fatal("configured private Storage URL was not accepted as a plaintext candidate")
	}
	if repo.whatsappMediaURLIsDemonstrablyPlaintext("https://mmg.whatsapp.net/v/t62/audio.ogg") {
		t.Fatal("unverified WhatsApp CDN URL was accepted as plaintext")
	}
}

func TestValidateRecoveredWhatsAppMediaRejectsEncryptedOrUnverifiableAudio(t *testing.T) {
	ogg := append([]byte("OggS"), make([]byte, 60)...)
	plainDigest := sha256.Sum256(ogg)
	job := queuedWhatsAppMediaJob{
		MediaType:     "audio",
		MediaMimeType: "audio/ogg; codecs=opus",
		DeclaredSize:  int64(len(ogg)),
		FileSHA256:    base64.StdEncoding.EncodeToString(plainDigest[:]),
	}
	detected, contentType, err := validateRecoveredWhatsAppMedia(job, recoveredWhatsAppMedia{
		bytes:       ogg,
		contentType: "application/octet-stream",
	})
	if err != nil {
		t.Fatalf("valid Ogg/Opus media was rejected: %v", err)
	}
	if detected != "application/ogg" || contentType != "audio/ogg" {
		t.Fatalf("Ogg MIME = detected:%q effective:%q, want application/ogg/audio/ogg", detected, contentType)
	}

	ciphertext := []byte("encrypted WhatsApp bytes that are not an Ogg container...........")
	cipherDigest := sha256.Sum256(ciphertext)
	encryptedJob := job
	encryptedJob.DeclaredSize = int64(len(ciphertext))
	encryptedJob.FileEncSHA256 = base64.StdEncoding.EncodeToString(cipherDigest[:])
	if _, _, err := validateRecoveredWhatsAppMedia(encryptedJob, recoveredWhatsAppMedia{bytes: ciphertext}); err == nil ||
		!strings.Contains(err.Error(), "encrypted WhatsApp media digest") {
		t.Fatalf("ciphertext validation error = %v, want encrypted digest rejection", err)
	}

	unknown := []byte("opaque bytes with a valid plaintext digest but no audio signature")
	unknownDigest := sha256.Sum256(unknown)
	unknownJob := job
	unknownJob.DeclaredSize = int64(len(unknown))
	unknownJob.FileSHA256 = base64.StdEncoding.EncodeToString(unknownDigest[:])
	if _, _, err := validateRecoveredWhatsAppMedia(unknownJob, recoveredWhatsAppMedia{bytes: unknown}); err == nil {
		t.Fatal("opaque bytes passed audio MIME/container validation")
	}

	sizeJob := job
	sizeJob.DeclaredSize++
	if _, _, err := validateRecoveredWhatsAppMedia(sizeJob, recoveredWhatsAppMedia{bytes: ogg}); err == nil ||
		!strings.Contains(err.Error(), "differs from declared size") {
		t.Fatalf("size validation error = %v, want declared-size rejection", err)
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
	if code != mediaErrorOutcomeUnknown || permanent {
		t.Fatalf("unknown read outcome classification = code:%q permanent:%v, want retryable", code, permanent)
	}
}

func TestEvolutionMediaRecoveryUsesDedicatedTimeoutAndKnownRejections(t *testing.T) {
	if got := evolutionRequestTimeout("message.downloadMedia"); got != evolutionMediaRecoveryTimeout || got <= 90*time.Second {
		t.Fatalf("download-media timeout = %s, want dedicated timeout above 90s", got)
	}
	if !evolutionActionMayRemainInFlight("message.downloadMedia") ||
		!evolutionActionMayRemainInFlight("message.downloadImage") ||
		evolutionActionMayRemainInFlight("instance.status") {
		t.Fatal("media transport ambiguity must be scoped to the two fixed provider download actions")
	}
	if got := evolutionRequestTimeout("instance.status"); got != 0 {
		t.Fatalf("ordinary Evolution timeout override = %s, want global client behavior", got)
	}
	imageResponseLimit := evolutionMediaResponseMaxBytes(whatsappMediaImageAutoMax)
	absoluteResponseLimit := evolutionMediaResponseMaxBytes(whatsappMediaAbsoluteMaxBytes)
	if imageResponseLimit <= whatsappMediaImageAutoMax || imageResponseLimit >= absoluteResponseLimit {
		t.Fatalf("typed provider response limits = image:%d absolute:%d", imageResponseLimit, absoluteResponseLimit)
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
	canceledContext, cancelCanceledContext := context.WithCancel(context.Background())
	cancelCanceledContext()
	_, err := client.evolutionFetch(canceledContext, http.MethodPost, "/media", evolutionFetchOptions{
		Body:                     map[string]any{"message": "fixture"},
		OutcomeMayRemainInFlight: true,
	})
	if !errors.Is(err, ErrProviderOutcomeUnknown) {
		t.Fatalf("canceled provider media transport = %v, want outcome-unknown quarantine marker", err)
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

func TestWhatsAppMediaDisconnectedDeferralPreservesAttemptBoundary(t *testing.T) {
	tests := []struct {
		name            string
		err             error
		wantDeferred    bool
		wantProviderRun bool
	}{
		{
			name:         "session dropped before provider marker",
			err:          fmt.Errorf("wrapped: %w", errWhatsAppMediaSessionDisconnected),
			wantDeferred: true,
		},
		{
			name:            "provider definitively reported disconnected",
			err:             fmt.Errorf("wrapped: %w", errWhatsAppMediaProviderDisconnected),
			wantDeferred:    true,
			wantProviderRun: true,
		},
		{
			name: "ordinary provider failure spends its bounded attempt",
			err:  fmt.Errorf("wrapped: %w", ErrProviderFailed),
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			deferred, providerStarted := whatsappMediaDisconnectedDeferral(test.err)
			if deferred != test.wantDeferred || providerStarted != test.wantProviderRun {
				t.Fatalf(
					"disconnected deferral = deferred:%v provider-started:%v, want %v/%v",
					deferred,
					providerStarted,
					test.wantDeferred,
					test.wantProviderRun,
				)
			}
		})
	}

	for _, test := range []struct {
		message string
		want    bool
	}{
		{message: "provider failed: client disconnected", want: true},
		{message: `provider failed: {"error":"client is disconnected"}`, want: true},
		{message: "provider failed: not connected", want: true},
		{message: "provider failed: logged out", want: true},
		{message: "provider failed: client is not disconnected", want: false},
		{message: "provider temporarily unavailable", want: false},
	} {
		if got := isWhatsAppMediaProviderDisconnected(errors.New(test.message)); got != test.want {
			t.Errorf("provider disconnect %q = %v, want %v", test.message, got, test.want)
		}
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

func TestWhatsAppMediaAmbiguousOutcomeWinsOverDisconnectedText(t *testing.T) {
	err := normalizeWhatsAppMediaProviderRecoveryError(fmt.Errorf(
		"%w: upstream 504: client disconnected",
		ErrProviderOutcomeUnknown,
	))
	if !errors.Is(err, errWhatsAppMediaProviderInFlight) {
		t.Fatalf("ambiguous disconnected response = %v, want provider in-flight fence", err)
	}
	if errors.Is(err, errWhatsAppMediaProviderDisconnected) {
		t.Fatalf("ambiguous disconnected response was downgraded to definitive disconnect: %v", err)
	}
	if deferred, _ := whatsappMediaDisconnectedDeferral(err); deferred {
		t.Fatal("ambiguous provider work can be released by the reconnect path")
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
		{name: "unknown size streams under hard cap", messageType: "audio", size: 0, allowed: true},
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

func TestWhatsAppMediaUploadedAssetFinalizationRemainsRetryable(t *testing.T) {
	source := mustReadWhatsAppMediaSource(t)
	for _, required := range []string{
		"if job.StoragePath != \"\" && job.ActualSize > 0",
		"repairStoragePath == \"\" || job.StoragePath != repairStoragePath",
		"whatsappMediaUploadIntent(job, repairStoragePath)",
		"repo.storage.objectExists(ctx, whatsappMediaBucket, intent.storagePath)",
		"repo.markWhatsAppMediaUploadIntent(ctx, job, asset)",
		"errWhatsAppMediaLocalStagePending",
		"repo.deferWhatsAppMediaLocalStage(ctx, job)",
		"errWhatsAppMediaLocalFinalizePending",
		"repo.markWhatsAppMediaStorageUploaded(ctx, job, ready)",
		"repo.deferWhatsAppMediaLocalFinalization(ctx, job)",
		"The upload is already durably recorded on the leased job",
		"next_retry_at = now() + interval '15 seconds'",
		"attempts = greatest(attempts - 1, 0)",
		"storage_path is not null",
		"actual_size > 0",
		"message_key = '{}'::jsonb",
		"message_key = jsonb_strip_nulls(jsonb_build_object(",
		"message_key->$7::text",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("durable upload finalization contract is missing %q", required)
		}
	}
}

func TestWhatsAppMediaUploadIntentIsDeterministicAndTenantScoped(t *testing.T) {
	job := queuedWhatsAppMediaJob{
		OrganizationID: "20000000-0000-0000-0000-000000000001",
		MessageID:      "30000000-0000-0000-0000-000000000001",
		MediaType:      "image",
		DeclaredSize:   68,
		AssetKey:       "sha256:fixture",
	}
	path := whatsappMediaObjectPath(job, "image/png", "")
	job.MessageKey = map[string]any{
		whatsappMediaUploadPathKey: path,
		whatsappMediaUploadMIMEKey: "image/png",
		whatsappMediaUploadSizeKey: float64(68),
	}
	asset, found, err := whatsappMediaUploadIntent(job, "")
	if err != nil || !found {
		t.Fatalf("valid upload intent = (%#v, %v, %v)", asset, found, err)
	}
	if asset.storagePath != path || asset.contentType != "image/png" || asset.actualSize != 68 {
		t.Fatalf("parsed upload intent = %#v", asset)
	}

	job.MessageKey[whatsappMediaUploadPathKey] = "orgs/20000000-0000-0000-0000-000000000002/assets/v2/foreign.png"
	if _, _, err := whatsappMediaUploadIntent(job, ""); !errors.Is(err, ErrProviderFailed) {
		t.Fatalf("foreign upload intent error = %v, want ErrProviderFailed", err)
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

func TestWhatsAppMediaCompletionLeaseFenceRejectsStaleOutcomes(t *testing.T) {
	job := queuedWhatsAppMediaJob{
		ID:         "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		LockedBy:   "worker-current",
		LeaseToken: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
	}
	for _, test := range []struct {
		name       string
		candidate  string
		status     string
		lockedBy   string
		leaseToken string
		want       bool
	}{
		{
			name:       "current lease",
			candidate:  job.ID,
			status:     "processing",
			lockedBy:   job.LockedBy,
			leaseToken: strings.ToUpper(job.LeaseToken),
			want:       true,
		},
		{name: "different job", candidate: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", status: "processing", lockedBy: job.LockedBy, leaseToken: job.LeaseToken},
		{name: "completed by asset peer", candidate: job.ID, status: "completed", lockedBy: job.LockedBy, leaseToken: job.LeaseToken},
		{name: "reclaimed by worker", candidate: job.ID, status: "processing", lockedBy: "worker-new", leaseToken: job.LeaseToken},
		{name: "renewed lease identity", candidate: job.ID, status: "processing", lockedBy: job.LockedBy, leaseToken: "dddddddd-dddd-4ddd-8ddd-dddddddddddd"},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := whatsappMediaCompletionLeaseMatches(job, test.candidate, test.status, test.lockedBy, test.leaseToken)
			if got != test.want {
				t.Fatalf("lease match = %v, want %v", got, test.want)
			}
		})
	}
}

func TestWhatsAppMediaCompletionLockIDsAreDeterministic(t *testing.T) {
	input := []string{
		"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
		"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
		" ",
		"cccccccc-cccc-4ccc-8ccc-cccccccccccc",
	}
	want := strings.Join([]string{
		"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
		"cccccccc-cccc-4ccc-8ccc-cccccccccccc",
	}, ",")

	start := make(chan struct{})
	results := make(chan string, 64)
	var workers sync.WaitGroup
	for range 64 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			results <- strings.Join(sortedUniqueWhatsAppMediaRowIDs(input), ",")
		}()
	}
	close(start)
	workers.Wait()
	close(results)
	for got := range results {
		if got != want {
			t.Fatalf("sorted completion lock IDs = %q, want %q", got, want)
		}
	}
}

func TestWhatsAppMediaCompletionCandidatesBoundDuplicateFanout(t *testing.T) {
	const ownJobID = "ffffffff-ffff-4fff-8fff-ffffffffffff"
	values := make([]whatsappMediaCompletionCandidate, 0, 152)
	for index := 149; index >= 0; index-- {
		values = append(values, whatsappMediaCompletionCandidate{
			jobID:     fmt.Sprintf("%08x-0000-4000-8000-%012x", index, index),
			messageID: fmt.Sprintf("%08x-1111-4111-8111-%012x", index, index),
		})
	}
	// The owner sorts after every duplicate and must still survive the cap.
	values = append(values,
		whatsappMediaCompletionCandidate{jobID: ownJobID, messageID: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"},
		whatsappMediaCompletionCandidate{jobID: ownJobID, messageID: "dddddddd-dddd-4ddd-8ddd-dddddddddddd"},
	)

	bounded, ownIncluded := boundWhatsAppMediaCompletionCandidates(ownJobID, values)
	if !ownIncluded {
		t.Fatal("completion owner was dropped from a batch with more than 100 asset duplicates")
	}
	if got := len(bounded.jobIDs); got != whatsappMediaCompletionMaxJobs {
		t.Fatalf("bounded completion jobs = %d, want %d", got, whatsappMediaCompletionMaxJobs)
	}
	if got := len(bounded.messageIDs); got != whatsappMediaCompletionMaxJobs {
		t.Fatalf("bounded completion messages = %d, want %d", got, whatsappMediaCompletionMaxJobs)
	}
	if bounded.jobIDs[len(bounded.jobIDs)-1] != ownJobID {
		t.Fatalf("bounded jobs do not include owner %q: %#v", ownJobID, bounded.jobIDs)
	}
	lastDuplicateIncluded := fmt.Sprintf("%08x-0000-4000-8000-%012x", 98, 98)
	firstDeferredDuplicate := fmt.Sprintf("%08x-0000-4000-8000-%012x", 99, 99)
	if !containsString(bounded.jobIDs, lastDuplicateIncluded) {
		t.Fatalf("deterministic 99th duplicate %q was not included", lastDuplicateIncluded)
	}
	if containsString(bounded.jobIDs, firstDeferredDuplicate) {
		t.Fatalf("101st total candidate %q escaped the transaction bound", firstDeferredDuplicate)
	}
	if _, found := boundWhatsAppMediaCompletionCandidates("missing-owner", values); found {
		t.Fatal("completion proceeded without its lease-owning job")
	}
}

func TestWhatsAppMediaMutationsUseCanonicalMessageThenJobLockOrder(t *testing.T) {
	source := mustReadWhatsAppMediaSource(t)
	functionSource := func(name string, next string) string {
		t.Helper()
		start := strings.Index(source, name)
		if start < 0 {
			t.Fatalf("media queue source is missing %q", name)
		}
		end := len(source)
		if next != "" {
			relativeEnd := strings.Index(source[start+len(name):], next)
			if relativeEnd < 0 {
				t.Fatalf("media queue source is missing boundary %q after %q", next, name)
			}
			end = start + len(name) + relativeEnd
		}
		return strings.Join(strings.Fields(strings.ToLower(source[start:end])), " ")
	}
	assertOrdered := func(section string, fragments ...string) {
		t.Helper()
		position := -1
		for _, fragment := range fragments {
			searchFrom := position + 1
			relativePosition := strings.Index(section[searchFrom:], strings.ToLower(fragment))
			if relativePosition < 0 {
				t.Fatalf("lock-order contract is missing %q", fragment)
			}
			nextPosition := searchFrom + relativePosition
			position = nextPosition
		}
	}

	messageLocks := functionSource(
		"func lockWhatsAppMediaCompletionMessages(",
		"func lockWhatsAppMediaCompletionJobs(",
	)
	for _, required := range []string{
		"from public.whatsapp_messages as message",
		"message.id = any($2::uuid[])",
		"order by message.id for update of message",
	} {
		if !strings.Contains(messageLocks, strings.ToLower(required)) {
			t.Fatalf("message lock helper is missing %q", required)
		}
	}
	jobLocks := functionSource(
		"func lockWhatsAppMediaCompletionJobs(",
		"func revalidateWhatsAppMediaCompletionCandidates(",
	)
	for _, required := range []string{
		"from public.media_jobs as job",
		"job.id = any($2::uuid[])",
		"order by job.id for update of job",
	} {
		if !strings.Contains(jobLocks, strings.ToLower(required)) {
			t.Fatalf("job lock helper is missing %q", required)
		}
	}
	derivation := functionSource(
		"func deriveWhatsAppMediaCompletionCandidates(",
		"func lockWhatsAppMediaCompletionMessages(",
	)
	for _, required := range []string{
		"with own_job as",
		"candidate.id = $3::uuid",
		"candidate.id <> $3::uuid",
		"candidate.status = 'pending'",
		"candidate.error_code, '') = $6",
		"order by candidate.id limit $5",
		"repair_siblings as",
		"candidate.status = 'completed'",
		"candidate.storage_path = $7",
		"select own_job.id, own_job.message_id, own_job.repair_sibling from own_job union all",
		"whatsappmediacompletionmaxjobs-1",
		"boundwhatsappmediacompletioncandidates(job.id, values)",
		"if !ownjobincluded",
	} {
		if !strings.Contains(derivation, strings.ToLower(required)) {
			t.Fatalf("bounded completion derivation is missing %q", required)
		}
	}
	if strings.Contains(derivation, "candidate.status in ('pending', 'processing')") {
		t.Fatal("asset completion derivation can still adopt a foreign processing lease")
	}

	completion := functionSource(
		"func (repo Repository) completeWhatsAppMediaJob(",
		"func (repo Repository) retryOrFailWhatsAppMediaJob(",
	)
	assertOrdered(
		completion,
		"deriveWhatsAppMediaCompletionCandidates(ctx, tx, job)",
		"lockWhatsAppMediaCompletionMessages(ctx, tx",
		"lockWhatsAppMediaCompletionJobs(ctx, tx",
		"revalidateWhatsAppMediaCompletionCandidates(ctx, tx",
		"update public.whatsapp_messages",
		"update public.media_jobs",
	)
	for _, forbidden := range []string{
		"select id::text from public.media_jobs where id = $1::uuid",
		"select candidate.message_id from public.media_jobs",
	} {
		if strings.Contains(completion, forbidden) {
			t.Fatalf("completion reacquired the inverted or unbounded lock path %q", forbidden)
		}
	}
	revalidation := functionSource(
		"func revalidateWhatsAppMediaCompletionCandidates(",
		"func (repo Repository) completeWhatsAppMediaJob(",
	)
	for _, required := range []string{
		"candidate.id = any($3::uuid[])",
		"candidate.asset_key = $2",
		"candidate.id = $5::uuid",
		"candidate.id <> $5::uuid",
		"candidate.locked_by = $6",
		"candidate.lease_token = $7::uuid",
		"whatsappmediacompletionleasematches(job, candidateid, status, lockedby, leasetoken)",
		"if !leasestillowned",
		"return whatsappmediacompletioncandidates{}, errwhatsappmedialeaselost",
	} {
		if !strings.Contains(revalidation, strings.ToLower(required)) {
			t.Fatalf("post-lock completion revalidation is missing %q", required)
		}
	}
	if strings.Contains(revalidation, "candidate.status in ('pending', 'processing')") {
		t.Fatal("post-lock revalidation can still adopt a foreign processing lease")
	}

	retry := functionSource(
		"func (repo Repository) retryOrFailWhatsAppMediaJob(",
		"func whatsappMediaRetryDelay(",
	)
	assertOrdered(
		retry,
		"from public.whatsapp_messages as message",
		"for update of message",
		"update public.media_jobs",
		"update public.whatsapp_messages",
	)
	for _, fence := range []string{
		"status = 'processing'",
		"locked_by = $2",
		"lease_token = $3::uuid",
		"command.rowsaffected() != 1",
	} {
		if !strings.Contains(retry, fence) {
			t.Fatalf("retry job update lost its lease fence %q", fence)
		}
	}

	disconnectedRelease := functionSource(
		"func (repo Repository) deferWhatsAppMediaJobDisconnected(",
		"func (repo Repository) retryOrFailWhatsAppMediaJob(",
	)
	assertOrdered(
		disconnectedRelease,
		"from public.whatsapp_messages as message",
		"for update of message",
		"update public.media_jobs",
		"update public.whatsapp_messages",
	)
	for _, required := range []string{
		"attempts = greatest(attempts - 1, 0)",
		"status = 'processing'",
		"locked_by = $2",
		"lease_token = $3::uuid",
		"provider_started_at is null",
		"command.rowsaffected() != 1",
	} {
		if !strings.Contains(disconnectedRelease, required) {
			t.Fatalf("disconnected media release lost its no-attempt fence %q", required)
		}
	}

	manualRetry := functionSource(
		"func (repo Repository) enqueueManualWhatsAppMediaJob(",
		"func enqueueNativeEvolutionMediaJob(",
	)
	assertOrdered(
		manualRetry,
		"pg_advisory_xact_lock",
		"from public.whatsapp_messages as target",
		"for update of target",
		"from public.media_jobs",
		"for update",
	)
	for _, required := range []string{
		"storage_path like 'orgs/' || organization_id::text || '/assets/v2/%'",
		"then actual_size else null end",
		"then storage_path else null end",
	} {
		if !strings.Contains(manualRetry, required) {
			t.Fatalf("manual retry can erase durable local media state; missing %q", required)
		}
	}
}

func TestWhatsAppMediaCanaryScopeCanonicalizesUUIDText(t *testing.T) {
	client := newFunctionsClient(StorageConfig{EvolutionGo: EvolutionGoConfig{
		WebhookRolloutSessionIDs: []string{"13EEA7E8-A74F-4BFB-BB36-024E3D26CCC9"},
	}}, nil)
	if len(client.webhookRolloutSessionIDs) != 1 || client.webhookRolloutSessionIDs[0] != "13eea7e8-a74f-4bfb-bb36-024e3d26ccc9" {
		t.Fatalf("canonical media canary scope = %#v", client.webhookRolloutSessionIDs)
	}
}

func TestWhatsAppMediaClaimScopeUsesTypedUUIDsAndExplicitGlobalFlag(t *testing.T) {
	ids, all, err := whatsappMediaClaimScope([]string{
		"13EEA7E8-A74F-4BFB-BB36-024E3D26CCC9",
		"13eea7e8-a74f-4bfb-bb36-024e3d26ccc9",
	})
	if err != nil || all || len(ids) != 1 || ids[0].String() != "13eea7e8-a74f-4bfb-bb36-024e3d26ccc9" {
		t.Fatalf("typed canary scope = ids:%#v all:%v error:%v", ids, all, err)
	}
	ids, all, err = whatsappMediaClaimScope([]string{"*"})
	if err != nil || !all || len(ids) != 0 {
		t.Fatalf("global media scope = ids:%#v all:%v error:%v", ids, all, err)
	}
	if _, _, err := whatsappMediaClaimScope([]string{"*", "13eea7e8-a74f-4bfb-bb36-024e3d26ccc9"}); err == nil {
		t.Fatal("mixed global and canary media scope was accepted")
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
	for _, required := range []string{
		"isAuthoritativeEvolutionStatusDisconnect(message)",
		"errWhatsAppMediaProviderDisconnected",
	} {
		if !strings.Contains(processor, required) {
			t.Fatalf("native provider media rejection is missing %q", required)
		}
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
		"deferWhatsAppMediaJobDisconnected(ctx, job, providerStarted)",
		"attempts = greatest(attempts - 1, 0)",
		"provider_started_at is null",
		"provider_started_at is not null",
		"markWhatsAppMediaStorageUploaded(ctx, job",
		"claimWhatsAppMediaJobForSessions",
		"processing_slot = null",
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
		"grant insert on table public.media_jobs to service_role",
		"private.claim_whatsapp_media_job",
		"private.renew_whatsapp_media_job",
		"lease_expires_at = now() + p_lease",
		"lease_expires_at = now() + lease_duration",
		"provider_started_at",
		"private.whatsapp_media_worker_state",
		"media_provider_outcome_unknown",
		"supabase/cutovers/20260909_prepare_whatsapp_media_queue.sql",
	} {
		if !strings.Contains(strings.ToLower(migration), strings.ToLower(required)) {
			t.Fatalf("media queue migration is missing %q", required)
		}
	}
	for _, forbidden := range []string{
		"grant select on table public.media_jobs to service_role",
		"grant update on table public.media_jobs to service_role",
		"grant delete on table public.media_jobs to service_role",
	} {
		if strings.Contains(strings.ToLower(migration), forbidden) {
			t.Fatalf("legacy Edge worker privilege was restored by %q", forbidden)
		}
	}
}

func TestWhatsAppMediaScaleMigrationBoundsConcurrencyWithoutGlobalStop(t *testing.T) {
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime caller unavailable")
	}
	whatsappDir := filepath.Dir(sourceFile)
	migration := strings.ToLower(mustReadWhatsAppMediaContractFile(t, filepath.Join(
		whatsappDir, "..", "..", "..", "..", "supabase", "migrations", "20260912152432_scale_whatsapp_media_queue_safely.sql",
	)))
	cutover := strings.ToLower(mustReadWhatsAppMediaContractFile(t, filepath.Join(
		whatsappDir, "..", "..", "..", "..", "supabase", "cutovers", "20260912_scale_whatsapp_media_queue.sql",
	)))
	validationCutover := strings.ToLower(mustReadWhatsAppMediaContractFile(t, filepath.Join(
		whatsappDir, "..", "..", "..", "..", "supabase", "cutovers", "20260912_validate_whatsapp_media_scale.sql",
	)))

	for _, required := range []string{
		"drop index public.media_jobs_one_global_processing_uidx",
		"media_jobs_processing_slot_uidx",
		"media_jobs_processing_session_uidx",
		"media_jobs_processing_asset_uidx",
		"media_jobs_pending_session_claim_idx",
		"media_jobs_pending_local_session_claim_idx",
		"media_jobs_pending_exhausted_idx",
		"p_max_concurrency not between 1 and 16",
		"p_session_ids uuid[]",
		"p_all_sessions boolean",
		"set plan_cache_mode = force_custom_plan",
		"session.id = any(p_session_ids)",
		"for update skip locked",
		"perform pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:slot-claim', 0))",
		"media_scale_breaker_preflight",
		"for update",
		"blocked by an open legacy breaker",
		"clear the breaker explicitly",
		"private.whatsapp_media_session_quarantine",
		"private.whatsapp_media_scale_cutover_state",
		"legacy_claim_disabled_at",
		"clock_timestamp() - interval '10 minutes'",
		"for v_candidate in",
		"job.lease_expires_at <= clock_timestamp()",
		"legacy_media_provider_outcome_unknown",
		"media_download_retry_scheduled",
		"force row level security",
		"revoke all on table private.whatsapp_media_session_quarantine",
		"stale_before_provider as materialized",
		"attempts = greatest(stale.attempts - 1, 0)",
		"poisoned_before_provider as materialized",
		"attempts = greatest(poisoned.attempts - 1, 0)",
		"poisoned.attempts >= poisoned.max_attempts",
		"poisoned.provider_started_at is null",
		"order by stale.id",
		"limit 100",
		"for update of message skip locked",
		"processing_slot = v_processing_slot",
		"provider_started_at = null",
		"now() + interval '10 minutes'",
		"media_local_finalization_pending",
		"media_local_stage_pending",
		"message_key->>'upload_intent_path'",
		"enforce_whatsapp_media_processing_slot",
		"where false",
		"revoke all on function private.claim_whatsapp_media_job(text, interval, integer, uuid[], boolean)",
		"revoke all on function private.claim_whatsapp_media_job(text, interval, integer, text[])",
	} {
		if !strings.Contains(migration, required) {
			t.Fatalf("scaled media migration is missing %q", required)
		}
	}
	if strings.Contains(migration, "set breaker_open = true") {
		t.Fatal("scaled media migration can still open a global permanent breaker")
	}
	if strings.Contains(migration, "set breaker_open = false") {
		t.Fatal("scaled media activation still clears an unresolved legacy breaker automatically")
	}
	if strings.Contains(migration, "job.session_id::text") || strings.Contains(migration, "stale.session_id::text") {
		t.Fatal("scaled media claim casts the indexed session UUID column to text")
	}
	if strings.Contains(migration, "validate constraint media_jobs_processing_slot_check") {
		t.Fatal("activation migration still validates the live media table inside its short transaction")
	}
	for _, forbidden := range []string{
		"where status <> 'processing'\n  and processing_slot is not null",
		"status <> 'processing' and processing_slot is not null",
	} {
		if strings.Contains(migration, forbidden) {
			t.Fatalf("media activation still scans every non-processing row via %q", forbidden)
		}
	}
	preflightPosition := strings.Index(migration, "do $media_scale_online_preflight$")
	triggerPosition := strings.Index(migration, "create trigger enforce_whatsapp_media_processing_slot")
	if preflightPosition < 0 || triggerPosition < 0 || preflightPosition >= triggerPosition {
		t.Fatal("live media index readiness must fail before the activation installs its table trigger")
	}
	recoveryStart := strings.Index(migration, "select coalesce(array_agg(candidate.job_id")
	recoveryEnd := strings.Index(migration, "select slot.slot::smallint")
	if recoveryStart < 0 || recoveryEnd < 0 || recoveryStart >= recoveryEnd {
		t.Fatal("media stale recovery source boundary is missing")
	}
	if strings.Contains(migration[recoveryStart:recoveryEnd], "p_session_ids") ||
		strings.Contains(migration[recoveryStart:recoveryEnd], "p_all_sessions") {
		t.Fatal("global processing slots cannot remain occupied by stale jobs outside the rollout claim scope")
	}
	scaleLock := strings.Index(migration, "pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:scale-cutover', 0))")
	globalClaimLock := strings.Index(migration, "pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:global-claim', 0))")
	slotClaimLock := strings.Index(migration, "pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:slot-claim', 0))")
	if scaleLock < 0 || globalClaimLock < 0 || slotClaimLock < 0 || !(scaleLock < globalClaimLock && globalClaimLock < slotClaimLock) {
		t.Fatalf("media activation lock order is unsafe: scale=%d global=%d slot=%d", scaleLock, globalClaimLock, slotClaimLock)
	}
	providerDueJobs := strings.Index(migration, "provider_due_jobs as materialized")
	localDueJobs := strings.Index(migration, "local_due_jobs as materialized")
	dueJobs := strings.Index(migration, "), due_jobs as materialized")
	if dueJobs >= 0 {
		dueJobs += len("), ")
	}
	candidate := strings.Index(migration, "), candidate as materialized")
	if providerDueJobs < 0 || localDueJobs < 0 || dueJobs < 0 || candidate < 0 ||
		!(providerDueJobs < localDueJobs && localDueJobs < dueJobs && dueJobs < candidate) {
		t.Fatalf(
			"scaled media due-head branches are invalid: provider=%d local=%d union=%d candidate=%d",
			providerDueJobs, localDueJobs, dueJobs, candidate,
		)
	}
	providerDueBody := migration[providerDueJobs:localDueJobs]
	localDueBody := migration[localDueJobs:dueJobs]
	dueBody := migration[dueJobs:candidate]
	for _, required := range []string{
		"from connected_sessions as session",
		"cross join lateral",
		"job.session_id = session.id",
		"job.organization_id = session.organization_id",
		"limit 1",
		"active_asset.asset_key = head.asset_key",
	} {
		if !strings.Contains(providerDueBody, required) {
			t.Fatalf("connected-session media head is missing %q", required)
		}
	}
	for _, required := range []string{
		"from local_sessions as session",
		"cross join lateral",
		"job.storage_path is not null",
		"and job.actual_size > 0",
		"job.storage_path <> nullif(btrim(job.message_key->>'repair_storage_path'), '')",
		"job.message_key->>'media_base64'",
		"job.message_key->>'base64'",
		"job.message_key->>'upload_intent_path'",
		"limit 1",
		"active_asset.asset_key = head.asset_key",
	} {
		if !strings.Contains(localDueBody, required) {
			t.Fatalf("lifecycle-independent local media head is missing %q", required)
		}
	}
	for _, required := range []string{
		"select provider_head.* from provider_due_jobs as provider_head",
		"union all",
		"select local_head.* from local_due_jobs as local_head",
	} {
		if !strings.Contains(dueBody, required) {
			t.Fatalf("media due-head union is missing %q", required)
		}
	}
	if strings.Contains(providerDueBody, "limit greatest(") || strings.Contains(localDueBody, "limit greatest(") {
		t.Fatal("a raw global media-job limit can let one tenant hide every other session")
	}
	scopedSessions := strings.Index(migration, "scoped_sessions as materialized")
	if scopedSessions < 0 || scopedSessions >= providerDueJobs {
		t.Fatal("media fairness must materialize scoped sessions before seeking one due head each")
	}
	sessionBody := migration[scopedSessions:providerDueJobs]
	for _, required := range []string{
		"from public.whatsapp_sessions as session",
		"connected_sessions as materialized",
		"coalesce(session.is_active, true) = true",
		"lower(btrim(coalesce(session.status, ''))) = 'connected'",
		"local_sessions as materialized",
		"from public.media_jobs as active_session",
		"active_session.session_id = session.id",
		"session.id = any(p_session_ids)",
		"from private.whatsapp_media_session_quarantine as quarantine",
		"quarantine.quarantined_until > now()",
	} {
		if !strings.Contains(sessionBody, required) {
			t.Fatalf("scoped media-session driver is missing %q", required)
		}
	}
	for _, required := range []string{
		"active_capacity as materialized",
		"when active.manual_requested then 26214400",
		"evolutionmediaresponsemaxbytes",
		"capacity.inflight_bytes + due.estimated_bytes <= 67108864",
	} {
		if required == "evolutionmediaresponsemaxbytes" {
			if !strings.Contains(strings.ToLower(mustReadWhatsAppMediaContractFile(t, filepath.Join(whatsappDir, "evolution_go.go"))), required) {
				t.Fatalf("Go provider response budget is missing %q", required)
			}
			continue
		}
		if !strings.Contains(migration, required) {
			t.Fatalf("scaled media byte budget is missing %q", required)
		}
	}
	for _, required := range []string{
		"job.message_key->>'media_base64'",
		"job.message_key->>'base64'",
		"job.storage_path is not null",
	} {
		if !strings.Contains(providerDueBody, required) {
			t.Fatalf("provider head does not exclude locally recoverable state via %q", required)
		}
	}
	if strings.Contains(providerDueBody, "from public.media_jobs as ready_asset") {
		t.Fatal("provider head reintroduced an unbounded completed-asset lookup")
	}
	if strings.Count(migration, "if index_definition is distinct from") < 7 {
		t.Fatal("media activation does not compare all prepared index definitions exactly")
	}
	wrapperPosition := strings.Index(migration, "create or replace function private.claim_whatsapp_media_job(\n  p_worker_id text,\n  p_lease interval default")
	dropOldSemaphorePosition := strings.Index(migration, "drop index public.media_jobs_one_global_processing_uidx")
	if wrapperPosition < 0 || dropOldSemaphorePosition < 0 || wrapperPosition > dropOldSemaphorePosition {
		t.Fatalf("rolling claim wrapper must be installed before dropping the old semaphore: wrapper=%d drop=%d", wrapperPosition, dropOldSemaphorePosition)
	}
	for _, required := range []string{
		"\\set on_error_stop on",
		"pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:scale-cutover', 0))",
		"pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:global-claim', 0))",
		"private.whatsapp_media_scale_cutover_state",
		"legacy_claim_disabled_at",
		"where false",
		"create unique index concurrently if not exists media_jobs_processing_slot_uidx",
		"create unique index concurrently if not exists media_jobs_processing_session_uidx",
		"create unique index concurrently if not exists media_jobs_processing_asset_uidx",
		"create index concurrently if not exists media_jobs_processing_org_idx",
		"create index concurrently if not exists media_jobs_pending_session_claim_idx",
		"create index concurrently if not exists media_jobs_pending_local_session_claim_idx",
		"create index concurrently if not exists media_jobs_pending_exhausted_idx",
		"verify_whatsapp_media_scale_online_artifacts",
		"is distinct from",
	} {
		if !strings.Contains(cutover, required) {
			t.Fatalf("scaled media cutover is missing %q", required)
		}
	}
	expandCommit := strings.Index(cutover, "commit;")
	cutoverScaleLock := strings.Index(cutover, "pg_advisory_lock(hashtextextended('vimob:whatsapp-media:scale-cutover', 0))")
	if expandCommit < 0 || cutoverScaleLock < 0 || cutoverScaleLock <= expandCommit {
		t.Fatal("online media cutover must acquire its session lock only after expand preflight commits")
	}
	if strings.Contains(cutover, "set processing_slot = 1") || strings.Contains(cutover, "drop index public.media_jobs_one_global_processing_uidx") {
		t.Fatal("online media expand cutover activates slot semantics before the atomic migration")
	}
	cutoverFenceScaleLock := strings.Index(cutover, "pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:scale-cutover', 0))")
	cutoverFenceGlobalLock := strings.Index(cutover, "pg_advisory_xact_lock(hashtextextended('vimob:whatsapp-media:global-claim', 0))")
	cutoverNoop := strings.Index(cutover, "where false")
	cutoverTimestamp := strings.Index(cutover, "values (true, clock_timestamp())")
	if cutoverFenceScaleLock < 0 || cutoverFenceGlobalLock < 0 || cutoverNoop < 0 || cutoverTimestamp < 0 ||
		!(cutoverFenceScaleLock < cutoverFenceGlobalLock && cutoverFenceGlobalLock < cutoverNoop && cutoverNoop < cutoverTimestamp) {
		t.Fatalf("legacy claim fence is not causal: scale=%d global=%d noop=%d timestamp=%d",
			cutoverFenceScaleLock, cutoverFenceGlobalLock, cutoverNoop, cutoverTimestamp)
	}
	for _, required := range []string{
		"validate constraint media_jobs_processing_slot_check",
		"convalidated",
		"media_jobs_pending_local_session_claim_idx",
		"media_jobs_pending_exhausted_idx",
		"media_jobs_processing_asset_uidx",
		"private.whatsapp_media_session_quarantine",
		"media_jobs_one_global_processing_uidx') is not null",
	} {
		if !strings.Contains(validationCutover, required) {
			t.Fatalf("post-activation media validation cutover is missing %q", required)
		}
	}
}

func TestWhatsAppMediaMigrationPreservesLegacyRetryableJobs(t *testing.T) {
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime caller unavailable")
	}
	whatsappDir := filepath.Dir(sourceFile)
	migration := strings.ToLower(mustReadWhatsAppMediaContractFile(t, filepath.Join(
		whatsappDir, "..", "..", "..", "..", "supabase", "migrations", "20260904225214_harden_whatsapp_media_queue.sql",
	)))
	cutover := strings.ToLower(mustReadWhatsAppMediaContractFile(t, filepath.Join(
		whatsappDir, "..", "..", "..", "..", "supabase", "cutovers", "20260909_prepare_whatsapp_media_queue.sql",
	)))

	claimStart := strings.Index(migration, "create or replace function private.claim_whatsapp_media_job")
	if claimStart < 0 {
		t.Fatal("media queue migration has no durable claim function")
	}
	if strings.Contains(migration[:claimStart], "update public.media_jobs") {
		t.Fatal("transactional migration still rewrites legacy media jobs before installing the worker")
	}
	for _, source := range []struct {
		name string
		sql  string
	}{
		{name: "migration pre-install", sql: migration[:claimStart]},
		{name: "cutover", sql: cutover},
	} {
		for _, forbidden := range []string{
			"media_legacy_job_retired",
			"pre-migration media job retired",
			"else 'failed'",
			"set status = 'failed'",
		} {
			if strings.Contains(source.sql, forbidden) {
				t.Fatalf("%s destructively terminalizes legacy work with %q", source.name, forbidden)
			}
		}
	}
	for _, required := range []string{
		"pending and failed are deliberately unchanged",
		"set status = 'completed'",
		"cutover blocked by a processing legacy job",
		"do not rewrite the job status",
		"where job.status is null",
	} {
		if !strings.Contains(cutover, required) {
			t.Fatalf("media queue cutover is missing the preservation contract %q", required)
		}
	}
}

func TestWhatsAppMediaMigrationRequiresOnlineCutoverForLiveQueue(t *testing.T) {
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime caller unavailable")
	}
	whatsappDir := filepath.Dir(sourceFile)
	migration := strings.ToLower(mustReadWhatsAppMediaContractFile(t, filepath.Join(
		whatsappDir, "..", "..", "..", "..", "supabase", "migrations", "20260904225214_harden_whatsapp_media_queue.sql",
	)))
	cutover := strings.ToLower(mustReadWhatsAppMediaContractFile(t, filepath.Join(
		whatsappDir, "..", "..", "..", "..", "supabase", "cutovers", "20260909_prepare_whatsapp_media_queue.sql",
	)))

	for _, required := range []string{
		"begin;",
		"lock table public.media_jobs in share mode nowait",
		"if exists (select 1 from public.media_jobs limit 1)",
		"pg_relation_size('public.media_jobs'::regclass) > 64 * 1024 * 1024",
		"or job.status is null",
		"and status is not null",
		"whatsapp media queue indexes are missing on a non-pristine queue",
		"run supabase/cutovers/20260909_prepare_whatsapp_media_queue.sql",
		"commit;",
	} {
		if !strings.Contains(migration, required) {
			t.Fatalf("media queue migration is missing live-database guard %q", required)
		}
	}
	if strings.Contains(migration, "create index concurrently") || strings.Contains(migration, "create unique index concurrently") {
		t.Fatal("transactional migration attempts CREATE INDEX CONCURRENTLY")
	}
	firstConcurrentIndex := strings.Index(cutover, "create unique index concurrently if not exists media_jobs_org_dedupe_uidx")
	cutoverDDLCommit := strings.Index(cutover, "commit;")
	if firstConcurrentIndex < 0 || cutoverDDLCommit < 0 || cutoverDDLCommit > firstConcurrentIndex {
		t.Fatal("media queue cutover does not leave its DDL transaction before CREATE INDEX CONCURRENTLY")
	}
	if strings.Contains(cutover[cutoverDDLCommit+len("commit;"):firstConcurrentIndex], "begin;") {
		t.Fatal("media queue cutover reopens a transaction before CREATE INDEX CONCURRENTLY")
	}
	for _, required := range []string{
		"preflight_whatsapp_media_queue_online_indexes",
		"verify_whatsapp_media_queue_online_artifacts",
		"create unique index concurrently if not exists media_jobs_org_dedupe_uidx",
		"create unique index concurrently if not exists media_jobs_one_global_processing_uidx",
		"create index concurrently if not exists media_jobs_hardened_claim_idx",
		"create index concurrently if not exists media_jobs_asset_ready_idx",
		"create index concurrently if not exists media_jobs_expired_lease_hardened_idx",
	} {
		if !strings.Contains(cutover, required) {
			t.Fatalf("media queue cutover is missing online artifact %q", required)
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

func mustReadWhatsAppMediaSource(t *testing.T) string {
	t.Helper()
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime caller unavailable")
	}
	return mustReadWhatsAppMediaContractFile(t, filepath.Join(filepath.Dir(sourceFile), "media_queue.go"))
}
