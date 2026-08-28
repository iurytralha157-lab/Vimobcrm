package auth

import (
	"context"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const testJWTSecret = "vimob-test-secret-with-at-least-32-bytes"

func TestVerifierAcceptsValidSupabaseToken(t *testing.T) {
	verifier := newTestVerifier(t)
	token := signTestToken(t, jwt.RegisteredClaims{
		Subject:   "10000000-0000-0000-0000-000000000001",
		Issuer:    "https://example.supabase.co/auth/v1",
		Audience:  jwt.ClaimStrings{"authenticated"},
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		IssuedAt:  jwt.NewNumericDate(time.Now().Add(-time.Minute)),
	})

	user, err := verifier.Verify(context.Background(), token)
	if err != nil {
		t.Fatalf("Verify() error = %v", err)
	}
	if user.ID != "10000000-0000-0000-0000-000000000001" {
		t.Fatalf("user id = %q", user.ID)
	}
}

func TestVerifierParsesSignedAuthenticationMethods(t *testing.T) {
	verifier := newTestVerifier(t)
	token := signTestToken(t, Claims{
		AuthenticationMethods: []AuthenticationMethod{
			{Method: "password", Timestamp: time.Now().Add(-time.Minute).Unix()},
			{Method: "recovery", Timestamp: time.Now().Unix()},
			{Method: "token_refresh", Timestamp: time.Now().Add(time.Minute).Unix()},
		},
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "10000000-0000-0000-0000-000000000001",
			Issuer:    "https://example.supabase.co/auth/v1",
			Audience:  jwt.ClaimStrings{"authenticated"},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	})

	user, err := verifier.Verify(context.Background(), token)
	if err != nil {
		t.Fatalf("Verify() error = %v", err)
	}
	if !user.IsPasswordRecovery() {
		t.Fatal("signed recovery AMR was not preserved")
	}
	if got, want := len(user.AuthenticationMethods), 3; got != want {
		t.Fatalf("authentication methods = %d, want %d", got, want)
	}
}

func TestUserIsPasswordRecovery(t *testing.T) {
	tests := []struct {
		name    string
		methods []AuthenticationMethod
		want    bool
	}{
		{name: "missing AMR", want: false},
		{name: "password session", methods: []AuthenticationMethod{{Method: "password"}}, want: false},
		{name: "refresh only", methods: []AuthenticationMethod{{Method: "token_refresh"}}, want: false},
		{name: "recovery", methods: []AuthenticationMethod{{Method: "recovery"}}, want: true},
		{name: "recovery survives refresh", methods: []AuthenticationMethod{{Method: "recovery"}, {Method: "token_refresh"}}, want: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			user := User{AuthenticationMethods: test.methods}
			if got := user.IsPasswordRecovery(); got != test.want {
				t.Fatalf("IsPasswordRecovery() = %t, want %t", got, test.want)
			}
		})
	}
}

func TestVerifierTrimsLegacyJWTSecret(t *testing.T) {
	verifier, err := NewVerifier(context.Background(), Config{
		ProjectURL: "https://example.supabase.co",
		Issuer:     "https://example.supabase.co/auth/v1",
		Audience:   "authenticated",
		JWTSecret:  " \t" + testJWTSecret + "\r\n",
	})
	if err != nil {
		t.Fatalf("NewVerifier() error = %v", err)
	}
	t.Cleanup(verifier.Close)

	token := signTestToken(t, jwt.RegisteredClaims{
		Subject:   "10000000-0000-0000-0000-000000000001",
		Issuer:    "https://example.supabase.co/auth/v1",
		Audience:  jwt.ClaimStrings{"authenticated"},
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
	})

	if _, err := verifier.Verify(context.Background(), token); err != nil {
		t.Fatalf("Verify() error = %v", err)
	}
}

func TestVerifierRejectsInvalidClaims(t *testing.T) {
	verifier := newTestVerifier(t)
	tests := []struct {
		name   string
		claims jwt.RegisteredClaims
	}{
		{
			name:   "missing subject",
			claims: jwt.RegisteredClaims{Issuer: "https://example.supabase.co/auth/v1", Audience: jwt.ClaimStrings{"authenticated"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))},
		},
		{
			name:   "wrong audience",
			claims: jwt.RegisteredClaims{Subject: "user-id", Issuer: "https://example.supabase.co/auth/v1", Audience: jwt.ClaimStrings{"service_role"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))},
		},
		{
			name:   "expired",
			claims: jwt.RegisteredClaims{Subject: "user-id", Issuer: "https://example.supabase.co/auth/v1", Audience: jwt.ClaimStrings{"authenticated"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(-time.Hour))},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := verifier.Verify(context.Background(), signTestToken(t, test.claims)); err == nil {
				t.Fatal("Verify() accepted invalid claims")
			}
		})
	}
}

func newTestVerifier(t *testing.T) *Verifier {
	t.Helper()
	verifier, err := NewVerifier(context.Background(), Config{
		ProjectURL: "https://example.supabase.co",
		Issuer:     "https://example.supabase.co/auth/v1",
		Audience:   "authenticated",
		JWTSecret:  testJWTSecret,
	})
	if err != nil {
		t.Fatalf("NewVerifier() error = %v", err)
	}
	t.Cleanup(verifier.Close)
	return verifier
}

func signTestToken(t *testing.T, claims jwt.Claims) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(testJWTSecret))
	if err != nil {
		t.Fatalf("SignedString() error = %v", err)
	}
	return signed
}
