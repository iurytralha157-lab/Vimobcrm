package portals

import (
	"context"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
)

func insertWebhookEvent(ctx context.Context, tx pgx.Tx, integration publicIntegration, eventType string, eventKey string, payload []byte) (string, *string, *string, bool, error) {
	var eventID string
	var leadID *string
	var propertyID *string
	err := tx.QueryRow(ctx, `
		insert into public.portal_webhook_events (
			integration_id,
			organization_id,
			portal,
			event_type,
			event_key,
			source_id,
			payload
		)
		values ($1::uuid, $2::uuid, 'grupo_olx', $3, $4, $4, $5::jsonb)
		on conflict (integration_id, event_type, event_key) where event_key is not null
		do nothing
		returning id::text, lead_id::text, property_id::text
	`, integration.ID, integration.OrganizationID, eventType, eventKey, string(payload)).Scan(&eventID, &leadID, &propertyID)
	if err == nil {
		return eventID, leadID, propertyID, false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", nil, nil, false, err
	}

	err = tx.QueryRow(ctx, `
		select id::text, lead_id::text, property_id::text
		from public.portal_webhook_events
		where integration_id = $1::uuid
		  and event_type = $2
		  and event_key = $3
		limit 1
	`, integration.ID, eventType, eventKey).Scan(&eventID, &leadID, &propertyID)
	if err != nil {
		return "", nil, nil, false, err
	}

	_, _ = tx.Exec(ctx, `
		update public.portal_webhook_events
		set processing_status = case when lead_id is null then 'duplicate' else processing_status end
		where id = $1::uuid
	`, eventID)
	return eventID, leadID, propertyID, true, nil
}

func findPublicationProperty(ctx context.Context, tx pgx.Tx, integrationID string, clientListingID string) (*string, *string, error) {
	if strings.TrimSpace(clientListingID) == "" {
		return nil, nil, nil
	}
	var propertyID string
	var propertyCode string
	err := tx.QueryRow(ctx, `
		select property.id::text, property.code
		from public.property_channel_publications publication
		join public.properties property
		  on property.organization_id = publication.organization_id
		 and property.id = publication.property_id
		where publication.channel = 'grupo_olx'
		  and publication.channel_account_key = $1
		  and publication.provider_listing_id = $2
		order by (publication.observed_state = 'published') desc, publication.updated_at desc
		limit 1
	`, integrationID, clientListingID).Scan(&propertyID, &propertyCode)
	if err == nil {
		return &propertyID, &propertyCode, nil
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, err
	}

	err = tx.QueryRow(ctx, `
		select property.id::text, property.code
		from public.portal_listing_publications publication
		join public.properties property
		  on property.organization_id = publication.organization_id
		 and property.id = publication.property_id
		where publication.integration_id = $1::uuid
		  and publication.client_listing_id = $2
		  and publication.is_enabled = true
		  and not exists (
		    select 1
		    from public.property_channel_publications canonical
		    where canonical.channel = 'grupo_olx'
		      and canonical.channel_account_key = $1
		      and canonical.provider_listing_id = $2
		  )
		limit 1
	`, integrationID, clientListingID).Scan(&propertyID, &propertyCode)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &clientListingID, nil
	}
	if err != nil {
		return nil, nil, err
	}
	return &propertyID, &propertyCode, nil
}

func validWebhookAuthorization(header string, secret string) bool {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return false
	}
	header = strings.TrimSpace(header)
	if header == "" || !strings.HasPrefix(strings.ToLower(header), "basic ") {
		return false
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(header[6:]))
	if err != nil {
		return false
	}
	parts := strings.SplitN(string(decoded), ":", 2)
	candidates := []string{string(decoded)}
	if len(parts) == 2 {
		candidates = append(candidates, parts[1])
	}
	for _, candidate := range candidates {
		if webhookSecretMatches(secret, candidate) {
			return true
		}
	}
	return false
}

func webhookSecretMatches(stored string, candidate string) bool {
	stored = strings.TrimSpace(stored)
	candidate = strings.TrimSpace(candidate)
	if stored == "" || candidate == "" {
		return false
	}
	if len(stored) != len(candidate) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(stored), []byte(candidate)) == 1
}
