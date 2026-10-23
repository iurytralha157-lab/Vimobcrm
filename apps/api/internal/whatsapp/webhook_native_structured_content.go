package whatsapp

import "strings"

// These are real customer messages with no downloadable top-level media.
// Keep a readable representation without treating vCards, buttons, coordinates
// or album headers as a media URL or as another contact identity.
func nativeStructuredMessageContent(node map[string]any) string {
	for _, candidate := range []struct {
		paths []string
		text  []string
		label string
	}{
		{[]string{"contactMessage", "ContactMessage"}, []string{"displayName", "DisplayName"}, "Contato compartilhado"},
		{[]string{"contactsArrayMessage", "ContactsArrayMessage"}, []string{"displayName", "DisplayName"}, "Contatos compartilhados"},
		{[]string{"locationMessage", "LocationMessage"}, []string{"name", "Name", "comment", "Comment"}, "Localização compartilhada"},
		{[]string{"liveLocationMessage", "LiveLocationMessage"}, []string{"caption", "Caption"}, "Localização em tempo real compartilhada"},
		{[]string{"albumMessage", "AlbumMessage"}, nil, "Álbum de fotos ou vídeos"},
		{[]string{"interactiveMessage", "InteractiveMessage"}, []string{"body.text", "Body.Text", "header.title", "Header.Title"}, "Mensagem interativa recebida. Abra o WhatsApp para interagir."},
		{[]string{"interactiveResponseMessage", "InteractiveResponseMessage"}, []string{"body.text", "Body.Text"}, "Resposta interativa recebida"},
		{[]string{"templateMessage", "TemplateMessage"}, []string{
			"hydratedTemplate.hydratedContentText", "HydratedTemplate.HydratedContentText",
			"hydratedFourRowTemplate.hydratedContentText", "HydratedFourRowTemplate.HydratedContentText",
			"interactiveMessageTemplate.body.text", "InteractiveMessageTemplate.Body.Text",
		}, "Mensagem recebida. Abra o WhatsApp para ver o conteúdo completo."},
		{[]string{"buttonsResponseMessage", "ButtonsResponseMessage"}, []string{"selectedDisplayText", "SelectedDisplayText", "selectedButtonID", "SelectedButtonID"}, "Resposta recebida"},
		{[]string{"templateButtonReplyMessage", "TemplateButtonReplyMessage"}, []string{"selectedDisplayText", "SelectedDisplayText", "selectedID", "SelectedID"}, "Resposta recebida"},
	} {
		block := nativeFirstMap(node, candidate.paths...)
		if len(block) == 0 {
			continue
		}
		if text := strings.TrimSpace(firstString(block, candidate.text...)); text != "" {
			if candidate.paths[0] == "contactMessage" || candidate.paths[0] == "contactsArrayMessage" {
				return candidate.label + ": " + text
			}
			return text
		}
		return candidate.label
	}
	return ""
}

// The provider has not decrypted this edit. It must never become a new CRM
// message or attendance/intake signal. Ingress records a durable ignored-event
// reason; an already queued event retains its original inbox record. Applying
// edited text requires a decrypted, separately supported provider event.
// Any new subtype or mixed customer content stays unsupported and retryable.
func nativeEvolutionMessageIsEncryptedEditControl(message nativeEvolutionMessage) bool {
	if message.ProviderMessageIDSynthetic || message.HasCampaignSignal || message.UnsupportedID {
		return false
	}
	// Providers can promote text or media outside Message. Checking only the
	// encrypted node would discard that already parsed customer content.
	if message.Content != "" || nativeIsMediaType(message.MessageType) || message.MediaURL != "" || message.MediaBase64 != "" || message.IsReaction || message.IsDeletion {
		return false
	}
	// An unrecognized representation in a known customer-payload field must
	// remain retryable even when normalization cannot render it yet.
	for _, key := range []string{"text", "body", "content", "caption", "buttonText", "button_text", "buttonId", "button_id", "base64", "Base64", "media", "file", "mediaUrl", "media_url", "url"} {
		value := message.Raw[key]
		if value == nil {
			continue
		}
		if text, ok := value.(string); !ok || text != "" {
			return false
		}
	}
	node := nativeFirstMap(message.Raw, "message", "Message")
	if len(node) == 0 {
		return false
	}
	for key := range node {
		switch key {
		case "secretEncryptedMessage", "SecretEncryptedMessage", "messageContextInfo", "MessageContextInfo":
		default:
			return false
		}
	}
	edit := nativeFirstMap(node, "secretEncryptedMessage", "SecretEncryptedMessage")
	if len(edit) == 0 {
		return false
	}
	knownEdit := false
	switch kind := nativeFirstValue(edit, "secretEncType", "SecretEncType").(type) {
	case string:
		knownEdit = kind == "2" || kind == "MESSAGE_EDIT"
	case int:
		knownEdit = kind == 2
	case float64:
		knownEdit = kind == 2
	}
	if !knownEdit {
		return false
	}
	for _, paths := range [][]string{{"encPayload", "EncPayload"}, {"encIV", "EncIV"}} {
		value, ok := nativeFirstValue(edit, paths...).(string)
		if !ok || strings.TrimSpace(value) == "" {
			return false
		}
	}
	target := nativeFirstMap(edit, "targetMessageKey", "TargetMessageKey")
	id, ok := nativeFirstValue(target, "id", "ID").(string)
	if !ok || strings.TrimSpace(id) == "" {
		return false
	}
	if rawRemote := nativeFirstValue(target, "remoteJid", "RemoteJID"); rawRemote != nil {
		remote, ok := rawRemote.(string)
		if !ok || (strings.TrimSpace(remote) != "" && normalizeRemoteAlias(remote) != message.RemoteJID) {
			return false
		}
	}
	return true
}

func withoutNativeEvolutionEncryptedEditControls(messages []nativeEvolutionMessage) []nativeEvolutionMessage {
	filtered := make([]nativeEvolutionMessage, 0, len(messages))
	for _, message := range messages {
		if !nativeEvolutionMessageIsEncryptedEditControl(message) {
			filtered = append(filtered, message)
		}
	}
	return filtered
}

func nativeEncryptedEditHasFrozenCaptureRoute(payload map[string]any, message nativeEvolutionMessage) bool {
	metadata := nativeFirstMap(payload, evolutionWebhookRoutingMetaKey)
	envelope := nativeFirstMap(metadata, "routing_snapshot")
	for _, route := range nativeObjectList(envelope["messages"]) {
		if firstString(route, "provider_message_id") == message.ProviderMessageID {
			eligible, ok := route["binding_eligible"].(bool)
			// A retained eligible/unknown route needs an explicit recovery outcome;
			// do not silently complete it through the technical-control path.
			if !ok || eligible {
				return true
			}
		}
	}
	return false
}
