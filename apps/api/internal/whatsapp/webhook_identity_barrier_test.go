package whatsapp

import (
	"testing"
)

func TestNativeContactPNBarrierCoversEveryContactHint(t *testing.T) {
	base := func() map[string]any {
		return map[string]any{
			"Info":    map[string]any{"ID": "pn-barrier", "Chat": "5511988881111@s.whatsapp.net", "SenderPN": "5511988881111@s.whatsapp.net"},
			"Message": map[string]any{"conversation": "synthetic"},
		}
	}
	for _, field := range []string{"phone", "number", "sender", "senderJid", "from"} {
		t.Run(field, func(t *testing.T) {
			raw := base()
			raw[field] = "5511977772222@s.whatsapp.net"
			message, ok := normalizeNativeEvolutionMessage(raw)
			if !ok || !message.IdentityPNConflict {
				t.Fatalf("contradictory %s was not quarantined: %#v", field, message)
			}
			if got := withoutNativeEvolutionPNConflicts([]nativeEvolutionMessage{message}); len(got) != 0 {
				t.Fatal("contradictory message survived the Native effect barrier")
			}
		})
	}
}

func TestContactPNBarrierEquivalentAndOpaqueIdentities(t *testing.T) {
	cases := []struct {
		values   []string
		conflict bool
	}{
		{[]string{"5511988881111@s.whatsapp.net", "5511977772222@s.whatsapp.net"}, true},
		{[]string{"5511988881111@s.whatsapp.net", "551188881111@c.us"}, false},
		{[]string{"5511988881111:18@s.whatsapp.net", "(11) 98888-1111"}, false},
		{[]string{"123456789@lid", "5511988881111@s.whatsapp.net"}, false},
		{[]string{"14155552671@s.whatsapp.net", "+1 (415) 555-2671"}, false},
		{[]string{"14155552671@s.whatsapp.net", "14155552671"}, false},
		{[]string{"351912345678@s.whatsapp.net", "00 351 912 345 678"}, false},
	}
	for _, c := range cases {
		if got := whatsAppContactPNConflict(c.values...); got != c.conflict {
			t.Fatalf("PN conflict(%#v) = %v, want %v", c.values, got, c.conflict)
		}
	}
}

func TestExplicitInternationalPNLookupNeverExpandsBrazilianLookalike(t *testing.T) {
	identity := newWhatsAppContactIdentity("14155552671", "14155552671@s.whatsapp.net", false)
	for _, candidate := range identity.LeadMatchValues() {
		if candidate == "5514155552671" || candidate == "+5514155552671" {
			t.Fatalf("explicit international PN acquired Brazilian lead alias: %#v", identity.LeadMatchValues())
		}
	}
	if !containsString(identity.LeadMatchValues(), "+14155552671") {
		t.Fatalf("explicit international lookup lost country prefix: %#v", identity.LeadMatchValues())
	}
	message := nativeEvolutionMessage{ContactPhone: "14155552671", RemoteAliases: []string{"14155552671@s.whatsapp.net", "14155552671"}}
	if containsString(nativeContactPhoneCandidates(message), "5514155552671") {
		t.Fatal("Native canonical phone was reinterpreted as a Brazilian national phone")
	}
}
