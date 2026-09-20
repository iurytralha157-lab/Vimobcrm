package site

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/publicingress"
)

const (
	maxPublicContactSessionIDRunes       = 160
	publicContactSubmissionSessionPrefix = "site-contact:"
)

func resolvePublicContactSessionIDs(sessionID *string, submissionID string) (*string, string, error) {
	if sessionID != nil {
		normalized := strings.TrimSpace(*sessionID)
		if normalized != "" {
			if len([]rune(normalized)) > maxPublicContactSessionIDRunes ||
				strings.HasPrefix(normalized, publicContactSubmissionSessionPrefix) {
				return nil, "", ErrInvalidInput
			}
			return &normalized, normalized, nil
		}
	}

	fallback := publicContactSubmissionSessionPrefix + submissionID
	if strings.TrimSpace(submissionID) == "" || len([]rune(fallback)) > maxPublicContactSessionIDRunes {
		return nil, "", ErrInvalidInput
	}
	return nil, fallback, nil
}

type publicContactProperty struct {
	ID   string
	Code *string
}

func resolvePublicContactProperty(
	ctx context.Context,
	q siteQueryer,
	organizationID string,
	requestedPropertyID *string,
	requestedPropertyCode *string,
) (*publicContactProperty, error) {
	var selector string
	var predicate string
	if requestedPropertyID != nil {
		normalizedPropertyID, ok := normalizeUUID(*requestedPropertyID)
		if !ok {
			return nil, ErrInvalidInput
		}
		selector = normalizedPropertyID
		predicate = "p.id = $2::uuid"
	} else if requestedPropertyCode != nil && strings.TrimSpace(*requestedPropertyCode) != "" {
		selector = strings.TrimSpace(*requestedPropertyCode)
		predicate = "lower(btrim(p.code)) = lower(btrim($2::text))"
	} else {
		return nil, nil
	}

	var propertyID string
	var propertyCode pgtype.Text
	var matchCount int
	err := q.QueryRow(ctx, `
		select p.id::text, nullif(btrim(p.code), ''), count(*) over()::int
		from public.properties as p
		where p.organization_id = $1::uuid
		  and `+predicate+`
		  and `+publicPropertyStandaloneEligibilitySQL("p")+`
		  and `+publicPropertyActiveSQL()+`
		limit 1
	`, organizationID, selector).Scan(&propertyID, &propertyCode, &matchCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrInvalidInput
	}
	if err != nil {
		return nil, err
	}
	if matchCount != 1 {
		return nil, ErrInvalidInput
	}

	resolved := &publicContactProperty{ID: propertyID}
	if propertyCode.Valid {
		resolved.Code = &propertyCode.String
	}
	return resolved, nil
}

func (repo Repository) CreatePublicContact(ctx context.Context, request PublicContactRequest) (map[string]any, error) {
	if !validatePublicContactRequest(request) {
		return nil, ErrInvalidInput
	}
	organizationID, ok := normalizeUUID(request.OrganizationID)
	if !ok {
		return nil, ErrInvalidInput
	}
	if err := repo.ensurePublicSiteActive(ctx, organizationID); err != nil {
		return nil, err
	}
	name := strings.TrimSpace(request.Name)
	phone := strings.TrimSpace(request.Phone)
	submissionID := strings.TrimSpace(request.SubmissionID)
	message := ""
	if request.Message != nil {
		message = strings.TrimSpace(*request.Message)
	}
	if request.Website != nil && strings.TrimSpace(*request.Website) != "" {
		return map[string]any{"success": true, "filtered": true}, nil
	}
	sessionID, analyticsSessionID, err := resolvePublicContactSessionIDs(request.SessionID, submissionID)
	if err != nil {
		return nil, err
	}
	sessionValue := optionalText(sessionID)
	request.LandingPage = sanitizePublicNavigationPointer(request.LandingPage, 500)
	request.Referrer = sanitizePublicNavigationPointer(request.Referrer, 1000)

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var submissionRowID string
	err = tx.QueryRow(ctx, `
		insert into public.site_lead_submissions (organization_id, submission_id, session_id)
		values ($1::uuid, $2, $3)
		on conflict (organization_id, submission_id) do nothing
		returning id::text
	`, organizationID, submissionID, sessionValue).Scan(&submissionRowID)
	if errors.Is(err, pgx.ErrNoRows) {
		var existingLeadID pgtype.Text
		if err := tx.QueryRow(ctx, `
			select lead_id::text from public.site_lead_submissions
			where organization_id = $1::uuid and submission_id = $2
		`, organizationID, submissionID).Scan(&existingLeadID); err != nil {
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		return map[string]any{"success": true, "lead_id": existingLeadID.String, "idempotent": true}, nil
	}
	if err != nil {
		return nil, err
	}

	allowed, err := publicingress.Allow(
		ctx,
		tx,
		"site_contact",
		[]string{organizationID, request.ClientIP},
		30,
		time.Minute,
	)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, ErrPublicRateLimited
	}

	if sessionID != nil {
		var recent int
		if err := tx.QueryRow(ctx, `
			select count(*) from public.site_lead_submissions
			where organization_id = $1::uuid and session_id = $2
			  and created_at >= now() - interval '1 minute'
		`, organizationID, *sessionID).Scan(&recent); err != nil {
			return nil, err
		}
		if recent > 5 {
			return nil, ErrPublicRateLimited
		}
	}

	resolvedProperty, err := resolvePublicContactProperty(
		ctx,
		tx,
		organizationID,
		request.PropertyID,
		request.PropertyCode,
	)
	if err != nil {
		return nil, err
	}
	var propertyID any
	var propertyCode any
	var routingPropertyID *string
	if resolvedProperty != nil {
		propertyID = resolvedProperty.ID
		propertyCode = optionalText(resolvedProperty.Code)
		routingPropertyID = &resolvedProperty.ID
	}

	destination, err := repo.resolvePublicLeadDestination(ctx, tx, organizationID)
	if err != nil {
		return nil, err
	}
	distributionSource := "site"
	websiteCategory := "public_site"
	intakeDestination, err := distribution.ResolveIntakeDestination(ctx, tx, distribution.IntakeContext{
		OrganizationID:     organizationID,
		PipelineID:         destination.PipelineID,
		Source:             distributionSource,
		PropertyID:         routingPropertyID,
		InterestPropertyID: routingPropertyID,
		WebsiteCategory:    &websiteCategory,
		UTMCampaign:        request.UTMCampaign,
	})
	if err != nil {
		return nil, err
	}
	intakeScopeKey := distribution.IntakeScopeKey(intakeDestination.RoundRobinID)
	var legacyPhoneIdentity bool
	if err := tx.QueryRow(ctx, `
		select to_regclass('public.leads_org_phone_unique') is not null
	`).Scan(&legacyPhoneIdentity); err != nil {
		return nil, err
	}
	if err := lockPublicContactLeadIntakeIdentity(ctx, tx, organizationID, phone, intakeScopeKey, legacyPhoneIdentity); err != nil {
		return nil, err
	}

	var leadID string
	var reentry bool
	err = tx.QueryRow(ctx, `
		select id::text from public.leads
		where organization_id=$1::uuid
		  and ($4::boolean or intake_scope_key=$3)
		  and phone is not null
		  and btrim(phone) <> ''
		  and normalize_phone(phone) is not null
		  and normalize_phone(phone) <> ''
		  and normalize_phone(phone)=normalize_phone($2)
		order by created_at asc, id asc
		limit 1
	`, organizationID, phone, intakeScopeKey, legacyPhoneIdentity).Scan(&leadID)
	if errors.Is(err, pgx.ErrNoRows) {
		err = tx.QueryRow(ctx, `
			insert into public.leads (
				organization_id, pipeline_id, stage_id, property_id, interest_property_id,
				name, email, phone, property_code, message, initial_message, source, source_detail,
				visitor_session_id, utm_source, utm_medium, utm_campaign, status, deal_status,
				first_touch_at, stage_entered_at, board_order_at, metadata,
				intake_scope_key, origin_round_robin_id
			) values (
				$1::uuid, $2::uuid, $3::uuid, $4::uuid, $4::uuid,
				$5, $6, $7, $8, $9, $9, 'site', 'public_site',
				$10, $14, $15, $16, 'new', 'open', now(),
				case when $3::uuid is null then null else now() end,
				case when $3::uuid is null then null else now() end,
				jsonb_build_object(
					'property_code', $8, 'best_time', $11, 'privacy_accepted', $12::boolean,
					'privacy_url', $13, 'landing_page', $17, 'referrer', $18,
					'utm_term', $19, 'utm_content', $20, 'gclid', $21, 'fbclid', $22,
					'submission_id', $23, 'distribution_deferred', true,
					'intake_scope_key', $24, 'origin_round_robin_id', $25
				),
				$24,
				$25::uuid
			)
			on conflict do nothing
			returning id::text
		`, organizationID, optionalText(destination.PipelineID), optionalText(destination.StageID), propertyID, name, optionalText(request.Email), phone, propertyCode, message, sessionValue, optionalText(request.BestTime), request.PrivacyAccepted, optionalText(request.PrivacyURL), optionalText(request.UTMSource), optionalText(request.UTMMedium), optionalText(request.UTMCampaign), optionalText(request.LandingPage), optionalText(request.Referrer), optionalText(request.UTMTerm), optionalText(request.UTMContent), optionalText(request.GCLID), optionalText(request.FBCLID), submissionID, intakeScopeKey, optionalText(intakeDestination.RoundRobinID)).Scan(&leadID)
		if errors.Is(err, pgx.ErrNoRows) {
			// Another transaction won the normalized-phone unique index. The
			// INSERT waits for that transaction to finish, so this new statement
			// can safely observe the committed canonical lead.
			err = tx.QueryRow(ctx, `
				select id::text from public.leads
				where organization_id=$1::uuid
				  and ($4::boolean or intake_scope_key=$3)
				  and phone is not null
				  and btrim(phone) <> ''
				  and normalize_phone(phone) is not null
				  and normalize_phone(phone) <> ''
				  and normalize_phone(phone)=normalize_phone($2)
				order by created_at asc, id asc
				limit 1
			`, organizationID, phone, intakeScopeKey, legacyPhoneIdentity).Scan(&leadID)
			reentry = true
		} else {
			reentry = false
		}
	} else if err == nil {
		reentry = true
	}
	if err != nil {
		return nil, err
	}

	if reentry {
		if _, err := tx.Exec(ctx, `
			insert into public.lead_entry_events (
				organization_id, lead_id, source, provider, provider_event_id,
				occurred_at, is_countable, source_detail, entry_type, property_id,
				campaign_name, utm_source, utm_medium, utm_campaign, utm_content,
				utm_term, metadata
			) values (
				$1::uuid, $2::uuid, 'site', 'site', $3, now(), true,
				'public_site', 'reentry', $4::uuid, $5, $6, $7, $5, $8, $9,
				jsonb_build_object(
					'submission_id', $3,
					'session_id', $10,
					'landing_page', $11,
					'referrer', $12,
					'gclid', $13,
					'fbclid', $14
				)
			)
			on conflict (organization_id, provider, provider_event_id)
				where provider_event_id is not null and is_countable = true
			do nothing
		`, organizationID, leadID, submissionID, propertyID, optionalText(request.UTMCampaign), optionalText(request.UTMSource), optionalText(request.UTMMedium), optionalText(request.UTMContent), optionalText(request.UTMTerm), sessionValue, optionalText(request.LandingPage), optionalText(request.Referrer), optionalText(request.GCLID), optionalText(request.FBCLID)); err != nil {
			return nil, err
		}
	} else {
		if _, err := tx.Exec(ctx, `
			update public.lead_entry_events
			set source = 'site',
			    provider = 'site',
			    provider_event_id = $3,
			    occurred_at = created_at,
			    is_countable = true,
			    source_detail = 'public_site',
			    property_id = coalesce($4::uuid, property_id),
			    campaign_name = coalesce($5, campaign_name),
			    utm_source = coalesce($6, utm_source),
			    utm_medium = coalesce($7, utm_medium),
			    utm_campaign = coalesce($5, utm_campaign),
			    utm_content = coalesce($8, utm_content),
			    utm_term = coalesce($9, utm_term),
			    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
			      'submission_id', $3,
			      'session_id', $10,
			      'landing_page', $11,
			      'referrer', $12,
			      'gclid', $13,
			      'fbclid', $14
			    )
			where id = (
				select initial.id
				from public.lead_entry_events initial
				where initial.organization_id = $1::uuid
				  and initial.lead_id = $2::uuid
				  and initial.entry_type = 'initial'
				order by initial.created_at, initial.id
				limit 1
			)
		`, organizationID, leadID, submissionID, propertyID, optionalText(request.UTMCampaign), optionalText(request.UTMSource), optionalText(request.UTMMedium), optionalText(request.UTMContent), optionalText(request.UTMTerm), sessionValue, optionalText(request.LandingPage), optionalText(request.Referrer), optionalText(request.GCLID), optionalText(request.FBCLID)); err != nil {
			return nil, err
		}
	}

	if _, err := tx.Exec(ctx, `update public.site_lead_submissions set lead_id = $1::uuid where id = $2::uuid`, leadID, submissionRowID); err != nil {
		return nil, err
	}
	if sessionID != nil {
		sessionStartMetadata := map[string]any{}
		addPublicTrackingAttributionSignals(sessionStartMetadata, PublicTrackingRequest{
			GCLID:  request.GCLID,
			FBCLID: request.FBCLID,
		})
		sessionStartPagePath := "/contato"
		if request.LandingPage != nil {
			sessionStartPagePath = sanitizePublicPagePath(*request.LandingPage)
		}
		if err := ensurePublicSessionStart(ctx, tx, publicTrackingEventWrite{
			organizationID: organizationID,
			eventType:      "session_start",
			pagePath:       sessionStartPagePath,
			referrer:       optionalText(request.Referrer),
			sessionID:      analyticsSessionID,
			utmSource:      optionalText(request.UTMSource),
			utmMedium:      optionalText(request.UTMMedium),
			utmCampaign:    optionalText(request.UTMCampaign),
			propertyID:     propertyID,
			metadataRaw:    jsonb(sessionStartMetadata),
		}); err != nil {
			return nil, err
		}
	}
	if _, err := tx.Exec(ctx, `
		insert into public.site_analytics_events (
			organization_id, session_id, event_type, page_path, page_title, referrer,
			property_id, lead_id, utm_source, utm_medium, utm_campaign, metadata, created_at
		) values ($1::uuid, $2, 'form_submit', coalesce(nullif($3, ''), '/contato'), 'Conversao do formulario', $4,
			$5::uuid, $6::uuid, $7, $8, $9,
			jsonb_build_object(
			  'reentry', $10::boolean,
			  'utm_term', $11,
			  'utm_content', $12,
			  'google_ads_click', nullif(btrim($13), '') is not null,
			  'facebook_click', nullif(btrim($14), '') is not null,
			  'synthetic_session', $15::boolean
			), clock_timestamp())
	`, organizationID, analyticsSessionID, optionalText(request.LandingPage), optionalText(request.Referrer), propertyID, leadID, optionalText(request.UTMSource), optionalText(request.UTMMedium), optionalText(request.UTMCampaign), reentry, optionalText(request.UTMTerm), optionalText(request.UTMContent), optionalText(request.GCLID), optionalText(request.FBCLID), sessionID == nil); err != nil {
		return nil, err
	}

	if reentry {
		// Append-only attribution, submission and analytics writes intentionally
		// happen before this update. The row lock is then held only through the
		// canonical distribution call and commit, preventing a same-phone convoy
		// from serializing the entire intake transaction.
		tag, err := tx.Exec(ctx, `
			update public.leads set
				board_order_at=now(), property_id=coalesce($3::uuid, property_id),
				interest_property_id=coalesce($3::uuid, interest_property_id),
				email=coalesce(nullif($4,''), email), phone=$5,
				property_code=coalesce(nullif($6,''), property_code), message=$7, initial_message=$7,
				visitor_session_id=coalesce(nullif($8,''), visitor_session_id),
				utm_source=coalesce(utm_source, $9), utm_medium=coalesce(utm_medium, $10),
				utm_campaign=coalesce(utm_campaign, $11), last_entry_at=now(),
				reentry_count=coalesce(reentry_count,0)+1, updated_at=now(),
				metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
					'property_code',$6,'best_time',$12,'privacy_accepted',$13::boolean,
					'privacy_url',$14,'landing_page',$15,'referrer',$16,'utm_term',$17,
					'utm_content',$18,'gclid',$19,'fbclid',$20,'submission_id',$21,
					'latest_utm_source',$9,'latest_utm_medium',$10,'latest_utm_campaign',$11,
					'reentry',true,'distribution_deferred',true)
			where id=$2::uuid and organization_id=$1::uuid
		`, organizationID, leadID, propertyID, optionalText(request.Email), phone, propertyCode, message, sessionValue, optionalText(request.UTMSource), optionalText(request.UTMMedium), optionalText(request.UTMCampaign), optionalText(request.BestTime), request.PrivacyAccepted, optionalText(request.PrivacyURL), optionalText(request.LandingPage), optionalText(request.Referrer), optionalText(request.UTMTerm), optionalText(request.UTMContent), optionalText(request.GCLID), optionalText(request.FBCLID), submissionID)
		if err != nil {
			return nil, err
		}
		if tag.RowsAffected() != 1 {
			return nil, fmt.Errorf("site contact lead changed concurrently before reentry update")
		}
	}

	// Keep canonical distribution as the final operation before commit. The
	// queue row is intentionally locked while its counters and assignment side
	// effects advance; doing unrelated submission/analytics writes first keeps
	// that critical section as short as possible under concurrent site intake.
	if _, err := distribution.Distribute(ctx, tx, distribution.Request{
		OrganizationID:     organizationID,
		LeadID:             leadID,
		IdempotencyKey:     "site:" + submissionID,
		RoundRobinID:       intakeDestination.RoundRobinID,
		RoundRobinResolved: intakeDestination.Resolved,
		PreserveAssignee:   distribution.PreserveAssigneeForIntake(reentry, intakeDestination),
		Source:             &distributionSource,
		OccurredAt:         time.Now().UTC(),
	}); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return map[string]any{
		"success": true,
		"lead_id": leadID,
		"reentry": reentry,
	}, nil
}

func phoneDigits(value string) string {
	var out strings.Builder
	for _, char := range value {
		if char >= '0' && char <= '9' {
			out.WriteRune(char)
		}
	}
	return out.String()
}

func lockPublicContactLeadIntakeIdentity(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	phone string,
	intakeScopeKey string,
	legacyIdentity bool,
) error {
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

func (repo Repository) resolvePublicLeadDestination(ctx context.Context, q siteQueryer, organizationID string) (publicLeadDestination, error) {
	var pipelineID pgtype.Text
	var stageID pgtype.Text

	err := q.QueryRow(ctx, `
		select p.id::text, (
			select s.id::text
			from public.stages s
			where s.pipeline_id = p.id
			  and s.organization_id = p.organization_id
			  and coalesce(s.is_active, true) = true
			order by s.position asc, s.created_at asc
			limit 1
		)
		from public.pipelines p
		where p.organization_id = $1::uuid
		  and coalesce(p.is_active, true) = true
		order by coalesce(p.is_default, false) desc, coalesce(p.position, 0) asc, p.created_at asc
		limit 1
	`, organizationID).Scan(&pipelineID, &stageID)
	if errors.Is(err, pgx.ErrNoRows) {
		return publicLeadDestination{}, nil
	}
	if err != nil {
		return publicLeadDestination{}, err
	}

	destination := publicLeadDestination{}
	if pipelineID.Valid {
		destination.PipelineID = &pipelineID.String
	}
	if stageID.Valid {
		destination.StageID = &stageID.String
	}
	return destination, nil
}
