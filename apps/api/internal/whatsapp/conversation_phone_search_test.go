package whatsapp

import (
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	phoneSearchOrganizationID = "55555555-5555-4555-8555-555555555555"
	phoneSearchUserID         = "66666666-6666-4666-8666-666666666666"
)

func TestConversationFilterPhoneSearchFallsBackToCanonicalRemoteJID(t *testing.T) {
	args, where, empty, err := conversationFilterSQL(tenant.Context{
		OrganizationID: phoneSearchOrganizationID,
		UserID:         phoneSearchUserID,
		MemberRole:     "user",
		Permissions:    []string{"lead_view_own"},
	}, ConversationListFilter{Search: "+55 (11) 99999-0000"})
	if err != nil {
		t.Fatalf("conversationFilterSQL() error = %v", err)
	}
	if empty {
		t.Fatal("phone search must not produce an empty scope")
	}

	joined := strings.Join(where, " and ")
	for _, clause := range []string{
		"wc.organization_id = $1::uuid",
		"ws.organization_id = wc.organization_id",
		"l.organization_id = wc.organization_id",
		"ws.owner_user_id = $2::uuid",
		"regexp_replace(coalesce(wc.contact_phone, ''), '\\D', '', 'g') like $6",
		"when wc.contact_phone is null",
		"lower(wc.remote_jid) ~ '^[1-9][0-9]{7,14}(:[0-9]+)?@(s[.]whatsapp[.]net|c[.]us)$'",
		"then split_part(split_part(wc.remote_jid, '@', 1), ':', 1) like $6",
	} {
		if !strings.Contains(joined, clause) {
			t.Fatalf("phone search is missing %q:\n%s", clause, joined)
		}
	}
	if strings.Contains(joined, "|lid") || strings.Contains(joined, "@g.us") {
		t.Fatalf("opaque or group JIDs must not be accepted as phone fallbacks: %s", joined)
	}
	if strings.Contains(joined, "wc.archived_at") {
		t.Fatalf("search must preserve cross-archive behavior: %s", joined)
	}

	wantArgs := []any{
		phoneSearchOrganizationID,
		phoneSearchUserID,
		false,
		false,
		"%+55 (11) 99999-0000%",
		"%5511999990000%",
	}
	if len(args) != len(wantArgs) {
		t.Fatalf("arguments = %#v, want %#v", args, wantArgs)
	}
	for index := range wantArgs {
		if args[index] != wantArgs[index] {
			t.Fatalf("argument %d = %#v, want %#v", index+1, args[index], wantArgs[index])
		}
	}
}

func TestConversationFilterPhoneSearchKeepsUserInputParameterized(t *testing.T) {
	search := "+55 (11) 99999-0000%' OR true --"
	args, where, empty, err := conversationFilterSQL(tenant.Context{
		OrganizationID: phoneSearchOrganizationID,
		UserID:         phoneSearchUserID,
	}, ConversationListFilter{Search: search})
	if err != nil || empty {
		t.Fatalf("conversationFilterSQL() = empty:%v error:%v", empty, err)
	}

	joined := strings.Join(where, " and ")
	if strings.Contains(joined, search) {
		t.Fatalf("raw search input was interpolated into SQL: %s", joined)
	}
	if len(args) != 6 || args[4] != "%+55 (11) 99999-0000%' or true --%" || args[5] != "%5511999990000%" {
		t.Fatalf("search arguments were not parameterized as expected: %#v", args)
	}
	if strings.Count(joined, "like $6") != 2 {
		t.Fatalf("contact_phone and remote_jid must reuse the same phone parameter: %s", joined)
	}
}
