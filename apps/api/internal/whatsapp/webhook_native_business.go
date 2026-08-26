package whatsapp

import (
	"context"
	"errors"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
)

type nativeInboundRule struct {
	ID                         string
	MatchType                  string
	MatchField                 string
	MatchValue                 string
	SourceLabel                string
	CampaignLabel              string
	TargetUserID               string
	TargetTeamID               string
	TargetPipelineID           string
	TargetStageID              string
	TargetRoundRobinID         string
	ManagedMessageDistribution bool
	Conditions                 map[string]any
}

type nativeLeadAssignment struct {
	UserID       string
	PipelineID   string
	StageID      string
	TeamID       string
	RoundRobinID string
}

const nativeInboundRulesQuery = `
	select
	  id::text,
	  coalesce(match_type, 'all'),
	  coalesce(match_field, 'message'),
	  coalesce(match_value, ''),
	  coalesce(source_label, ''),
	  coalesce(campaign_label, ''),
	  coalesce(target_user_id::text, ''),
	  coalesce(target_team_id::text, ''),
	  coalesce(target_pipeline_id::text, ''),
	  coalesce(target_stage_id::text, ''),
	  coalesce(target_round_robin_id::text, ''),
	  coalesce(session_id = $2::uuid, false) and (
	  exists (
	    select 1
	    from public.round_robin_rules managed_rule
	    where managed_rule.organization_id = whatsapp_inbound_rules.organization_id
	      and managed_rule.id = whatsapp_inbound_rules.id
	      and managed_rule.round_robin_id = whatsapp_inbound_rules.target_round_robin_id
	      and coalesce(nullif(managed_rule.match_type, ''), managed_rule.conditions->>'match_type', managed_rule.name, '') = 'whatsapp_message_contains'
	  ) or (
	    priority <= -1000000000
	    and name like 'Distribuição: %'
	    and coalesce(match_type, '') = 'contains'
	    and coalesce(match_field, 'message') = 'message'
	    and target_round_robin_id is not null
	  )),
	  '{}'::jsonb::text
	from public.whatsapp_inbound_rules
	where organization_id = $1::uuid
	  and coalesce(is_active, true) = true
	  and (session_id is null or session_id = $2::uuid)
	order by priority desc, created_at asc, id asc
`

func findNativeInboundRule(ctx context.Context, tx pgx.Tx, session nativeEvolutionSession, message nativeEvolutionMessage) (nativeInboundRule, error) {
	rows, err := tx.Query(ctx, nativeInboundRulesQuery, session.OrganizationID, session.ID)
	if err != nil {
		return nativeInboundRule{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var rule nativeInboundRule
		var conditions string
		if err := rows.Scan(
			&rule.ID,
			&rule.MatchType,
			&rule.MatchField,
			&rule.MatchValue,
			&rule.SourceLabel,
			&rule.CampaignLabel,
			&rule.TargetUserID,
			&rule.TargetTeamID,
			&rule.TargetPipelineID,
			&rule.TargetStageID,
			&rule.TargetRoundRobinID,
			&rule.ManagedMessageDistribution,
			&conditions,
		); err != nil {
			return nativeInboundRule{}, err
		}
		rule.Conditions = decodeObjectJSON(conditions)
		if nativeInboundRuleMatches(rule, message) {
			return rule, nil
		}
	}
	return nativeInboundRule{}, rows.Err()
}

func nativeInboundRuleMatches(rule nativeInboundRule, message nativeEvolutionMessage) bool {
	matchType := strings.ToLower(strings.TrimSpace(firstNonEmpty(rule.MatchType, "contains")))
	if matchType == "all" {
		return true
	}
	value := strings.ToLower(strings.TrimSpace(firstNonEmpty(
		rule.MatchValue,
		stringFromAny(rule.Conditions["value"]),
		stringFromAny(rule.Conditions["keyword"]),
		stringFromAny(rule.Conditions["text"]),
	)))
	if value == "" {
		return false
	}
	field := strings.ToLower(strings.TrimSpace(firstNonEmpty(rule.MatchField, "message")))
	anyValue := strings.Join([]string{
		message.Content,
		message.ContactName,
		message.RemoteJID,
		message.CampaignSourceID,
		message.CampaignSourceURL,
		message.CampaignHeadline,
		message.CampaignCTWAClid,
		message.CampaignPropertyCode,
	}, " ")
	sources := map[string]string{
		"message":       message.Content,
		"text":          message.Content,
		"phone":         normalizeDigits(message.ContactPhone),
		"name":          message.ContactName,
		"contact_name":  message.ContactName,
		"campaign":      message.CampaignHeadline,
		"ad":            message.CampaignSourceID,
		"ad_id":         message.CampaignSourceID,
		"source_id":     message.CampaignSourceID,
		"source_url":    message.CampaignSourceURL,
		"ctwa_clid":     message.CampaignCTWAClid,
		"property_code": message.CampaignPropertyCode,
		"creative":      message.CampaignHeadline,
		"any":           anyValue,
	}
	source, knownField := sources[field]
	if !knownField {
		source = anyValue
	}
	haystack := strings.ToLower(strings.TrimSpace(source))
	switch matchType {
	case "exact":
		return haystack == value
	case "starts_with":
		return strings.HasPrefix(haystack, value)
	case "regex":
		pattern, err := regexp.Compile(value)
		return err == nil && pattern.MatchString(haystack)
	default:
		return strings.Contains(haystack, value)
	}
}

func resolveNativeLeadAssignment(ctx context.Context, tx pgx.Tx, session nativeEvolutionSession, rule nativeInboundRule) (nativeLeadAssignment, error) {
	assignment := nativeLeadAssignment{}
	if rule.ManagedMessageDistribution {
		assignment.RoundRobinID = rule.TargetRoundRobinID
		return assignment, nil
	}
	if rule.TargetUserID != "" {
		valid, err := nativeOrganizationUserExists(ctx, tx, session.OrganizationID, rule.TargetUserID)
		if err != nil {
			return nativeLeadAssignment{}, err
		}
		if valid {
			assignment.UserID = rule.TargetUserID
		}
	}

	if assignment.UserID == "" && rule.TargetRoundRobinID != "" {
		var roundRobinID string
		err := tx.QueryRow(ctx, `
			select id::text
			from public.round_robins
			where organization_id = $1::uuid and id = $2::uuid and coalesce(is_active, true) = true
		`, session.OrganizationID, rule.TargetRoundRobinID).Scan(&roundRobinID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nativeLeadAssignment{}, err
		}
		if err == nil {
			assignment.RoundRobinID = roundRobinID
		}
	}

	if assignment.UserID == "" && assignment.RoundRobinID == "" {
		for _, candidate := range []string{session.OwnerUserID, session.CreatedBy} {
			if candidate == "" {
				continue
			}
			valid, err := nativeOrganizationUserExists(ctx, tx, session.OrganizationID, candidate)
			if err != nil {
				return nativeLeadAssignment{}, err
			}
			if valid {
				assignment.UserID = candidate
				break
			}
		}
	}

	var err error
	assignment.TeamID, err = nativeScopedUUID(ctx, tx, "teams", session.OrganizationID, rule.TargetTeamID)
	if err != nil {
		return nativeLeadAssignment{}, err
	}
	assignment.PipelineID, err = nativeScopedUUID(ctx, tx, "pipelines", session.OrganizationID, rule.TargetPipelineID)
	if err != nil {
		return nativeLeadAssignment{}, err
	}
	assignment.StageID, err = nativeScopedUUID(ctx, tx, "stages", session.OrganizationID, rule.TargetStageID)
	if err != nil {
		return nativeLeadAssignment{}, err
	}
	return assignment, nil
}

func nativeOrganizationUserExists(ctx context.Context, tx pgx.Tx, organizationID string, userID string) (bool, error) {
	var exists bool
	err := tx.QueryRow(ctx, `
		select exists (
		  select 1
		  from public.users app_user
		  join public.organization_members member
		    on member.organization_id = app_user.organization_id
		   and member.user_id = app_user.id
		   and coalesce(member.is_active, true) = true
		  where app_user.organization_id = $1::uuid
		    and app_user.id = $2::uuid
		    and coalesce(app_user.is_active, true) = true
		)
	`, organizationID, userID).Scan(&exists)
	return exists, err
}

func nativeScopedUUID(ctx context.Context, tx pgx.Tx, table string, organizationID string, value string) (string, error) {
	if value == "" {
		return "", nil
	}
	allowed := map[string]bool{"teams": true, "pipelines": true, "stages": true}
	if !allowed[table] {
		return "", ErrInvalidInput
	}
	var id string
	err := tx.QueryRow(ctx, `select id::text from public.`+table+` where organization_id = $1::uuid and id = $2::uuid limit 1`, organizationID, value).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}

func applyNativeInboundBusinessEffects(
	ctx context.Context,
	tx pgx.Tx,
	session nativeEvolutionSession,
	conversation nativeEvolutionConversation,
	message nativeEvolutionMessage,
	messageRowID string,
	rule nativeInboundRule,
) error {
	attribution := nativeCampaignAttribution(message)
	details := jsonb(map[string]any{
		"remote_jid":           conversation.RemoteJID,
		"message_id":           message.ProviderMessageID,
		"message_row_id":       messageRowID,
		"match_field":          rule.MatchField,
		"match_value":          rule.MatchValue,
		"campaign_label":       firstNonEmpty(rule.CampaignLabel, message.CampaignHeadline),
		"whatsapp_attribution": attribution,
	})
	if _, err := tx.Exec(ctx, `
		insert into public.whatsapp_inbound_logs (
		  organization_id, session_id, conversation_id, lead_id,
		  matched_rule_id, assigned_user_id, match_details
		)
		select $1::uuid, $2::uuid, $3::uuid, nullif($4, '')::uuid,
		       nullif($5, '')::uuid, nullif($6, '')::uuid, $7::jsonb
		where not exists (
		  select 1 from public.whatsapp_inbound_logs log
		  where log.organization_id = $1::uuid and log.session_id = $2::uuid
		    and log.match_details->>'message_id' = $8
		)
	`, session.OrganizationID, session.ID, conversation.ID, conversation.LeadID,
		rule.ID, nativeConversationAssignedUser(ctx, tx, session.OrganizationID, conversation.ID), details, message.ProviderMessageID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		update public.whatsapp_inbound_logs
		set lead_id = coalesce(lead_id, nullif($4, '')::uuid),
		    matched_rule_id = coalesce(matched_rule_id, nullif($5, '')::uuid),
		    assigned_user_id = coalesce(assigned_user_id, nullif($6, '')::uuid),
		    match_details = coalesce(match_details, '{}'::jsonb) || $7::jsonb
		where organization_id = $1::uuid and session_id = $2::uuid
		  and conversation_id = $3::uuid and match_details->>'message_id' = $8
	`, session.OrganizationID, session.ID, conversation.ID, conversation.LeadID,
		rule.ID, nativeConversationAssignedUser(ctx, tx, session.OrganizationID, conversation.ID), details, message.ProviderMessageID); err != nil {
		return err
	}
	if conversation.LeadID == "" {
		return nil
	}

	leadMetadata := map[string]any{
		"last_whatsapp_session_id": session.ID,
		"last_whatsapp_remote_jid": conversation.RemoteJID,
	}
	if message.HasCampaignSignal {
		leadMetadata["whatsapp_attribution"] = attribution
	}
	metadataPatch := jsonb(leadMetadata)
	if _, err := tx.Exec(ctx, `
		update public.leads
		set last_contact_at = greatest(coalesce(last_contact_at, $3::timestamptz), $3::timestamptz),
		    metadata = coalesce(metadata, '{}'::jsonb) || $4::jsonb,
		    updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
	`, session.OrganizationID, conversation.LeadID, message.SentAt, metadataPatch); err != nil {
		return err
	}
	if !message.HasCampaignSignal {
		return nil
	}

	attributionJSON := jsonb(attribution)
	if _, err := tx.Exec(ctx, `
		insert into public.lead_meta (
		  organization_id, lead_id, platform, source_type, ad_id, ad_name,
		  campaign_name, payload, raw_payload
		) values (
		  $1::uuid, $2::uuid, 'meta', 'whatsapp_click_to_message', nullif($3, ''),
		  nullif($4, ''), nullif($4, ''), $5::jsonb, $5::jsonb
		)
		on conflict (lead_id) do update set
		  platform = 'meta',
		  source_type = 'whatsapp_click_to_message',
		  ad_id = excluded.ad_id,
		  ad_name = excluded.ad_name,
		  campaign_name = excluded.campaign_name,
		  payload = excluded.payload,
		  raw_payload = excluded.raw_payload,
		  updated_at = now()
		where lead_meta.organization_id = $1::uuid
		  and (lead_meta.source_type is null or lead_meta.source_type = 'whatsapp_click_to_message' or lead_meta.platform = 'whatsapp')
	`, session.OrganizationID, conversation.LeadID, message.CampaignSourceID, message.CampaignHeadline, attributionJSON); err != nil {
		return err
	}

	effectMetadata := jsonb(map[string]any{
		"source":              "whatsapp",
		"source_type":         "whatsapp_click_to_message",
		"message_id":          message.ProviderMessageID,
		"message_row_id":      messageRowID,
		"conversation_id":     conversation.ID,
		"whatsapp_session_id": session.ID,
		"remote_jid":          conversation.RemoteJID,
		"ad_id":               message.CampaignSourceID,
		"campaign_name":       message.CampaignHeadline,
		"source_url":          message.CampaignSourceURL,
		"ctwa_clid":           message.CampaignCTWAClid,
		"property_code":       message.CampaignPropertyCode,
	})
	if conversation.LeadIsNew {
		if _, err := tx.Exec(ctx, `
			update public.lead_entry_events
			set source = 'whatsapp',
			    provider = 'whatsapp',
			    provider_event_id = nullif($3, ''),
			    occurred_at = $4::timestamptz,
			    is_countable = true,
			    source_detail = 'whatsapp_click_to_message',
			    campaign_name = nullif($5, ''),
			    ad_id = nullif($6, ''),
			    ad_name = nullif($5, ''),
			    utm_source = 'facebook',
			    utm_medium = 'click_to_whatsapp',
			    utm_campaign = nullif($5, ''),
			    metadata = coalesce(metadata, '{}'::jsonb) || $7::jsonb,
			    payload = $7::jsonb
			where id = (
				select initial.id
				from public.lead_entry_events initial
				where initial.organization_id = $1::uuid
				  and initial.lead_id = $2::uuid
				  and initial.entry_type = 'initial'
				order by initial.created_at, initial.id
				limit 1
			)
		`, session.OrganizationID, conversation.LeadID, message.ProviderMessageID, message.SentAt, message.CampaignHeadline, message.CampaignSourceID, effectMetadata); err != nil {
			return err
		}
	} else if _, err := tx.Exec(ctx, `
		insert into public.lead_entry_events (
		  organization_id, lead_id, source, provider, provider_event_id,
		  occurred_at, is_countable, source_detail, entry_type, campaign_name,
		  ad_id, ad_name, utm_source, utm_medium, utm_campaign, metadata, payload
		)
		values (
		  $1::uuid, $2::uuid, 'whatsapp', 'whatsapp', nullif($3, ''),
		  $4::timestamptz, true, 'whatsapp_click_to_message', 'reentry', nullif($5, ''),
		  nullif($6, ''), nullif($5, ''), 'facebook', 'click_to_whatsapp',
		  nullif($5, ''), $7::jsonb, $7::jsonb
		)
		on conflict (organization_id, provider, provider_event_id)
			where provider_event_id is not null and is_countable = true
		do nothing
	`, session.OrganizationID, conversation.LeadID, message.ProviderMessageID, message.SentAt, message.CampaignHeadline, message.CampaignSourceID, effectMetadata); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		insert into public.activities (organization_id, lead_id, user_id, type, content, metadata)
		select $1::uuid, $2::uuid, null, 'meta_creative', nullif($3, ''), $4::jsonb
		where not exists (
		  select 1 from public.activities activity
		  where activity.organization_id = $1::uuid and activity.lead_id = $2::uuid
		    and activity.type = 'meta_creative' and activity.metadata->>'message_id' = $5
		)
	`, session.OrganizationID, conversation.LeadID, firstNonEmpty(message.CampaignHeadline, "Criativo do anuncio"), effectMetadata, message.ProviderMessageID); err != nil {
		return err
	}
	return nil
}

func nativeConversationAssignedUser(ctx context.Context, tx pgx.Tx, organizationID string, conversationID string) string {
	var userID string
	_ = tx.QueryRow(ctx, `
		select coalesce(assigned_user_id::text, '')
		from public.whatsapp_conversations
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, conversationID).Scan(&userID)
	return userID
}

func nativeCampaignAttribution(message nativeEvolutionMessage) map[string]any {
	if !message.HasCampaignSignal {
		return map[string]any{}
	}
	return map[string]any{
		"source":        "whatsapp",
		"source_type":   "whatsapp_click_to_message",
		"platform":      "meta",
		"ad_id":         message.CampaignSourceID,
		"source_id":     message.CampaignSourceID,
		"source_url":    message.CampaignSourceURL,
		"ctwa_clid":     message.CampaignCTWAClid,
		"ad_name":       message.CampaignHeadline,
		"campaign_name": message.CampaignHeadline,
		"property_code": message.CampaignPropertyCode,
		"source_referral": map[string]any{
			"explicit_source_type": strings.ToLower(strings.TrimSpace(message.CampaignSourceType)),
			"source_id":            message.CampaignSourceID,
			"source_url":           message.CampaignSourceURL,
			"ctwa_clid":            message.CampaignCTWAClid,
			"headline":             message.CampaignHeadline,
		},
	}
}
