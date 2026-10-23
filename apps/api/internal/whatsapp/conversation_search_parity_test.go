package whatsapp

import (
	"net/url"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/searchtext"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestConversationLiteralTextDoesNotBecomePhoneSearch(t *testing.T) {
	for _, organization := range []string{unreadCountOrganizationID, unreadCountSecondSession} {
		context := tenant.Context{OrganizationID: organization, UserID: unreadCountUserID, Permissions: []string{"lead_view_own"}}
		for _, query := range []string{"Lote 123", "Joao2026", "name12@example.invalid", "abc1", "123", "None", "All"} {
			t.Run(query+" "+organization, func(t *testing.T) {
				filter, err := ParseConversationListFilter(url.Values{"search": {query}})
				if err != nil || filter.Search != query {
					t.Fatalf("literal query changed: %#v %v", filter, err)
				}
				args, where, empty, err := conversationFilterSQL(context, filter)
				if err != nil || empty || args[0] != organization || args[len(args)-1] != searchtext.Pattern(query) {
					t.Fatalf("literal search expanded or lost tenant scope: %#v %v", args, err)
				}
				joined := strings.Join(where, " and ")
				if strings.Contains(joined, "regexp_replace(coalesce(wc.contact_phone") || strings.Contains(joined, "split_part(split_part(wc.remote_jid") {
					t.Fatalf("text/short query %q became a numeric alternative", query)
				}
				for _, required := range []string{"wc.organization_id = $1::uuid", "ws.owner_user_id = $2::uuid", "access.can_view = true and access.can_read = true", "wm.organization_id = wc.organization_id", conversationMessageLeadMatchSQL(), "wm.capture_state is distinct from 'suppressed'"} {
					if !strings.Contains(joined, required) {
						t.Fatalf("search lost operational authorization or text column %q", required)
					}
				}
				if strings.Contains(joined, "coalesce(wc.last_message,") {
					t.Fatal("search used an unproven cached message instead of the authorized preview")
				}
			})
		}
	}
}

func TestConversationPhoneSearchKeepsNormalizedPNRouteGuards(t *testing.T) {
	context := tenant.Context{OrganizationID: unreadCountOrganizationID, UserID: unreadCountUserID, Permissions: []string{"lead_view_own"}}
	for _, query := range []string{"(11) 99999-8888", "+55 (11) 99999-8888", "9999"} {
		filter, err := ParseConversationListFilter(url.Values{"search": {query}})
		if err != nil {
			t.Fatal(err)
		}
		args, where, empty, err := conversationFilterSQL(context, filter)
		if err != nil || empty || args[0] != unreadCountOrganizationID {
			t.Fatalf("phone query lost tenant scope: %#v %v", args, err)
		}
		digits := strings.NewReplacer("(", "", ")", "", " ", "", "-", "", "+", "").Replace(query)
		if args[len(args)-1] != "%"+digits+"%" {
			t.Fatalf("phone mask was not normalized: %#v", args)
		}
		joined := strings.Join(where, " and ")
		for _, required := range []string{"regexp_replace(coalesce(wc.contact_phone, ''), '\\D', '', 'g')", "when wc.contact_phone is null", "^[1-9][0-9]{7,14}(:[0-9]+)?@(s[.]whatsapp[.]net|c[.]us)$", "split_part(split_part(wc.remote_jid", "else false"} {
			if !strings.Contains(joined, required) {
				t.Fatalf("phone search lost its PN-only fallback guard %q", required)
			}
		}
		for _, clause := range where {
			if strings.Contains(clause, "regexp_replace(coalesce(wc.contact_phone") && (!strings.HasPrefix(clause, "(") || !strings.HasSuffix(clause, ")")) {
				t.Fatal("phone OR must remain inside the authorized WHERE")
			}
		}
	}
}
