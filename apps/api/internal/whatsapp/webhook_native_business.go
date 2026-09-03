package whatsapp

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type nativeInboundRule struct {
	ID                          string
	MatchType                   string
	MatchField                  string
	MatchValue                  string
	SourceLabel                 string
	CampaignLabel               string
	TargetUserID                string
	TargetTeamID                string
	TargetPipelineID            string
	TargetStageID               string
	TargetRoundRobinID          string
	ManagedMessageDistribution  bool
	ManagedProviderEventHandled bool
	LegacyNonManagedRetry       bool
	ManagedProviderEventPending bool
	ManagedProviderEventLeadID  string
	Conditions                  map[string]any
}

type nativeManagedWhatsAppEntryLookup struct {
	Handled               bool   `json:"handled"`
	Pending               bool   `json:"pending"`
	LegacyNonManagedRetry bool   `json:"legacy_non_managed_retry"`
	Quarantine            bool   `json:"quarantine"`
	Quarantined           bool   `json:"quarantined"`
	Incomplete            bool   `json:"incomplete"`
	Reason                string `json:"reason"`
	MatchedRuleID         string `json:"matched_rule_id"`
	TargetQueueID         string `json:"target_round_robin_id"`
	LeadID                string `json:"lead_id"`
}

const nativeManagedWhatsAppEntryLookupQuery = `
	select public.lookup_managed_whatsapp_lead_entry(
		p_organization_id => $1::uuid,
		p_session_id => $2::uuid,
		p_provider_message_id => $3,
		p_message => $4
	)
`

const nativeLegacyRoundRobinMembersQuery = `
	select member.user_id::text
	from public.round_robin_members member
	join public.users app_user
	  on app_user.organization_id = member.organization_id
	 and app_user.id = member.user_id
	 and coalesce(app_user.is_active, true) = true
	where member.organization_id = $1::uuid
	  and member.round_robin_id = $2::uuid
	  and coalesce(member.is_active, true) = true
	order by member.position asc, member.created_at asc, member.id asc
`

type nativeLeadAssignment struct {
	UserID             string
	PipelineID         string
	StageID            string
	TeamID             string
	RoundRobinID       string
	RoundRobinPosition int
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
	  coalesce(whatsapp_inbound_rules.session_id = $2::uuid, false)
	  and lower(btrim(coalesce(whatsapp_inbound_rules.match_type, ''))) = 'contains'
	  and lower(btrim(coalesce(whatsapp_inbound_rules.match_field, 'message'))) = 'message'
	  and btrim(coalesce(whatsapp_inbound_rules.match_value, '')) <> ''
	  and exists (
	    select 1
	    from public.round_robins managed_queue
	    where managed_queue.organization_id = whatsapp_inbound_rules.organization_id
	      and managed_queue.id = whatsapp_inbound_rules.target_round_robin_id
	      and coalesce(managed_queue.is_active, true) = true
	      and lower(btrim(coalesce(managed_queue.settings->>'require_checkin', 'false')))
	        not in ('true', '1', 'yes')
	  )
	  and exists (
	    select 1
	    from public.round_robin_rules managed_rule
	    where managed_rule.organization_id = whatsapp_inbound_rules.organization_id
	      and managed_rule.id = whatsapp_inbound_rules.id
	      and managed_rule.round_robin_id = whatsapp_inbound_rules.target_round_robin_id
	      and coalesce(managed_rule.is_active, true) = true
	      and coalesce(nullif(managed_rule.match_type, ''), managed_rule.conditions->>'match_type', managed_rule.name, '') = 'whatsapp_message_contains'
	      and coalesce(
	        nullif(btrim(managed_rule.match->>'whatsapp_session_id'), ''),
	        nullif(btrim(managed_rule.conditions->'match'->>'whatsapp_session_id'), '')
	      ) = $2::uuid::text
	      and lower(btrim(whatsapp_inbound_rules.match_value)) = lower(btrim(coalesce(
	        nullif(managed_rule.match_value, ''),
	        managed_rule.conditions->>'match_value',
	        ''
	      )))
	  ),
	  '{}'::jsonb::text
	from public.whatsapp_inbound_rules
	where organization_id = $1::uuid
	  and coalesce(is_active, true) = true
	  and (session_id is null or session_id = $2::uuid)
	order by priority desc, created_at asc, id asc
`

func findNativeInboundRule(ctx context.Context, tx pgx.Tx, session nativeEvolutionSession, message nativeEvolutionMessage) (nativeInboundRule, error) {
	if !message.FromMe && !message.IsGroup && strings.TrimSpace(message.ProviderMessageID) != "" {
		lookup, err := lookupNativeManagedWhatsAppLeadEntry(ctx, tx, session, message)
		if err != nil {
			return nativeInboundRule{}, err
		}
		if err := nativeManagedWhatsAppEntryLookupFailure(lookup); err != nil {
			return nativeInboundRule{}, err
		}
		if recoveredRule, recovered := nativeInboundRuleFromManagedLookup(lookup); recovered {
			return recoveredRule, nil
		}
	}

	rows, err := tx.Query(ctx, nativeInboundRulesQuery, session.OrganizationID, session.ID)
	if err != nil {
		return nativeInboundRule{}, err
	}
	defer rows.Close()
	rules := make([]nativeInboundRule, 0)
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
		rules = append(rules, rule)
	}
	if err := rows.Err(); err != nil {
		return nativeInboundRule{}, err
	}
	selected := selectNativeInboundRule(rules, message)
	if err := validateNativeManagedProviderMessageIdentity(message, selected); err != nil {
		return nativeInboundRule{}, err
	}
	return selected, nil
}

func nativeInboundRuleFromManagedLookup(lookup nativeManagedWhatsAppEntryLookup) (nativeInboundRule, bool) {
	if lookup.Pending {
		return nativeInboundRule{
			ID:                          lookup.MatchedRuleID,
			TargetRoundRobinID:          lookup.TargetQueueID,
			ManagedMessageDistribution:  true,
			ManagedProviderEventPending: true,
			ManagedProviderEventLeadID:  lookup.LeadID,
		}, true
	}
	if lookup.Handled {
		return nativeInboundRule{
			ManagedProviderEventHandled: true,
			LegacyNonManagedRetry:       lookup.LegacyNonManagedRetry,
			ManagedProviderEventLeadID:  lookup.LeadID,
		}, true
	}
	return nativeInboundRule{}, false
}

func lookupNativeManagedWhatsAppLeadEntry(
	ctx context.Context,
	tx pgx.Tx,
	session nativeEvolutionSession,
	message nativeEvolutionMessage,
) (nativeManagedWhatsAppEntryLookup, error) {
	var raw []byte
	if err := tx.QueryRow(
		ctx,
		nativeManagedWhatsAppEntryLookupQuery,
		session.OrganizationID,
		session.ID,
		message.ProviderMessageID,
		message.Content,
	).Scan(&raw); err != nil {
		return nativeManagedWhatsAppEntryLookup{}, err
	}
	return parseNativeManagedWhatsAppEntryLookup(raw)
}

func parseNativeManagedWhatsAppEntryLookup(raw []byte) (nativeManagedWhatsAppEntryLookup, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" || !strings.HasPrefix(trimmed, "{") {
		return nativeManagedWhatsAppEntryLookup{}, errors.New("invalid managed WhatsApp entry lookup result: expected JSON object")
	}
	var lookup nativeManagedWhatsAppEntryLookup
	if err := json.Unmarshal(raw, &lookup); err != nil {
		return nativeManagedWhatsAppEntryLookup{}, fmt.Errorf("invalid managed WhatsApp entry lookup result: %w", err)
	}
	if lookup.Pending {
		if lookup.Handled || strings.TrimSpace(lookup.MatchedRuleID) == "" ||
			strings.TrimSpace(lookup.TargetQueueID) == "" || strings.TrimSpace(lookup.LeadID) == "" {
			return nativeManagedWhatsAppEntryLookup{}, errors.New("invalid pending managed WhatsApp entry lookup result")
		}
	}
	if lookup.LegacyNonManagedRetry && !lookup.Handled {
		return nativeManagedWhatsAppEntryLookup{}, errors.New("invalid legacy non-managed WhatsApp retry lookup result")
	}
	if lookup.Handled && !lookup.LegacyNonManagedRetry && (strings.TrimSpace(lookup.LeadID) == "" ||
		strings.TrimSpace(lookup.MatchedRuleID) == "" || strings.TrimSpace(lookup.TargetQueueID) == "") {
		return nativeManagedWhatsAppEntryLookup{}, errors.New("invalid handled managed WhatsApp entry lookup result")
	}
	if (lookup.Quarantine || lookup.Quarantined || lookup.Incomplete) && (lookup.Handled || lookup.Pending) {
		return nativeManagedWhatsAppEntryLookup{}, errors.New("invalid quarantined managed WhatsApp entry lookup result")
	}
	return lookup, nil
}

func nativeManagedWhatsAppEntryLookupFailure(lookup nativeManagedWhatsAppEntryLookup) error {
	if !lookup.Quarantine && !lookup.Quarantined && !lookup.Incomplete {
		return nil
	}
	reason := strings.TrimSpace(lookup.Reason)
	if reason == "" {
		reason = "managed_whatsapp_provider_event_requires_quarantine"
	}
	return fmt.Errorf("managed WhatsApp provider event cannot be routed: %s", reason)
}

func validateNativeManagedProviderMessageIdentity(message nativeEvolutionMessage, rule nativeInboundRule) error {
	if !rule.ManagedMessageDistribution && !message.IsCTWAAd {
		return nil
	}
	providerMessageID := strings.TrimSpace(message.ProviderMessageID)
	if message.ProviderMessageIDSynthetic || providerMessageID == "" {
		return errors.New("WhatsApp CTWA lead creation requires a provider message id")
	}
	if providerMessageID != message.ProviderMessageID || utf8.RuneCountInString(providerMessageID) > 500 {
		return errors.New("WhatsApp CTWA lead creation provider message id is invalid")
	}
	return nil
}

// selectNativeInboundRule expects the same priority order enforced by
// nativeInboundRulesQuery. Managed mirrors are exclusively CTWA lead-routing
// rules: a matching managed mirror always wins for a confirmed CTWA ad, while
// normal WhatsApp messages ignore managed mirrors entirely.
func selectNativeInboundRule(rules []nativeInboundRule, message nativeEvolutionMessage) nativeInboundRule {
	firstManual := nativeInboundRule{}
	for _, rule := range rules {
		if !nativeInboundRuleMatches(rule, message) {
			continue
		}
		if rule.ManagedMessageDistribution {
			if message.IsCTWAAd {
				return rule
			}
			continue
		}
		if firstManual.ID == "" {
			firstManual = rule
		}
	}
	return firstManual
}

func nativeInboundRuleIsCatchAll(rule nativeInboundRule) bool {
	return strings.EqualFold(strings.TrimSpace(rule.MatchType), "all")
}

func nativeManagedProviderEventAlreadyHandled(rule nativeInboundRule) bool {
	return rule.ManagedProviderEventHandled
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
		var currentPosition int
		err := tx.QueryRow(ctx, `
			select current_position
			from public.round_robins
			where organization_id = $1::uuid and id = $2::uuid and coalesce(is_active, true) = true
			for update
		`, session.OrganizationID, rule.TargetRoundRobinID).Scan(&currentPosition)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nativeLeadAssignment{}, err
		}
		if err == nil {
			rows, err := tx.Query(ctx, nativeLegacyRoundRobinMembersQuery, session.OrganizationID, rule.TargetRoundRobinID)
			if err != nil {
				return nativeLeadAssignment{}, err
			}
			members := []string{}
			for rows.Next() {
				var userID string
				if err := rows.Scan(&userID); err != nil {
					rows.Close()
					return nativeLeadAssignment{}, err
				}
				members = append(members, userID)
			}
			if err := rows.Err(); err != nil {
				rows.Close()
				return nativeLeadAssignment{}, err
			}
			rows.Close()
			if len(members) > 0 {
				index := currentPosition % len(members)
				if index < 0 {
					index = -index
				}
				assignment.UserID = members[index]
				assignment.RoundRobinID = rule.TargetRoundRobinID
				assignment.RoundRobinPosition = currentPosition + 1
			}
		}
	}

	if assignment.UserID == "" {
		ownerUserID, err := resolveNativeActiveSessionOwner(ctx, tx, session)
		if err != nil {
			return nativeLeadAssignment{}, err
		}
		assignment.UserID = ownerUserID
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

func resolveNativeActiveSessionOwner(ctx context.Context, tx pgx.Tx, session nativeEvolutionSession) (string, error) {
	for _, candidate := range uniqueStrings(session.OwnerUserID, session.CreatedBy) {
		if candidate == "" {
			continue
		}
		valid, err := nativeOrganizationUserExists(ctx, tx, session.OrganizationID, candidate)
		if err != nil {
			return "", err
		}
		if valid {
			return candidate, nil
		}
	}
	return "", nil
}

func nativeOrganizationUserExists(ctx context.Context, tx pgx.Tx, organizationID string, userID string) (bool, error) {
	var exists bool
	err := tx.QueryRow(ctx, `
		select exists (
		  select 1
		  from public.users app_user
		  where app_user.id = $2::uuid
		    and coalesce(app_user.is_active, true) = true
		    and exists (
		      select 1
		      from public.organization_members member
		      where member.organization_id = $1::uuid
		        and member.user_id = app_user.id
		        and coalesce(member.is_active, true) = true
		    )
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

const nativeLeadMetaAttributionUpsertQuery = `
	insert into public.lead_meta (
	  organization_id, lead_id, platform, source_type, ad_id, ad_name,
	  campaign_name, creative_url, creative_video_url, creative_instagram_url,
	  utm_source, utm_medium, utm_campaign, payload, raw_payload
	) values (
	  $1::uuid, $2::uuid, 'meta', 'whatsapp_click_to_message', nullif($3, ''),
	  nullif($4, ''), nullif($4, ''), nullif($5, ''), nullif($6, ''), nullif($7, ''),
	  $8, 'click_to_whatsapp', nullif($4, ''), $9::jsonb, $9::jsonb
	)
	on conflict (lead_id) do update set
	  platform = 'meta',
	  source_type = 'whatsapp_click_to_message',
	  ad_id = excluded.ad_id,
	  ad_name = excluded.ad_name,
	  campaign_name = excluded.campaign_name,
	  creative_url = excluded.creative_url,
	  creative_video_url = excluded.creative_video_url,
	  creative_instagram_url = excluded.creative_instagram_url,
	  utm_source = excluded.utm_source,
	  utm_medium = excluded.utm_medium,
	  utm_campaign = excluded.utm_campaign,
	  payload = excluded.payload,
	  raw_payload = excluded.raw_payload,
	  updated_at = now()
	where lead_meta.organization_id = $1::uuid
	  and (lead_meta.source_type is null or lead_meta.source_type = 'whatsapp_click_to_message' or lead_meta.platform = 'whatsapp')
`

const nativeNonManagedLeadReentryUpsertQuery = `
	insert into public.lead_entry_events as existing_entry (
	  organization_id, lead_id, source, provider,
	  provider_event_id, occurred_at, is_countable, source_detail, entry_type, campaign_name,
	  ad_id, ad_name, utm_source, utm_medium, utm_campaign, metadata, payload
	)
	values (
	  $1::uuid, $2::uuid, 'whatsapp', 'whatsapp',
	  $8, $3::timestamptz, true, 'whatsapp_click_to_message', 'reentry', nullif($4, ''),
	  nullif($5, ''), nullif($4, ''), $7, 'click_to_whatsapp',
	  nullif($4, ''), $6::jsonb, $6::jsonb
	)
	on conflict (organization_id, provider, provider_event_id)
	  where provider_event_id is not null and is_countable = true
	do update set
	  campaign_name = coalesce(excluded.campaign_name, existing_entry.campaign_name),
	  ad_id = coalesce(excluded.ad_id, existing_entry.ad_id),
	  ad_name = coalesce(excluded.ad_name, existing_entry.ad_name),
	  utm_source = coalesce(excluded.utm_source, existing_entry.utm_source),
	  utm_medium = coalesce(excluded.utm_medium, existing_entry.utm_medium),
	  utm_campaign = coalesce(excluded.utm_campaign, existing_entry.utm_campaign),
	  metadata = coalesce(existing_entry.metadata, '{}'::jsonb) || excluded.metadata,
	  payload = coalesce(existing_entry.payload, '{}'::jsonb) || excluded.payload
	where existing_entry.lead_id = excluded.lead_id
	returning existing_entry.id::text
`

func applyNativeInboundBusinessEffects(
	ctx context.Context,
	tx pgx.Tx,
	session nativeEvolutionSession,
	conversation nativeEvolutionConversation,
	message nativeEvolutionMessage,
	messageRowID string,
	rule nativeInboundRule,
) error {
	if rule.ManagedProviderEventHandled {
		if rule.ManagedProviderEventLeadID != "" && conversation.LeadID != "" &&
			conversation.LeadID != rule.ManagedProviderEventLeadID {
			return errors.New("managed WhatsApp provider event lead mismatch")
		}
		return nil
	}
	if rule.ManagedProviderEventPending &&
		(conversation.LeadID == "" || conversation.LeadID != rule.ManagedProviderEventLeadID) {
		return errors.New("pending managed WhatsApp provider event lead mismatch")
	}

	attribution := nativeCampaignAttribution(message)
	detailsPayload := nativeInboundLogDetailsPayload(session, conversation, message, messageRowID, rule, attribution)
	details := jsonb(detailsPayload)
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
		if rule.ManagedMessageDistribution {
			return errors.New("managed WhatsApp lead identity unresolved")
		}
		return nil
	}

	if !rule.ManagedMessageDistribution {
		leadMetadata := map[string]any{
			"last_whatsapp_session_id": session.ID,
			"last_whatsapp_remote_jid": conversation.RemoteJID,
		}
		if message.IsCTWAAd {
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
	}
	if !message.IsCTWAAd {
		if rule.ManagedMessageDistribution {
			return processNativeManagedWhatsAppLeadEntry(ctx, tx, session, conversation, message, rule)
		}
		return nil
	}

	attributionJSON := jsonb(attribution)
	if _, err := tx.Exec(ctx, nativeLeadMetaAttributionUpsertQuery,
		session.OrganizationID, conversation.LeadID, message.CampaignSourceID, message.CampaignHeadline,
		message.CampaignCreativeURL, message.CampaignCreativeVideoURL, nativeCampaignInstagramURL(message),
		nativeCampaignAttributionUTMSource(message), attributionJSON); err != nil {
		return err
	}

	effectPayload := map[string]any{}
	for key, value := range attribution {
		effectPayload[key] = value
	}
	for key, value := range map[string]any{
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
	} {
		effectPayload[key] = value
	}
	if !rule.ManagedMessageDistribution {
		// Keep the canonical session-scoped event key in metadata only. Writing
		// it to provider_event_id here would make managed lookup mistake this
		// owner-fallback event for a managed-ledger row.
		effectPayload["provider_event_id"] = nativeWhatsAppProviderEventID(session, message)
	}
	effectMetadata := jsonb(effectPayload)
	utmSource := nativeCampaignAttributionUTMSource(message)
	nonManagedProviderEventID := nativeNonManagedWhatsAppProviderEventID(session, message)
	if !rule.ManagedMessageDistribution && conversation.LeadIsNew {
		if _, err := tx.Exec(ctx, `
			update public.lead_entry_events
			set source = 'whatsapp',
			    provider = 'whatsapp',
			    provider_event_id = $8,
			    occurred_at = $3::timestamptz,
			    is_countable = true,
			    source_detail = 'whatsapp_click_to_message',
			    campaign_name = nullif($4, ''),
			    ad_id = nullif($5, ''),
			    ad_name = nullif($4, ''),
			    utm_source = $7,
			    utm_medium = 'click_to_whatsapp',
			    utm_campaign = nullif($4, ''),
			    metadata = coalesce(metadata, '{}'::jsonb) || $6::jsonb,
			    payload = coalesce(payload, '{}'::jsonb) || $6::jsonb
			where id = (
				select initial.id
				from public.lead_entry_events initial
				where initial.organization_id = $1::uuid
				  and initial.lead_id = $2::uuid
				  and initial.entry_type = 'initial'
				order by initial.created_at, initial.id
				limit 1
			)
		`, session.OrganizationID, conversation.LeadID, message.SentAt, message.CampaignHeadline, message.CampaignSourceID, effectMetadata, utmSource, nonManagedProviderEventID); err != nil {
			return err
		}
	} else if !rule.ManagedMessageDistribution {
		var entryID string
		err := tx.QueryRow(ctx, nativeNonManagedLeadReentryUpsertQuery,
			session.OrganizationID, conversation.LeadID, message.SentAt, message.CampaignHeadline,
			message.CampaignSourceID, effectMetadata, utmSource, nonManagedProviderEventID,
		).Scan(&entryID)
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("non-managed WhatsApp provider event belongs to another lead")
		}
		if err != nil {
			return err
		}
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
	if rule.ManagedMessageDistribution {
		return processNativeManagedWhatsAppLeadEntry(ctx, tx, session, conversation, message, rule)
	}
	return nil
}

func nativeManagedWhatsAppMessageFingerprint(
	organizationID string,
	sessionID string,
	providerMessageID string,
	message string,
) string {
	payload := organizationID + string(rune(31)) + sessionID + string(rune(31)) + providerMessageID + string(rune(31)) + message
	digest := sha256.Sum256([]byte(payload))
	return fmt.Sprintf("%x", digest)
}

type nativeHandledMessageTransportExecutor interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

const nativeHandledMessageTransportReconcileQuery = `
	update public.whatsapp_messages as message
	set media_url = coalesce(message.media_url, nullif($4, '')),
	    media_mime_type = coalesce(message.media_mime_type, nullif($5, '')),
	    media_storage_path = coalesce(message.media_storage_path, nullif($6, '')),
	    media_status = case
	      when coalesce(message.media_storage_path, nullif($6, '')) is not null then 'ready'
	      else message.media_status
	    end,
	    media_error = case
	      when coalesce(message.media_storage_path, nullif($6, '')) is not null then null
	      else message.media_error
	    end,
	    media_size = coalesce(message.media_size, nullif($7, 0)),
	    updated_at = now()
	where message.organization_id = $1::uuid
	  and message.session_id = $2::uuid
	  and (message.provider_message_id = $3 or message.message_id = $3)
	  and coalesce(message.from_me, false) = false
	  and lower(coalesce(message.direction, 'inbound')) <> 'outbound'
`

// A completed lifecycle ledger is a no-op for lead/routing effects, but the
// native media pipeline intentionally replays the message after Storage has
// succeeded. Reconcile only transport fields on the existing row so that the
// second pass cannot create a lead, rerun a rule or increment an entry.
func reconcileNativeHandledMessageTransport(
	ctx context.Context,
	executor nativeHandledMessageTransportExecutor,
	session nativeEvolutionSession,
	message nativeEvolutionMessage,
) error {
	if !nativeIsMediaType(message.MessageType) || strings.TrimSpace(message.MediaStoragePath) == "" {
		return nil
	}
	_, err := executor.Exec(
		ctx,
		nativeHandledMessageTransportReconcileQuery,
		session.OrganizationID,
		session.ID,
		message.ProviderMessageID,
		message.MediaURL,
		message.MediaMimeType,
		message.MediaStoragePath,
		message.MediaSize,
	)
	return err
}

func nativeInboundLogDetailsPayload(
	session nativeEvolutionSession,
	conversation nativeEvolutionConversation,
	message nativeEvolutionMessage,
	messageRowID string,
	rule nativeInboundRule,
	attribution map[string]any,
) map[string]any {
	details := map[string]any{
		"remote_jid":           conversation.RemoteJID,
		"message_id":           message.ProviderMessageID,
		"message_row_id":       messageRowID,
		"match_field":          rule.MatchField,
		"match_value":          rule.MatchValue,
		"campaign_label":       firstNonEmpty(rule.CampaignLabel, message.CampaignHeadline),
		"whatsapp_attribution": attribution,
	}
	if rule.ManagedMessageDistribution {
		details["managed_whatsapp_message_distribution"] = true
		details["target_round_robin_id"] = rule.TargetRoundRobinID
		details["message_fingerprint"] = nativeManagedWhatsAppMessageFingerprint(
			session.OrganizationID,
			session.ID,
			message.ProviderMessageID,
			message.Content,
		)
	}
	return details
}

func processNativeManagedWhatsAppLeadEntry(
	ctx context.Context,
	tx pgx.Tx,
	session nativeEvolutionSession,
	conversation nativeEvolutionConversation,
	message nativeEvolutionMessage,
	rule nativeInboundRule,
) error {
	var result []byte
	if err := tx.QueryRow(ctx, `
		select public.process_managed_whatsapp_lead_entry(
			p_organization_id => $1::uuid,
			p_lead_id => $2::uuid,
			p_session_id => $3::uuid,
			p_rule_id => $4::uuid,
			p_provider_message_id => $5,
			p_message => $6,
			p_occurred_at => $7::timestamptz
		)
	`, session.OrganizationID, conversation.LeadID, session.ID, rule.ID,
		message.ProviderMessageID, message.Content, message.SentAt).Scan(&result); err != nil {
		return err
	}
	if err := validateNativeManagedWhatsAppLeadEntryResult(result); err != nil {
		return err
	}
	if !message.IsCTWAAd {
		return nil
	}
	return enrichNativeManagedWhatsAppLeadEntryAttribution(
		ctx,
		tx,
		session,
		conversation.LeadID,
		message,
		false,
	)
}

type nativeManagedAttributionQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func enrichNativeManagedWhatsAppLeadEntryAttribution(
	ctx context.Context,
	querier nativeManagedAttributionQuerier,
	session nativeEvolutionSession,
	leadID string,
	message nativeEvolutionMessage,
	allowMissing bool,
) error {
	if !message.IsCTWAAd || strings.TrimSpace(leadID) == "" {
		return nil
	}
	var enriched bool
	if err := querier.QueryRow(ctx, `
		select public.enrich_whatsapp_lead_entry_attribution(
			p_organization_id => $1::uuid,
			p_lead_id => $2::uuid,
			p_session_id => $3::uuid,
			p_provider_message_id => $4
		)
	`, session.OrganizationID, leadID, session.ID, message.ProviderMessageID).Scan(&enriched); err != nil {
		return err
	}
	if !enriched && !allowMissing {
		return errors.New("managed WhatsApp lead entry attribution was not found")
	}
	return nil
}

func validateNativeManagedWhatsAppLeadEntryResult(raw []byte) error {
	var result struct {
		Handled bool   `json:"handled"`
		Reason  string `json:"reason"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return fmt.Errorf("invalid managed WhatsApp lead entry result: %w", err)
	}
	if result.Handled {
		return nil
	}
	reason := strings.TrimSpace(result.Reason)
	if reason == "" {
		reason = "unknown"
	}
	return fmt.Errorf("managed WhatsApp lead entry was not handled: %s", reason)
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
	referral := nativeCampaignReferralSnapshot(message)
	if len(referral) == 0 {
		return map[string]any{}
	}
	attribution := map[string]any{
		"source":                        "whatsapp",
		"source_type":                   "whatsapp_click_to_message",
		"platform":                      "meta",
		"ad_id":                         message.CampaignSourceID,
		"source_id":                     message.CampaignSourceID,
		"source_url":                    message.CampaignSourceURL,
		"ctwa_clid":                     message.CampaignCTWAClid,
		"ad_name":                       message.CampaignHeadline,
		"campaign_name":                 message.CampaignHeadline,
		"creative_name":                 message.CampaignHeadline,
		"creative_url":                  message.CampaignCreativeURL,
		"creative_video_url":            message.CampaignCreativeVideoURL,
		"creative_link_url":             message.CampaignSourceURL,
		"creative_destination_url":      message.CampaignSourceURL,
		"property_code":                 message.CampaignPropertyCode,
		"entry_point_conversion_source": message.CampaignEntryPointConversionSource,
		"entry_point_conversion_app":    message.CampaignEntryPointConversionApp,
		"conversion_source":             message.CampaignConversionSource,
		"source_app":                    message.CampaignSourceApp,
		"source_referral":               referral,
	}
	if message.CampaignShowAdAttribution != nil {
		attribution["show_ad_attribution"] = *message.CampaignShowAdAttribution
	}
	if instagramURL := nativeCampaignInstagramURL(message); instagramURL != "" {
		attribution["creative_instagram_url"] = instagramURL
	}
	for key, value := range attribution {
		if text, ok := value.(string); ok && strings.TrimSpace(text) == "" {
			delete(attribution, key)
		}
	}
	return attribution
}

func nativeCampaignReferralSnapshot(message nativeEvolutionMessage) map[string]any {
	referral := map[string]any{}
	values := map[string]string{
		"explicit_source_type":          strings.TrimSpace(message.CampaignSourceType),
		"source_id":                     strings.TrimSpace(message.CampaignSourceID),
		"source_url":                    strings.TrimSpace(message.CampaignSourceURL),
		"image_url":                     strings.TrimSpace(message.CampaignCreativeURL),
		"video_url":                     strings.TrimSpace(message.CampaignCreativeVideoURL),
		"ctwa_clid":                     strings.TrimSpace(message.CampaignCTWAClid),
		"headline":                      strings.TrimSpace(message.CampaignHeadline),
		"entry_point_conversion_source": strings.TrimSpace(message.CampaignEntryPointConversionSource),
		"entry_point_conversion_app":    strings.TrimSpace(message.CampaignEntryPointConversionApp),
		"conversion_source":             strings.TrimSpace(message.CampaignConversionSource),
		"source_app":                    strings.TrimSpace(message.CampaignSourceApp),
	}
	for key, value := range values {
		if value != "" {
			referral[key] = value
		}
	}
	if explicit := strings.TrimSpace(message.CampaignSourceType); explicit != "" {
		referral["source_type"] = explicit
	} else if message.CampaignSourceID != "" || message.CampaignSourceURL != "" || message.CampaignCTWAClid != "" {
		referral["source_type"] = "ad"
	}
	if message.CampaignShowAdAttribution != nil {
		referral["show_ad_attribution"] = *message.CampaignShowAdAttribution
	}
	return referral
}

func nativeCampaignAttributionUTMSource(message nativeEvolutionMessage) string {
	sourceApp := strings.ToLower(strings.TrimSpace(firstNonEmpty(
		message.CampaignSourceApp,
		message.CampaignEntryPointConversionApp,
	)))
	if sourceApp == "instagram" || sourceApp == "facebook" {
		return sourceApp
	}
	return "meta"
}

func nativeCampaignInstagramURL(message nativeEvolutionMessage) string {
	if nativeCampaignAttributionUTMSource(message) != "instagram" {
		return ""
	}
	return strings.TrimSpace(message.CampaignSourceURL)
}

func nativeWhatsAppProviderEventID(session nativeEvolutionSession, message nativeEvolutionMessage) string {
	return strings.TrimSpace(session.ID) + ":" + strings.TrimSpace(message.ProviderMessageID)
}

func nativeNonManagedWhatsAppProviderEventID(session nativeEvolutionSession, message nativeEvolutionMessage) string {
	return "nonmanaged:" + nativeWhatsAppProviderEventID(session, message)
}
