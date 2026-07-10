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

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
