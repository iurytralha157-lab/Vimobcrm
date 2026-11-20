package leads

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/authorization"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/whatsappbinding"
)

func (repo Repository) linkWhatsAppConversations(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	leadID string,
	phone *string,
	conversationID *string,
	expectedPreviousLeadID *string,
	confirmHistoryLink bool,
	futureSessionID string,
	beforeBinding ...func() error,
) error {
	// A lead arriving by phone alone has no consent to claim a previously
	// observed WhatsApp history. The inbound processor opens a new epoch for
	// future lead messages; only the exact user-confirmed conversation binds.
	_ = phone
	if conversationID == nil {
		return nil
	}
	if !confirmHistoryLink || expectedPreviousLeadID == nil {
		return fmt.Errorf("%w: explicit conversation history confirmation is required", ErrInvalidInput)
	}
	if err := repo.authorizeWhatsAppConversationLeadBinding(ctx, tx, tenantContext, *conversationID, leadID, false); err != nil {
		return err
	}
	// Authorization above locks conversation then target lead. Reentry must
	// check the fresh pool state here, before changing any history binding.
	for _, authorize := range beforeBinding {
		if err := authorize(); err != nil {
			return err
		}
	}
	var unlinkedRetentionV1 bool
	var currentLeadID, sessionID pgtype.Text
	err := tx.QueryRow(ctx, `
		select unlinked_retention_v1, lead_id::text, session_id::text
		from public.whatsapp_conversations
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, *conversationID).Scan(&unlinkedRetentionV1, &currentLeadID, &sessionID)
	if err != nil {
		return err
	}
	if (currentLeadID.Valid && currentLeadID.String != *expectedPreviousLeadID) ||
		(!currentLeadID.Valid && *expectedPreviousLeadID != "unlinked") {
		return ErrConversationBindingChanged
	}
	if futureSessionID != "" {
		if !sessionID.Valid || sessionID.String != futureSessionID || currentLeadID.Valid || unlinkedRetentionV1 || *expectedPreviousLeadID != "unlinked" {
			return ErrConversationBindingChanged
		}
		eligible, err := whatsappbinding.CanLinkLegacyForFuture(ctx, tx, tenantContext.OrganizationID, *conversationID)
		if err != nil {
			return err
		}
		if !eligible {
			return ErrConversationBindingChanged
		}
	}
	// Modelo de 12/11: conversa sem lead com mensagens unlinked preservadas
	// anexa o historico pelo RPC autorizado, seja ou nao do contrato v1.
	var hasUnlinkedHistory bool
	if !currentLeadID.Valid && futureSessionID == "" {
		if err := tx.QueryRow(ctx, `
			select exists (
				select 1 from public.whatsapp_messages wm
				where wm.organization_id = $1::uuid
				  and wm.conversation_id = $2::uuid
				  and wm.lead_id is null
				  and wm.capture_state = 'unlinked_ephemeral'
				  and wm.unlinked_retention_scrubbed_at is null
			)
		`, tenantContext.OrganizationID, *conversationID).Scan(&hasUnlinkedHistory); err != nil {
			return err
		}
	}
	if futureSessionID == "" && !currentLeadID.Valid && !unlinkedRetentionV1 && !hasUnlinkedHistory {
		return ErrInvalidReference
	}
	if !currentLeadID.Valid && (unlinkedRetentionV1 || hasUnlinkedHistory) && futureSessionID == "" {
		return confirmWhatsAppUnlinkedHistoryBinding(
			ctx, tx, tenantContext.OrganizationID, *conversationID, leadID, tenantContext.UserID, "manual_lead_create",
		)
	}
	if err := activateWhatsAppConversationLeadBinding(
		ctx, tx, tenantContext.OrganizationID, *conversationID, leadID, *expectedPreviousLeadID,
	); err != nil {
		return err
	}
	if futureSessionID != "" {
		_, err := whatsappbinding.StartAssignedOwnerAttendance(ctx, tx, tenantContext, *conversationID, futureSessionID, leadID)
		return err
	}
	return nil
}
func (repo Repository) authorizeWhatsAppConversationLeadBinding(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	conversationID string,
	targetLeadID string,
	requireUnlinked bool,
) error {
	var remoteJID string
	var contactPhone string
	var currentLeadID, sessionOwnerID pgtype.Text
	err := tx.QueryRow(ctx, `
		select
			coalesce(wc.remote_jid, ''),
			coalesce(wc.contact_phone, ''),
			wc.lead_id::text,
			ws.owner_user_id::text
		from public.whatsapp_conversations wc
		join public.whatsapp_sessions ws
		  on ws.id = wc.session_id
		 and ws.organization_id = wc.organization_id
		where wc.organization_id = $1::uuid
		  and wc.id = $2::uuid
		  and wc.deleted_at is null
		  and wc.is_group is not true
		  and ws.provider = 'evolution_go'
		  and coalesce(ws.is_active, true) = true
		  and coalesce(ws.status, '') <> 'deleted'
		for update of wc
	`, tenantContext.OrganizationID, conversationID).Scan(
		&remoteJID,
		&contactPhone,
		&currentLeadID,
		&sessionOwnerID,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrInvalidReference
	}
	if err != nil {
		return err
	}

	if currentLeadID.Valid {
		if requireUnlinked {
			return ErrInvalidReference
		}
		var assignedUserID, teamID pgtype.Text
		err = tx.QueryRow(ctx, `
			select
			  lead.assigned_user_id::text,
			  nullif(to_jsonb(lead)->>'team_id', '')
			from public.leads as lead
			where lead.organization_id = $1::uuid
			  and lead.id = $2::uuid
			for share of lead
		`, tenantContext.OrganizationID, currentLeadID.String).Scan(&assignedUserID, &teamID)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && !authorization.CanUseLeadForMutation(tenantContext, authorization.LeadResource{
			AssignedUserID: textValue(assignedUserID),
			TeamID:         textValue(teamID),
		})) {
			return ErrInvalidReference
		}
		if err != nil {
			return err
		}
	} else if strings.TrimSpace(tenantContext.UserID) == "" || textValue(sessionOwnerID) != tenantContext.UserID {
		// Unlinked history has no lead grant to inherit. It belongs to the
		// connected session owner even when another user manages the org.
		return ErrInvalidReference
	}

	identityCandidates, ok := whatsAppConversationIdentityCandidates(contactPhone, remoteJID)
	if !ok {
		return ErrInvalidReference
	}

	var identityMatches bool
	err = tx.QueryRow(ctx, `
		select true
		from public.leads l
		where l.organization_id = $1::uuid
		  and l.id = $2::uuid
		  and exists (
		    select 1
		    from unnest($3::text[]) as candidate(value)
		    where normalize_phone(candidate.value) is not null
		      and normalize_phone(candidate.value) <> ''
		      and (
		        (
		          l.phone is not null
		          and normalize_phone(l.phone) = normalize_phone(candidate.value)
		        )
		        or (
		          nullif(to_jsonb(l)->>'whatsapp', '') is not null
		          and normalize_phone(to_jsonb(l)->>'whatsapp') = normalize_phone(candidate.value)
		        )
		      )
		  )
		for share of l
	`, tenantContext.OrganizationID, targetLeadID, identityCandidates).Scan(&identityMatches)
	if errors.Is(err, pgx.ErrNoRows) || !identityMatches {
		return ErrInvalidReference
	}
	return err
}

func whatsAppConversationIdentityCandidates(contactPhone string, remoteJID string) ([]string, bool) {
	remoteLower := strings.ToLower(strings.TrimSpace(remoteJID))
	if strings.Contains(remoteLower, "@g.us") ||
		strings.Contains(remoteLower, "@newsletter") ||
		strings.Contains(remoteLower, "@broadcast") ||
		strings.Contains(remoteLower, "@status") {
		return nil, false
	}

	contactIdentity := directWhatsAppPhoneIdentity(contactPhone, true)
	remoteIdentity := directWhatsAppPhoneIdentity(remoteJID, false)
	if contactIdentity == "" && remoteIdentity == "" {
		return nil, false
	}
	if contactIdentity != "" && remoteIdentity != "" && contactIdentity != remoteIdentity {
		return nil, false
	}
	if contactIdentity != "" {
		return []string{contactIdentity}, true
	}
	return []string{remoteIdentity}, true
}

func directWhatsAppPhoneIdentity(value string, allowBare bool) string {
	raw := strings.TrimSpace(value)
	if raw == "" {
		return ""
	}
	lower := strings.ToLower(raw)
	if at := strings.Index(lower, "@"); at >= 0 {
		domain := lower[at+1:]
		if domain != "s.whatsapp.net" && domain != "c.us" {
			return ""
		}
		raw = raw[:at]
		if colon := strings.Index(raw, ":"); colon >= 0 {
			raw = raw[:colon]
		}
	} else if !allowBare {
		return ""
	}

	normalized := normalizePhone(raw)
	if len(normalized) < 8 {
		return ""
	}
	return normalized
}

func activateWhatsAppConversationLeadBinding(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	conversationID string,
	leadID string,
	expectedPreviousLeadID string,
) error {
	var raw []byte
	if err := tx.QueryRow(ctx, `
		select public.activate_whatsapp_conversation_lead_binding(
			p_organization_id => $1::uuid,
			p_conversation_id => $2::uuid,
			p_lead_id => $3::uuid,
			p_provider_message_id => null,
			p_expected_previous_lead_id => $4
		)
	`, organizationID, conversationID, leadID, expectedPreviousLeadID).Scan(&raw); err != nil {
		return err
	}

	var result struct {
		Success        bool   `json:"success"`
		Stale          bool   `json:"stale"`
		IsCurrent      bool   `json:"is_current"`
		ConversationID string `json:"conversation_id"`
		LeadID         string `json:"lead_id"`
		ActiveLeadID   string `json:"active_lead_id"`
		BindingID      string `json:"binding_id"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return fmt.Errorf("decode WhatsApp conversation lead binding: %w", err)
	}
	if result.ConversationID != conversationID || result.LeadID != leadID {
		return errors.New("WhatsApp conversation lead binding CAS returned another target")
	}
	if !result.Success || result.Stale || !result.IsCurrent ||
		result.ActiveLeadID != leadID || strings.TrimSpace(result.BindingID) == "" {
		return ErrConversationBindingChanged
	}
	return nil
}

func confirmWhatsAppUnlinkedHistoryBinding(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	conversationID string,
	leadID string,
	actorUserID string,
	action string,
) error {
	var raw []byte
	err := tx.QueryRow(ctx, `
		select public.confirm_whatsapp_unlinked_history_binding(
		  p_organization_id => $1::uuid,
		  p_conversation_id => $2::uuid,
		  p_lead_id => $3::uuid,
		  p_expected_previous_lead_id => null,
		  p_actor_user_id => $4::uuid,
		  p_action => $5
		)
	`, organizationID, conversationID, leadID, actorUserID, action).Scan(&raw)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) {
			switch pgErr.Code {
			case "40001", "23514":
				return ErrConversationBindingChanged
			case "23503":
				return ErrInvalidReference
			case "42501":
				return tenant.ErrOrganizationAccessDenied
			}
		}
		return err
	}
	var result struct {
		Success        bool   `json:"success"`
		ConversationID string `json:"conversation_id"`
		LeadID         string `json:"lead_id"`
		BindingMode    string `json:"binding_mode"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return fmt.Errorf("decode WhatsApp history binding: %w", err)
	}
	if !result.Success || result.ConversationID != conversationID ||
		result.LeadID != leadID ||
		(result.BindingMode != "active" && result.BindingMode != "history_only") {
		return ErrConversationBindingChanged
	}
	return nil
}
