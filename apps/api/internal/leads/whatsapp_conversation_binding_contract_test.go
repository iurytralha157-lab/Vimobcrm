package leads

import (
	"os"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestLeadCreationAuthorizesWhatsAppConversationBeforeBinding(t *testing.T) {
	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) linkWhatsAppConversations")
	if start < 0 {
		t.Fatal("could not isolate WhatsApp lead binding helper")
	}
	end := strings.Index(source[start:], "func activateWhatsAppConversationLeadBinding")
	if end < 0 {
		t.Fatal("could not isolate WhatsApp lead binding helper")
	}
	linker := source[start : start+end]

	for _, required := range []string{
		"tenantContext tenant.Context",
		"expectedPreviousLeadID *string",
		"repo.authorizeWhatsAppConversationLeadBinding",
		"*expectedPreviousLeadID",
		"'whatsapp-conversation-phone:'",
		"select count(*)::integer, min(wc.id::text)",
		"leadCandidateCount != 1",
		"soleLeadID.String != leadID",
		"conversationCandidateCount != 1",
		"wc.lead_id is null",
		"ws.provider = 'evolution_go'",
		"coalesce(ws.is_active, true) = true",
		"coalesce(ws.status, '') <> 'deleted'",
	} {
		if !strings.Contains(linker, required) {
			t.Fatalf("WhatsApp lead binding contract is missing %q", required)
		}
	}
	explicitAuthorize := strings.Index(linker, "repo.authorizeWhatsAppConversationLeadBinding(ctx, tx, tenantContext, *conversationID, leadID, false)")
	explicitActivate := -1
	if explicitAuthorize >= 0 {
		if offset := strings.Index(linker[explicitAuthorize:], "*expectedPreviousLeadID,"); offset >= 0 {
			explicitActivate = explicitAuthorize + offset
		}
	}
	if explicitAuthorize < 0 || explicitActivate < 0 || explicitAuthorize >= explicitActivate {
		t.Fatal("explicit binding must authorize the conversation before invoking the activation RPC")
	}
	automaticAuthorize := strings.Index(linker, "repo.authorizeWhatsAppConversationLeadBinding(ctx, tx, tenantContext, soleConversationID.String, leadID, true)")
	automaticActivate := strings.Index(linker, `"unlinked",`)
	if automaticAuthorize < 0 || automaticActivate < 0 || automaticAuthorize >= automaticActivate {
		t.Fatal("automatic binding must authorize the sole unlinked conversation before invoking the activation RPC")
	}
	for _, forbidden := range []string{
		"order by",
		"limit 1",
		"set lead_id =",
		"set lead_id = null",
	} {
		if strings.Contains(strings.ToLower(linker), forbidden) {
			t.Fatalf("WhatsApp lead binding must not use ambiguous direct reassignment %q", forbidden)
		}
	}
}

func TestWhatsAppBindingAccessIsFailClosed(t *testing.T) {
	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) authorizeWhatsAppConversationLeadBinding")
	if start < 0 {
		t.Fatal("could not isolate WhatsApp binding authorization helper")
	}
	end := strings.Index(source[start:], "func whatsAppConversationIdentityCandidates")
	if end < 0 {
		t.Fatal("could not isolate WhatsApp binding authorization helper")
	}
	authorize := source[start : start+end]
	for _, required := range []string{
		"wc.deleted_at is null",
		"wc.is_group is not true",
		"ws.provider = 'evolution_go'",
		"coalesce(ws.is_active, true) = true",
		"coalesce(ws.status, '') <> 'deleted'",
		"for update of wc",
		"requireUnlinked",
		"authorization.CanUseLeadForMutation",
		"textValue(sessionOwnerID) != tenantContext.UserID",
		"canManageWhatsAppLeadBinding",
		"whatsAppConversationIdentityCandidates",
		"to_jsonb(l)->>'whatsapp'",
		"for share of l",
		"return ErrInvalidReference",
	} {
		if !strings.Contains(authorize, required) {
			t.Fatalf("WhatsApp binding authorization contract is missing %q", required)
		}
	}
	if strings.Contains(authorize, "activateWhatsAppConversationLeadBinding") {
		t.Fatal("authorization helper must not activate a binding itself")
	}
}

func TestWhatsAppConversationIdentityCandidates(t *testing.T) {
	tests := []struct {
		name         string
		contactPhone string
		remoteJID    string
		want         string
		wantOK       bool
	}{
		{name: "contact phone", contactPhone: "+55 (11) 99999-0000", want: "11999990000", wantOK: true},
		{name: "direct jid", remoteJID: "5511999990000@s.whatsapp.net", want: "11999990000", wantOK: true},
		{name: "device jid", remoteJID: "5511999990000:12@s.whatsapp.net", want: "11999990000", wantOK: true},
		{name: "matching phone and jid", contactPhone: "11999990000", remoteJID: "5511999990000@c.us", want: "11999990000", wantOK: true},
		{name: "resolved lid", contactPhone: "11999990000", remoteJID: "123456789@lid", want: "11999990000", wantOK: true},
		{name: "conflicting phone and jid", contactPhone: "11999990000", remoteJID: "5521888880000@s.whatsapp.net", wantOK: false},
		{name: "group", contactPhone: "11999990000", remoteJID: "5511999990000@g.us", wantOK: false},
		{name: "newsletter", contactPhone: "11999990000", remoteJID: "123456789@newsletter", wantOK: false},
		{name: "status broadcast", contactPhone: "11999990000", remoteJID: "status@broadcast", wantOK: false},
		{name: "opaque jid without phone", remoteJID: "123456789@lid", wantOK: false},
		{name: "short identity", contactPhone: "1234567", wantOK: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, ok := whatsAppConversationIdentityCandidates(test.contactPhone, test.remoteJID)
			if ok != test.wantOK {
				t.Fatalf("ok = %v, want %v (candidates %#v)", ok, test.wantOK, got)
			}
			if !test.wantOK {
				return
			}
			if len(got) != 1 || got[0] != test.want {
				t.Fatalf("candidates = %#v, want [%q]", got, test.want)
			}
		})
	}
}

func TestWhatsAppLeadBindingManagementAuthorization(t *testing.T) {
	tests := []struct {
		name string
		ctx  tenant.Context
		want bool
	}{
		{name: "super admin", ctx: tenant.Context{IsSuperAdmin: true}, want: true},
		{name: "owner", ctx: tenant.Context{MemberRole: "owner"}, want: true},
		{name: "admin", ctx: tenant.Context{MemberRole: "admin"}, want: true},
		{name: "permission", ctx: tenant.Context{MemberRole: "user", Permissions: []string{permissions.WhatsAppManage}}, want: true},
		{name: "ordinary member", ctx: tenant.Context{MemberRole: "user"}, want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := canManageWhatsAppLeadBinding(test.ctx); got != test.want {
				t.Fatalf("canManageWhatsAppLeadBinding() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestExplicitConversationBindingUsesVersionedRPC(t *testing.T) {
	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func activateWhatsAppConversationLeadBinding")
	if start < 0 {
		t.Fatal("could not isolate WhatsApp binding activation helper")
	}
	end := strings.Index(source[start:], "func isLeadPhoneUniqueViolation")
	if end < 0 {
		t.Fatal("could not isolate WhatsApp binding activation helper")
	}
	activation := source[start : start+end]
	for _, required := range []string{
		"public.activate_whatsapp_conversation_lead_binding",
		"p_expected_previous_lead_id => $4",
		"result.Stale",
		"result.IsCurrent",
		"result.ActiveLeadID != leadID",
		"ErrConversationBindingChanged",
		"result.ConversationID != conversationID",
		"result.LeadID != leadID",
	} {
		if !strings.Contains(activation, required) {
			t.Fatalf("explicit WhatsApp binding contract is missing %q", required)
		}
	}
}

func TestLeadDeletionUsesConversationFirstLockOrder(t *testing.T) {
	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) Delete")
	if start < 0 {
		t.Fatal("could not isolate lead deletion")
	}
	end := strings.Index(source[start:], "func (repo Repository) getLeadDeleteAuthorizationResource")
	if end < 0 {
		t.Fatal("could not isolate lead deletion")
	}
	deletion := source[start : start+end]

	firstConversationLock := strings.Index(deletion, "lockLeadWhatsAppConversations")
	leadLock := strings.Index(deletion, "repo.getLeadSnapshotForDelete")
	if firstConversationLock < 0 || leadLock < 0 || firstConversationLock >= leadLock {
		t.Fatal("lead deletion must lock existing conversations before locking the lead")
	}
	if strings.Count(deletion, "lockLeadWhatsAppConversations") != 2 {
		t.Fatal("lead deletion must rescan conversations after acquiring the lead lock")
	}
	secondConversationLock := strings.LastIndex(deletion, "lockLeadWhatsAppConversations")
	conversationUpdate := strings.Index(deletion, "update public.whatsapp_conversations")
	if secondConversationLock <= leadLock || conversationUpdate <= secondConversationLock {
		t.Fatal("lead deletion must perform its ordered rescan before detaching conversations")
	}
	if strings.Count(deletion, "authorization.CanDeleteLead") != 2 {
		t.Fatal("lead deletion must revalidate authorization after acquiring the lead lock")
	}
	for _, required := range []string{
		"order by wc.id",
		"for no key update of wc",
		`getLeadSnapshotWithLock(ctx, tx, organizationID, leadID, "for update of l")`,
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("lead deletion lock contract is missing %q", required)
		}
	}
}
