package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type leadPhoneMatch struct {
	ID               string
	Name             string
	WhatsAppAvatar   *string
	PipelineID       *string
	StageID          *string
	AssignedUserID   *string
	AssignedUserName *string
	AssigneeAvatar   *string
}

type whatsappQueryRower interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

type accessibleLeadContact struct {
	Identity       whatsappContactIdentity
	AssignedUserID string
}

// resolveAccessibleLeadContact validates the requested number against an
// authorized lead, but deliberately returns the number stored on that lead.
// Brazilian 10/11 digit variants are useful for matching legacy data; they
// must never become the outbound destination because inserting/removing the
// ninth digit can address a different WhatsApp account.
func resolveAccessibleLeadContact(
	ctx context.Context,
	queryer whatsappQueryRower,
	tenantContext tenant.Context,
	leadID string,
	requested whatsappContactIdentity,
) (accessibleLeadContact, error) {
	candidates := phoneMatchCandidates(requested.LeadMatchValues()...)
	if len(candidates) == 0 || requested.IsGroup {
		return accessibleLeadContact{}, ErrInvalidReference
	}

	args := append(baseConversationArgs(tenantContext), leadID, candidates)
	var storedPhone, assignedUserID string
	err := queryer.QueryRow(ctx, `
		select
		  case
		    when nullif(l.phone, '') is not null
		     and exists (
		       select 1 from unnest($6::text[]) candidate(value)
		       where normalize_phone(candidate.value) <> ''
		         and normalize_phone(l.phone) = normalize_phone(candidate.value)
		     ) then l.phone
		    when nullif(to_jsonb(l)->>'whatsapp', '') is not null
		     and exists (
		       select 1 from unnest($6::text[]) candidate(value)
		       where normalize_phone(candidate.value) <> ''
		         and normalize_phone(to_jsonb(l)->>'whatsapp') = normalize_phone(candidate.value)
		     ) then to_jsonb(l)->>'whatsapp'
		    else ''
		  end,
		  coalesce(l.assigned_user_id::text, '')
		from public.leads l
		where l.organization_id = $1::uuid
		  and `+leadVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext))+`
		  and l.id = $5::uuid
		  and (
		    (
		      nullif(l.phone, '') is not null
		      and exists (
		        select 1 from unnest($6::text[]) candidate(value)
		        where normalize_phone(candidate.value) <> ''
		          and normalize_phone(l.phone) = normalize_phone(candidate.value)
		      )
		    )
		    or (
		      nullif(to_jsonb(l)->>'whatsapp', '') is not null
		      and exists (
		        select 1 from unnest($6::text[]) candidate(value)
		        where normalize_phone(candidate.value) <> ''
		          and normalize_phone(to_jsonb(l)->>'whatsapp') = normalize_phone(candidate.value)
		      )
		    )
		  )
		for share of l
	`, args...).Scan(&storedPhone, &assignedUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return accessibleLeadContact{}, ErrInvalidReference
	}
	if err != nil {
		return accessibleLeadContact{}, err
	}

	identity := newWhatsAppContactIdentity(storedPhone, storedPhone, false)
	if identity.IsGroup || identity.ContactPhone == "" || identity.RemoteJID == "" {
		return accessibleLeadContact{}, ErrInvalidReference
	}

	return accessibleLeadContact{Identity: identity, AssignedUserID: assignedUserID}, nil
}

// ensureAccessibleLeadMatchesIdentity prevents a conversation/JID from being
// attached to an unrelated lead. Authorization alone is not enough: the
// lead's canonical phone must also match the WhatsApp contact identity.
func ensureAccessibleLeadMatchesIdentity(
	ctx context.Context,
	queryer whatsappQueryRower,
	tenantContext tenant.Context,
	leadID string,
	identity whatsappContactIdentity,
) error {
	_, err := resolveAccessibleLeadContact(ctx, queryer, tenantContext, leadID, identity)
	return err
}

func (repo Repository) resolveConversationLead(ctx context.Context, tenantContext tenant.Context, conversation Conversation) (Conversation, error) {
	if conversation.LeadID != nil || conversation.IsGroup {
		return conversation, nil
	}

	identity := newWhatsAppContactIdentity(pointerValue(conversation.ContactPhone), conversation.RemoteJID, conversation.IsGroup)
	match, err := repo.findLeadByPhone(ctx, tenantContext, identity.LeadMatchValues()...)
	if err != nil || match == nil {
		return conversation, err
	}

	if err := repo.attachConversationToLead(ctx, tenantContext.OrganizationID, conversation.ID, match.ID); err != nil {
		return conversation, err
	}

	if refreshed, err := repo.GetConversation(ctx, tenantContext, conversation.ID); err == nil {
		return refreshed, nil
	}

	conversation.LeadID = &match.ID
	conversation.Lead = match.toLeadLite()
	return conversation, nil
}

func (repo Repository) findLeadByPhone(ctx context.Context, tenantContext tenant.Context, values ...string) (*leadPhoneMatch, error) {
	candidates := phoneMatchCandidates(values...)
	if len(candidates) == 0 {
		return nil, nil
	}

	var match leadPhoneMatch
	var leadName, leadAvatar, pipelineID, stageID, assignedUserID, assignedUserName, assigneeAvatar pgtype.Text
	var matchCount int
	err := repo.db.Pool().QueryRow(ctx, `
		with global_matches as materialized (
		  select distinct matched.id
		  from unnest($5::text[]) as candidate(value)
		  cross join lateral public.find_lead_by_normalized_phone(
		    $1::uuid,
		    candidate.value
		  ) as matched
		), global_count as (
		  select count(*)::integer as match_count from global_matches
		)
		select
			l.id::text,
			l.name,
			l.whatsapp_avatar_url,
			l.pipeline_id::text,
			l.stage_id::text,
			l.assigned_user_id::text,
			u.name,
			u.avatar_url,
			global_count.match_count
		from global_matches
		cross join global_count
		join public.leads l on l.id = global_matches.id
		left join public.users u on u.id = l.assigned_user_id
		where l.organization_id = $1::uuid
		  and `+leadVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext))+`
		limit 1
	`, append(baseConversationArgs(tenantContext), candidates)...).Scan(
		&match.ID,
		&leadName,
		&leadAvatar,
		&pipelineID,
		&stageID,
		&assignedUserID,
		&assignedUserName,
		&assigneeAvatar,
		&matchCount,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		var postgresError *pgconn.PgError
		if errors.As(err, &postgresError) && postgresError.Code == "23505" &&
			(strings.Contains(postgresError.Message, "whatsapp_lead_phone_ambiguous") ||
				strings.Contains(postgresError.Message, "lead_queue_phone_ambiguous")) {
			return nil, nil
		}
		return nil, err
	}
	if matchCount != 1 {
		// Phone identity is no longer a card identity. Without an explicit lead
		// or active conversation binding, multiple scoped cards are terminally
		// ambiguous and must remain unlinked.
		return nil, nil
	}

	match.Name = textValue(leadName)
	match.WhatsAppAvatar = textPtr(leadAvatar)
	match.PipelineID = textPtr(pipelineID)
	match.StageID = textPtr(stageID)
	match.AssignedUserID = textPtr(assignedUserID)
	match.AssignedUserName = textPtr(assignedUserName)
	match.AssigneeAvatar = textPtr(assigneeAvatar)

	return &match, nil
}

func (repo Repository) attachConversationToLead(ctx context.Context, organizationID string, conversationID string, leadID string) error {
	_, err := activateRepositoryWhatsAppConversationLeadBindingIfExpected(
		ctx,
		repo.db.Pool(),
		organizationID,
		conversationID,
		leadID,
		unlinkedConversationLeadSnapshot,
	)
	return err
}

type repositoryWhatsAppConversationLeadBinding struct {
	Success        bool   `json:"success"`
	Changed        bool   `json:"changed"`
	Stale          bool   `json:"stale"`
	IsCurrent      bool   `json:"is_current"`
	ConversationID string `json:"conversation_id"`
	LeadID         string `json:"lead_id"`
	ActiveLeadID   string `json:"active_lead_id"`
	BindingID      string `json:"binding_id"`
}

// activateRepositoryWhatsAppConversationLeadBindingIfExpected is reserved for
// explicit browser/operator actions. Unlike provider-event replay, a stale
// browser snapshot must not be retained as binding history or activate the
// destination card. The five-argument SQL overload compares the expected
// previous lead while holding the same conversation lock used by activation.
func activateRepositoryWhatsAppConversationLeadBindingIfExpected(
	ctx context.Context,
	queryer whatsappQueryRower,
	organizationID string,
	conversationID string,
	leadID string,
	expectedPreviousLeadID string,
) (repositoryWhatsAppConversationLeadBinding, error) {
	var rawResult string
	err := queryer.QueryRow(ctx, `
		select public.activate_whatsapp_conversation_lead_binding(
		  p_organization_id => $1::uuid,
		  p_conversation_id => $2::uuid,
		  p_lead_id => $3::uuid,
		  p_provider_message_id => null,
		  p_expected_previous_lead_id => $4
		)::text
	`, organizationID, conversationID, leadID, expectedPreviousLeadID).Scan(&rawResult)
	if err != nil {
		return repositoryWhatsAppConversationLeadBinding{}, err
	}

	var binding repositoryWhatsAppConversationLeadBinding
	if err := json.Unmarshal([]byte(rawResult), &binding); err != nil {
		return repositoryWhatsAppConversationLeadBinding{}, fmt.Errorf("decode WhatsApp conversation lead binding CAS: %w", err)
	}
	if binding.ConversationID != conversationID || binding.LeadID != leadID {
		return repositoryWhatsAppConversationLeadBinding{}, errors.New("WhatsApp conversation lead binding CAS returned another target")
	}
	if !binding.Success || binding.Stale || !binding.IsCurrent ||
		binding.ActiveLeadID != leadID || strings.TrimSpace(binding.BindingID) == "" {
		return binding, ErrConversationBindingChanged
	}
	return binding, nil
}

func phoneMatchCandidates(values ...string) []string {
	seen := map[string]struct{}{}
	out := []string{}

	for _, value := range values {
		for _, candidate := range phoneVariants(value) {
			if candidate == "" {
				continue
			}
			if _, exists := seen[candidate]; exists {
				continue
			}
			seen[candidate] = struct{}{}
			out = append(out, candidate)
		}
	}

	return out
}

func (match leadPhoneMatch) toLeadLite() *LeadLite {
	lead := &LeadLite{
		ID:                match.ID,
		Name:              match.Name,
		WhatsAppAvatarURL: match.WhatsAppAvatar,
		PipelineID:        match.PipelineID,
		StageID:           match.StageID,
	}
	if match.AssignedUserID != nil && *match.AssignedUserID != "" {
		lead.Assignee = &LeadAssigneeRef{
			ID:        *match.AssignedUserID,
			Name:      pointerValue(match.AssignedUserName),
			AvatarURL: match.AssigneeAvatar,
		}
	}
	return lead
}
