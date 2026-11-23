package meta

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db     *dbpkg.Postgres
	config Config
	client *http.Client
}

type pendingMetaLeadReentry struct {
	PlaceholderLeadID string
	IntakeIdentity    metaLeadIntakeIdentity
}

func NewRepository(db *dbpkg.Postgres, config Config) Repository {
	if strings.TrimSpace(config.GraphVersion) == "" {
		config.GraphVersion = "v25.0"
	}
	if strings.TrimSpace(config.GraphBaseURL) == "" {
		config.GraphBaseURL = "https://graph.facebook.com"
	}
	return Repository{
		db:     db,
		config: config,
		client: &http.Client{
			Timeout: 15 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

func (repo Repository) persistLead(ctx context.Context, webhookPayload map[string]any, details map[string]any, change leadgenChange, integration metaIntegration, formConfig metaFormConfig, lead leadData, detailsError string, pendingReentry *pendingMetaLeadReentry) (string, bool, error) {
	leadID, reentry, err := repo.persistLeadWithIdentityMode(ctx, webhookPayload, details, change, integration, formConfig, lead, detailsError, pendingReentry, nil)
	constraintName := metaLeadPhoneUniqueViolationConstraint(err)
	if constraintName == "" {
		return leadID, reentry, err
	}
	legacyIdentity := constraintName == "leads_org_phone_unique"
	return repo.persistLeadWithIdentityMode(ctx, webhookPayload, details, change, integration, formConfig, lead, detailsError, pendingReentry, &legacyIdentity)
}

func (repo Repository) persistLeadWithIdentityMode(ctx context.Context, webhookPayload map[string]any, details map[string]any, change leadgenChange, integration metaIntegration, formConfig metaFormConfig, lead leadData, detailsError string, pendingReentry *pendingMetaLeadReentry, forceLegacyIdentity *bool) (string, bool, error) {
	tx, err := repo.beginWebhookMutation(ctx)
	if err != nil {
		return "", false, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		select pg_advisory_xact_lock(
			hashtextextended('lead-entry:meta:' || $1 || ':' || $2, 0)
		)
	`, integration.OrganizationID, change.LeadgenID); err != nil {
		return "", false, err
	}
	if duplicateLeadID, err := findLeadByProviderEventID(ctx, tx, integration.OrganizationID, "meta", change.LeadgenID); err != nil {
		return "", false, err
	} else if duplicateLeadID != "" && (pendingReentry == nil || duplicateLeadID != pendingReentry.PlaceholderLeadID) {
		return "", false, duplicateLeadgenError{leadID: duplicateLeadID}
	}

	var destination resolvedDestination
	if pendingReentry != nil {
		destination, err = repo.resolveDestinationForIntakeIdentity(ctx, tx, integration, formConfig, pendingReentry.IntakeIdentity)
	} else {
		destination, err = repo.resolveDestination(ctx, tx, integration, formConfig)
	}
	if err != nil {
		return "", false, err
	}
	source := coalesceText(formConfig.Source, "meta")
	propertyID := resolvePropertyID(formConfig)
	if shouldResolveAutomaticMetaIntake(pendingReentry, formConfig) {
		destination, err = repo.resolveAutomaticMetaIntakeDestination(
			ctx,
			tx,
			destination,
			integration,
			formConfig,
			change,
			lead,
			details,
			source,
			propertyID,
		)
		if err != nil {
			return "", false, err
		}
	}
	intakeScopeKey := metaLeadIntakeScopeKey(destination.RoundRobinID)
	if pendingReentry != nil && intakeScopeKey != pendingReentry.IntakeIdentity.ScopeKey {
		return "", false, fmt.Errorf("%w: preserved Meta intake identity was reclassified", ErrInvalidInput)
	}
	legacyIdentity := false
	if forceLegacyIdentity != nil {
		legacyIdentity = *forceLegacyIdentity
	} else {
		legacyIdentity, err = legacyMetaLeadPhoneUniquenessActive(ctx, tx)
		if err != nil {
			return "", false, err
		}
	}
	if err := lockMetaLeadIntakeIdentity(ctx, tx, integration.OrganizationID, lead.Phone, intakeScopeKey, legacyIdentity); err != nil {
		return "", false, err
	}

	if err := repo.validateProperty(ctx, tx, integration.OrganizationID, propertyID); err != nil {
		return "", false, err
	}

	var existingLeadID string
	if pendingReentry != nil {
		existingLeadID, err = repo.discardUntouchedPendingMetaLeadForReentry(ctx, tx, integration.OrganizationID, pendingReentry, lead.Phone, legacyIdentity)
	} else if legacyIdentity {
		existingLeadID, err = repo.findExistingLeadByPhoneLegacy(ctx, tx, integration.OrganizationID, lead.Phone)
	} else {
		existingLeadID, err = repo.findExistingLeadByPhone(ctx, tx, integration.OrganizationID, lead.Phone, intakeScopeKey)
	}
	if err != nil {
		return "", false, err
	}

	sourceDetail := sourceDetail(integration, formConfig)
	interestValue := interestValue(formConfig.DefaultValues)
	status := coalesceText(formConfig.DefaultStatus, coalesceText(integration.DefaultStatus, "new"))
	metadata := buildLeadMetadata(webhookPayload, details, change, integration, formConfig, lead)
	setMetaLeadDetailsState(metadata, detailsError)
	metadata["source_detail"] = sourceDetail
	metadata["distribution_deferred"] = true
	metadata["intake_scope_key"] = intakeScopeKey
	if destination.RoundRobinID != nil {
		metadata["origin_round_robin_id"] = *destination.RoundRobinID
	}
	payloadJSON := jsonb(map[string]any{
		"webhook_payload": webhookPayload,
		"lead_details":    details,
		"fields":          lead.RawFields,
	})

	leadID := existingLeadID
	reentry := existingLeadID != ""
	entryInserted := false
	if reentry {
		// Persist the new Meta entry before moving the existing lead. The funnel
		// trigger can then attribute a qualification caused by this reentry to
		// the new leadgen_id instead of the previous Meta submission.
		if err := repo.insertLeadEntry(ctx, tx, integration.OrganizationID, leadID, details, change, propertyID, interestValue, metadata, true); err != nil {
			return "", false, err
		}
		entryInserted = true
	}
	if reentry {
		_, err = tx.Exec(ctx, `
			update public.leads
			set name = $3,
			    email = coalesce($4, email),
			    phone = coalesce($5, phone),
			    source = coalesce(nullif(source, ''), $6),
			    message = coalesce($7, message),
			    cargo = coalesce($8, cargo),
			    empresa = coalesce($9, empresa),
			    cidade = coalesce($10, cidade),
			    bairro = coalesce($11, bairro),
			    meta_lead_id = coalesce(meta_lead_id, $12),
			    meta_form_id = coalesce(meta_form_id, $13),
			    meta_campaign_id = coalesce(meta_campaign_id, $14),
			    meta_adset_id = coalesce(meta_adset_id, $15),
			    meta_ad_id = coalesce(meta_ad_id, $16),
			    utm_source = coalesce(utm_source, $17),
			    utm_medium = coalesce(utm_medium, $18),
			    utm_campaign = coalesce(utm_campaign, $19),
			    pipeline_id = coalesce($20::uuid, pipeline_id),
			    stage_entered_at = case
			      when $21::uuid is null or stage_id is not distinct from $21::uuid then stage_entered_at
			      else now()
			    end,
			    board_order_at = now(),
			    stage_id = coalesce($21::uuid, stage_id),
			    property_id = coalesce($22::uuid, property_id),
			    interest_property_id = coalesce($22::uuid, interest_property_id),
			    valor_interesse = coalesce($23::numeric, valor_interesse),
			    last_entry_at = now(),
			    reentry_count = coalesce(reentry_count, 0) + 1,
			    metadata = coalesce(metadata, '{}'::jsonb) || ($24::jsonb - 'intake_scope_key' - 'origin_round_robin_id'),
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
		`, integration.OrganizationID, leadID, lead.Name, nullablePointer(lead.Email), nullablePointer(lead.Phone), source, nullablePointer(lead.Message), nullablePointer(lead.Cargo), nullablePointer(lead.Empresa), nullablePointer(lead.Cidade), nullablePointer(lead.Bairro), change.LeadgenID, change.FormID, nullableString(metaText(details, change.Raw, "campaign_id")), nullableString(metaText(details, change.Raw, "adset_id")), nullableString(metaText(details, change.Raw, "ad_id")), "facebook", "lead_ads", nullableString(metaText(details, change.Raw, "campaign_name")), nullablePointer(destination.PipelineID), nullablePointer(destination.StageID), nullablePointer(propertyID), nullablePointer(interestValue), jsonb(metadata))
	} else {
		err = tx.QueryRow(ctx, `
			insert into public.leads (
				organization_id,
				pipeline_id,
				stage_id,
				assigned_user_id,
				assigned_at,
				property_id,
				interest_property_id,
				name,
				email,
				phone,
				source,
				message,
				status,
				cargo,
				empresa,
				cidade,
				bairro,
				finalidade_compra,
				meta_lead_id,
				meta_form_id,
				meta_campaign_id,
				meta_adset_id,
				meta_ad_id,
				utm_source,
				utm_medium,
				utm_campaign,
				valor_interesse,
				team_id,
				stage_entered_at,
				board_order_at,
				last_entry_at,
				metadata,
				intake_scope_key,
				origin_round_robin_id
			)
			values (
				$1::uuid,
				$2::uuid,
				$3::uuid,
				$4::uuid,
				case when $4::uuid is null then null else now() end,
				$5::uuid,
				$5::uuid,
				$6,
				$7,
				$8,
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
				$19,
				$20,
				$21,
				'facebook',
				'lead_ads',
				$22,
				$23::numeric,
				$24::uuid,
				case when $3::uuid is null then null else now() end,
				case when $3::uuid is null then null else now() end,
				now(),
				$25::jsonb,
				$26,
				$27::uuid
			)
			returning id::text
		`, integration.OrganizationID, nullablePointer(destination.PipelineID), nullablePointer(destination.StageID), nullablePointer(destination.AssignedUserID), nullablePointer(propertyID), lead.Name, nullablePointer(lead.Email), nullablePointer(lead.Phone), source, nullablePointer(lead.Message), status, nullablePointer(lead.Cargo), nullablePointer(lead.Empresa), nullablePointer(lead.Cidade), nullablePointer(lead.Bairro), nullablePointer(formConfig.Purpose), change.LeadgenID, change.FormID, nullableString(metaText(details, change.Raw, "campaign_id")), nullableString(metaText(details, change.Raw, "adset_id")), nullableString(metaText(details, change.Raw, "ad_id")), nullableString(metaText(details, change.Raw, "campaign_name")), nullablePointer(interestValue), nullablePointer(destination.TeamID), jsonb(metadata), intakeScopeKey, nullablePointer(destination.RoundRobinID)).Scan(&leadID)
	}
	if err != nil {
		return "", false, err
	}

	if err := repo.insertLeadMeta(ctx, tx, integration.OrganizationID, leadID, details, change, formConfig, payloadJSON); err != nil {
		return "", false, err
	}
	if err := repo.insertLeadTags(ctx, tx, integration.OrganizationID, leadID, destination.TagIDs); err != nil {
		return "", false, err
	}
	if !entryInserted {
		if err := repo.insertLeadEntry(ctx, tx, integration.OrganizationID, leadID, details, change, propertyID, interestValue, metadata, false); err != nil {
			return "", false, err
		}
	}
	preserveAssignee := preserveAssigneeForMetaIntake(reentry, destination)
	distributionResult, err := distribution.Distribute(ctx, tx, distribution.Request{
		OrganizationID:     integration.OrganizationID,
		LeadID:             leadID,
		IdempotencyKey:     distribution.StableKey("meta", integration.ID, change.LeadgenID),
		RoundRobinID:       destination.RoundRobinID,
		RoundRobinResolved: destination.RoundRobinResolved,
		PreserveAssignee:   preserveAssignee,
		Source:             &source,
		OccurredAt:         metaLeadOccurredAt(change.CreatedTime),
	})
	if err != nil {
		return "", false, err
	}
	destination.AssignedUserID = distributionResult.AssignedUserID
	destination.TeamID = distributionResult.TeamID
	destination.PipelineID = distributionResult.PipelineID
	destination.StageID = distributionResult.StageID
	destination.RoundRobinID = distributionResult.RoundRobinID
	destination.RoundRobinMemberID = distributionResult.MemberID
	if !reentry && destination.RoundRobinID != nil {
		if err := repo.insertLeadRedistributionJob(ctx, tx, integration.OrganizationID, leadID, destination, change, distributionResult.Reason); err != nil {
			return "", false, err
		}
	}
	if err := repo.insertActivity(ctx, tx, integration.OrganizationID, leadID, lead.Name, reentry, metadata); err != nil {
		return "", false, err
	}
	assignedUserID, err := repo.findLeadAssignedUser(ctx, tx, integration.OrganizationID, leadID)
	if err != nil {
		return "", false, err
	}
	notificationRecipients := []string{}
	if assignedUserID != nil {
		notificationRecipients = append(notificationRecipients, *assignedUserID)
	} else {
		notificationRecipients, err = repo.listFallbackLeadNotificationRecipients(ctx, tx, integration.OrganizationID)
		if err != nil {
			return "", false, err
		}
	}
	for _, recipientID := range notificationRecipients {
		eventKey := "new_lead_received"
		title := "Novo lead recebido"
		content := fmt.Sprintf("%s foi atribuido a voce", lead.Name)
		if assignedUserID == nil {
			content = fmt.Sprintf("%s entrou pela Meta sem responsavel definido", lead.Name)
		}
		if reentry {
			eventKey = "lead_reentry"
			title = "Lead retornou"
			content = fmt.Sprintf("%s teve uma nova entrada", lead.Name)
			if assignedUserID == nil {
				content = fmt.Sprintf("%s teve uma nova entrada pela Meta sem responsavel definido", lead.Name)
			}
		}
		notificationMetadata := map[string]any{
			"lead_name":     lead.Name,
			"source":        source,
			"campaign_name": metaText(details, change.Raw, "campaign_name"),
			"adset_name":    metaText(details, change.Raw, "adset_name"),
			"ad_name":       metaText(details, change.Raw, "ad_name"),
			"form_name":     nullablePointer(formConfig.FormName),
			"form_id":       change.FormID,
			"page_name":     nullablePointer(integration.PageName),
			"page_id":       change.PageID,
			"leadgen_id":    change.LeadgenID,
			"created_time":  change.CreatedTime,
			"unassigned":    assignedUserID == nil,
		}
		if reentry && strings.TrimSpace(change.LeadgenID) != "" {
			notificationMetadata["dedupe_key"] = metaNotificationDedupeKey(eventKey, leadID, recipientID, change.LeadgenID)
		} else if !reentry {
			notificationMetadata["dedupe_key"] = metaNotificationDedupeKey(eventKey, leadID, recipientID)
		}
		notificationMetadata = prepareMetaLeadNotificationMetadata(notificationMetadata, eventKey)
		if !reentry &&
			distributionResult.Reason == "assigned" &&
			distributionResult.DistributionEventID != nil {
			updated, err := repo.enrichCanonicalLeadNotification(
				ctx,
				tx,
				integration.OrganizationID,
				recipientID,
				leadID,
				*distributionResult.DistributionEventID,
				title,
				content,
				notificationMetadata,
			)
			if err != nil {
				return "", false, err
			}
			if updated {
				continue
			}
		}
		if err := repo.insertLeadNotification(ctx, tx, integration.OrganizationID, recipientID, leadID, title, content, eventKey, notificationMetadata); err != nil {
			return "", false, err
		}
	}
	if err := repo.incrementStats(ctx, tx, integration.ID, formConfig.ID); err != nil {
		return "", false, err
	}
	if err := distribution.ValidatePersistedIntakeDestination(ctx, tx, integration.OrganizationID, leadID); err != nil {
		return "", false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", false, err
	}

	return leadID, reentry, nil
}

func (repo Repository) prepareUntouchedPendingMetaLeadForReentry(
	ctx context.Context,
	integration metaIntegration,
	leadgenID string,
	pendingLeadID string,
	phone *string,
) (*pendingMetaLeadReentry, error) {
	if digitsOnly(phone) == "" {
		return nil, nil
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		select pg_advisory_xact_lock(
			hashtextextended('lead-entry:meta:' || $1 || ':' || $2, 0)
		)
	`, integration.OrganizationID, leadgenID); err != nil {
		return nil, err
	}
	intakeIdentity, err := repo.pendingMetaLeadIntakeIdentity(ctx, tx, integration.OrganizationID, pendingLeadID, true)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: pending Meta placeholder no longer exists", ErrInvalidInput)
	}
	if err != nil {
		return nil, err
	}
	legacyIdentity, err := legacyMetaLeadPhoneUniquenessActive(ctx, tx)
	if err != nil {
		return nil, err
	}
	if err := lockMetaLeadIntakeIdentity(ctx, tx, integration.OrganizationID, phone, intakeIdentity.ScopeKey, legacyIdentity); err != nil {
		return nil, err
	}

	var detailsPending bool
	var phoneMissing bool
	var untouched bool
	err = tx.QueryRow(ctx, `
		select
		  lower(coalesce(metadata->>'meta_details_status', '')) = 'pending',
		  phone is null or normalize_phone(phone) = '',
		  first_touch_at is null
		    and first_response_at is null
		    and owner_last_activity_at is null
		    and last_contact_at is null
		from public.leads
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, integration.OrganizationID, pendingLeadID).Scan(&detailsPending, &phoneMissing, &untouched)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: pending Meta placeholder no longer exists", ErrInvalidInput)
	}
	if err != nil {
		return nil, err
	}
	if !detailsPending || !phoneMissing || !untouched {
		return nil, tx.Commit(ctx)
	}

	var existingLeadID string
	if legacyIdentity {
		existingLeadID, err = repo.findExistingLeadByPhoneLegacy(ctx, tx, integration.OrganizationID, phone)
	} else {
		existingLeadID, err = repo.findExistingLeadByPhone(ctx, tx, integration.OrganizationID, phone, intakeIdentity.ScopeKey)
	}
	if err != nil {
		return nil, err
	}
	if existingLeadID == "" || existingLeadID == pendingLeadID {
		return nil, tx.Commit(ctx)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &pendingMetaLeadReentry{
		PlaceholderLeadID: pendingLeadID,
		IntakeIdentity:    intakeIdentity,
	}, nil
}

func (repo Repository) discardUntouchedPendingMetaLeadForReentry(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	pendingReentry *pendingMetaLeadReentry,
	phone *string,
	legacyIdentity bool,
) (string, error) {
	if pendingReentry == nil || digitsOnly(phone) == "" {
		return "", ErrInvalidInput
	}

	currentIdentity, err := repo.pendingMetaLeadIntakeIdentity(ctx, tx, organizationID, pendingReentry.PlaceholderLeadID, true)
	if err != nil {
		return "", err
	}
	if currentIdentity != pendingReentry.IntakeIdentity {
		return "", fmt.Errorf("%w: pending Meta intake identity changed", ErrInvalidInput)
	}

	var detailsPending bool
	var phoneMissing bool
	var untouched bool
	err = tx.QueryRow(ctx, `
		select
		  lower(coalesce(metadata->>'meta_details_status', '')) = 'pending',
		  phone is null or normalize_phone(phone) = '',
		  first_touch_at is null
		    and first_response_at is null
		    and owner_last_activity_at is null
		    and last_contact_at is null
		from public.leads
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, organizationID, pendingReentry.PlaceholderLeadID).Scan(&detailsPending, &phoneMissing, &untouched)
	if err != nil {
		return "", err
	}
	if !detailsPending || !phoneMissing || !untouched {
		return "", fmt.Errorf("%w: pending Meta placeholder is no longer disposable", ErrInvalidInput)
	}

	var existingLeadID string
	if legacyIdentity {
		existingLeadID, err = repo.findExistingLeadByPhoneLegacy(ctx, tx, organizationID, phone)
	} else {
		existingLeadID, err = repo.findExistingLeadByPhone(ctx, tx, organizationID, phone, currentIdentity.ScopeKey)
	}
	if err != nil {
		return "", err
	}
	if existingLeadID == "" || existingLeadID == pendingReentry.PlaceholderLeadID {
		return "", fmt.Errorf("%w: pending Meta reentry target no longer exists", ErrInvalidInput)
	}

	command, err := tx.Exec(ctx, `
		delete from public.leads
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and lower(coalesce(metadata->>'meta_details_status', '')) = 'pending'
	`, organizationID, pendingReentry.PlaceholderLeadID)
	if err != nil {
		return "", err
	}
	if command.RowsAffected() != 1 {
		return "", fmt.Errorf("%w: pending Meta placeholder was not discarded", ErrInvalidInput)
	}
	return existingLeadID, nil
}

func (repo Repository) enrichPendingMetaLead(
	ctx context.Context,
	webhookPayload map[string]any,
	details map[string]any,
	change leadgenChange,
	integration metaIntegration,
	formConfig metaFormConfig,
	leadID string,
	lead leadData,
) error {
	tx, err := repo.beginWebhookMutation(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		select pg_advisory_xact_lock(
			hashtextextended('lead-entry:meta:' || $1 || ':' || $2, 0)
		)
	`, integration.OrganizationID, change.LeadgenID); err != nil {
		return err
	}
	intakeIdentity, err := repo.pendingMetaLeadIntakeIdentity(ctx, tx, integration.OrganizationID, leadID, true)
	if err != nil {
		return err
	}
	legacyIdentity, err := legacyMetaLeadPhoneUniquenessActive(ctx, tx)
	if err != nil {
		return err
	}
	if err := lockMetaLeadIntakeIdentity(ctx, tx, integration.OrganizationID, lead.Phone, intakeIdentity.ScopeKey, legacyIdentity); err != nil {
		return err
	}

	var detailsPending bool
	err = tx.QueryRow(ctx, `
		select lower(coalesce(metadata->>'meta_details_status', '')) = 'pending'
		from public.leads
		where organization_id = $1::uuid
		  and id = $2::uuid
		for update
	`, integration.OrganizationID, leadID).Scan(&detailsPending)
	if err != nil {
		return err
	}
	if !detailsPending {
		return tx.Commit(ctx)
	}

	source := coalesceText(formConfig.Source, "meta")
	metadata := buildLeadMetadata(webhookPayload, details, change, integration, formConfig, lead)
	setMetaLeadDetailsState(metadata, "")
	metadata["source_detail"] = sourceDetail(integration, formConfig)
	metadata["intake_scope_key"] = intakeIdentity.ScopeKey
	if intakeIdentity.OriginRoundRobinID != "" {
		metadata["origin_round_robin_id"] = intakeIdentity.OriginRoundRobinID
	}

	_, err = tx.Exec(ctx, `
		update public.leads
		set name = $3,
		    email = coalesce($4, email),
		    phone = coalesce($5, phone),
		    source = coalesce(nullif(source, ''), $6),
		    message = coalesce($7, message),
		    cargo = coalesce($8, cargo),
		    empresa = coalesce($9, empresa),
		    cidade = coalesce($10, cidade),
		    bairro = coalesce($11, bairro),
		    meta_lead_id = coalesce(meta_lead_id, $12),
		    meta_form_id = coalesce(meta_form_id, $13),
		    meta_campaign_id = coalesce($14, meta_campaign_id),
		    meta_adset_id = coalesce($15, meta_adset_id),
		    meta_ad_id = coalesce($16, meta_ad_id),
		    utm_source = coalesce(utm_source, 'facebook'),
		    utm_medium = coalesce(utm_medium, 'lead_ads'),
		    utm_campaign = coalesce($17, utm_campaign),
		    metadata = (coalesce(metadata, '{}'::jsonb) - 'meta_details_error') || $18::jsonb,
		    intake_scope_key = $19,
		    origin_round_robin_id = $20::uuid,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, integration.OrganizationID, leadID, lead.Name, nullablePointer(lead.Email), nullablePointer(lead.Phone), source, nullablePointer(lead.Message), nullablePointer(lead.Cargo), nullablePointer(lead.Empresa), nullablePointer(lead.Cidade), nullablePointer(lead.Bairro), change.LeadgenID, change.FormID, nullableString(metaText(details, change.Raw, "campaign_id")), nullableString(metaText(details, change.Raw, "adset_id")), nullableString(metaText(details, change.Raw, "ad_id")), nullableString(metaText(details, change.Raw, "campaign_name")), jsonb(metadata), intakeIdentity.ScopeKey, nullableString(intakeIdentity.OriginRoundRobinID))
	if err != nil {
		return err
	}
	if err := repo.insertLeadMeta(ctx, tx, integration.OrganizationID, leadID, details, change, formConfig, jsonb(map[string]any{
		"webhook_payload": webhookPayload,
		"lead_details":    details,
		"fields":          lead.RawFields,
	})); err != nil {
		return err
	}
	if err := repo.insertLeadTags(ctx, tx, integration.OrganizationID, leadID, tagIDs(formConfig)); err != nil {
		return err
	}
	if err := repo.insertLeadEntry(ctx, tx, integration.OrganizationID, leadID, details, change, resolvePropertyID(formConfig), interestValue(formConfig.DefaultValues), metadata, false); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
