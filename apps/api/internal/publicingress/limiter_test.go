package publicingress

import (
	"context"
	"errors"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type limiterTestQueryRower struct {
	row pgx.Row
}

func (queryer limiterTestQueryRower) QueryRow(context.Context, string, ...any) pgx.Row {
	return queryer.row
}

type limiterTestRow struct {
	err error
}

func (row limiterTestRow) Scan(...any) error {
	return row.err
}

func TestClientIPResolverIgnoresSpoofedForwardingFromUntrustedPeer(t *testing.T) {
	resolver, err := NewClientIPResolver([]string{"10.0.0.0/8"})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", "https://api.example.test/public", nil)
	request.RemoteAddr = "203.0.113.20:43210"
	request.Header.Set("X-Forwarded-For", "198.51.100.10")

	if got := resolver.Resolve(request); got != "203.0.113.20" {
		t.Fatalf("client IP = %q, want direct untrusted peer", got)
	}
}

func TestClientIPResolverWalksTrustedProxyChainFromTheRight(t *testing.T) {
	resolver, err := NewClientIPResolver([]string{"10.0.0.0/8", "192.0.2.0/24"})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", "https://api.example.test/public", nil)
	request.RemoteAddr = "10.0.0.8:443"
	request.Header.Set(
		"X-Forwarded-For",
		"198.51.100.44, 192.0.2.10",
	)

	if got := resolver.Resolve(request); got != "198.51.100.44" {
		t.Fatalf("client IP = %q, want first untrusted hop", got)
	}
}

func TestClientIPResolverIgnoresSpoofedPrefixBeforeRealClient(t *testing.T) {
	resolver, err := NewClientIPResolver([]string{"10.0.0.0/8", "192.0.2.0/24"})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", "https://api.example.test/public", nil)
	request.RemoteAddr = "10.0.0.8:443"
	request.Header.Set(
		"X-Forwarded-For",
		"203.0.113.250, 198.51.100.44, 192.0.2.10",
	)

	if got := resolver.Resolve(request); got != "198.51.100.44" {
		t.Fatalf("client IP = %q, want nearest untrusted client hop", got)
	}
}

func TestClientIPResolverUsesRealIPOnlyBehindTrustedProxy(t *testing.T) {
	resolver, err := NewClientIPResolver([]string{"127.0.0.0/8"})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", "http://api.example.test/public", nil)
	request.RemoteAddr = "127.0.0.1:43210"
	request.Header.Set("X-Real-IP", "198.51.100.81")

	if got := resolver.Resolve(request); got != "198.51.100.81" {
		t.Fatalf("client IP = %q, want trusted X-Real-IP", got)
	}
}

func TestClientIPResolverDoesNotFallbackToRealIPForMalformedForwardingChain(t *testing.T) {
	resolver, err := NewClientIPResolver([]string{"127.0.0.0/8"})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", "http://api.example.test/public", nil)
	request.RemoteAddr = "127.0.0.1:43210"
	request.Header.Set("X-Forwarded-For", "not-an-ip")
	request.Header.Set("X-Real-IP", "198.51.100.81")

	if got := resolver.Resolve(request); got != "127.0.0.1" {
		t.Fatalf("client IP = %q, want trusted peer fail-closed identity", got)
	}
}

func TestClientIPResolverRejectsInvalidTrustedProxyCIDR(t *testing.T) {
	for _, value := range []string{"not-a-cidr", "0.0.0.0/0", "2000::/3"} {
		if _, err := NewClientIPResolver([]string{value}); err == nil {
			t.Fatalf("expected unsafe trusted proxy CIDR %q to fail", value)
		}
	}
}

func TestClientIPResolverCanonicalizesMappedIPv4(t *testing.T) {
	resolver, err := NewClientIPResolver(nil)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", "http://api.example.test/public", nil)
	request.RemoteAddr = "[::ffff:203.0.113.9]:443"

	if got := resolver.Resolve(request); got != "203.0.113.9" {
		t.Fatalf("client IP = %q, want canonical IPv4", got)
	}
}

func TestAllowUsesBoundedProcessFallbackOnlyForMissingSharedLimiter(t *testing.T) {
	queryer := limiterTestQueryRower{row: limiterTestRow{err: &pgconn.PgError{
		Code:    "42883",
		Message: "function private.check_public_ingress_rate_limit(unknown, unknown, unknown, unknown) does not exist",
	}}}
	options := AllowOptions{ProcessFallbackEnabled: true}

	first, err := AllowWithOptions(
		context.Background(),
		queryer,
		t.Name(),
		[]string{"198.51.100.10"},
		1,
		time.Hour,
		options,
	)
	if err != nil || !first {
		t.Fatalf("first fallback request = %v, %v; want allowed", first, err)
	}

	second, err := AllowWithOptions(
		context.Background(),
		queryer,
		t.Name(),
		[]string{"198.51.100.10"},
		1,
		time.Hour,
		options,
	)
	if err != nil || second {
		t.Fatalf("second fallback request = %v, %v; want rate limited", second, err)
	}
}

func TestAllowFailsClosedWhenProcessFallbackIsDisabled(t *testing.T) {
	queryer := limiterTestQueryRower{row: limiterTestRow{err: &pgconn.PgError{
		Code:    "42883",
		Message: "function private.check_public_ingress_rate_limit(unknown, unknown, unknown, unknown) does not exist",
	}}}

	allowed, err := Allow(
		context.Background(),
		queryer,
		t.Name(),
		[]string{"198.51.100.11"},
		1,
		time.Hour,
	)
	if err == nil || allowed {
		t.Fatalf("request = %v, %v; want fail-closed error", allowed, err)
	}
}

func TestAllowDoesNotHideOtherDatabaseErrors(t *testing.T) {
	expected := errors.New("database unavailable")
	queryer := limiterTestQueryRower{row: limiterTestRow{err: expected}}

	allowed, err := AllowWithOptions(
		context.Background(),
		queryer,
		t.Name(),
		[]string{"198.51.100.12"},
		1,
		time.Hour,
		AllowOptions{ProcessFallbackEnabled: true},
	)
	if !errors.Is(err, expected) || allowed {
		t.Fatalf("request = %v, %v; want original database error", allowed, err)
	}
}
