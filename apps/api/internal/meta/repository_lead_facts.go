package meta

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (repo Repository) validateProperty(ctx context.Context, tx pgx.Tx, organizationID string, propertyID *string) error {
	if propertyID == nil {
		return nil
	}

	var exists bool
	err := tx.QueryRow(ctx, `
		select exists (
			select 1
			from public.properties
			where organization_id = $1::uuid
			  and id = $2::uuid
		)
	`, organizationID, *propertyID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrInvalidInput
	}
	return nil
}

func (repo Repository) insertLeadMeta(ctx context.Context, tx pgx.Tx, organizationID string, leadID string, details map[string]any, change leadgenChange, formConfig metaFormConfig, payload string) error {
	tag, err := tx.Exec(ctx, `
		update public.lead_meta
		set platform = 'meta',
		    campaign_id = coalesce($3, campaign_id),
		    campaign_name = coalesce($4, campaign_name),
		    adset_id = coalesce($5, adset_id),
		    adset_name = coalesce($6, adset_name),
		    ad_id = coalesce($7, ad_id),
		    ad_name = coalesce($8, ad_name),
		    form_id = coalesce($9, form_id),
		    page_id = coalesce($10, page_id),
		    form_name = coalesce($11, form_name),
		    source_type = coalesce($12, source_type),
		    creative_url = coalesce($13, creative_url),
		    creative_video_url = coalesce($14, creative_video_url),
		    creative_instagram_url = coalesce($15, creative_instagram_url),
		    payload = $16::jsonb,
		    raw_payload = $16::jsonb,
		    updated_at = now()
		where organization_id = $1::uuid
		  and lead_id = $2::uuid
	`, organizationID, leadID, nullableString(metaText(details, change.Raw, "campaign_id")), nullableString(metaText(details, change.Raw, "campaign_name")), nullableString(metaText(details, change.Raw, "adset_id")), nullableString(metaText(details, change.Raw, "adset_name")), nullableString(metaText(details, change.Raw, "ad_id")), nullableString(metaText(details, change.Raw, "ad_name")), change.FormID, change.PageID, nullablePointer(formConfig.FormName), "meta", nullableString(metaText(details, change.Raw, "creative_url", "creative_thumbnail_url")), nullableString(metaText(details, change.Raw, "creative_video_url")), nullableString(metaText(details, change.Raw, "creative_instagram_url")), payload)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		return nil
	}

	_, err = tx.Exec(ctx, `
		insert into public.lead_meta (
			organization_id,
			lead_id,
			platform,
			campaign_id,
			campaign_name,
			adset_id,
			adset_name,
			ad_id,
			ad_name,
			form_id,
			page_id,
			form_name,
			source_type,
			creative_url,
			creative_video_url,
			creative_instagram_url,
			payload,
			raw_payload
		)
		values ($1::uuid, $2::uuid, 'meta', $3, $4, $5, $6, $7, $8, $9, $10, $11, 'meta', $12, $13, $14, $15::jsonb, $15::jsonb)
	`, organizationID, leadID, nullableString(metaText(details, change.Raw, "campaign_id")), nullableString(metaText(details, change.Raw, "campaign_name")), nullableString(metaText(details, change.Raw, "adset_id")), nullableString(metaText(details, change.Raw, "adset_name")), nullableString(metaText(details, change.Raw, "ad_id")), nullableString(metaText(details, change.Raw, "ad_name")), change.FormID, change.PageID, nullablePointer(formConfig.FormName), nullableString(metaText(details, change.Raw, "creative_url", "creative_thumbnail_url")), nullableString(metaText(details, change.Raw, "creative_video_url")), nullableString(metaText(details, change.Raw, "creative_instagram_url")), payload)
	return err
}

func (repo Repository) insertLeadTags(ctx context.Context, tx pgx.Tx, organizationID string, leadID string, tagIDs []string) error {
	for _, tagID := range tagIDs {
		normalizedTagID, ok := normalizeUUID(tagID)
		if !ok {
			continue
		}
		if _, err := tx.Exec(ctx, `
			insert into public.lead_tags (organization_id, lead_id, tag_id)
			select $1::uuid, $2::uuid, $3::uuid
			where exists (
				select 1
				from public.tags
				where organization_id = $1::uuid
				  and id = $3::uuid
			)
			on conflict do nothing
		`, organizationID, leadID, normalizedTagID); err != nil {
			return err
		}
	}
	return nil
}

func (repo Repository) insertLeadEntry(ctx context.Context, tx pgx.Tx, organizationID string, leadID string, details map[string]any, change leadgenChange, propertyID *string, interestValue *string, metadata map[string]any, reentry bool) error {
	jsonColumn, err := repo.leadEntryJSONColumn(ctx, tx)
	if err != nil {
		return err
	}
	occurredAt := metaLeadOccurredAt(change.CreatedTime)
	entryType := "initial"
	if reentry {
		entryType = "reentry"
	}
	if !reentry {
		updateQuery := fmt.Sprintf(`
			update public.lead_entry_events
			set source = 'meta',
			    provider = 'meta',
			    provider_event_id = $3,
			    occurred_at = $4,
			    is_countable = true,
			    source_detail = coalesce($5, source_detail),
			    campaign_id = coalesce($6, campaign_id),
			    campaign_name = coalesce($7, campaign_name),
			    adset_id = coalesce($8, adset_id),
			    adset_name = coalesce($9, adset_name),
			    ad_id = coalesce($10, ad_id),
			    ad_name = coalesce($11, ad_name),
			    form_id = coalesce($12, form_id),
			    form_name = coalesce($13, form_name),
			    page_id = coalesce($14, page_id),
			    page_name = coalesce($15, page_name),
			    property_id = coalesce($16::uuid, property_id),
			    valor_interesse = coalesce($17::numeric, valor_interesse),
			    utm_source = 'facebook',
			    utm_medium = 'lead_ads',
			    utm_campaign = coalesce($7, utm_campaign),
			    %s = coalesce(%s, '{}'::jsonb) || $18::jsonb
			where id = (
				select initial.id
				from public.lead_entry_events initial
				where initial.organization_id = $1::uuid
				  and initial.lead_id = $2::uuid
				  and initial.entry_type = 'initial'
				order by initial.created_at, initial.id
				limit 1
			)
		`, jsonColumn, jsonColumn)
		tag, err := tx.Exec(ctx, updateQuery,
			organizationID,
			leadID,
			change.LeadgenID,
			occurredAt,
			nullableString(textFromAny(metadata["source_detail"])),
			nullableString(metaText(details, change.Raw, "campaign_id")),
			nullableString(metaText(details, change.Raw, "campaign_name")),
			nullableString(metaText(details, change.Raw, "adset_id")),
			nullableString(metaText(details, change.Raw, "adset_name")),
			nullableString(metaText(details, change.Raw, "ad_id")),
			nullableString(metaText(details, change.Raw, "ad_name")),
			change.FormID,
			nullablePointer(formConfigName(metadata)),
			change.PageID,
			nullableString(textFromAny(metadata["page_name"])),
			nullablePointer(propertyID),
			nullablePointer(interestValue),
			jsonb(metadata),
		)
		if err != nil {
			return err
		}
		if tag.RowsAffected() > 0 {
			return nil
		}
	}

	query := fmt.Sprintf(`
		insert into public.lead_entry_events (
			organization_id,
			lead_id,
			source,
			provider,
			provider_event_id,
			occurred_at,
			is_countable,
			source_detail,
			entry_type,
			property_id,
			valor_interesse,
			campaign_id,
			campaign_name,
			adset_id,
			adset_name,
			ad_id,
			ad_name,
			form_id,
			form_name,
			page_id,
			page_name,
			utm_source,
			utm_medium,
			utm_campaign,
			%s
		)
		values (
			$1::uuid,
			$2::uuid,
			'meta',
			'meta',
			$3,
			$4,
			true,
			$5,
			$6,
			$7::uuid,
			$8::numeric,
			$9,
			$10,
			$11,
			$12,
			$13,
			$14,
			$15,
			$16,
			$17,
			$18,
			'facebook',
			'lead_ads',
			$10,
			$19::jsonb
		)
		on conflict (organization_id, provider, provider_event_id)
			where provider_event_id is not null and is_countable = true
		do nothing
	`, jsonColumn)

	tag, err := tx.Exec(ctx, query,
		organizationID,
		leadID,
		change.LeadgenID,
		occurredAt,
		nullableString(textFromAny(metadata["source_detail"])),
		entryType,
		nullablePointer(propertyID),
		nullablePointer(interestValue),
		nullableString(metaText(details, change.Raw, "campaign_id")),
		nullableString(metaText(details, change.Raw, "campaign_name")),
		nullableString(metaText(details, change.Raw, "adset_id")),
		nullableString(metaText(details, change.Raw, "adset_name")),
		nullableString(metaText(details, change.Raw, "ad_id")),
		nullableString(metaText(details, change.Raw, "ad_name")),
		change.FormID,
		nullablePointer(formConfigName(metadata)),
		change.PageID,
		nullableString(textFromAny(metadata["page_name"])),
		jsonb(metadata),
	)
	if err == nil && tag.RowsAffected() == 0 {
		return duplicateLeadgenError{leadID: leadID}
	}
	return err
}

func formConfigName(metadata map[string]any) *string {
	value := textFromAny(metadata["form_name"])
	if value == "" {
		return nil
	}
	return &value
}

func metaLeadOccurredAt(raw string) time.Time {
	raw = strings.TrimSpace(raw)
	seconds, err := strconv.ParseInt(raw, 10, 64)
	if err == nil {
		if len(raw) == 13 {
			seconds /= 1000
		}
		if seconds > 0 {
			return time.Unix(seconds, 0).UTC()
		}
	}
	return time.Now().UTC()
}

func (repo Repository) leadEntryJSONColumn(ctx context.Context, tx pgx.Tx) (string, error) {
	var column string
	err := tx.QueryRow(ctx, `
		select case
			when exists (
				select 1
				from information_schema.columns
				where table_schema = 'public'
				  and table_name = 'lead_entry_events'
				  and column_name = 'metadata'
			) then 'metadata'
			when exists (
				select 1
				from information_schema.columns
				where table_schema = 'public'
				  and table_name = 'lead_entry_events'
				  and column_name = 'payload'
			) then 'payload'
			else ''
		end
	`).Scan(&column)
	if err != nil {
		return "", err
	}
	if column != "metadata" && column != "payload" {
		return "", errors.New("lead_entry_events JSON column was not found")
	}
	return column, nil
}

func (repo Repository) insertActivity(ctx context.Context, tx pgx.Tx, organizationID string, leadID string, leadName string, reentry bool, metadata map[string]any) error {
	activityType := "lead_created"
	content := fmt.Sprintf(`Lead "%s" foi criado pela Meta`, leadName)
	if reentry {
		activityType = "lead_reentry"
		content = fmt.Sprintf(`Lead "%s" retornou pela Meta`, leadName)
	}

	_, err := tx.Exec(ctx, `
		insert into public.activities (
			organization_id,
			lead_id,
			user_id,
			type,
			content,
			metadata
		)
		values ($1::uuid, $2::uuid, null, $3, $4, $5::jsonb)
	`, organizationID, leadID, activityType, content, jsonb(metadata))
	return err
}

func (repo Repository) incrementStats(ctx context.Context, tx pgx.Tx, integrationID string, formConfigID string) error {
	if _, err := tx.Exec(ctx, `
		update public.meta_integrations
		set leads_received = coalesce(leads_received, 0) + 1,
		    last_lead_at = now(),
		    last_sync_at = now(),
		    health_status = 'ok',
		    last_error = null,
		    updated_at = now()
		where id = $1::uuid
	`, integrationID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `
		update public.meta_form_configs
		set leads_received = coalesce(leads_received, 0) + 1,
		    last_lead_at = now(),
		    updated_at = now()
		where id = $1::uuid
	`, formConfigID)
	return err
}
