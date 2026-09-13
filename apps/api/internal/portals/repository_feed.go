package portals

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
)

func (repo Repository) BuildGrupoOLXFeed(ctx context.Context, token string) ([]byte, error) {
	integration, err := repo.integrationByPublicToken(ctx, token, "feed_token", false)
	if err != nil {
		return nil, err
	}
	if (integration.Status == "draft" || (!integration.IsActive && integration.Status != "paused")) ||
		strings.TrimSpace(textFromSettings(integration.Settings, "contact_name")) == "" ||
		strings.TrimSpace(textFromSettings(integration.Settings, "contact_email")) == "" {
		return nil, ErrFeedNotActivated
	}
	selection := feedSelection{
		Listings:         []feedListing{},
		Invalid:          map[string][]string{},
		InvalidLegacy:    map[string][]string{},
		InvalidCanonical: map[string]canonicalFeedValidationIssue{},
		ValidCanonical:   map[string]canonicalFeedValidationIssue{},
	}
	feedActive := integration.IsActive && integration.Status != "paused" && integration.ModuleEnabled
	if feedActive {
		selection, err = repo.feedListings(ctx, integration)
		if err != nil {
			return nil, err
		}
	}
	xmlBytes, err := buildVRSyncFeed(integration, selection.Listings)
	if err != nil {
		return nil, err
	}
	if len(xmlBytes) > 30*1024*1024 {
		return nil, fmt.Errorf("grupo olx feed exceeds 30MB")
	}

	legacyValidIDs := make([]string, 0, len(selection.Listings))
	for _, listing := range selection.Listings {
		if listing.Source == "legacy" {
			legacyValidIDs = append(legacyValidIDs, listing.PublicationID)
		}
	}
	invalidJSON, err := json.Marshal(selection.InvalidLegacy)
	if err != nil {
		return nil, err
	}
	syncStatus := fmt.Sprintf("feed_served:valid=%d:invalid=%d", len(selection.Listings), len(selection.Invalid))
	lastError := ""
	if !feedActive {
		syncStatus = "feed_draining:integration_inactive"
	} else if len(selection.Listings) == 0 && len(selection.Invalid) > 0 {
		lastError = "Todos os imoveis habilitados possuem erros de validacao."
	}
	integrationStatus := "connected"
	if feedActive && len(selection.Listings) == 0 && len(selection.Invalid) > 0 {
		integrationStatus = "error"
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		update public.portal_integrations
		set last_feed_accessed_at = now(),
		    last_sync_status = $2,
		    status = case
		      when $5::boolean and portal_integrations.is_active and portal_integrations.status <> 'paused' then $3
		      else portal_integrations.status
		    end,
		    last_error = nullif($4, '')
		where id = $1::uuid
	`, integration.ID, syncStatus, integrationStatus, lastError, feedActive); err != nil {
		return nil, err
	}
	if len(legacyValidIDs) > 0 {
		if _, err := tx.Exec(ctx, `
			update public.portal_listing_publications
			set status = 'exported',
			    last_exported_at = now(),
			    last_seen_in_feed_at = now(),
			    validation_errors = '[]'::jsonb,
			    last_error = null
			where integration_id = $1::uuid
			  and id = any($2::uuid[])
		`, integration.ID, legacyValidIDs); err != nil {
			return nil, err
		}
	}
	if len(selection.InvalidLegacy) > 0 {
		if _, err := tx.Exec(ctx, `
			update public.portal_listing_publications publication
			set status = 'invalid',
			    validation_errors = invalid.errors,
			    last_error = invalid.errors->>0
			from jsonb_each($2::jsonb) as invalid(publication_id, errors)
			where publication.integration_id = $1::uuid
			  and publication.id = invalid.publication_id::uuid
		`, integration.ID, string(invalidJSON)); err != nil {
			return nil, err
		}
	}
	if err := applyCanonicalFeedValidationIssues(ctx, tx, integration.ID, selection.InvalidCanonical); err != nil {
		return nil, err
	}
	if err := clearCanonicalFeedValidationIssues(ctx, tx, integration.ID, selection.ValidCanonical); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return xmlBytes, nil
}

func clearCanonicalFeedValidationIssues(
	ctx context.Context,
	tx pgx.Tx,
	integrationID string,
	valid map[string]canonicalFeedValidationIssue,
) error {
	if len(valid) == 0 {
		return nil
	}
	type validInput struct {
		PublicationID    string `json:"publication_id"`
		PublishedVersion int64  `json:"published_version"`
		VersionID        string `json:"version_id"`
		PayloadHash      string `json:"payload_hash"`
	}
	publicationIDs := make([]string, 0, len(valid))
	for publicationID := range valid {
		publicationIDs = append(publicationIDs, publicationID)
	}
	sort.Strings(publicationIDs)
	payload := make([]validInput, 0, len(publicationIDs))
	for _, publicationID := range publicationIDs {
		item := valid[publicationID]
		payload = append(payload, validInput{
			PublicationID: publicationID, PublishedVersion: item.PublishedVersion,
			VersionID: item.VersionID, PayloadHash: item.PayloadHash,
		})
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	// Feed validation is derived telemetry. Clear the adapter-owned checks for
	// every exact delivered version in one statement and never touch updated_at,
	// which is the optimistic-concurrency token for publication commands.
	_, err = tx.Exec(ctx, `
		with input as (
		  select *
		  from jsonb_to_recordset($2::jsonb) as item(
		    publication_id uuid,
		    published_version bigint,
		    version_id uuid,
		    payload_hash text
		  )
		), eligible as (
		  select publication.id,
		         coalesce((
		           select jsonb_agg(entry.value order by entry.ordinality)
		           from jsonb_array_elements(
		             case when jsonb_typeof(publication.validation_errors) = 'array'
		               then publication.validation_errors else '[]'::jsonb end
		           ) with ordinality as entry(value, ordinality)
		           where strpos(coalesce(entry.value->>'code', ''), 'grupo_olx_feed_validation') <> 1
		         ), '[]'::jsonb) as cleaned_validation_errors
		  from public.property_channel_publications publication
		  join input on input.publication_id = publication.id
		  where publication.channel = 'grupo_olx'
		    and publication.channel_account_key = $1
		    and publication.published_version = input.published_version
		    and exists (
		      select 1
		      from public.property_channel_publication_versions version
		      where version.id = input.version_id
		        and version.publication_id = publication.id
		        and version.version = publication.published_version
		        and version.payload_hash = input.payload_hash
		    )
		)
		update public.property_channel_publications publication
		set validation_errors = eligible.cleaned_validation_errors,
		    last_error_code = case
		      when publication.last_error_code = 'grupo_olx_feed_validation' then null
		      else publication.last_error_code end,
		    last_error_message = case
		      when publication.last_error_code = 'grupo_olx_feed_validation' then null
		      else publication.last_error_message end
		from eligible
		where publication.id = eligible.id
		  and (
		    publication.validation_errors is distinct from eligible.cleaned_validation_errors
		    or publication.last_error_code = 'grupo_olx_feed_validation'
		  )
	`, integrationID, string(encoded))
	return err
}

func removePortalChecksByPrefix(checks []portalPublicationCheck, prefix string) []portalPublicationCheck {
	result := make([]portalPublicationCheck, 0, len(checks))
	for _, check := range checks {
		if strings.HasPrefix(check.Code, prefix) {
			continue
		}
		result = append(result, check)
	}
	return result
}

func applyCanonicalFeedValidationIssues(
	ctx context.Context,
	tx pgx.Tx,
	integrationID string,
	issues map[string]canonicalFeedValidationIssue,
) error {
	if len(issues) == 0 {
		return nil
	}
	type invalidInput struct {
		PublicationID    string   `json:"publication_id"`
		PublishedVersion int64    `json:"published_version"`
		VersionID        string   `json:"version_id"`
		PayloadHash      string   `json:"payload_hash"`
		Messages         []string `json:"messages"`
	}
	publicationIDs := make([]string, 0, len(issues))
	for publicationID := range issues {
		publicationIDs = append(publicationIDs, publicationID)
	}
	sort.Strings(publicationIDs)
	payload := make([]invalidInput, 0, len(publicationIDs))
	for _, publicationID := range publicationIDs {
		issue := issues[publicationID]
		messages := uniqueNonEmptyStrings(issue.Messages)
		if len(messages) == 0 {
			continue
		}
		bounded := make([]string, 0, len(messages))
		for _, message := range messages {
			bounded = append(bounded, truncatePortalRunes(message, 1000))
		}
		payload = append(payload, invalidInput{
			PublicationID: publicationID, PublishedVersion: issue.PublishedVersion,
			VersionID: issue.VersionID, PayloadHash: issue.PayloadHash, Messages: bounded,
		})
	}
	if len(payload) == 0 {
		return nil
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	// Replace all adapter-owned checks in one fenced update. Repeated feed reads
	// with identical errors become zero-write operations and cannot invalidate a
	// concurrent publish/unpublish If-Match token through updated_at churn.
	_, err = tx.Exec(ctx, `
		with input as (
		  select *
		  from jsonb_to_recordset($2::jsonb) as item(
		    publication_id uuid,
		    published_version bigint,
		    version_id uuid,
		    payload_hash text,
		    messages jsonb
		  )
		), eligible as (
		  select publication.id,
		         input.messages->>0 as first_message,
		         coalesce((
		           select jsonb_agg(entry.value order by entry.ordinality)
		           from jsonb_array_elements(
		             case when jsonb_typeof(publication.validation_errors) = 'array'
		               then publication.validation_errors else '[]'::jsonb end
		           ) with ordinality as entry(value, ordinality)
		           where strpos(coalesce(entry.value->>'code', ''), 'grupo_olx_feed_validation') <> 1
		         ), '[]'::jsonb) || coalesce((
		           select jsonb_agg(jsonb_build_object(
		             'code', 'grupo_olx_feed_validation_' || substr(md5(message.value), 1, 12),
		             'label', 'Validacao do adaptador VRSync',
		             'severity', 'error',
		             'resolved', false,
		             'message', message.value
		           ) order by message.ordinality)
		           from jsonb_array_elements_text(input.messages) with ordinality as message(value, ordinality)
		         ), '[]'::jsonb) as next_validation_errors
		  from public.property_channel_publications publication
		  join input on input.publication_id = publication.id
		  where publication.channel = 'grupo_olx'
		    and publication.channel_account_key = $1
		    and publication.published_version = input.published_version
		    and jsonb_array_length(input.messages) > 0
		    and exists (
		      select 1
		      from public.property_channel_publication_versions version
		      where version.id = input.version_id
		        and version.publication_id = publication.id
		        and version.version = publication.published_version
		        and version.payload_hash = input.payload_hash
		    )
		)
		update public.property_channel_publications publication
		set validation_errors = eligible.next_validation_errors,
		    last_error_code = 'grupo_olx_feed_validation',
		    last_error_message = left(eligible.first_message, 4000),
		    last_attempt_at = clock_timestamp()
		from eligible
		where publication.id = eligible.id
		  and (
		    publication.validation_errors is distinct from eligible.next_validation_errors
		    or publication.last_error_code is distinct from 'grupo_olx_feed_validation'
		    or publication.last_error_message is distinct from left(eligible.first_message, 4000)
		  )
	`, integrationID, string(encoded))
	return err
}

type feedSelection struct {
	Listings         []feedListing
	Invalid          map[string][]string
	InvalidLegacy    map[string][]string
	InvalidCanonical map[string]canonicalFeedValidationIssue
	ValidCanonical   map[string]canonicalFeedValidationIssue
}

type canonicalFeedValidationIssue struct {
	Messages         []string
	PublishedVersion int64
	VersionID        string
	PayloadHash      string
}

func (repo Repository) feedListings(ctx context.Context, integration publicIntegration) (feedSelection, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		with canonical_scope as (
		  select publication.property_id, publication.provider_listing_id
		  from public.property_channel_publications publication
		  where publication.organization_id = $2::uuid
		    and publication.channel = 'grupo_olx'
		    and publication.channel_account_key = $1
		), feed_rows as (
		  select publication.id::text as publication_id,
		         publication.property_id::text as property_id,
		         'canonical'::text as source,
		         version.id::text as version_id,
		         version.version as published_version,
		         version.payload_hash,
		         version.payload->'channel_config'->>'client_listing_id' as client_listing_id,
		         version.payload->'channel_config'->>'publication_type' as publication_type,
		         version.payload->'property' as property,
		         version.payload->'media' as media,
		         publication.updated_at as sort_at
		  from public.property_channel_publications publication
		  join public.property_channel_publication_versions version
		    on version.publication_id = publication.id
		   and version.organization_id = publication.organization_id
		   and version.property_id = publication.property_id
		   and version.channel = publication.channel
		   and version.channel_account_key = publication.channel_account_key
		   and version.version = publication.published_version
		  where publication.organization_id = $2::uuid
		    and publication.channel = 'grupo_olx'
		    and publication.channel_account_key = $1
		    and publication.desired_state = 'published'
		    and publication.observed_state in ('published', 'queued', 'publishing')
		    and publication.published_version is not null
		    and jsonb_typeof(version.payload->'property') = 'object'
		    and jsonb_typeof(version.payload->'channel_config') = 'object'

		  union all

		  select legacy.id::text,
		         legacy.property_id::text,
		         'legacy'::text,
		         ''::text,
		         0::bigint,
		         ''::text,
		         legacy.client_listing_id,
		         legacy.publication_type,
		         to_jsonb(property),
		         '[]'::jsonb,
		         property.updated_at
		  from public.portal_listing_publications legacy
		  join public.properties property
		    on property.organization_id = legacy.organization_id
		   and property.id = legacy.property_id
		  where legacy.integration_id = $1::uuid
		    and legacy.organization_id = $2::uuid
		    and legacy.portal = 'grupo_olx'
		    and legacy.is_enabled = true
		    and not exists (
		      select 1
		      from canonical_scope canonical
		      where canonical.property_id = legacy.property_id
		         or canonical.provider_listing_id = legacy.client_listing_id
		    )
		)
		select jsonb_build_object(
		  'publication_id', publication_id,
		  'property_id', property_id,
		  'source', source,
		  'version_id', version_id,
		  'published_version', published_version,
		  'payload_hash', payload_hash,
		  'client_listing_id', client_listing_id,
		  'publication_type', publication_type,
		  'property', property,
		  'media', media
		)
		from feed_rows
		order by sort_at desc, publication_id
		limit 50001
	`, integration.ID, integration.OrganizationID)
	if err != nil {
		return feedSelection{}, err
	}
	defer rows.Close()
	selection := feedSelection{
		Listings:         []feedListing{},
		Invalid:          map[string][]string{},
		InvalidLegacy:    map[string][]string{},
		InvalidCanonical: map[string]canonicalFeedValidationIssue{},
		ValidCanonical:   map[string]canonicalFeedValidationIssue{},
	}
	candidateCount := 0
	for rows.Next() {
		candidateCount++
		if err := ensureFeedListingLimit(candidateCount); err != nil {
			return feedSelection{}, err
		}
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return feedSelection{}, err
		}
		var listing feedListing
		if err := json.Unmarshal(raw, &listing); err != nil {
			return feedSelection{}, err
		}
		validationErrors := validateFeedListing(integration, listing)
		if len(validationErrors) == 0 {
			selection.Listings = append(selection.Listings, listing)
			if listing.Source == "canonical" {
				selection.ValidCanonical[listing.PublicationID] = canonicalFeedValidationIssue{
					PublishedVersion: listing.PublishedVersion,
					VersionID:        listing.VersionID, PayloadHash: listing.PayloadHash,
				}
			}
		} else {
			selection.Invalid[listing.PublicationID] = validationErrors
			if listing.Source == "canonical" {
				selection.InvalidCanonical[listing.PublicationID] = canonicalFeedValidationIssue{
					Messages: validationErrors, PublishedVersion: listing.PublishedVersion,
					VersionID: listing.VersionID, PayloadHash: listing.PayloadHash,
				}
			} else {
				selection.InvalidLegacy[listing.PublicationID] = validationErrors
			}
		}
	}
	return selection, rows.Err()
}

func ensureFeedListingLimit(candidateCount int) error {
	if candidateCount > maxGrupoOLXFeedListings {
		return ErrFeedListingLimit
	}
	return nil
}
