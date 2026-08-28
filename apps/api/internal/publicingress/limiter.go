package publicingress

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	unknownClientIP                = "unknown"
	maxProcessFallbackLimiterItems = 10_000
)

type AllowOptions struct {
	// ProcessFallbackEnabled is intended only for local development while the
	// database migration that installs the shared limiter is still pending.
	// Production must remain fail-closed so replicas cannot multiply the limit.
	ProcessFallbackEnabled bool
}

type processRateLimitEntry struct {
	windowStartedAt time.Time
	lastSeenAt      time.Time
	count           int
}

type processRateLimiter struct {
	mu      sync.Mutex
	entries map[string]processRateLimitEntry
}

var developmentFallbackLimiter = processRateLimiter{
	entries: make(map[string]processRateLimitEntry),
}

type QueryRower interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

type ClientIPResolver struct {
	trustedProxies []netip.Prefix
}

func NewClientIPResolver(trustedProxyCIDRs []string) (ClientIPResolver, error) {
	resolver := ClientIPResolver{}
	for _, value := range trustedProxyCIDRs {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		prefix, err := netip.ParsePrefix(value)
		if err != nil {
			return ClientIPResolver{}, fmt.Errorf("invalid trusted proxy CIDR %q: %w", value, err)
		}
		if prefix.Addr().Is4In6() {
			return ClientIPResolver{}, fmt.Errorf("invalid trusted proxy CIDR %q: IPv4-mapped IPv6 prefixes are not supported", value)
		}
		minimumBits := 32
		if prefix.Addr().Is4() {
			minimumBits = 8
		}
		if prefix.Bits() < minimumBits {
			return ClientIPResolver{}, fmt.Errorf("trusted proxy CIDR %q is overly broad", value)
		}
		resolver.trustedProxies = append(resolver.trustedProxies, prefix.Masked())
	}
	return resolver, nil
}

func (resolver ClientIPResolver) Resolve(request *http.Request) string {
	if request == nil {
		return unknownClientIP
	}

	peer, ok := parseRemoteAddress(request.RemoteAddr)
	if !ok {
		return unknownClientIP
	}
	if !resolver.isTrusted(peer) {
		return peer.String()
	}

	forwardedHeaders := request.Header.Values("X-Forwarded-For")
	forwarded := forwardedAddresses(forwardedHeaders)
	for index := len(forwarded) - 1; index >= 0; index-- {
		if !resolver.isTrusted(forwarded[index]) {
			return forwarded[index].String()
		}
	}

	// X-Real-IP is a fallback only when X-Forwarded-For is absent. A malformed
	// forwarding chain must fail closed to the trusted peer identity instead of
	// switching to a second potentially client-controlled header.
	if len(forwardedHeaders) == 0 {
		if realIP, ok := parseAddress(request.Header.Get("X-Real-IP")); ok {
			return realIP.String()
		}
	}
	return peer.String()
}

func (resolver ClientIPResolver) isTrusted(address netip.Addr) bool {
	for _, prefix := range resolver.trustedProxies {
		if prefix.Contains(address) {
			return true
		}
	}
	return false
}

func Allow(
	ctx context.Context,
	queryer QueryRower,
	scope string,
	subjectParts []string,
	limit int,
	window time.Duration,
) (bool, error) {
	return AllowWithOptions(ctx, queryer, scope, subjectParts, limit, window, AllowOptions{})
}

func AllowWithOptions(
	ctx context.Context,
	queryer QueryRower,
	scope string,
	subjectParts []string,
	limit int,
	window time.Duration,
	options AllowOptions,
) (bool, error) {
	if queryer == nil {
		return false, errors.New("public ingress limiter is not initialized")
	}
	scope = strings.TrimSpace(scope)
	if scope == "" || limit <= 0 || window < time.Second || window > 24*time.Hour {
		return false, errors.New("invalid public ingress limiter rule")
	}

	normalizedParts := make([]string, 0, len(subjectParts))
	for _, part := range subjectParts {
		part = strings.TrimSpace(part)
		if part == "" {
			part = unknownClientIP
		}
		normalizedParts = append(normalizedParts, part)
	}
	if len(normalizedParts) == 0 {
		normalizedParts = append(normalizedParts, unknownClientIP)
	}

	digest := sha256.Sum256([]byte(scope + "\x00" + strings.Join(normalizedParts, "\x00")))
	subjectHash := hex.EncodeToString(digest[:])
	windowSeconds := int(window / time.Second)

	var allowed bool
	err := queryer.QueryRow(ctx, `
		select private.check_public_ingress_rate_limit(
			$1,
			$2,
			$3,
			$4
		)
	`, scope, subjectHash, limit, windowSeconds).Scan(&allowed)
	if err != nil {
		if options.ProcessFallbackEnabled && isMissingSharedLimiter(err) {
			return developmentFallbackLimiter.allow(scope+"\x00"+subjectHash, limit, window, time.Now().UTC()), nil
		}
		return false, fmt.Errorf("check public ingress rate limit: %w", err)
	}
	return allowed, nil
}

func isMissingSharedLimiter(err error) bool {
	var postgresError *pgconn.PgError
	return errors.As(err, &postgresError) &&
		postgresError.Code == "42883" &&
		strings.Contains(strings.ToLower(postgresError.Message), "check_public_ingress_rate_limit")
}

func (limiter *processRateLimiter) allow(key string, limit int, window time.Duration, now time.Time) bool {
	limiter.mu.Lock()
	defer limiter.mu.Unlock()

	if current, ok := limiter.entries[key]; ok {
		if now.Sub(current.windowStartedAt) < window {
			current.count++
			current.lastSeenAt = now
			limiter.entries[key] = current
			return current.count <= limit
		}

		limiter.entries[key] = processRateLimitEntry{
			windowStartedAt: now,
			lastSeenAt:      now,
			count:           1,
		}
		return true
	}

	if len(limiter.entries) >= maxProcessFallbackLimiterItems {
		for entryKey, entry := range limiter.entries {
			if now.Sub(entry.lastSeenAt) >= 24*time.Hour {
				delete(limiter.entries, entryKey)
			}
		}
	}
	if len(limiter.entries) >= maxProcessFallbackLimiterItems {
		return false
	}

	limiter.entries[key] = processRateLimitEntry{
		windowStartedAt: now,
		lastSeenAt:      now,
		count:           1,
	}
	return true
}

func parseRemoteAddress(value string) (netip.Addr, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return netip.Addr{}, false
	}
	host, _, err := net.SplitHostPort(value)
	if err == nil {
		return parseAddress(host)
	}
	return parseAddress(value)
}

func parseAddress(value string) (netip.Addr, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return netip.Addr{}, false
	}
	address, err := netip.ParseAddr(value)
	if err != nil {
		return netip.Addr{}, false
	}
	return address.Unmap(), true
}

func forwardedAddresses(values []string) []netip.Addr {
	addresses := make([]netip.Addr, 0, len(values))
	for _, value := range values {
		for _, candidate := range strings.Split(value, ",") {
			if address, ok := parseAddress(candidate); ok {
				addresses = append(addresses, address)
			}
		}
	}
	return addresses
}
