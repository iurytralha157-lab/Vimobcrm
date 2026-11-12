package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/whatsappbinding"
)

// ConversationLeadLinkPreview contains only counts and timestamps. It never
// exposes retained message content while the user decides whether to link it.
type ConversationLeadLinkPreview struct {
	ConversationID         string     `json:"conversationId"`
	SessionID              string     `json:"sessionId"`
	SessionDisplayName     string     `json:"sessionDisplayName"`
	ContactDisplayName     string     `json:"contactDisplayName"`
	LeadID                 *string    `json:"leadId"`
	ExpectedPreviousLeadID string     `json:"expectedPreviousLeadId"`
	BindingMode            string     `json:"bindingMode"`
	FutureOnly             bool       `json:"futureOnly,omitempty"`
	EligibleMessageCount   int        `json:"eligibleMessageCount"`
	FirstEligibleAt        *time.Time `json:"firstEligibleAt"`
	LastEligibleAt         *time.Time `json:"lastEligibleAt"`
	ExpiresAt              *time.Time `json:"expiresAt"`
}

type ConversationLeadLinkResult struct {
	BindingMode          string     `json:"bindingMode"`
	AttachedMessageCount int        `json:"attachedMessageCount"`
	HistoryFirstAt       *time.Time `json:"historyFirstAt,omitempty"`
	HistoryLastAt        *time.Time `json:"historyLastAt,omitempty"`
	ExpiresAt            *time.Time `json:"expiresAt,omitempty"`
	ConfirmedAt          *time.Time `json:"confirmedAt,omitempty"`
}

func (repo Repository) GetConversationLeadLinkPreview(
	ctx context.Context,
	tenantContext tenant.Context,
	conversationID string,
	targetLeadID string,
	expectedPreviousLeadID string,
) (ConversationLeadLinkPreview, error) {
	conversationID, ok := normalizeUUID(conversationID)
	if !ok {
		return ConversationLeadLinkPreview{}, ErrConversationNotFound
	}
	expectedPreviousLeadID, err := validateExpectedPreviousConversationLeadID(expectedPreviousLeadID)
	if err != nil {
		return ConversationLeadLinkPreview{}, err
	}
	if targetLeadID != "" {
		targetLeadID, ok = normalizeUUID(targetLeadID)
		if !ok {
			return ConversationLeadLinkPreview{}, ErrInvalidReference
		}
	}

	var preview ConversationLeadLinkPreview
	var currentLeadID pgtype.Text
	var firstAt, lastAt, expiresAt pgtype.Timestamptz
	var contactPhone, remoteJID string
	var isGroup, unlinkedV1 bool
	err = repo.db.Pool().QueryRow(ctx, `
		select
		  wc.id::text,
		  wc.session_id::text,
		  coalesce(nullif(ws.display_name, ''), ws.instance_name, ''),
		  coalesce(nullif(wc.contact_name, ''), nullif(wc.contact_phone, ''), wc.remote_jid),
		  wc.lead_id::text,
		  coalesce(wc.contact_phone, ''),
		  wc.remote_jid,
		  coalesce(wc.is_group, false),
		  wc.unlinked_retention_v1,
		  case when wc.retired_at is null then 'active' else 'history_only' end,
		 case when wc.lead_id is null and eligible.message_count > 0
		   then greatest(wc.created_at, coalesce(eligible.last_at, wc.created_at)) + interval '7 days' end,
		 case when wc.lead_id is null then eligible.message_count else 0 end,
		 case when wc.lead_id is null then eligible.first_at end,
		 case when wc.lead_id is null then eligible.last_at end
		from public.whatsapp_conversations wc
		join public.whatsapp_sessions ws
		  on ws.id = wc.session_id
		 and ws.organization_id = wc.organization_id
		cross join lateral (
		  select count(*)::integer as message_count,
		         min(wm.sent_at) as first_at,
		         max(wm.sent_at) as last_at
		  from public.whatsapp_messages wm
		  where wm.organization_id = wc.organization_id
		    and wc.lead_id is null
		    and wm.session_id = wc.session_id
		    and wm.conversation_id = wc.id
		    and wm.lead_id is null
		    and wm.capture_state = 'unlinked_ephemeral'
		) eligible
		where wc.organization_id = $1::uuid
		  and wc.id = $2::uuid
		  and wc.deleted_at is null
		  and coalesce(wc.is_group, false) = false
		  and ws.provider = 'evolution_go'
		  and coalesce(ws.is_active, true) = true
		  and coalesce(ws.status, '') <> 'deleted'
		  and (
		    (wc.lead_id is null
		     and ws.owner_user_id = $3::uuid
		     and (
		       (wc.unlinked_retention_v1 and wc.created_at > now() - interval '7 days'
		        and wc.unlinked_retention_scrubbed_at is null)
		       or (not wc.unlinked_retention_v1 and wc.retired_at is null and ws.status = 'connected')
		     ))
		    or (wc.lead_id is not null and wc.retired_at is null)
		  )
	`, tenantContext.OrganizationID, conversationID, tenantContext.UserID).Scan(
		&preview.ConversationID,
		&preview.SessionID,
		&preview.SessionDisplayName,
		&preview.ContactDisplayName,
		&currentLeadID,
		&contactPhone,
		&remoteJID,
		&isGroup,
		&unlinkedV1,
		&preview.BindingMode,
		&expiresAt,
		&preview.EligibleMessageCount,
		&firstAt,
		&lastAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return ConversationLeadLinkPreview{}, ErrConversationNotFound
	}
	if err != nil {
		return ConversationLeadLinkPreview{}, err
	}
	if isGroup {
		return ConversationLeadLinkPreview{}, ErrInvalidReference
	}
	if currentLeadID.Valid {
		if expectedPreviousLeadID != currentLeadID.String {
			return ConversationLeadLinkPreview{}, ErrConversationBindingChanged
		}
		visibilityArgs := append(baseConversationArgs(tenantContext), currentLeadID.String)
		var sourceVisible bool
		err = repo.db.Pool().QueryRow(ctx, `
			select true
			from public.leads l
			where l.organization_id = $1::uuid
			  and l.id = $5::uuid
			  and `+leadVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext))+`
		`, visibilityArgs...).Scan(&sourceVisible)
		if errors.Is(err, pgx.ErrNoRows) {
			return ConversationLeadLinkPreview{}, ErrConversationNotFound
		}
		if err != nil {
			return ConversationLeadLinkPreview{}, err
		}
		if !sourceVisible {
			return ConversationLeadLinkPreview{}, ErrConversationNotFound
		}
	} else {
		if expectedPreviousLeadID != unlinkedConversationLeadSnapshot {
			return ConversationLeadLinkPreview{}, ErrConversationBindingChanged
		}
		// Modelo de 12/11: conversa sem lead com mensagens visiveis anexa o
		// historico, seja ou nao do contrato efemero v1. O caminho legado de
		// vinculo apenas-futuro fica para conversas sem nada preservado.
		if !unlinkedV1 && preview.EligibleMessageCount == 0 {
			if err := requireOriginalWhatsAppOrganization(ctx, repo.db.Pool(), tenantContext); err != nil {
				return ConversationLeadLinkPreview{}, err
			}
			identity := newWhatsAppContactIdentity(contactPhone, remoteJID, false)
			if identity.IsGroup || identity.PNConflict || identity.ContactPhone == "" {
				return ConversationLeadLinkPreview{}, ErrConversationNotFound
			}
			eligible, err := whatsappbinding.CanLinkLegacyForFuture(ctx, repo.db.Pool(), tenantContext.OrganizationID, conversationID)
			if err != nil {
				return ConversationLeadLinkPreview{}, err
			}
			if !eligible {
				return ConversationLeadLinkPreview{}, ErrConversationNotFound
			}
			preview.FutureOnly = true
		}
	}
	preview.ExpectedPreviousLeadID = expectedPreviousLeadID
	if firstAt.Valid {
		preview.FirstEligibleAt = &firstAt.Time
	}
	if lastAt.Valid {
		preview.LastEligibleAt = &lastAt.Time
	}
	if expiresAt.Valid {
		preview.ExpiresAt = &expiresAt.Time
	}
	if targetLeadID != "" {
		identity := newWhatsAppContactIdentity(contactPhone, remoteJID, false)
		if err := ensureAccessibleLeadMatchesIdentity(ctx, repo.db.Pool(), tenantContext, targetLeadID, identity); err != nil {
			return ConversationLeadLinkPreview{}, fmt.Errorf("%w: a conversa e o lead possuem telefones diferentes", err)
		}
		preview.LeadID = &targetLeadID
	}
	return preview, nil
}

func confirmUnlinkedHistoryBinding(
	ctx context.Context,
	queryer whatsappQueryRower,
	organizationID string,
	conversationID string,
	leadID string,
	actorUserID string,
	action string,
) (ConversationLeadLinkResult, error) {
	var raw []byte
	err := queryer.QueryRow(ctx, `
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
				return ConversationLeadLinkResult{}, ErrConversationBindingChanged
			case "23503":
				return ConversationLeadLinkResult{}, ErrInvalidReference
			case "42501":
				return ConversationLeadLinkResult{}, tenant.ErrOrganizationAccessDenied
			}
		}
		return ConversationLeadLinkResult{}, err
	}
	var result struct {
		Success              bool       `json:"success"`
		ConversationID       string     `json:"conversation_id"`
		LeadID               string     `json:"lead_id"`
		BindingMode          string     `json:"binding_mode"`
		AttachedMessageCount int        `json:"attached_message_count"`
		HistoryFirstAt       *time.Time `json:"history_first_at"`
		HistoryLastAt        *time.Time `json:"history_last_at"`
		ExpiresAt            *time.Time `json:"expires_at"`
		ConfirmedAt          *time.Time `json:"confirmed_at"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return ConversationLeadLinkResult{}, fmt.Errorf("decode WhatsApp history binding: %w", err)
	}
	if !result.Success || !strings.EqualFold(result.ConversationID, conversationID) ||
		!strings.EqualFold(result.LeadID, leadID) ||
		(result.BindingMode != "active" && result.BindingMode != "history_only") {
		return ConversationLeadLinkResult{}, ErrConversationBindingChanged
	}
	return ConversationLeadLinkResult{
		BindingMode:          result.BindingMode,
		AttachedMessageCount: result.AttachedMessageCount,
		HistoryFirstAt:       result.HistoryFirstAt,
		HistoryLastAt:        result.HistoryLastAt,
		ExpiresAt:            result.ExpiresAt,
		ConfirmedAt:          result.ConfirmedAt,
	}, nil
}
