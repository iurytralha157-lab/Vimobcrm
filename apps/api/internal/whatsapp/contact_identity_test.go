package whatsapp

import "testing"

func TestWhatsAppContactIdentityCanonicalizesIndividualJIDs(t *testing.T) {
	identity := newWhatsAppContactIdentity("", "5522974063727@c.us", false)

	if identity.RemoteJID != "5522974063727@s.whatsapp.net" {
		t.Fatalf("expected canonical s.whatsapp.net JID, got %q", identity.RemoteJID)
	}
	if identity.ContactPhone != "5522974063727" {
		t.Fatalf("expected contact phone to be extracted, got %q", identity.ContactPhone)
	}

	aliases := identity.RemoteAliases()
	if !containsString(aliases, "5522974063727@c.us") || !containsString(aliases, "5522974063727@s.whatsapp.net") {
		t.Fatalf("expected aliases to include c.us and s.whatsapp.net, got %#v", aliases)
	}
}

func TestWhatsAppContactIdentityPreservesPhoneCountryIntentEndToEnd(t *testing.T) {
	tests := []struct {
		name          string
		input         string
		wantPhone     string
		wantRemoteJID string
	}{
		{
			name:          "explicit NANP",
			input:         "+1 (415) 555-2671",
			wantPhone:     "14155552671",
			wantRemoteJID: "14155552671@s.whatsapp.net",
		},
		{
			name:          "international dial-out prefix",
			input:         "00 351 912 345 678",
			wantPhone:     "351912345678",
			wantRemoteJID: "351912345678@s.whatsapp.net",
		},
		{
			name:          "Brazilian local default",
			input:         "(11) 99999-9999",
			wantPhone:     "5511999999999",
			wantRemoteJID: "5511999999999@s.whatsapp.net",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			identity := newWhatsAppContactIdentity(test.input, "", false)
			if identity.ContactPhone != test.wantPhone {
				t.Fatalf("ContactPhone = %q, want %q", identity.ContactPhone, test.wantPhone)
			}
			if identity.RemoteJID != test.wantRemoteJID {
				t.Fatalf("RemoteJID = %q, want %q", identity.RemoteJID, test.wantRemoteJID)
			}
			if outbound := whatsAppDestinationPhone(identity.RemoteJID); outbound != test.wantPhone {
				t.Fatalf("outbound destination = %q, want %q", outbound, test.wantPhone)
			}
		})
	}
}

func TestWhatsAppContactIdentityKeepsGroupsSeparate(t *testing.T) {
	identity := newWhatsAppContactIdentity("", "120363123456789@g.us", false)

	if !identity.IsGroup {
		t.Fatal("expected group identity")
	}
	if identity.RemoteJID != "120363123456789@g.us" {
		t.Fatalf("expected group JID to be preserved, got %q", identity.RemoteJID)
	}
	if identity.ContactPhone != "" {
		t.Fatalf("expected group identity without contact phone, got %q", identity.ContactPhone)
	}
}

func TestWhatsAppContactIdentityIgnoresLIDAsPhoneSource(t *testing.T) {
	identity := newWhatsAppContactIdentity("5522974063727", "123456789@lid", false)

	if identity.RemoteJID != "5522974063727@s.whatsapp.net" {
		t.Fatalf("expected phone fallback to canonical JID, got %q", identity.RemoteJID)
	}
	if identity.ContactPhone != "5522974063727" {
		t.Fatalf("expected phone fallback to be contact phone, got %q", identity.ContactPhone)
	}
	if containsString(identity.LeadMatchValues(), "123456789@lid") {
		t.Fatalf("expected lead match values to ignore lid alias, got %#v", identity.LeadMatchValues())
	}
}

func TestWhatsAppContactIdentityIgnoresOpaqueJIDsAsPhoneSource(t *testing.T) {
	opaqueJIDs := []string{
		"120363999999999@newsletter",
		"status@broadcast",
		"5511999999999@status",
	}

	for _, remoteJID := range opaqueJIDs {
		identity := newWhatsAppContactIdentity("5522974063727", remoteJID, false)

		if identity.ContactPhone != "5522974063727" {
			t.Fatalf("expected phone fallback for %q, got %q", remoteJID, identity.ContactPhone)
		}
		if containsString(identity.LeadMatchValues(), remoteJID) {
			t.Fatalf("expected lead match values to ignore opaque alias %q, got %#v", remoteJID, identity.LeadMatchValues())
		}
	}
}

func TestCanonicalWhatsAppSelfJIDRejectsProfileNames(t *testing.T) {
	if jid, ok := canonicalWhatsAppSelfJID("André Rocha"); ok || jid != "" {
		t.Fatalf("profile name became WhatsApp actor JID: %q / %v", jid, ok)
	}
	if jid, ok := canonicalWhatsAppSelfJID("5511999991111:18@s.whatsapp.net"); !ok || jid != "5511999991111@s.whatsapp.net" {
		t.Fatalf("canonical self JID = %q / %v", jid, ok)
	}
}

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
