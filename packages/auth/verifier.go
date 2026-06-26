package auth

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
)

type Config struct {
	ProjectURL string
	JWKSURL    string
	Issuer     string
	Audience   string
	JWTSecret  string
}

type User struct {
	ID        string         `json:"id"`
	Email     string         `json:"email,omitempty"`
	Role      string         `json:"role,omitempty"`
	SessionID string         `json:"sessionId,omitempty"`
	Claims    map[string]any `json:"-"`
}

type Claims struct {
	Email       string         `json:"email,omitempty"`
	Role        string         `json:"role,omitempty"`
	SessionID   string         `json:"session_id,omitempty"`
	AppMetadata map[string]any `json:"app_metadata,omitempty"`
	jwt.RegisteredClaims
}

type Verifier struct {
	cfg     Config
	jwks    keyfunc.Keyfunc
	methods []string
}

func NewVerifier(ctx context.Context, cfg Config) (*Verifier, error) {
	cfg.ProjectURL = strings.TrimRight(strings.TrimSpace(cfg.ProjectURL), "/")
	cfg.JWKSURL = strings.TrimSpace(cfg.JWKSURL)
	cfg.Issuer = strings.TrimRight(strings.TrimSpace(cfg.Issuer), "/")
	cfg.Audience = strings.TrimSpace(cfg.Audience)

	if cfg.ProjectURL == "" {
		return nil, errors.New("supabase project url is required")
	}

	if _, err := url.ParseRequestURI(cfg.ProjectURL); err != nil {
		return nil, fmt.Errorf("supabase project url is invalid: %w", err)
	}

	if cfg.Issuer == "" {
		cfg.Issuer = cfg.ProjectURL + "/auth/v1"
	}

	if cfg.Audience == "" {
		cfg.Audience = "authenticated"
	}

	verifier := &Verifier{cfg: cfg}

	if cfg.JWKSURL == "" && cfg.JWTSecret != "" {
		verifier.methods = []string{"HS256"}
		return verifier, nil
	}

	if cfg.JWKSURL == "" {
		cfg.JWKSURL = cfg.ProjectURL + "/auth/v1/.well-known/jwks.json"
		verifier.cfg.JWKSURL = cfg.JWKSURL
	}

	jwks, err := keyfunc.NewDefaultCtx(ctx, []string{cfg.JWKSURL})
	if err != nil {
		return nil, fmt.Errorf("failed to initialize supabase jwks verifier: %w", err)
	}

	verifier.jwks = jwks
	verifier.methods = []string{"RS256", "ES256", "ES384", "ES512", "EdDSA"}

	return verifier, nil
}

func (verifier *Verifier) Verify(ctx context.Context, rawToken string) (User, error) {
	rawToken = strings.TrimSpace(rawToken)
	if rawToken == "" {
		return User{}, errors.New("token is required")
	}

	claims := &Claims{}
	token, err := jwt.ParseWithClaims(
		rawToken,
		claims,
		verifier.keyfunc(ctx),
		jwt.WithValidMethods(verifier.methods),
		jwt.WithIssuer(verifier.cfg.Issuer),
		jwt.WithAudience(verifier.cfg.Audience),
		jwt.WithExpirationRequired(),
		jwt.WithLeeway(30*time.Second),
	)
	if err != nil {
		return User{}, fmt.Errorf("failed to verify jwt: %w", err)
	}

	if !token.Valid {
		return User{}, errors.New("jwt is invalid")
	}

	if claims.Subject == "" {
		return User{}, errors.New("jwt subject is required")
	}

	return User{
		ID:        claims.Subject,
		Email:     claims.Email,
		Role:      claims.Role,
		SessionID: claims.SessionID,
		Claims: map[string]any{
			"issuer":       claims.Issuer,
			"audience":     claims.Audience,
			"expiresAt":    claims.ExpiresAt,
			"issuedAt":     claims.IssuedAt,
			"appMetadata":  claims.AppMetadata,
			"authProvider": "supabase",
		},
	}, nil
}

func (verifier *Verifier) Close() {
	// The JWKS refresh lifecycle is bound to the context passed to NewVerifier.
}

func (verifier *Verifier) keyfunc(ctx context.Context) jwt.Keyfunc {
	if verifier.cfg.JWTSecret != "" {
		return func(token *jwt.Token) (any, error) {
			return []byte(verifier.cfg.JWTSecret), nil
		}
	}

	return verifier.jwks.KeyfuncCtx(ctx)
}
