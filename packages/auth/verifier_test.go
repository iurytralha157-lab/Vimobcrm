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

func signTestToken(t *testing.T, claims jwt.RegisteredClaims) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(testJWTSecret))
	if err != nil {
		t.Fatalf("SignedString() error = %v", err)
	}
	return signed
}
