package portals

import (
	"context"
	"encoding/json"
	"errors"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
)

func (repo Repository) ProcessGrupoOLXLead(ctx context.Context, token string, authorization string, payload []byte) (leadWebhookResult, error) {
	if !validWebhookAuthorization(authorization, repo.webhookSecret) {
		return leadWebhookResult{}, ErrUnauthorized
	}
	// A paused account can remain advertised by Grupo OLX for hours. Keep the
	// authenticated drain path accepting leads until the provider removes it.
	integration, err := repo.integrationByPublicToken(ctx, token, "webhook_token", false)
	if err != nil {
		return leadWebhookResult{}, err
	}
	var body map[string]any
	if err := json.Unmarshal(payload, &body); err != nil {
		return leadWebhookResult{}, ErrInvalidInput
	}
	rawEventKey := strings.TrimSpace(firstText(body, "originLeadId", "leadId", "id"))
	if rawEventKey == "" {
		return leadWebhookResult{}, ErrInvalidInput
	}
	eventKey := normalizeGrupoOLXLeadEventKey(rawEventKey, payload)
	rawClientListingID := strings.TrimSpace(firstText(body, "clientListingId", "listingId", "propertyCode"))
	isMCMVLead := isGrupoOLXMCMVLead(body)
	if !isMCMVLead && (rawClientListingID == "" || utf8.RuneCountInString(rawClientListingID) > 50) {
		return leadWebhookResult{}, ErrInvalidInput
	}
	clientListingID := truncatePortalRunes(rawClientListingID, 80)
	lookupListingID := rawClientListingID
	if utf8.RuneCountInString(lookupListingID) > 50 {
		lookupListingID = ""
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return leadWebhookResult{}, err
	}
	defer tx.Rollback(ctx)

	eventID, existingLeadID, existingPropertyID, duplicate, err := insertWebhookEvent(ctx, tx, integration, "lead", eventKey, payload)
	if err != nil {
		return leadWebhookResult{}, err
	}
	if duplicate {
		if err := tx.Commit(ctx); err != nil {
			return leadWebhookResult{}, err
		}
		return leadWebhookResult{
			EventID: eventID, LeadID: existingLeadID, PropertyID: existingPropertyID,
			Duplicate: true, Linked: existingPropertyID != nil,
		}, nil
	}

	var propertyID, propertyCode *string
	if lookupListingID != "" {
		propertyID, propertyCode, err = findPublicationProperty(ctx, tx, integration.ID, lookupListingID)
		if err != nil {
			return leadWebhookResult{}, err
		}
	}
	unlinkedOrdinaryLead := !isMCMVLead && propertyID == nil
	destination, err := repo.resolvePortalDestination(ctx, tx, integration)
	if err != nil {
		return leadWebhookResult{}, err
	}
	destination, err = resolveAutomaticPortalIntakeDestination(ctx, tx, integration.OrganizationID, destination, propertyID)
	if err != nil {
		return leadWebhookResult{}, err
	}

	name := truncatePortalRunes(firstText(body, "name", "consumerName", "leadName"), 180)
	email := normalizeGrupoOLXLeadEmail(firstText(body, "email", "consumerEmail"))
	phone := normalizeGrupoOLXLeadPhone(body)
	message := truncatePortalRunes(firstText(body, "message", "messageBody", "description"), 2000)
	leadOrigin, leadType, providerOccurredAt, mcmv := grupoOLXLeadAnalytics(body)
	leadOrigin = truncatePortalRunes(leadOrigin, 80)
	leadType = truncatePortalRunes(leadType, 80)
	sourceDetail := leadType
	if isMCMVLead {
		sourceDetail = "MCMV_OLX"
	}
	if sourceDetail == "" {
		sourceDetail = "Grupo OLX"
	}

	leadID := ""
	leadMetadata := map[string]any{
		"provider":              "grupo_olx",
		"origin_lead_id":        eventKey,
		"client_listing_id":     clientListingID,
		"property_code":         clientListingID,
		"origin_listing_id":     truncatePortalRunes(firstText(body, "originListingId"), 80),
		"temperature":           truncatePortalRunes(firstText(body, "temperature"), 80),
		"transaction_type":      truncatePortalRunes(firstText(body, "transactionType"), 80),
		"lead_origin":           leadOrigin,
		"lead_type":             leadType,
		"provider_occurred_at":  providerOccurredAt,
		"webhook_payload":       body,
		"distribution_deferred": true,
	}
	intakeScopeKey := portalLeadIntakeScopeKey(destination.RoundRobinID)
	leadMetadata["intake_scope_key"] = intakeScopeKey
	if destination.RoundRobinID != "" {
		leadMetadata["origin_round_robin_id"] = destination.RoundRobinID
	}
	if unlinkedOrdinaryLead {
		leadMetadata["unlinked_reason"] = "listing_not_found"
	}
	if mcmv != nil {
		leadMetadata["mcmv"] = mcmv
	}
	metadataJSON, _ := json.Marshal(leadMetadata)
	leadID, reentry, err := repo.persistGrupoOLXLead(
		ctx, tx, integration, destination, eventKey, name, email, phone,
		sourceDetail, message, providerOccurredAt, propertyID, propertyCode, metadataJSON,
	)
	if err != nil {
		return leadWebhookResult{}, err
	}

	if _, err := tx.Exec(ctx, `
		insert into public.lead_meta (organization_id, lead_id, platform, form_id, payload)
		values ($1::uuid, $2::uuid, 'grupo_olx', $3, $4::jsonb)
		on conflict (lead_id) do update
		set platform = excluded.platform,
		    form_id = excluded.form_id,
		    payload = excluded.payload,
		    updated_at = now()
	`, integration.OrganizationID, leadID, eventKey, string(metadataJSON)); err != nil {
		return leadWebhookResult{}, err
	}
	var roundRobinID *string
	if destination.RoundRobinID != "" {
		roundRobinID = &destination.RoundRobinID
	}
	distributionSource := "grupo_olx"
	if _, err := distribution.Distribute(ctx, tx, distribution.Request{
		OrganizationID:     integration.OrganizationID,
		LeadID:             leadID,
		IdempotencyKey:     "portal:" + eventID,
		RoundRobinID:       roundRobinID,
		RoundRobinResolved: destination.RoundRobinResolved,
		PreserveAssignee:   preserveAssigneeForPortalIntake(reentry, destination),
		Source:             &distributionSource,
		OccurredAt:         time.Now().UTC(),
	}); err != nil {
		return leadWebhookResult{}, err
	}

	_, err = tx.Exec(ctx, `
		update public.portal_webhook_events
		set processing_status = 'processed',
		    lead_id = $2::uuid,
		    property_id = nullif($3, '')::uuid,
		    processed_at = now()
		where id = $1::uuid
	`, eventID, leadID, nullableStringValue(propertyID))
	if err != nil {
		return leadWebhookResult{}, err
	}
	_, err = tx.Exec(ctx, `
		update public.portal_integrations
		set last_lead_received_at = now(),
		    status = case when is_active and status <> 'paused' then 'connected' else status end,
		    last_sync_status = case when $2::boolean then 'lead_received_unlinked' else last_sync_status end,
		    last_error = case when $2::boolean
		      then left('Lead recebido sem vínculo para ListingID ' || $3, 4000)
		      else last_error end,
		    updated_at = now()
		where id = $1::uuid
	`, integration.ID, unlinkedOrdinaryLead, clientListingID)
	if err != nil {
		return leadWebhookResult{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return leadWebhookResult{}, err
	}
	return leadWebhookResult{
		EventID:    eventID,
		LeadID:     &leadID,
		PropertyID: propertyID,
		Linked:     propertyID != nil,
	}, nil
}

func (repo Repository) persistGrupoOLXLead(
	ctx context.Context,
	tx pgx.Tx,
	integration publicIntegration,
	destination portalDestination,
	eventKey string,
	name string,
	email string,
	phone string,
	sourceDetail string,
	message string,
	providerOccurredAt string,
	propertyID *string,
	propertyCode *string,
	metadataJSON []byte,
) (string, bool, error) {
	runAttempt := func(forceLegacyIdentity *bool) (string, bool, error) {
		attemptTx, err := tx.Begin(ctx)
		if err != nil {
			return "", false, err
		}
		leadID, reentry, err := repo.persistGrupoOLXLeadWithIdentityMode(
			ctx, attemptTx, integration, destination, eventKey, name, email, phone,
			sourceDetail, message, providerOccurredAt, propertyID, propertyCode, metadataJSON,
			forceLegacyIdentity,
		)
		if err != nil {
			_ = attemptTx.Rollback(ctx)
			return "", false, err
		}
		if err := attemptTx.Commit(ctx); err != nil {
			_ = attemptTx.Rollback(ctx)
			return "", false, err
		}
		return leadID, reentry, nil
	}

	leadID, reentry, err := runAttempt(nil)
	constraintName := portalLeadPhoneUniqueViolationConstraint(err)
	if constraintName == "" {
		return leadID, reentry, err
	}
	legacyIdentity := constraintName == "leads_org_phone_unique"
	return runAttempt(&legacyIdentity)
}

func (repo Repository) persistGrupoOLXLeadWithIdentityMode(
	ctx context.Context,
	tx pgx.Tx,
	integration publicIntegration,
	destination portalDestination,
	eventKey string,
	name string,
	email string,
	phone string,
	sourceDetail string,
	message string,
	providerOccurredAt string,
	propertyID *string,
	propertyCode *string,
	metadataJSON []byte,
	forceLegacyIdentity *bool,
) (string, bool, error) {
	leadID := ""
	reentry := false
	intakeScopeKey := portalLeadIntakeScopeKey(destination.RoundRobinID)
	legacyIdentity := false
	var err error
	if forceLegacyIdentity != nil {
		legacyIdentity = *forceLegacyIdentity
	} else {
		legacyIdentity, err = legacyPortalLeadPhoneUniquenessActive(ctx, tx)
		if err != nil {
			return "", false, err
		}
	}
	if phone != "" {
		if err := lockPortalLeadIntakeIdentity(ctx, tx, integration.OrganizationID, phone, intakeScopeKey, legacyIdentity); err != nil {
			return "", false, err
		}
		if legacyIdentity {
			leadID, err = findPortalLeadByPhoneLegacy(ctx, tx, integration.OrganizationID, phone)
		} else {
			leadID, err = findPortalLeadByPhone(ctx, tx, integration.OrganizationID, phone, intakeScopeKey)
		}
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return "", false, err
		}
		reentry = err == nil
	}

	if reentry {
		// The entry is written before moving the lead so funnel triggers attribute
		// any state transition to this provider event, not the previous contact.
		if _, err := tx.Exec(ctx, `
			insert into public.lead_entry_events (
			  lead_id, organization_id, entry_type, source, source_detail,
			  provider, provider_event_id, occurred_at, property_id,
			  pipeline_id, stage_id, metadata, payload, created_at
			) values (
			  $1::uuid, $2::uuid, 'reentry', 'grupo_olx', $3,
			  'grupo_olx', $4, coalesce(nullif($5, '')::timestamptz, clock_timestamp()),
			  nullif($6, '')::uuid, nullif($7, '')::uuid, nullif($8, '')::uuid,
			  $9::jsonb, $9::jsonb, clock_timestamp()
			)
		`, leadID, integration.OrganizationID, sourceDetail, eventKey, providerOccurredAt,
			nullableStringValue(propertyID), destination.PipelineID, destination.StageID, string(metadataJSON)); err != nil {
			return "", false, err
		}
		if _, err := tx.Exec(ctx, `
			update public.leads
			set name = coalesce(nullif($3, ''), name),
			    email = coalesce(nullif($4, ''), email),
			    phone = coalesce(nullif($5, ''), phone),
			    source = coalesce(nullif(source, ''), 'grupo_olx'),
			    source_detail = coalesce(nullif($6, ''), source_detail),
			    message = coalesce(nullif($7, ''), message),
			    initial_message = coalesce(initial_message, nullif($7, '')),
			    pipeline_id = coalesce(nullif($8, '')::uuid, pipeline_id),
			    stage_entered_at = case
			      when nullif($9, '')::uuid is null or stage_id is not distinct from nullif($9, '')::uuid then stage_entered_at
			      else clock_timestamp() end,
			    board_order_at = clock_timestamp(),
			    stage_id = coalesce(nullif($9, '')::uuid, stage_id),
			    property_id = coalesce(nullif($10, '')::uuid, property_id),
			    interest_property_id = coalesce(nullif($10, '')::uuid, interest_property_id),
			    property_code = coalesce(nullif($11, ''), property_code),
			    last_entry_at = clock_timestamp(),
			    reentry_count = coalesce(reentry_count, 0) + 1,
			    metadata = coalesce(metadata, '{}'::jsonb) || ($12::jsonb - 'intake_scope_key' - 'origin_round_robin_id'),
			    updated_at = clock_timestamp()
			where organization_id = $1::uuid and id = $2::uuid
		`, integration.OrganizationID, leadID, name, email, phone, sourceDetail, message,
			destination.PipelineID, destination.StageID, nullableStringValue(propertyID), nullableStringValue(propertyCode), string(metadataJSON)); err != nil {
			return "", false, err
		}
	} else {
		err := tx.QueryRow(ctx, `
			insert into public.leads (
			  organization_id, pipeline_id, stage_id, assigned_user_id, team_id,
			  property_id, interest_property_id, property_code, name, email, phone,
			  source, source_detail, message, initial_message, status, deal_status,
			  utm_source, utm_medium, metadata, created_by, last_entry_at, updated_at,
			  intake_scope_key, origin_round_robin_id
			) values (
			  $1::uuid, nullif($2, '')::uuid, nullif($3, '')::uuid,
			  nullif($4, '')::uuid, nullif($5, '')::uuid,
			  nullif($6, '')::uuid, nullif($6, '')::uuid, nullif($7, ''),
			  coalesce(nullif($8, ''), 'Lead Grupo OLX'), nullif($9, ''), nullif($10, ''), 'grupo_olx', $11,
			  nullif($12, ''), nullif($12, ''), 'new', 'open',
			  'grupo_olx', 'portal', $13::jsonb, nullif($14, '')::uuid,
			  clock_timestamp(), clock_timestamp(), $15, nullif($16, '')::uuid
			)
			returning id::text
		`, integration.OrganizationID, destination.PipelineID, destination.StageID,
			destination.AssignedUserID, destination.TeamID, nullableStringValue(propertyID),
			nullableStringValue(propertyCode), name, email, phone, sourceDetail, message,
			string(metadataJSON), destination.AssignedUserID, intakeScopeKey, destination.RoundRobinID).Scan(&leadID)
		if err != nil {
			return "", false, err
		}
		// Enrich the trigger-created initial entry instead of creating a second
		// countable row for the same first provider contact.
		if _, err := tx.Exec(ctx, `
			update public.lead_entry_events entry
			set provider = 'grupo_olx',
			    provider_event_id = $3,
			    source_detail = $4,
			    occurred_at = coalesce(nullif($5, '')::timestamptz, entry.occurred_at, clock_timestamp()),
			    property_id = nullif($6, '')::uuid,
			    pipeline_id = nullif($7, '')::uuid,
			    stage_id = nullif($8, '')::uuid,
			    metadata = coalesce(entry.metadata, '{}'::jsonb) || $9::jsonb,
			    payload = $9::jsonb
			where entry.id = (
			  select initial.id
			  from public.lead_entry_events initial
			  where initial.organization_id = $1::uuid
			    and initial.lead_id = $2::uuid
			    and initial.entry_type = 'initial'
			  order by initial.created_at desc, initial.id desc
			  limit 1
			)
		`, integration.OrganizationID, leadID, eventKey, sourceDetail, providerOccurredAt,
			nullableStringValue(propertyID), destination.PipelineID, destination.StageID, string(metadataJSON)); err != nil {
			return "", false, err
		}
	}

	if propertyID != nil {
		if _, err := tx.Exec(ctx, `
			insert into public.lead_property_interests (lead_id, property_id, interest_level, notes)
			values ($1::uuid, $2::uuid, 'high', 'Interesse recebido pelo Grupo OLX')
			on conflict (lead_id, property_id) do update
			set interest_level = 'high'
		`, leadID, *propertyID); err != nil {
			return "", false, err
		}
	}
	return leadID, reentry, nil
}

func portalLeadIntakeScopeKey(roundRobinID string) string {
	roundRobinID = strings.TrimSpace(roundRobinID)
	if roundRobinID == "" {
		return distribution.IntakeScopeKey(nil)
	}
	return distribution.IntakeScopeKey(&roundRobinID)
}

func findPortalLeadByPhone(ctx context.Context, tx pgx.Tx, organizationID string, phone string, intakeScopeKey string) (string, error) {
	var leadID string
	err := tx.QueryRow(ctx, `
		select id::text
		from public.leads
		where organization_id = $1::uuid
		  and intake_scope_key = $2
		  and phone is not null
		  and btrim(phone) <> ''
		  and normalize_phone(phone) is not null
		  and normalize_phone(phone) <> ''
		  and normalize_phone(phone) = normalize_phone($3)
		order by created_at, id
		limit 1
		for update
	`, organizationID, intakeScopeKey, phone).Scan(&leadID)
	return leadID, err
}

func findPortalLeadByPhoneLegacy(ctx context.Context, tx pgx.Tx, organizationID string, phone string) (string, error) {
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
		order by created_at, id
		limit 1
		for update
	`, organizationID, phone).Scan(&leadID)
	return leadID, err
}

func lockPortalLeadIntakeIdentity(ctx context.Context, tx pgx.Tx, organizationID string, phone string, intakeScopeKey string, legacyIdentity bool) error {
	if legacyIdentity {
		_, err := tx.Exec(ctx, `
			select pg_advisory_xact_lock(
			  hashtextextended($1 || ':legacy-global:' || normalize_phone($2), 0)
			)
		`, organizationID, phone)
		return err
	}
	_, err := tx.Exec(ctx, `
		select pg_advisory_xact_lock(
		  hashtextextended($1 || ':' || $2 || ':' || normalize_phone($3), 0)
		)
	`, organizationID, intakeScopeKey, phone)
	return err
}

func legacyPortalLeadPhoneUniquenessActive(ctx context.Context, tx pgx.Tx) (bool, error) {
	var active bool
	err := tx.QueryRow(ctx, `
		select to_regclass('public.leads_org_phone_unique') is not null
	`).Scan(&active)
	return active, err
}

func portalLeadPhoneUniqueViolationConstraint(err error) string {
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

func isGrupoOLXMCMVLead(body map[string]any) bool {
	origin, _, _, _ := grupoOLXLeadAnalytics(body)
	return origin == "mcmv_olx"
}

func grupoOLXLeadAnalytics(body map[string]any) (string, string, string, any) {
	leadOrigin := strings.ToLower(strings.TrimSpace(firstText(body, "leadOrigin", "lead_origin")))
	extra := objectValue(body["extraData"])
	leadType := strings.TrimSpace(firstText(body, "leadType", "channel"))
	if leadType == "" {
		leadType = strings.TrimSpace(firstText(extra, "leadType", "channel"))
	}
	providerOccurredAt := ""
	if occurredAt := parsePortalReportTimestamp(firstValue(body, "timestamp", "createdAt", "created_at", "leadCreatedAt", "date")); occurredAt != nil {
		providerOccurredAt = occurredAt.UTC().Format(time.RFC3339Nano)
	}
	return leadOrigin, leadType, providerOccurredAt, extra["mcmv"]
}

func normalizePhone(phone string, ddd string) string {
	phone = onlyDigits(phone)
	ddd = onlyDigits(ddd)
	if ddd != "" && !strings.HasPrefix(phone, ddd) {
		phone = ddd + phone
	}
	return phone
}

func normalizeGrupoOLXLeadPhone(body map[string]any) string {
	ddd := onlyDigits(firstText(body, "ddd"))
	phone := ""
	if officialPhone := onlyDigits(firstText(body, "phone")); officialPhone != "" {
		// In the official Grupo OLX contract `phone` excludes DDD. Do not use a
		// prefix heuristic: subscriber numbers can legitimately start with it.
		phone = ddd + officialPhone
	} else {
		phone = normalizePhone(firstText(body, "phoneNumber", "consumerPhone"), ddd)
	}
	if len(phone) < 8 || len(phone) > 40 {
		return ""
	}
	return phone
}

func normalizeGrupoOLXLeadEmail(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" || utf8.RuneCountInString(value) > 254 {
		return ""
	}
	address, err := mail.ParseAddress(value)
	if err != nil || !strings.EqualFold(address.Address, value) {
		return ""
	}
	return value
}
