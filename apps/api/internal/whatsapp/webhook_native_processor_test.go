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
		if message.CTWAConfirmationMethod != "entry_point_ctwa_ad" {
			t.Fatalf("CTWA confirmation method = %q", message.CTWAConfirmationMethod)
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

	t.Run("Evolution CTWA click id fallback without entry point", func(t *testing.T) {
		payload := decodeNativeFixture(t, "meta_ctwa_evolution_clid_without_entrypoint.json")
		messages := extractNativeEvolutionMessages(payload)
		if len(messages) != 1 {
			t.Fatalf("messages = %d, want 1", len(messages))
		}
		message := messages[0]
		if !message.IsCTWAAd || message.CTWAConfirmationMethod != "evolution_ctwa_clid_v1" {
			t.Fatalf("Evolution CTWA fallback was not confirmed: %#v", message)
		}
		if message.CampaignEntryPointConversionSource != "" || message.CampaignSourceType != "ad" ||
			message.CampaignCTWAClid == "" || message.CampaignSourceID != "" {
			t.Fatalf("Evolution CTWA fallback signals were not preserved exactly: %#v", message)
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

	t.Run("LID CTWA promotion from immediate data envelope", func(t *testing.T) {
		payload := decodeNativeFixture(t, "meta_ctwa_lid_envelope_sender.json")
		data := mapFromAny(payload["data"])
		data["ID"] = "instance-envelope-id"
		data["Info"] = map[string]any{}
		data["key"] = map[string]any{}
		messages := extractNativeEvolutionMessages(payload)
		if len(messages) != 1 {
			t.Fatalf("messages = %d, want only the nested message", len(messages))
		}
		message := messages[0]
		if message.ProviderMessageID != "provider-meta-ctwa-lid-envelope-1" {
			t.Fatalf("provider message id = %q, want nested message id", message.ProviderMessageID)
		}
		if message.ContactPhone != "559491298288" || message.RemoteJID != "559491298288@s.whatsapp.net" || message.UnsupportedID {
			t.Fatalf("LID envelope identity was not promoted: %#v", message)
		}
		if message.ContactPhone == "551188887777" {
			t.Fatal("top-level Evolution sender (the connected instance) was used as the contact")
		}
		if !stringIn("987654321012345@lid", message.RemoteAliases...) {
			t.Fatalf("original LID alias was not preserved: %#v", message.RemoteAliases)
		}
		if !message.IsCTWAAd || message.CampaignHeadline != "Lumy Penha" || message.CampaignSourceID != "120249512922100328" ||
			message.CampaignEntryPointConversionSource != "ctwa_ad" || message.CampaignSourceApp != "instagram" {
			t.Fatalf("current data-envelope CTWA referral was not normalized: %#v", message)
		}
		if message.Content != "Olá, gostaria de saber mais informações sobre o Lançamento Lumy Penha." {
			t.Fatalf("content = %q", message.Content)
		}
	})

	t.Run("direct scalar-ID message remains a message", func(t *testing.T) {
		messages := extractNativeEvolutionMessages(map[string]any{
			"event": "messages.upsert",
			"data": map[string]any{
				"message": map[string]any{
					"ID":        "direct-message-id",
					"Info":      map[string]any{},
					"remoteJid": "5511999998888@s.whatsapp.net",
					"message": map[string]any{
						"conversation": "oi",
					},
				},
			},
		})
		if len(messages) != 1 || messages[0].ProviderMessageID != "direct-message-id" || messages[0].Content != "oi" {
			t.Fatalf("direct scalar-ID message was treated as an envelope: %#v", messages)
		}
	})

	t.Run("CTWA proof conflicts between message and envelope fail closed", func(t *testing.T) {
		const envelopeClid = "AR_fake_ctwa_lid_click_id"
		setCurrentReferral := func(payload map[string]any, referral map[string]any) {
			data := mapFromAny(payload["data"])
			message := mapFromAny(data["message"])
			messageNode := mapFromAny(message["message"])
			extended := mapFromAny(messageNode["extendedTextMessage"])
			extended["contextInfo"] = map[string]any{
				"externalAdReply": referral,
			}
		}
		tests := []struct {
			name     string
			current  map[string]any
			mutate   func(map[string]any)
			wantCTWA bool
			wantName string
		}{
			{
				name:    "current non-ad conflicts with ad envelope",
				current: map[string]any{"sourceType": "post"},
			},
			{
				name:    "current ad conflicts with non-ad envelope",
				current: map[string]any{"sourceType": "ad", "ctwaClid": envelopeClid},
				mutate: func(payload map[string]any) {
					data := mapFromAny(payload["data"])
					referral := mapFromAny(data["referral"])
					mapFromAny(referral["external_ad_reply"])["source_type"] = "post"
				},
			},
			{
				name: "complementary proof keeps current descriptive fields",
				current: map[string]any{
					"sourceType": "ad",
					"ctwaClid":   envelopeClid,
					"title":      "Mensagem atual",
					"sourceUrl":  "https://www.instagram.com/p/current-message/",
				},
				wantCTWA: true,
				wantName: "Mensagem atual",
			},
			{
				name:    "show attribution conflict",
				current: map[string]any{"sourceType": "ad", "ctwaClid": envelopeClid, "showAdAttribution": false},
			},
			{
				name:    "click id conflict",
				current: map[string]any{"sourceType": "ad", "ctwaClid": "different-current-click-id"},
			},
		}
		for _, test := range tests {
			t.Run(test.name, func(t *testing.T) {
				payload := decodeNativeFixture(t, "meta_ctwa_lid_envelope_sender.json")
				setCurrentReferral(payload, test.current)
				if test.mutate != nil {
					test.mutate(payload)
				}
				messages := extractNativeEvolutionMessages(payload)
				if len(messages) != 1 {
					t.Fatalf("messages = %d, want 1", len(messages))
				}
				message := messages[0]
				if message.IsCTWAAd != test.wantCTWA {
					t.Fatalf("IsCTWAAd = %v, want %v: %#v", message.IsCTWAAd, test.wantCTWA, message)
				}
				if !test.wantCTWA && !message.CampaignCTWAProofConflict {
					t.Fatalf("conflicting proof was not retained: %#v", message)
				}
				if test.wantName != "" && message.CampaignHeadline != test.wantName {
					t.Fatalf("headline = %q, want current-message value %q", message.CampaignHeadline, test.wantName)
				}
			})
		}
	})

	t.Run("malformed fallback show attribution fails closed", func(t *testing.T) {
		for _, invalid := range []any{"", "banana", float64(2)} {
			payload := decodeNativeFixture(t, "meta_ctwa_evolution_clid_without_entrypoint.json")
			data := mapFromAny(payload["data"])
			message := mapFromAny(data["message"])
			messageNode := mapFromAny(message["message"])
			extended := mapFromAny(messageNode["extendedTextMessage"])
			contextInfo := mapFromAny(extended["contextInfo"])
			mapFromAny(contextInfo["externalAdReply"])["showAdAttribution"] = invalid
			messages := extractNativeEvolutionMessages(payload)
			if len(messages) != 1 || messages[0].IsCTWAAd || !messages[0].CampaignShowAdAttributionInvalid {
				t.Fatalf("invalid showAdAttribution %#v was not rejected: %#v", invalid, messages)
			}
		}
		payload := decodeNativeFixture(t, "meta_ctwa_instagram.json")
		data := mapFromAny(payload["data"])
		message := mapFromAny(data["message"])
		messageNode := mapFromAny(message["message"])
		extended := mapFromAny(messageNode["extendedTextMessage"])
		contextInfo := mapFromAny(extended["contextInfo"])
		mapFromAny(contextInfo["externalAdReply"])["showAdAttribution"] = "banana"
		messages := extractNativeEvolutionMessages(payload)
		if len(messages) != 1 || messages[0].IsCTWAAd || !messages[0].CampaignShowAdAttributionInvalid {
			t.Fatalf("explicit entry point accepted malformed show attribution: %#v", messages)
		}
	})

	t.Run("malformed CTWA proof fields fail closed", func(t *testing.T) {
		tests := []struct {
			name   string
			mutate func(map[string]any)
		}{
			{
				name: "boolean entry point cannot fall through to click fallback",
				mutate: func(contextInfo map[string]any) {
					contextInfo["entryPointConversionSource"] = false
				},
			},
			{
				name: "boolean source type cannot weaken explicit entry point",
				mutate: func(contextInfo map[string]any) {
					mapFromAny(contextInfo["externalAdReply"])["sourceType"] = false
				},
			},
			{
				name: "numeric click id cannot accompany explicit entry point",
				mutate: func(contextInfo map[string]any) {
					mapFromAny(contextInfo["externalAdReply"])["ctwaClid"] = float64(12345678)
				},
			},
		}
		for _, test := range tests {
			t.Run(test.name, func(t *testing.T) {
				payload := decodeNativeFixture(t, "meta_ctwa_instagram.json")
				data := mapFromAny(payload["data"])
				message := mapFromAny(data["message"])
				messageNode := mapFromAny(message["message"])
				extended := mapFromAny(messageNode["extendedTextMessage"])
				contextInfo := mapFromAny(extended["contextInfo"])
				test.mutate(contextInfo)
				messages := extractNativeEvolutionMessages(payload)
				if len(messages) != 1 || messages[0].IsCTWAAd || !messages[0].CampaignCTWAProofConflict {
					t.Fatalf("malformed proof was not rejected: %#v", messages)
				}
			})
		}
	})

	t.Run("top-level sender does not promote a LID", func(t *testing.T) {
		payload := decodeNativeFixture(t, "message_lid_quarantine.json")
		payload["sender"] = "551188887777@s.whatsapp.net"
		messages := extractNativeEvolutionMessages(payload)
		if len(messages) != 1 || !messages[0].UnsupportedID || messages[0].ContactPhone != "" {
			t.Fatalf("top-level instance sender promoted an opaque contact: %#v", messages)
		}
	})

	t.Run("shared batch envelope does not promote or attribute a message", func(t *testing.T) {
		payload := decodeNativeFixture(t, "meta_ctwa_lid_envelope_sender.json")
		data := mapFromAny(payload["data"])
		data["messages"] = []any{data["message"]}
		delete(data, "message")
		messages := extractNativeEvolutionMessages(payload)
		if len(messages) != 1 {
			t.Fatalf("messages = %d, want 1", len(messages))
		}
		message := messages[0]
		if !message.UnsupportedID || message.ContactPhone != "" || message.IsCTWAAd || message.HasCampaignSignal {
			t.Fatalf("ambiguous batch envelope leaked into its item: %#v", message)
		}
	})

	t.Run("non LID opaque chat never inherits the envelope phone", func(t *testing.T) {
		payload := decodeNativeFixture(t, "message_lid_quarantine.json")
		data := mapFromAny(payload["data"])
		data["sender"] = "551188887777@s.whatsapp.net"
		message := mapFromAny(data["message"])
		key := mapFromAny(message["key"])
		key["remoteJid"] = "status@broadcast"
		messages := extractNativeEvolutionMessages(payload)
		if len(messages) != 1 || messages[0].ContactPhone != "" || messages[0].RemoteJID != "status@broadcast" {
			t.Fatalf("opaque non-LID chat inherited an envelope phone: %#v", messages)
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

func TestNativeStrictCampaignProofTextSkipsOnlyEmptyAliases(t *testing.T) {
	value, invalid := nativeStrictCampaignProofText(map[string]any{
		"source_type": "",
		"sourceType":  "ad",
	}, "source_type", "sourceType")
	if invalid || value != "ad" {
		t.Fatalf("empty canonical alias did not fall through safely: %q, invalid=%v", value, invalid)
	}
	value, invalid = nativeStrictCampaignProofText(map[string]any{
		"source_type": false,
		"sourceType":  "ad",
	}, "source_type", "sourceType")
	if !invalid || value != "" {
		t.Fatalf("non-string canonical alias did not fail closed: %q, invalid=%v", value, invalid)
	}
}

func TestNativeCTWAConfirmationAcceptsBoundedEvolutionClickIDFallback(t *testing.T) {
	show := true
	hide := false
	base := nativeEvolutionMessage{
		ProviderMessageID:         "provider-real-ctwa",
		CampaignSourceType:        "ad",
		CampaignCTWAClid:          "AfjGD28_TndSXnbFSjURxTw0",
		CampaignShowAdAttribution: &show,
	}
	if got := nativeCTWAAdConfirmationMethod(base); got != "evolution_ctwa_clid_v1" {
		t.Fatalf("Evolution CTWA fallback method = %q", got)
	}
	withoutShowFlag := base
	withoutShowFlag.CampaignShowAdAttribution = nil
	if got := nativeCTWAAdConfirmationMethod(withoutShowFlag); got != "evolution_ctwa_clid_v1" {
		t.Fatalf("Evolution CTWA fallback without show flag = %q", got)
	}

	rejected := []nativeEvolutionMessage{
		func() nativeEvolutionMessage {
			value := base
			value.CampaignEntryPointConversionSource = "qr_code"
			return value
		}(),
		func() nativeEvolutionMessage { value := base; value.CampaignSourceType = ""; return value }(),
		func() nativeEvolutionMessage { value := base; value.ProviderMessageIDSynthetic = true; return value }(),
		func() nativeEvolutionMessage { value := base; value.CampaignShowAdAttribution = &hide; return value }(),
		func() nativeEvolutionMessage { value := base; value.FromMe = true; return value }(),
		func() nativeEvolutionMessage { value := base; value.IsGroup = true; return value }(),
		func() nativeEvolutionMessage { value := base; value.CampaignCTWAClid = "short"; return value }(),
		func() nativeEvolutionMessage {
			value := base
			value.CampaignCTWAClid = "valid-id\x00forged"
			return value
		}(),
	}
	for index, message := range rejected {
		if got := nativeCTWAAdConfirmationMethod(message); got != "" {
			t.Fatalf("rejected CTWA fallback %d returned %q", index, got)
		}
	}
}

func TestNativeCTWAV2LeadMetadataUsesTheRecomputedProviderProof(t *testing.T) {
	source := compactCTWAContract(readCTWAContractFile(t,
		"apps", "api", "internal", "whatsapp", "webhook_native_processor.go",
	))
	creation := sectionCTWAContract(
		t,
		source,
		"func createAuthorizedNativeLead(",
		"func nativeCTWALeadAssignmentRule(",
	)
	for _, fragment := range []string{
		"ctwaConfirmationMethod := nativeCTWAAdConfirmationMethod(message)",
		`"whatsapp_lead_creation_contract": "ctwa_ad_v2"`,
		`"ctwa_confirmation_method": ctwaConfirmationMethod`,
		`"whatsapp_initial_provider_event_id": session.ID + ":" + message.ProviderMessageID`,
	} {
		requireCTWAContractContains(t, creation, fragment)
	}

	recovery := sectionCTWAContract(
		t,
		source,
		"func nativeMessageWithPersistedCampaignAttribution(",
		"type nativeHandledAutoReplyQuerier interface",
	)
	requireCTWAContractContains(t, recovery,
		`message.CampaignSourceType = firstString(referral, "explicit_source_type")`)
	if strings.Contains(recovery, `firstString(referral, "explicit_source_type", "source_type"`) {
		t.Fatal("native CTWA v2 recovery must not authorize from an inferred source_type")
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

func TestNativeCTWAReferralSupportsSnakeCaseCurrentContext(t *testing.T) {
	referral := nativeCampaignReferral(map[string]any{
		"message": map[string]any{
			"extendedTextMessage": map[string]any{
				"context_info": map[string]any{
					"entry_point_conversion_source": "ctwa_ad",
					"external_ad_reply": map[string]any{
						"source_type": "ad",
						"source_id":   "snake-case-ad",
					},
				},
			},
		},
	})
	if referral["entry_point_conversion_source"] != "ctwa_ad" || referral["source_id"] != "snake-case-ad" {
		t.Fatalf("snake-case current-message referral was not normalized: %#v", referral)
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
	syntheticFallback := nativeMessageWithPersistedCampaignAttribution(nativeEvolutionMessage{
		ProviderMessageID:          "native-synthetic-retry",
		ProviderMessageIDSynthetic: true,
	}, map[string]any{
		"whatsapp_referral": map[string]any{
			"explicit_source_type": "ad",
			"ctwa_clid":            "AfjGD28_TndSXnbFSjURxTw0",
		},
	})
	if syntheticFallback.IsCTWAAd {
		t.Fatalf("synthetic provider id was reclassified during recovery: %#v", syntheticFallback)
	}
	validFallback := nativeMessageWithPersistedCampaignAttribution(nativeEvolutionMessage{
		ProviderMessageID: "provider-retry-valid-fallback",
	}, map[string]any{
		"whatsapp_referral": map[string]any{
			"explicit_source_type": "ad",
			"ctwa_clid":            "AfjGD28_TndSXnbFSjURxTw0",
		},
	})
	if !validFallback.IsCTWAAd || validFallback.CTWAConfirmationMethod != "evolution_ctwa_clid_v1" {
		t.Fatalf("valid persisted fallback was rejected: %#v", validFallback)
	}
	for _, test := range []struct {
		name     string
		referral map[string]any
	}{
		{
			name: "boolean entry point cannot disappear during retry",
			referral: map[string]any{
				"entry_point_conversion_source": false,
				"explicit_source_type":          "ad",
				"ctwa_clid":                     "AfjGD28_TndSXnbFSjURxTw0",
			},
		},
		{
			name: "numeric click id cannot be stringified during retry",
			referral: map[string]any{
				"explicit_source_type": "ad",
				"ctwa_clid":            float64(12345678),
			},
		},
		{
			name: "inferred source type cannot become explicit during retry",
			referral: map[string]any{
				"source_type": "ad",
				"ctwa_clid":   "AfjGD28_TndSXnbFSjURxTw0",
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			recovered := nativeMessageWithPersistedCampaignAttribution(nativeEvolutionMessage{
				ProviderMessageID: "provider-retry-malformed",
			}, map[string]any{"whatsapp_referral": test.referral})
			if recovered.IsCTWAAd {
				t.Fatalf("malformed persisted proof was authorized: %#v", recovered)
			}
		})
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
		{"sent", "received", "sent"},
		{"processing", "pending", "processing"},
		{"processing", "sent", "sent"},
		{"delivered", "pending", "delivered"},
		{"delivered", "queued", "delivered"},
		{"delivered", "sent", "delivered"},
		{"read", "sent", "read"},
		{"delivered", "failed", "delivered"},
		{"failed", "sent", "failed"},
		{"failed", "delivered", "failed"},
		{"failed", "read", "failed"},
		{"sent", "read", "read"},
	}
	for _, test := range tests {
		if got := nativeMonotonicStatus(test.current, test.incoming); got != test.want {
			t.Fatalf("nativeMonotonicStatus(%q, %q) = %q, want %q", test.current, test.incoming, got, test.want)
		}
	}
}

func TestNativeOutboxStatusDoesNotReopenFromProviderQueueAck(t *testing.T) {
	for _, current := range []string{"processing", "retry", "sent", "delivered", "read", "failed", "dead"} {
		for _, incoming := range []string{"pending", "queued"} {
			if got := nativeMonotonicOutboxStatus(current, incoming); got != current {
				t.Fatalf("nativeMonotonicOutboxStatus(%q, %q) = %q, want %q", current, incoming, got, current)
			}
		}
	}
	if got := nativeMonotonicOutboxStatus("processing", "sent"); got != "sent" {
		t.Fatalf("processing outbox with sent receipt = %q, want sent", got)
	}
	if got := nativeMonotonicOutboxStatus("dead", "read"); got != "dead" {
		t.Fatalf("dead outbox with read receipt = %q, want dead until full reconciliation", got)
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
