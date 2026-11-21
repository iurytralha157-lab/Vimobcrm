package meta

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type duplicateLeadgenError struct {
	leadID string
}

type metaLeadMatch struct {
	LeadID         string
	DetailsPending bool
}

type metaLeadIntakeIdentity struct {
	ScopeKey           string
	OriginRoundRobinID string
}

func (err duplicateLeadgenError) Error() string {
	return "Meta leadgen event was already processed"
}

func (repo Repository) findLeadByMetaLeadID(ctx context.Context, organizationID string, leadgenID string) (metaLeadMatch, error) {
	var match metaLeadMatch
	err := repo.db.Pool().QueryRow(ctx, `
		select
		  candidate.lead_id,
		  lower(coalesce(lead.metadata->>'meta_details_status', '')) = 'pending'
		from (
			select entry.lead_id::text as lead_id, 0 as priority, entry.occurred_at as matched_at
			from public.lead_entry_events entry
			where entry.organization_id = $1::uuid
			  and entry.provider = 'meta'
			  and entry.provider_event_id = $2
			  and entry.is_countable = true
			union all
			select lead.id::text, 1, lead.created_at
			from public.leads lead
			where lead.organization_id = $1::uuid
			  and lead.meta_lead_id = $2
		) candidate
		join public.leads lead
		  on lead.organization_id = $1::uuid
		 and lead.id = candidate.lead_id::uuid
		order by candidate.priority, candidate.matched_at desc
		limit 1
	`, organizationID, leadgenID).Scan(&match.LeadID, &match.DetailsPending)
	if errors.Is(err, pgx.ErrNoRows) {
		return metaLeadMatch{}, nil
	}
	return match, err
}

func findLeadByProviderEventID(ctx context.Context, tx pgx.Tx, organizationID string, provider string, providerEventID string) (string, error) {
	if strings.TrimSpace(providerEventID) == "" {
		return "", nil
	}

	var leadID string
	err := tx.QueryRow(ctx, `
		select lead_id::text
		from public.lead_entry_events
		where organization_id = $1::uuid
		  and provider = $2
		  and provider_event_id = $3
		  and is_countable = true
		order by occurred_at, created_at, id
		limit 1
	`, organizationID, provider, providerEventID).Scan(&leadID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return leadID, err
}

func (repo Repository) findExistingLeadByPhone(ctx context.Context, tx pgx.Tx, organizationID string, phone *string, intakeScopeKey string) (string, error) {
	if digitsOnly(phone) == "" {
		return "", nil
	}

	var leadID string
	err := tx.QueryRow(ctx, `
		select id::text
		from public.leads
		where organization_id = $1::uuid
		  and intake_scope_key = $3
		  and phone is not null
		  and btrim(phone) <> ''
		  and normalize_phone(phone) is not null
		  and normalize_phone(phone) <> ''
		  and normalize_phone(phone) = normalize_phone($2)
		order by created_at asc
		limit 1
	`, organizationID, *phone, intakeScopeKey).Scan(&leadID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return leadID, err
}

func (repo Repository) findExistingLeadByPhoneLegacy(ctx context.Context, tx pgx.Tx, organizationID string, phone *string) (string, error) {
	if digitsOnly(phone) == "" {
		return "", nil
	}

	var leadID string
	err := tx.QueryRow(ctx, `
		select id::text
		from public.leads
		where organization_id = $1::uuid
		  and phone is not null
		  and btrim(phone) <> ''
		  and normalize_phone(phone) is not null
		  and normalize_phone(phone) <> ''
		  and normalize_phone(phone) = normalize_phone($2)
		order by created_at asc
		limit 1
	`, organizationID, *phone).Scan(&leadID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return leadID, err
}

func metaLeadIntakeScopeKey(roundRobinID *string) string {
	if roundRobinID == nil || strings.TrimSpace(*roundRobinID) == "" {
		return "unscoped"
	}
	return "queue:" + strings.ToLower(strings.TrimSpace(*roundRobinID))
}

func resolveStoredMetaLeadIntakeIdentity(storedScope string, storedOrigin string, metadataScope string, metadataOrigin string) (metaLeadIntakeIdentity, error) {
	queueID := ""
	addQueueID := func(raw string, source string) error {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			return nil
		}
		normalized, ok := normalizeUUID(raw)
		if !ok {
			return fmt.Errorf("%w: invalid %s", ErrInvalidInput, source)
		}
		if queueID != "" && queueID != normalized {
			return fmt.Errorf("%w: conflicting Meta intake queue identity", ErrInvalidInput)
		}
		queueID = normalized
		return nil
	}
	addScope := func(raw string, source string) error {
		raw = strings.TrimSpace(raw)
		if raw == "" || strings.EqualFold(raw, "unscoped") {
			return nil
		}
		const prefix = "queue:"
		if len(raw) <= len(prefix) || !strings.EqualFold(raw[:len(prefix)], prefix) {
			return fmt.Errorf("%w: invalid %s", ErrInvalidInput, source)
		}
		return addQueueID(strings.TrimSpace(raw[len(prefix):]), source)
	}

	if err := addScope(storedScope, "stored intake_scope_key"); err != nil {
		return metaLeadIntakeIdentity{}, err
	}
	if err := addQueueID(storedOrigin, "stored origin_round_robin_id"); err != nil {
		return metaLeadIntakeIdentity{}, err
	}
	if err := addScope(metadataScope, "metadata intake_scope_key"); err != nil {
		return metaLeadIntakeIdentity{}, err
	}
	if err := addQueueID(metadataOrigin, "metadata origin_round_robin_id"); err != nil {
		return metaLeadIntakeIdentity{}, err
	}
	if queueID == "" {
		return metaLeadIntakeIdentity{ScopeKey: "unscoped"}, nil
	}
	return metaLeadIntakeIdentity{
		ScopeKey:           "queue:" + queueID,
		OriginRoundRobinID: queueID,
	}, nil
}

func (repo Repository) pendingMetaLeadIntakeIdentity(ctx context.Context, tx pgx.Tx, organizationID string, leadID string, lockRow bool) (metaLeadIntakeIdentity, error) {
	query := `
		select
		  coalesce(nullif(intake_scope_key, ''), 'unscoped'),
		  coalesce(origin_round_robin_id::text, ''),
		  coalesce(nullif(metadata->>'intake_scope_key', ''), ''),
		  coalesce(nullif(metadata->>'origin_round_robin_id', ''), '')
		from public.leads
		where organization_id = $1::uuid
		  and id = $2::uuid
	`
	if lockRow {
		query += " for update"
	}

	var storedScope string
	var storedOrigin string
	var metadataScope string
	var metadataOrigin string
	err := tx.QueryRow(ctx, query, organizationID, leadID).Scan(&storedScope, &storedOrigin, &metadataScope, &metadataOrigin)
	if err != nil {
		return metaLeadIntakeIdentity{}, err
	}
	identity, err := resolveStoredMetaLeadIntakeIdentity(storedScope, storedOrigin, metadataScope, metadataOrigin)
	if err != nil {
		return metaLeadIntakeIdentity{}, err
	}
	// The placeholder already owns this immutable intake identity. Its source
	// queue may legitimately have been hard-deleted after the lead was accepted,
	// so validate the canonical stored shape without requiring a live queue row.
	if err := repo.validateMetaLeadIntakeIdentity(ctx, tx, organizationID, identity, false); err != nil {
		return metaLeadIntakeIdentity{}, err
	}
	return identity, nil
}

func (repo Repository) validateMetaLeadIntakeIdentity(ctx context.Context, tx pgx.Tx, organizationID string, identity metaLeadIntakeIdentity, requireLiveQueue bool) error {
	canonical, err := resolveStoredMetaLeadIntakeIdentity(identity.ScopeKey, identity.OriginRoundRobinID, "", "")
	if err != nil || canonical != identity {
		return fmt.Errorf("%w: invalid Meta intake identity", ErrInvalidInput)
	}
	if identity.OriginRoundRobinID == "" || !requireLiveQueue {
		return nil
	}

	var exists bool
	err = tx.QueryRow(ctx, `
		select exists (
		  select 1
		  from public.round_robins
		  where organization_id = $1::uuid
		    and id = $2::uuid
		)
	`, organizationID, identity.OriginRoundRobinID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("%w: Meta intake queue does not belong to the organization", ErrInvalidInput)
	}
	return nil
}

func normalizeMetaReentryBehavior(value string) string {
	if strings.EqualFold(strings.TrimSpace(value), "keep_assignee") {
		return "keep_assignee"
	}
	return "redistribute"
}

func firstNonEmptyText(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func lockMetaLeadIntakeIdentity(ctx context.Context, tx pgx.Tx, organizationID string, phone *string, intakeScopeKey string, legacyIdentity bool) error {
	if digitsOnly(phone) == "" {
		return nil
	}
	if legacyIdentity {
		_, err := tx.Exec(ctx, `
			select pg_advisory_xact_lock(
				hashtextextended($1 || ':legacy-global:' || normalize_phone($2), 0)
			)
		`, organizationID, *phone)
		return err
	}
	_, err := tx.Exec(ctx, `
		select pg_advisory_xact_lock(
			hashtextextended($1 || ':' || $2 || ':' || normalize_phone($3), 0)
		)
	`, organizationID, intakeScopeKey, *phone)
	return err
}

func legacyMetaLeadPhoneUniquenessActive(ctx context.Context, tx pgx.Tx) (bool, error) {
	var active bool
	err := tx.QueryRow(ctx, `
		select to_regclass('public.leads_org_phone_unique') is not null
	`).Scan(&active)
	return active, err
}

func metaLeadPhoneUniqueViolationConstraint(err error) string {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
		return ""
	}
	switch pgErr.ConstraintName {
	case "leads_org_phone_unique", "leads_org_scope_phone_unique":
		return pgErr.ConstraintName
	default:
		return ""
	}
}
