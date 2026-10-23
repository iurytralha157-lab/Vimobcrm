package leads

import (
	"os"
	"strings"
	"testing"
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
		"confirmHistoryLink bool",
		"repo.authorizeWhatsAppConversationLeadBinding",
		"*expectedPreviousLeadID",
		"confirmWhatsAppUnlinkedHistoryBinding",
		`"manual_lead_create"`,
		"if conversationID == nil",
	} {
		if !strings.Contains(linker, required) {
			t.Fatalf("WhatsApp lead binding contract is missing %q", required)
		}
	}
	if strings.Index(linker, "repo.authorizeWhatsAppConversationLeadBinding") >= strings.Index(linker, "confirmWhatsAppUnlinkedHistoryBinding") {
		t.Fatal("manual binding must authorize the conversation before invoking the confirmation RPC")
	}
	for _, forbidden := range []string{
		"whatsapp-conversation-phone:",
		"soleconversationid",
		"set lead_id =",
		"set lead_id = null",
	} {
		if strings.Contains(strings.ToLower(linker), forbidden) {
			t.Fatalf("WhatsApp lead binding must not claim history by phone or direct reassignment %q", forbidden)
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
	if strings.Contains(authorize, "canManageWhatsAppLeadBinding") {
		t.Fatal("an administrator must not claim a private unlinked session without ownership")
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
