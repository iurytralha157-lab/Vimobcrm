package whatsapp

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func TestNativeEvolutionFixtures(t *testing.T) {
	t.Run("text", func(t *testing.T) {
		payload := decodeNativeFixture(t, "message_text.json")
		messages := extractNativeEvolutionMessages(payload)
		if len(messages) != 1 {
			t.Fatalf("messages = %d, want 1", len(messages))
		}
		message := messages[0]
		if message.ProviderMessageID != "provider-inbound-text-1" || message.RemoteJID != "5511999991111@s.whatsapp.net" || message.Content != "Mensagem recebida pelo backend" || message.FromMe {
			t.Fatalf("unexpected normalized text message: %#v", message)
		}
		if message.ProviderMessageIDSynthetic {
			t.Fatal("provider-supplied message id must not be marked synthetic")
		}
	})

	t.Run("synthetic id preserves exact conversation whitespace", func(t *testing.T) {
		raw := map[string]any{
			"Info": map[string]any{
				"Sender":    "5511999991111@s.whatsapp.net",
				"Timestamp": float64(1_725_000_000),
			},
			"key": map[string]any{
				"remoteJid": "5511999991111@s.whatsapp.net",
			},
			"Message": map[string]any{
				"conversation": "  Olá\x00\r\nMundo  ",
			},
		}

		message, ok := normalizeNativeEvolutionMessage(raw)
		if !ok {
			t.Fatal("message was not normalized")
		}
		if !message.ProviderMessageIDSynthetic || !strings.HasPrefix(message.ProviderMessageID, "native-") {
			t.Fatalf("synthetic provider identity was not marked: %#v", message)
		}
		if message.Content != "  Olá\r\nMundo  " {
			t.Fatalf("content = %q, want exact whitespace with only NUL removed", message.Content)
		}
	})

	t.Run("media", func(t *testing.T) {
		payload := decodeNativeFixture(t, "message_media.json")
		messages := extractNativeEvolutionMessages(payload)
		if len(messages) != 1 {
			t.Fatalf("messages = %d, want 1", len(messages))
		}
		message := messages[0]
		if message.MessageType != "image" || message.MediaMimeType != "image/png" || message.MediaBase64 == "" || message.Content != "Foto do imóvel" {
			t.Fatalf("unexpected normalized media message: %#v", message)
		}
	})

	t.Run("provider media keeps only official protobuf block", func(t *testing.T) {
		payload := decodeNativeFixture(t, "message_media_provider.json")
		messages := extractNativeEvolutionMessages(payload)
		if len(messages) != 1 || messages[0].MediaBase64 != "" || messages[0].MediaURL != "" {
			t.Fatalf("provider media was not normalized: %#v", messages)
		}
		providerMessage, err := nativeEvolutionProviderMessage(messages[0])
		if err != nil {
			t.Fatal(err)
		}
		if len(providerMessage) != 1 || mapFromAny(providerMessage["imageMessage"])["directPath"] == nil {
			t.Fatalf("provider message was not minimized: %#v", providerMessage)
		}
	})

	t.Run("reaction", func(t *testing.T) {
		payload := decodeNativeFixture(t, "message_reaction.json")
		messages := extractNativeEvolutionMessages(payload)
		if len(messages) != 1 {
			t.Fatalf("messages = %d, want 1", len(messages))
		}
		message := messages[0]
		if !message.IsReaction || message.ReactionTargetID != "provider-outbound-for-reaction" || message.ReactionEmoji != "❤️" {
			t.Fatalf("unexpected normalized reaction: %#v", message)
		}
	})

	t.Run("status", func(t *testing.T) {
		payload := decodeNativeFixture(t, "message_status.json")
		statuses := extractNativeEvolutionStatuses(payload)
		if len(statuses) != 1 || statuses[0].Status != "read" || len(statuses[0].MessageIDs) != 1 || statuses[0].MessageIDs[0] != "provider-outbound-status" {
			t.Fatalf("unexpected normalized statuses: %#v", statuses)
		}
	})

	t.Run("unverified campaign is detected", func(t *testing.T) {
		payload := decodeNativeFixture(t, "meta_referral.json")
		messages := extractNativeEvolutionMessages(payload)
		if len(messages) != 1 || !messages[0].HasCampaignSignal {
			t.Fatalf("campaign signal was not detected: %#v", messages)
		}
	})

	t.Run("legacy ad fields are not sufficient for CTWA", func(t *testing.T) {
		payload := decodeNativeFixture(t, "meta_referral_verified.json")
		messages := extractNativeEvolutionMessages(payload)
		if len(messages) != 1 || messages[0].CampaignSourceType != "ad" || messages[0].CampaignSourceID != "123456789012345" || messages[0].CampaignPropertyCode != "PROP-META-1" {
			t.Fatalf("legacy campaign fields were not normalized: %#v", messages)
		}
		if messages[0].IsCTWAAd {
			t.Fatal("source_type=ad without entryPointConversionSource=ctwa_ad was accepted as CTWA")
		}
	})

	t.Run("confirmed Instagram CTWA attribution", func(t *testing.T) {
		payload := decodeNativeFixture(t, "meta_ctwa_instagram.json")
		messages := extractNativeEvolutionMessages(payload)
		if len(messages) != 1 {
			t.Fatalf("messages = %d, want 1", len(messages))
		}
		message := messages[0]
		if !message.IsCTWAAd || message.ContactName != "Luana" || message.ContactPhone != "559491298288" {
			t.Fatalf("CTWA identity was not normalized: %#v", message)
		}
		if message.CampaignEntryPointConversionSource != "ctwa_ad" || message.CampaignEntryPointConversionApp != "instagram" ||
			message.CampaignConversionSource != "FB_Ads" || message.CampaignSourceApp != "instagram" {
			t.Fatalf("CTWA conversion fields were not preserved: %#v", message)
		}
		if message.CampaignShowAdAttribution == nil || !*message.CampaignShowAdAttribution {
			t.Fatalf("showAdAttribution was not preserved: %#v", message.CampaignShowAdAttribution)
		}
		if message.Content != "Olá, gostaria de saber mais informações sobre o Lançamento Lumy Penha." ||
			message.CampaignHeadline != "Lumy Penha" || message.CampaignSourceID != "120249512922100328" ||
			message.CampaignSourceURL != "https://www.instagram.com/p/Dcyi6FjgAeQ/" {
			t.Fatalf("CTWA content and attribution were not normalized: %#v", message)
		}
	})

	t.Run("LID quarantine identity", func(t *testing.T) {
		payload := decodeNativeFixture(t, "message_lid_quarantine.json")
		messages := extractNativeEvolutionMessages(payload)
		if len(messages) != 1 || !messages[0].UnsupportedID || messages[0].ContactPhone != "" || messages[0].RemoteJID != "987654321012345@lid" {
			t.Fatalf("LID identity was not normalized for quarantine: %#v", messages)
		}
	})

	t.Run("LID promotion identity", func(t *testing.T) {
		payload := decodeNativeFixture(t, "message_lid_promote.json")
		messages := extractNativeEvolutionMessages(payload)
		if len(messages) != 1 || messages[0].ContactPhone != "5511666665555" || messages[0].RemoteJID != "5511666665555@s.whatsapp.net" {
			t.Fatalf("LID promotion identity was not normalized: %#v", messages)
		}
		if !stringIn("987654321012345@lid", messages[0].RemoteAliases...) {
			t.Fatalf("LID alias was not preserved for promotion: %#v", messages[0].RemoteAliases)
		}
	})

	t.Run("delete protocol", func(t *testing.T) {
		payload := decodeNativeFixture(t, "message_delete.json")
		messages := extractNativeEvolutionMessages(payload)
		if len(messages) != 1 || !messages[0].IsDeletion || messages[0].DeletionTargetID != "provider-delete-target" || messages[0].UnsupportedMessage {
			t.Fatalf("delete protocol was not normalized: %#v", messages)
		}
	})

	t.Run("session lifecycle", func(t *testing.T) {
		qrPayload := decodeNativeFixture(t, "qr.json")
		if qr := nativeEvolutionQRCode(qrPayload); qr != "data:image/png;base64,qr-native-fixture" {
			t.Fatalf("qr = %q", qr)
		}
		connectionPayload := decodeNativeFixture(t, "connection.json")
		status, recognized, connectionErr := nativeEvolutionConnectionStatus(connectionPayload, "connection.update")
		if !recognized || status != "connected" || connectionErr != "" {
			t.Fatalf("connection = %q, %v, %q", status, recognized, connectionErr)
		}
	})
}

func TestNativeCTWAConfirmationRequiresEntryPointAndCompatibleExplicitSourceType(t *testing.T) {
	tests := []struct {
		name       string
		entryPoint string
		sourceType string
		want       bool
	}{
		{name: "entry point with absent source type", entryPoint: "ctwa_ad", want: true},
		{name: "entry point with ad", entryPoint: "CTWA_AD", sourceType: "AD", want: true},
		{name: "entry point with non ad", entryPoint: "ctwa_ad", sourceType: "post", want: false},
		{name: "ad without entry point", sourceType: "ad", want: false},
		{name: "lookalike entry point", entryPoint: "ctwa_ads", sourceType: "ad", want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := nativeIsCTWAAdReferral(test.entryPoint, test.sourceType); got != test.want {
				t.Fatalf("nativeIsCTWAAdReferral(%q, %q) = %v, want %v", test.entryPoint, test.sourceType, got, test.want)
			}
		})
	}
}

func TestNativeCampaignSourceURLAllowsOnlyAbsoluteHTTPURLs(t *testing.T) {
	for _, unsafeURL := range []string{"javascript:alert(1)", "data:text/html,unsafe", "//example.com/relative", "not a url"} {
		normalized := nativeNormalizeCampaignReferralCandidate(map[string]any{
			"entryPointConversionSource": "ctwa_ad",
			"sourceUrl":                  unsafeURL,
		})
		if got := stringFromAny(normalized["source_url"]); got != "" {
			t.Fatalf("unsafe source URL %q was preserved as %q", unsafeURL, got)
		}
	}
	const instagramURL = "https://www.instagram.com/p/Dcyi6FjgAeQ/"
	normalized := nativeNormalizeCampaignReferralCandidate(map[string]any{
		"entryPointConversionSource": "ctwa_ad",
		"sourceUrl":                  instagramURL,
	})
	if got := stringFromAny(normalized["source_url"]); got != instagramURL {
		t.Fatalf("Instagram HTTPS URL = %q, want %q", got, instagramURL)
	}
}

func TestNativeCampaignReferralMergesSiblingCandidates(t *testing.T) {
	referral := nativeCampaignReferral(map[string]any{
		"contextInfo": map[string]any{
			"entryPointConversionSource": "ctwa_ad",
		},
		"referral": map[string]any{
			"sourceType": "ad",
			"sourceApp":  "instagram",
			"sourceUrl":  "https://www.instagram.com/p/Dcyi6FjgAeQ/",
		},
	})
	if referral["entry_point_conversion_source"] != "ctwa_ad" || referral["source_type"] != "ad" ||
		referral["source_app"] != "instagram" || referral["source_url"] != "https://www.instagram.com/p/Dcyi6FjgAeQ/" {
		t.Fatalf("sibling referral candidates were not merged: %#v", referral)
	}
}

func TestNativeCTWAReferralIgnoresQuotedMessageAttribution(t *testing.T) {
	raw := map[string]any{
		"Info": map[string]any{
			"ID":       "provider-organic-reply-1",
			"Chat":     "5511999991111@s.whatsapp.net",
			"SenderPN": "5511999991111@s.whatsapp.net",
		},
		"message": map[string]any{
			"extendedTextMessage": map[string]any{
				"text": "Tenho outra dúvida",
				"contextInfo": map[string]any{
					"quotedMessage": map[string]any{
						"extendedTextMessage": map[string]any{
							"text": "Mensagem antiga do anúncio",
							"contextInfo": map[string]any{
								"entryPointConversionSource": "ctwa_ad",
								"externalAdReply": map[string]any{
									"sourceType": "ad",
									"sourceId":   "quoted-ad-id",
								},
							},
						},
					},
				},
			},
		},
	}
	message, ok := normalizeNativeEvolutionMessage(raw)
	if !ok {
		t.Fatal("organic reply was not normalized")
	}
	if message.IsCTWAAd || message.CampaignEntryPointConversionSource != "" || message.CampaignSourceID != "" {
		t.Fatalf("quoted CTWA attribution authorized the current message: %#v", message)
	}
	if !message.HasCampaignSignal {
		t.Fatal("quoted campaign shape should remain fail-closed for native fallback detection")
	}
}

func TestNativeCTWAReferralSupportsCrossCasedStructuredContext(t *testing.T) {
	referral := nativeCampaignReferral(map[string]any{
		"Message": map[string]any{
			"ExtendedTextMessage": map[string]any{
				"contextInfo": map[string]any{
					"entryPointConversionSource": "ctwa_ad",
					"ExternalAdReply": map[string]any{
						"sourceType": "ad",
						"sourceId":   "cross-case-ad",
					},
				},
			},
		},
	})
	if referral["entry_point_conversion_source"] != "ctwa_ad" || referral["source_id"] != "cross-case-ad" {
		t.Fatalf("cross-cased structured referral was not normalized: %#v", referral)
	}
}

func TestNativeCTWAAttributionAndMessageMetadataPreserveNormalizedReferral(t *testing.T) {
	message := extractNativeEvolutionMessages(decodeNativeFixture(t, "meta_ctwa_instagram.json"))[0]
	attribution := nativeCampaignAttribution(message)
	for key, want := range map[string]any{
		"creative_link_url":             "https://www.instagram.com/p/Dcyi6FjgAeQ/",
		"creative_destination_url":      "https://www.instagram.com/p/Dcyi6FjgAeQ/",
		"creative_instagram_url":        "https://www.instagram.com/p/Dcyi6FjgAeQ/",
		"entry_point_conversion_source": "ctwa_ad",
		"entry_point_conversion_app":    "instagram",
		"conversion_source":             "FB_Ads",
		"source_app":                    "instagram",
		"show_ad_attribution":           true,
	} {
		if got := attribution[key]; got != want {
			t.Fatalf("attribution[%q] = %#v, want %#v", key, got, want)
		}
	}
	referral, ok := attribution["source_referral"].(map[string]any)
	if !ok || referral["explicit_source_type"] != "ad" || referral["entry_point_conversion_source"] != "ctwa_ad" {
		t.Fatalf("normalized source_referral = %#v", attribution["source_referral"])
	}
	metadata := nativeEvolutionMessageMetadata(message)
	if metadata["source"] != "evolution_go_webhook" {
		t.Fatalf("message metadata source = %#v", metadata["source"])
	}
	storedReferral, ok := metadata["whatsapp_referral"].(map[string]any)
	if !ok || storedReferral["source_app"] != "instagram" || storedReferral["show_ad_attribution"] != true {
		t.Fatalf("message whatsapp_referral = %#v", metadata["whatsapp_referral"])
	}
	if got := nativeCampaignAttributionUTMSource(message); got != "instagram" {
		t.Fatalf("UTM source = %q, want instagram", got)
	}
}

func TestNativeAmbiguousPhoneMatchFailsClosed(t *testing.T) {
	if _, err := nativeSingleEvolutionLeadMatch([]nativeEvolutionLead{{ID: "lead-a"}, {ID: "lead-b"}}); !errors.Is(err, errNativeEvolutionLeadPhoneAmbiguous) {
		t.Fatalf("ambiguous lead lookup error = %v", err)
	}
	lead, err := nativeSingleEvolutionLeadMatch([]nativeEvolutionLead{{ID: "lead-a"}})
	if err != nil || lead.ID != "lead-a" {
		t.Fatalf("single lead lookup = %#v, %v", lead, err)
	}
}

func TestNativeExistingConversationLeadSkipsGlobalPhoneResolution(t *testing.T) {
	linked := nativeEvolutionConversation{ID: "conversation-id", LeadID: "lead-id"}
	if !nativeConversationHasAttachedLead(linked, false) {
		t.Fatal("existing scoped conversation/lead link must be reused")
	}
	if nativeConversationHasAttachedLead(linked, true) ||
		nativeConversationHasAttachedLead(nativeEvolutionConversation{ID: "conversation-id"}, false) {
		t.Fatal("missing conversation or lead must still use normal scoped resolution")
	}
}

func TestNativeLegacyRecoveryUsesPersistedAttribution(t *testing.T) {
	incoming := nativeEvolutionMessage{
		ProviderMessageID:                  "provider-retry-1",
		CampaignEntryPointConversionSource: "ctwa_ad",
		CampaignSourceType:                 "ad",
		CampaignSourceID:                   "untrusted-replay-ad",
		IsCTWAAd:                           true,
	}
	persisted := nativeMessageWithPersistedCampaignAttribution(incoming, map[string]any{
		"whatsapp_referral": map[string]any{
			"entry_point_conversion_source": "ctwa_ad",
			"explicit_source_type":          "ad",
			"source_id":                     "persisted-ad",
			"source_url":                    "https://www.instagram.com/p/persisted/",
			"source_app":                    "instagram",
			"headline":                      "Campanha persistida",
		},
	})
	if !persisted.IsCTWAAd || persisted.CampaignSourceID != "persisted-ad" ||
		persisted.CampaignHeadline != "Campanha persistida" ||
		persisted.CampaignSourceURL != "https://www.instagram.com/p/persisted/" {
		t.Fatalf("persisted attribution was not recovered: %#v", persisted)
	}
	if persisted.CampaignSourceID == incoming.CampaignSourceID {
		t.Fatal("legacy recovery trusted mutable replay attribution")
	}
	for _, fragment := range []string{
		"from public.whatsapp_messages as message",
		"message.organization_id = $1::uuid",
		"message.session_id = $2::uuid",
		"coalesce(message.from_me, false) = false",
		"for update of message, conversation",
	} {
		if !strings.Contains(nativeLegacyNonManagedRecoveryQuery, fragment) {
			t.Fatalf("legacy recovery query missing %q", fragment)
		}
	}
	if !strings.Contains(nativeLegacyNonManagedConversationRecoveryQuery,
		"conversation.last_message_at is null or conversation.last_message_at < $4::timestamptz") {
		t.Fatal("legacy conversation recovery must be replay-idempotent")
	}
}

func TestNativeCTWAWithoutManagedRuleDropsLegacyAssignmentTargets(t *testing.T) {
	legacy := nativeInboundRule{
		ID:                 "legacy-rule",
		TargetUserID:       "legacy-user",
		TargetTeamID:       "legacy-team",
		TargetPipelineID:   "legacy-pipeline",
		TargetStageID:      "legacy-stage",
		TargetRoundRobinID: "legacy-round-robin",
	}
	if got := nativeCTWALeadAssignmentRule(legacy); got.ID != "" || got.TargetUserID != "" || got.TargetTeamID != "" ||
		got.TargetPipelineID != "" || got.TargetStageID != "" || got.TargetRoundRobinID != "" {
		t.Fatalf("owner-fallback assignment retained legacy targets: %#v", got)
	}
	managed := legacy
	managed.ManagedMessageDistribution = true
	if got := nativeCTWALeadAssignmentRule(managed); got.ID != managed.ID || !got.ManagedMessageDistribution {
		t.Fatalf("managed assignment context was not preserved: %#v", got)
	}
}

func TestNativeEvolutionConnectionStatusUsesTransportAndLoginState(t *testing.T) {
	tests := []struct {
		name    string
		payload map[string]any
		want    string
	}{
		{name: "socket and login active", payload: map[string]any{"data": map[string]any{"Connected": true, "LoggedIn": true}}, want: "connected"},
		{name: "socket awaiting qr", payload: map[string]any{"data": map[string]any{"Connected": true, "LoggedIn": false}}, want: "qr_ready"},
		{name: "paired session temporarily offline", payload: map[string]any{"data": map[string]any{"Connected": false, "LoggedIn": true}}, want: "disconnected"},
		{name: "logged out", payload: map[string]any{"data": map[string]any{"Connected": false, "LoggedIn": false}}, want: "disconnected"},
		{name: "legacy connected-only payload", payload: map[string]any{"data": map[string]any{"Connected": true}}, want: "connected"},
		{name: "explicit connected event state", payload: map[string]any{"data": map[string]any{"status": "open"}}, want: "connected"},
		{name: "connecting event awaits pairing", payload: map[string]any{"data": map[string]any{"status": "connecting"}}, want: "qr_ready"},
		{name: "pairing event awaits qr", payload: map[string]any{"data": map[string]any{"status": "pairing"}}, want: "qr_ready"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status, recognized, _ := nativeEvolutionConnectionStatus(tt.payload, "connection.update")
			if !recognized || status != tt.want {
				t.Fatalf("nativeEvolutionConnectionStatus() = (%q, %v), want (%q, true)", status, recognized, tt.want)
			}
		})
	}

	status, recognized, _ := nativeEvolutionConnectionStatus(map[string]any{"data": map[string]any{"status": "unknown"}}, "connection.update")
	if recognized || status != "" {
		t.Fatalf("unknown connection state must not overwrite the stored state: (%q, %v)", status, recognized)
	}
	status, recognized, connectionErr := nativeEvolutionConnectionStatus(map[string]any{"data": map[string]any{"status": "error", "message": "socket failed"}}, "connection.update")
	if !recognized || status != "" || connectionErr != "socket failed" {
		t.Fatalf("error event must preserve status and record its reason: (%q, %v, %q)", status, recognized, connectionErr)
	}
}

func TestNativeMessageStatusIsMonotonic(t *testing.T) {
	tests := []struct {
		current  string
		incoming string
		want     string
	}{
		{"sent", "pending", "sent"},
		{"sent", "queued", "sent"},
		{"delivered", "pending", "delivered"},
		{"delivered", "queued", "delivered"},
		{"delivered", "sent", "delivered"},
		{"read", "sent", "read"},
		{"delivered", "failed", "delivered"},
		{"sent", "read", "read"},
	}
	for _, test := range tests {
		if got := nativeMonotonicStatus(test.current, test.incoming); got != test.want {
			t.Fatalf("nativeMonotonicStatus(%q, %q) = %q, want %q", test.current, test.incoming, got, test.want)
		}
	}
}

func TestNativeLIDPromotionFailsClosedOnLeadConflict(t *testing.T) {
	if _, err := safeNativeMergedLeadID("lead-a", "lead-b", "lead-a"); err == nil {
		t.Fatal("conflicting canonical and LID lead ownership was accepted")
	}
	if _, err := safeNativeMergedLeadID("", "lead-a", ""); err == nil {
		t.Fatal("an existing LID lead was promoted without phone verification")
	}
	if got, err := safeNativeMergedLeadID("lead-a", "lead-a", "lead-a"); err != nil || got != "lead-a" {
		t.Fatalf("verified identical lead ownership = %q, %v", got, err)
	}
}

func TestNativeInboundRuleUsesOnlyTheSelectedField(t *testing.T) {
	message := nativeEvolutionMessage{Content: "codigo 123456789012345 no texto"}
	rule := nativeInboundRule{
		MatchType:     "exact",
		MatchField:    "ad_id",
		MatchValue:    "123456789012345",
		CampaignLabel: "123456789012345",
	}
	if nativeInboundRuleMatches(rule, message) {
		t.Fatal("ad_id rule matched plain message content or its own output label")
	}
	message.CampaignSourceID = "123456789012345"
	if !nativeInboundRuleMatches(rule, message) {
		t.Fatal("ad_id rule did not match the normalized referral ad id")
	}
}

func TestNativeMessageAliasesNeverMergeGroupParticipantOrOwnDevice(t *testing.T) {
	group, ok := normalizeNativeEvolutionMessage(map[string]any{
		"Info": map[string]any{
			"ID":       "group-message",
			"Chat":     "120363000000000000@g.us",
			"SenderPN": "5511777776666@s.whatsapp.net",
			"IsGroup":  true,
		},
		"Message": map[string]any{"conversation": "Oi grupo"},
	})
	if !ok || !group.IsGroup {
		t.Fatalf("group message was not normalized: %#v", group)
	}
	for _, alias := range group.RemoteAliases {
		if alias == "5511777776666@s.whatsapp.net" {
			t.Fatalf("group participant leaked into group aliases: %#v", group.RemoteAliases)
		}
	}

	outbound, ok := normalizeNativeEvolutionMessage(map[string]any{
		"Info": map[string]any{
			"ID":          "outbound-message",
			"Chat":        "5511999991111@s.whatsapp.net",
			"RecipientPN": "5511999991111@s.whatsapp.net",
			"SenderPN":    "5511888887777@s.whatsapp.net",
			"IsFromMe":    true,
			"PushName":    "Minha instância",
		},
		"contactName": "Contato correto",
		"Message":     map[string]any{"conversation": "Oi contato"},
	})
	if !ok || outbound.RemoteJID != "5511999991111@s.whatsapp.net" || outbound.ContactName != "Contato correto" {
		t.Fatalf("outbound contact was not normalized: %#v", outbound)
	}
	for _, alias := range outbound.RemoteAliases {
		if alias == "5511888887777@s.whatsapp.net" {
			t.Fatalf("own device leaked into contact aliases: %#v", outbound.RemoteAliases)
		}
	}
}

func TestEvolutionWebhookProcessorModeDefaultsToEdge(t *testing.T) {
	if mode := normalizeEvolutionWebhookProcessorMode(""); mode != webhookProcessorEdge {
		t.Fatalf("default mode = %q, want edge", mode)
	}
	if mode := normalizeEvolutionWebhookProcessorMode("native_fallback"); mode != webhookProcessorNativeFallback {
		t.Fatalf("explicit mode = %q, want native_fallback", mode)
	}
}

func TestEvolutionWebhookProcessorModeIsSessionGated(t *testing.T) {
	const (
		canarySession = "13eea7e8-a74f-4bfb-bb36-024e3d26ccc9"
		otherSession  = "c15fe784-741b-4764-a60c-c60ffc50d606"
	)

	if mode := evolutionWebhookProcessorModeForSession(webhookProcessorNativeFallback, nil, canarySession); mode != webhookProcessorEdge {
		t.Fatalf("empty rollout mode = %q, want edge", mode)
	}
	if mode := evolutionWebhookProcessorModeForSession(webhookProcessorNativeFallback, []string{canarySession}, otherSession); mode != webhookProcessorEdge {
		t.Fatalf("non-canary mode = %q, want edge", mode)
	}
	if mode := evolutionWebhookProcessorModeForSession(webhookProcessorNativeFallback, []string{canarySession}, canarySession); mode != webhookProcessorNativeFallback {
		t.Fatalf("canary mode = %q, want native_fallback", mode)
	}
	if mode := evolutionWebhookProcessorModeForSession(webhookProcessorNative, []string{"*"}, otherSession); mode != webhookProcessorNative {
		t.Fatalf("wildcard mode = %q, want native", mode)
	}
}

func TestNativeFallbackNeverForwardsUnsupportedMessageOrCampaignToEdge(t *testing.T) {
	const sessionID = "13eea7e8-a74f-4bfb-bb36-024e3d26ccc9"
	var edgeCalls atomic.Int32
	edge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		edgeCalls.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer edge.Close()

	repo := Repository{functions: functionsClient{
		apiKey:                   "edge-api-key",
		evolutionWebhookURL:      edge.URL,
		webhookProcessorMode:     webhookProcessorNativeFallback,
		webhookRolloutSessionIDs: []string{sessionID},
		httpClient:               edge.Client(),
	}}
	tests := []struct {
		name      string
		eventType string
		payload   string
	}{
		{
			name:      "unsupported protocol message",
			eventType: "messages.upsert",
			payload: `{
				"event":"messages.upsert",
				"data":{
					"Info":{"ID":"unsupported-message-1","Chat":"5511999991111@s.whatsapp.net"},
					"Message":{"protocolMessage":{"type":"history_sync_notification"}}
				}
			}`,
		},
		{
			name:      "unsupported campaign referral",
			eventType: "campaign.referral",
			payload:   `{"event":"campaign.referral","data":{"referral":{"source_type":"unknown","source_id":"not-verified"}}}`,
		},
		{
			name:      "campaign hidden under unknown event",
			eventType: "unknown",
			payload:   `{"event":"unknown","data":{"ad":{"source_type":"ad","source_id":"123456789"}}}`,
		},
		{
			name:      "unrecognized generic status",
			eventType: "status",
			payload:   `{"event":"status","data":{"state":"unexpected"}}`,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := repo.dispatchEvolutionWebhook(context.Background(), pendingEvolutionWebhook{
				OrganizationID: "55f02ce7-4290-47f8-9ee3-61fc84619747",
				SessionID:      sessionID,
				EventType:      test.eventType,
				WebhookToken:   "legacy-secret",
				Payload:        []byte(test.payload),
			})
			if !errors.Is(err, errNativeWebhookMessageLikeUnsupported) {
				t.Fatalf("dispatch error = %v, want fail-closed message-like error", err)
			}
		})
	}
	if got := edgeCalls.Load(); got != 0 {
		t.Fatalf("unsupported message-like events reached Edge %d times", got)
	}
}

func TestNativeFallbackStillForwardsNonMessageLifecycleEvent(t *testing.T) {
	const sessionID = "13eea7e8-a74f-4bfb-bb36-024e3d26ccc9"
	var edgeCalls atomic.Int32
	edge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		edgeCalls.Add(1)
		if got := r.Header.Get("x-webhook-token"); got != "legacy-secret" {
			t.Errorf("legacy fallback token = %q", got)
		}
		for _, credential := range []string{"webhook_token", "apikey", "token"} {
			if r.URL.Query().Has(credential) {
				t.Errorf("forwarded webhook leaked %s in its URL", credential)
			}
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer edge.Close()

	repo := Repository{functions: functionsClient{
		apiKey:                   "edge-api-key",
		evolutionWebhookURL:      edge.URL,
		webhookProcessorMode:     webhookProcessorNativeFallback,
		webhookRolloutSessionIDs: []string{sessionID},
		httpClient:               edge.Client(),
	}}
	err := repo.dispatchEvolutionWebhook(context.Background(), pendingEvolutionWebhook{
		OrganizationID: "55f02ce7-4290-47f8-9ee3-61fc84619747",
		SessionID:      sessionID,
		EventType:      "presence.update",
		WebhookToken:   "legacy-secret",
		Payload:        []byte(`{"event":"presence.update","data":{"presence":"available"}}`),
	})
	if err != nil {
		t.Fatalf("non-message fallback failed: %v", err)
	}
	if got := edgeCalls.Load(); got != 1 {
		t.Fatalf("non-message lifecycle event reached Edge %d times, want 1", got)
	}
}

func decodeNativeFixture(t *testing.T, name string) map[string]any {
	t.Helper()
	raw := readNativeFixture(t, name)
	payload, err := decodeNativeEvolutionPayload(raw)
	if err != nil {
		t.Fatal(err)
	}
	return payload
}

func readNativeFixture(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "evolution_go", name))
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
