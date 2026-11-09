package whatsapp

import (
	"strconv"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/leadscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func canIncludeSupervisoryLeads(actor tenant.Context, filter ConversationListFilter) bool {
	if !filter.IncludeSupervisoryLeads || filter.AccessibleProvided || len(filter.SessionIDs) != 0 ||
		strings.TrimSpace(filter.SessionID) != "" || filter.WithoutLead || filter.PendingReply || filter.ShowArchived ||
		strings.TrimSpace(actor.MemberRole) == "" {
		return false
	}
	actor.IsSuperAdmin = false
	return leadscope.CanRead(actor)
}

// This branch only adds discovery of current lead history. It does not
// authorize operations on another account or change the inbox counters.
func supervisoryLeadVisibilitySQL(actor tenant.Context, rolePlaceholder string) string {
	platformAdmin := actor.IsSuperAdmin
	actor.IsSuperAdmin = false
	canViewAll := leadscope.CanViewAll(actor)
	canViewTeam := leadscope.CanViewTeam(actor)
	scope := ""
	if !canViewAll && !canViewTeam {
		scope = " and l.assigned_user_id = $2::uuid"
	}
	if platformAdmin {
		// The surrounding operational predicate allows platform authority.
		// Extra rows must instead follow this member's tenant lead permissions.
		scope += " and " + leadscope.VisibilitySQL("l", strconv.FormatBool(canViewAll),
			"$2", strconv.FormatBool(canViewTeam), leadscope.CanViewOwn(actor))
	}
	return `(wc.lead_id is not null and wc.is_group is false and wc.archived_at is null
		and coalesce(l.deal_status, 'open') = 'open'
		and exists (
			select 1
			from public.organization_members member
			join public.users profile on profile.id = member.user_id and profile.is_active is true
			join public.organizations org on org.id = member.organization_id and coalesce(org.is_active, true)
			where member.organization_id = $1::uuid and member.user_id = $2::uuid
			  and member.is_active is true and member.deleted_at is null
			  and lower(btrim(member.role)) = ` + rolePlaceholder + `
		)` + scope + `)`
}

func (conversation *Conversation) projectSupervisoryLead() {
	conversation.HistoricalLeadView = true
	conversation.UnreadCount = 0
	conversation.ContactPresence = nil
	conversation.PresenceUpdatedAt = nil
	conversation.Session = nil
	// The physical inbox timestamp may belong to a previous card binding.
	conversation.LastMessageAt = conversation.LastMessageSentAt
}
