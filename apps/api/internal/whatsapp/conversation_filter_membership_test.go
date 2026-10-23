package whatsapp

import (
	"fmt"
	"net/url"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestConversationSourceMatchesSharedFilterBounds(t *testing.T) {
	tc := tenant.Context{OrganizationID: unreadCountOrganizationID, UserID: unreadCountUserID}
	for _, length := range []int{121, 4096} {
		t.Run(fmt.Sprint(length), func(t *testing.T) {
			source := strings.Repeat("🏠", length)
			filter, err := ParseConversationListFilter(url.Values{"leadSource": {" " + source + " "}})
			if err != nil || filter.LeadSource != source {
				t.Fatalf("shared source rejected or truncated: %v", err)
			}
			args, where, empty, err := conversationFilterSQL(tc, filter)
			if err != nil || empty || args[len(args)-1] != source || !strings.Contains(strings.Join(where, " and "), "l.source =") {
				t.Fatalf("shared source did not reach parameterized list/count SQL unchanged: %v", err)
			}
			if _, _, _, err := conversationFilterOptionsSQL(tc, filter); err != nil {
				t.Fatalf("shared source rejected by catalog builder: %v", err)
			}
		})
	}
	for _, source := range []string{strings.Repeat("🏠", 4097), "source\x00suffix", string([]byte{0xff})} {
		if _, err := ParseConversationListFilter(url.Values{"leadSource": {source}}); err == nil {
			t.Fatal("parser accepted an invalid shared source")
		}
		if _, _, _, err := conversationFilterSQL(tc, ConversationListFilter{LeadSource: source}); err == nil {
			t.Fatal("direct list/count builder accepted an invalid shared source")
		}
	}
}

func TestConversationTeamAndCatalogUseActiveTenantMembership(t *testing.T) {
	tc := tenant.Context{OrganizationID: unreadCountOrganizationID, UserID: unreadCountUserID, Permissions: []string{"lead_view_own"}}
	args, where, empty, err := conversationFilterSQL(tc, ConversationListFilter{TeamID: unreadCountSecondSession})
	if err != nil || empty || args[len(args)-1] != unreadCountSecondSession {
		t.Fatalf("team scope not bound: %v", err)
	}
	query := strings.Join(where, " and ")
	for _, clause := range []string{
		"member.id = tm.user_id", "coalesce(member.is_active, false) = true",
		"membership.organization_id = tm.organization_id", "membership.user_id = tm.user_id",
		"membership.deleted_at is null", "coalesce(membership.is_active, false) = true",
		"membership.membership_generation = tm.membership_generation", "team.is_active = true",
		"tm.organization_id = wc.organization_id", "tm.user_id = l.assigned_user_id",
		"wc.organization_id = $1::uuid", "ws.owner_user_id = $2::uuid", "access.can_view = true and access.can_read = true",
	} {
		if !strings.Contains(query, clause) {
			t.Fatalf("team filter lost authorization or active-membership condition %q", clause)
		}
	}
	if strings.Contains(query, "member.organization_id = tm.organization_id") {
		t.Fatal("current organization membership cannot depend on the user's primary organization")
	}
	_, catalog, _, err := conversationFilterOptionsSQL(tc, ConversationListFilter{ExpandedOptions: true})
	if err != nil {
		t.Fatal(err)
	}
	for _, clause := range []string{
		"m.organization_id=l.organization_id and m.user_id=u.id",
		"coalesce(m.is_active,false) and m.deleted_at is null",
		"m.membership_generation=tm.membership_generation", "t.is_active",
		"u.id=tm.user_id and coalesce(u.is_active,false)", "u.id=l.assigned_user_id and coalesce(u.is_active,false)",
		"wc.organization_id = $1::uuid", "ws.owner_user_id = $2::uuid",
	} {
		if !strings.Contains(catalog, clause) {
			t.Fatalf("catalog lost active-membership/visibility condition %q", clause)
		}
	}
	if strings.Contains(catalog, "u.organization_id=l.organization_id") {
		t.Fatal("catalog excluded a valid member of a secondary organization")
	}
}
