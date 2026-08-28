package whatsapp

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"math"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	// Evolution Go can embed media as base64 when provider object storage is not
	// enabled. Eight MiB keeps common media callbacks compatible while cutting
	// the former 32 MiB unauthenticated ingress cap by 75%. Larger callbacks
	// require provider mediaUrl storage or WEBHOOK_FILES=false.
	evolutionWebhookMaxBodyBytes = int64(8 << 20)

	evolutionWebhookRateLimitMaxEntries = 8192
	evolutionWebhookRateLimitIdleTTL    = 10 * time.Minute
)

var (
	errEvolutionWebhookBodyTooLarge = errors.New("evolution webhook body too large")

	defaultEvolutionWebhookRateLimiter = newEvolutionWebhookRateLimiter()
)

type evolutionWebhookRateLimitSpec struct {
	ratePerSecond float64
	burst         float64
}

var (
	// A single session can absorb a provider reconnect burst while sustained
	// traffic remains bounded before any database lookup.
	evolutionWebhookSessionRateLimit = evolutionWebhookRateLimitSpec{
		ratePerSecond: 25,
		burst:         100,
	}
	// Rotating session IDs must not bypass the ingress limit.
	evolutionWebhookClientRateLimit = evolutionWebhookRateLimitSpec{
		ratePerSecond: 100,
		burst:         300,
	}
	// Forwarded client headers are useful behind a proxy but are not trusted.
	// This coarser remote-peer bucket bounds spoofed-header bypasses without
	// treating every session behind the same reverse proxy as one small bucket.
	evolutionWebhookRemoteRateLimit = evolutionWebhookRateLimitSpec{
		ratePerSecond: 500,
		burst:         1000,
	}
)

type evolutionWebhookRateLimitKey struct {
	value string
	spec  evolutionWebhookRateLimitSpec
}

type evolutionWebhookRateLimitEntry struct {
	tokens   float64
	updated  time.Time
	lastSeen time.Time
}

type evolutionWebhookRateLimiter struct {
	mu         sync.Mutex
	now        func() time.Time
	entries    map[string]evolutionWebhookRateLimitEntry
	maxEntries int
	idleTTL    time.Duration
}

// This limiter is process-local defense in depth: it caps work and memory per
// API replica, but replicas intentionally do not share counters.
func newEvolutionWebhookRateLimiter() *evolutionWebhookRateLimiter {
	return &evolutionWebhookRateLimiter{
		now:        time.Now,
		entries:    make(map[string]evolutionWebhookRateLimitEntry),
		maxEntries: evolutionWebhookRateLimitMaxEntries,
		idleTTL:    evolutionWebhookRateLimitIdleTTL,
	}
}

func (handler Handler) allowEvolutionWebhookRequest(r *http.Request) bool {
	limiter := handler.webhookRateLimiter
	if limiter == nil {
		limiter = defaultEvolutionWebhookRateLimiter
	}
	return limiter.allow(evolutionWebhookRateLimitKeys(r)...)
}

func (limiter *evolutionWebhookRateLimiter) allow(keys ...evolutionWebhookRateLimitKey) bool {
	if limiter == nil || len(keys) == 0 {
		return true
	}

	now := time.Now()
	if limiter.now != nil {
		now = limiter.now()
	}
	limiter.mu.Lock()
	defer limiter.mu.Unlock()

	if limiter.entries == nil {
		limiter.entries = make(map[string]evolutionWebhookRateLimitEntry)
	}
	if limiter.maxEntries <= 0 {
		return false
	}
	if limiter.idleTTL <= 0 {
		limiter.idleTTL = evolutionWebhookRateLimitIdleTTL
	}

	missing := 0
	seenKeys := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		if key.value == "" || key.spec.ratePerSecond <= 0 || key.spec.burst < 1 {
			return false
		}
		if _, duplicate := seenKeys[key.value]; duplicate {
			return false
		}
		seenKeys[key.value] = struct{}{}
		if _, exists := limiter.entries[key.value]; !exists {
			missing++
		}
	}
	if len(limiter.entries)+missing > limiter.maxEntries {
		limiter.cleanupLocked(now)
	}
	if len(limiter.entries)+missing > limiter.maxEntries {
		// Keep memory bounded under key-rotation attacks. Existing provider
		// buckets continue to work until an idle slot expires.
		return false
	}

	// Check/refill every bucket first so a rejected aggregate bucket does not
	// consume tokens from the session bucket.
	entries := make([]evolutionWebhookRateLimitEntry, len(keys))
	allowed := true
	for index, key := range keys {
		entry, exists := limiter.entries[key.value]
		if !exists {
			entry = evolutionWebhookRateLimitEntry{
				tokens:   key.spec.burst,
				updated:  now,
				lastSeen: now,
			}
		} else {
			elapsed := now.Sub(entry.updated).Seconds()
			if elapsed > 0 {
				entry.tokens = math.Min(
					key.spec.burst,
					entry.tokens+elapsed*key.spec.ratePerSecond,
				)
			}
			entry.updated = now
			entry.lastSeen = now
		}
		entries[index] = entry
		if entry.tokens < 1 {
			allowed = false
		}
	}

	for index, key := range keys {
		entry := entries[index]
		if allowed {
			entry.tokens--
		}
		limiter.entries[key.value] = entry
	}
	return allowed
}

func (limiter *evolutionWebhookRateLimiter) cleanupLocked(now time.Time) {
	for key, entry := range limiter.entries {
		if now.Sub(entry.lastSeen) >= limiter.idleTTL {
			delete(limiter.entries, key)
		}
	}
}

func evolutionWebhookRateLimitKeys(r *http.Request) []evolutionWebhookRateLimitKey {
	route := strings.TrimSpace(r.Method) + " " + strings.TrimSpace(r.URL.Path)
	sessionID := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("session_id")))
	if sessionID == "" {
		sessionID = "missing"
	}
	remoteIP := evolutionWebhookRemoteIP(r)
	clientIP := evolutionWebhookClientIP(r, remoteIP)

	return []evolutionWebhookRateLimitKey{
		{
			value: evolutionWebhookRateLimitKeyHash(
				"session",
				route,
				sessionID,
				clientIP,
			),
			spec: evolutionWebhookSessionRateLimit,
		},
		{
			value: evolutionWebhookRateLimitKeyHash("client", route, clientIP),
			spec:  evolutionWebhookClientRateLimit,
		},
		{
			value: evolutionWebhookRateLimitKeyHash("remote", route, remoteIP),
			spec:  evolutionWebhookRemoteRateLimit,
		},
	}
}

func evolutionWebhookRateLimitKeyHash(scope string, values ...string) string {
	hash := sha256.New()
	_, _ = hash.Write([]byte(scope))
	for _, value := range values {
		_, _ = hash.Write([]byte{0})
		_, _ = hash.Write([]byte(value))
	}
	return scope + ":" + hex.EncodeToString(hash.Sum(nil))
}

func evolutionWebhookRemoteIP(r *http.Request) string {
	value := strings.TrimSpace(r.RemoteAddr)
	if host, _, err := net.SplitHostPort(value); err == nil {
		value = host
	}
	if parsed := net.ParseIP(strings.Trim(value, "[]")); parsed != nil {
		return parsed.String()
	}
	return "unknown"
}

func evolutionWebhookClientIP(r *http.Request, remoteIP string) string {
	for _, value := range []string{
		r.Header.Get("CF-Connecting-IP"),
		r.Header.Get("X-Real-IP"),
		firstForwardedIP(r.Header.Get("X-Forwarded-For")),
	} {
		if parsed := net.ParseIP(strings.TrimSpace(value)); parsed != nil {
			return remoteIP + "/" + parsed.String()
		}
	}
	return remoteIP
}

func firstForwardedIP(value string) string {
	first, _, _ := strings.Cut(value, ",")
	return strings.TrimSpace(first)
}

func evolutionWebhookContentLengthTooLarge(r *http.Request) bool {
	return r.ContentLength > evolutionWebhookMaxBodyBytes
}

func readEvolutionWebhookBody(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	body, err := io.ReadAll(
		http.MaxBytesReader(w, r.Body, evolutionWebhookMaxBodyBytes),
	)
	if err == nil {
		return body, nil
	}

	var maxBytesError *http.MaxBytesError
	if errors.As(err, &maxBytesError) {
		return nil, errEvolutionWebhookBodyTooLarge
	}
	return nil, err
}
