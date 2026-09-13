package publicapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/publicingress"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db *dbpkg.Postgres
}

func NewRepository(db *dbpkg.Postgres) Repository {
	return Repository{db: db}
}

func (repo Repository) AllowIP(ctx context.Context, clientIP string) error {
	allowed, err := publicingress.Allow(
		ctx,
		repo.db.Pool(),
		"public_api_ip_minute",
		[]string{clientIP},
		300,
		time.Minute,
	)
	if err != nil {
		return err
	}
	if !allowed {
		return ErrRateLimited
	}
	return nil
}

func (repo Repository) Authenticate(ctx context.Context, rawKey string) (Principal, error) {
	rawKey = strings.TrimSpace(rawKey)
	if !validRawAPIKey(rawKey) {
		return Principal{}, ErrInvalidCredentials
	}
	digest := sha256.Sum256([]byte(rawKey))

	var principal Principal
	var subscriptionStatus string
	var subscriptionType string
	var trialEndsAt pgtype.Timestamptz
	var billingGraceUntil pgtype.Timestamptz
	var moduleEnabled bool
	err := repo.db.Pool().QueryRow(ctx, `
		select
			api_key.id::text,
			api_key.organization_id::text,
			coalesce(nullif(trim(organization.subscription_status), ''), ''),
			coalesce(nullif(trim(organization.subscription_type), ''), ''),
			organization.trial_ends_at,
			organization.billing_grace_until,
			exists (
				select 1
				from public.organization_modules module
				where module.organization_id = api_key.organization_id
				  and lower(trim(module.module_name)) = 'api'
				  and coalesce(module.is_enabled, false) = true
			)
		from public.organization_api_keys api_key
		join public.organizations organization
		  on organization.id = api_key.organization_id
		 and coalesce(organization.is_active, true) = true
		where api_key.key_hash = $1
		  and coalesce(api_key.is_active, false) = true
		  and (api_key.expires_at is null or api_key.expires_at > now())
		limit 1
	`, hex.EncodeToString(digest[:])).Scan(
		&principal.KeyID,
		&principal.OrganizationID,
		&subscriptionStatus,
		&subscriptionType,
		&trialEndsAt,
		&billingGraceUntil,
		&moduleEnabled,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Principal{}, ErrInvalidCredentials
	}
	if err != nil {
		return Principal{}, err
	}

	billingContext := tenant.Context{
		OrganizationID:     principal.OrganizationID,
		SubscriptionStatus: subscriptionStatus,
		SubscriptionType:   subscriptionType,
		TrialEndsAt:        timestamptzPointer(trialEndsAt),
		BillingGraceUntil:  timestamptzPointer(billingGraceUntil),
	}
	if !billingContext.HasBillingAccessAt(time.Now()) {
		return Principal{}, ErrBillingRequired
	}
	if !moduleEnabled {
		return Principal{}, ErrAPIUnavailable
	}
	return principal, nil
}

func (repo Repository) AllowPrincipal(ctx context.Context, principal Principal) error {
	for _, rule := range []struct {
		scope  string
		limit  int
		window time.Duration
	}{
		{"public_api_key_minute", 120, time.Minute},
		{"public_api_key_hour", 1_000, time.Hour},
	} {
		allowed, err := publicingress.Allow(
			ctx,
			repo.db.Pool(),
			rule.scope,
			[]string{principal.OrganizationID, principal.KeyID},
			rule.limit,
			rule.window,
		)
		if err != nil {
			return err
		}
		if !allowed {
			return ErrRateLimited
		}
	}
	return nil
}

func (repo Repository) MarkUsed(ctx context.Context, principal Principal) error {
	_, err := repo.db.Pool().Exec(ctx, `
		update public.organization_api_keys
		set last_used_at = now(), updated_at = now()
		where id = $1::uuid
		  and organization_id = $2::uuid
		  and (last_used_at is null or last_used_at < now() - interval '1 minute')
	`, principal.KeyID, principal.OrganizationID)
	return err
}

func validRawAPIKey(value string) bool {
	if len(value) != len("vimob_")+64 || !strings.HasPrefix(value, "vimob_") {
		return false
	}
	for _, character := range value[len("vimob_"):] {
		if !((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f')) {
			return false
		}
	}
	return true
}

func timestamptzPointer(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	timestamp := value.Time
	return &timestamp
}
