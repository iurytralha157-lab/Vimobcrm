package whatsapp

import (
	"encoding/json"
	"strconv"
	"strings"
)

func presentationNumber(value any) (float64, error) {
	switch number := value.(type) {
	case float64:
		return number, nil
	case float32:
		return float64(number), nil
	case json.Number:
		return number.Float64()
	default:
		return strconv.ParseFloat(stringFromAny(value), 64)
	}
}

type nativeMessagePresentation struct {
	filename string
	location *MessageLocation
	contacts []MessageContact
	quoteRef string
}

func parseNativeMessagePresentation(node, raw, media map[string]any) nativeMessagePresentation {
	presentation := nativeMessagePresentation{filename: safeMediaFilename(firstNonEmpty(
		firstString(media, "fileName", "FileName", "filename", "Filename"),
		firstString(raw, "fileName", "filename"),
	))}
	location := nativeFirstMap(node, "locationMessage", "LocationMessage", "liveLocationMessage", "LiveLocationMessage")
	latitude, longitude := nativeFirstValue(location, "degreesLatitude", "DegreesLatitude", "latitude"),
		nativeFirstValue(location, "degreesLongitude", "DegreesLongitude", "longitude")
	if latitude != nil && longitude != nil {
		lat, latErr := presentationNumber(latitude)
		lon, lonErr := presentationNumber(longitude)
		if latErr == nil && lonErr == nil {
			presentation.location = sanitizeMessageLocation(&MessageLocation{Latitude: lat, Longitude: lon,
				Name: firstString(location, "name", "Name"), Address: firstString(location, "address", "Address")})
		}
	}
	contacts := []map[string]any{nativeFirstMap(node, "contactMessage", "ContactMessage")}
	array := nativeFirstMap(node, "contactsArrayMessage", "ContactsArrayMessage")
	for _, contact := range nativeObjectList(nativeFirstValue(array, "contacts", "Contacts")) {
		contacts = append(contacts, contact)
		if len(contacts) >= 6 {
			break
		}
	}
	for _, contact := range contacts {
		if len(contact) == 0 {
			continue
		}
		name := firstString(contact, "displayName", "DisplayName")
		// Preserve line boundaries only for parsing; never retain the raw vCard.
		card := firstString(contact, "vcard", "Vcard", "vCard", "VCard")
		if len(card) > 8192 {
			card = card[:8192]
		}
		var phones []string
		for _, line := range strings.Split(strings.ReplaceAll(card, "\r\n", "\n"), "\n") {
			field, value, found := strings.Cut(line, ":")
			if !found {
				continue
			}
			field = strings.ToUpper(strings.Split(field, ";")[0])
			if field == "FN" && name == "" {
				name = value
			}
			if field == "TEL" || strings.HasSuffix(field, ".TEL") {
				phones = append(phones, value)
			}
		}
		presentation.contacts = append(presentation.contacts, MessageContact{DisplayName: name, Phones: phones})
	}
	presentation.contacts = sanitizeMessageContacts(presentation.contacts)
	// Only inspect the current message's known content blocks. A nested quote
	// belongs to its own historical context and must never supply this parent.
	contexts := []map[string]any{nativeFirstMap(raw, "contextInfo", "ContextInfo", "context_info"), nativeFirstMap(node, "contextInfo", "ContextInfo", "context_info")}
	for _, kind := range []string{"extendedTextMessage", "ExtendedTextMessage", "imageMessage", "ImageMessage", "videoMessage", "VideoMessage", "audioMessage", "AudioMessage", "documentMessage", "DocumentMessage", "stickerMessage", "StickerMessage", "contactMessage", "ContactMessage", "contactsArrayMessage", "ContactsArrayMessage", "locationMessage", "LocationMessage", "liveLocationMessage", "LiveLocationMessage", "interactiveMessage", "InteractiveMessage", "interactiveResponseMessage", "InteractiveResponseMessage", "buttonsResponseMessage", "ButtonsResponseMessage", "templateButtonReplyMessage", "TemplateButtonReplyMessage", "albumMessage", "AlbumMessage", "templateMessage", "TemplateMessage"} {
		message := mapFromAny(node[kind])
		contexts = append(contexts, nativeFirstMap(message, "contextInfo", "ContextInfo", "context_info"))
	}
	for _, context := range contexts {
		if reference := safeQuotedMessageReference(firstString(context, "stanzaID", "stanzaId", "StanzaID", "StanzaId")); reference != "" {
			presentation.quoteRef = reference
			break
		}
	}
	return presentation
}

func appendNativePresentationMetadata(metadata map[string]any, message nativeEvolutionMessage) {
	if filename := safeMediaFilename(message.MediaFilename); filename != "" {
		metadata["media_filename"] = filename
	}
	if location := sanitizeMessageLocation(message.Location); location != nil {
		metadata["message_location"] = location
	}
	if contacts := sanitizeMessageContacts(message.Contacts); len(contacts) > 0 {
		metadata["message_contacts"] = contacts
	}
	if reference := safeQuotedMessageReference(message.QuotedMessageID); reference != "" {
		metadata["quoted_message_id"] = reference
	}
}
