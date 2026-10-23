package whatsapp

import (
	"encoding/json"
	"math"
	"strings"
	"unicode"
	"unicode/utf8"
)

type MessageLocation struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Name      string  `json:"name,omitempty"`
	Address   string  `json:"address,omitempty"`
}

type MessageContact struct {
	DisplayName string   `json:"display_name"`
	Phones      []string `json:"phones,omitempty"`
}

type QuotedMessage struct {
	MessageID     string  `json:"message_id"`
	Available     bool    `json:"available"`
	ID            *string `json:"id,omitempty"`
	FromMe        *bool   `json:"from_me,omitempty"`
	Content       *string `json:"content,omitempty"`
	MessageType   *string `json:"message_type,omitempty"`
	SenderName    *string `json:"sender_name,omitempty"`
	MediaFilename *string `json:"media_filename,omitempty"`
}

func (quote QuotedMessage) MarshalJSON() ([]byte, error) {
	if !quote.Available {
		return json.Marshal(struct {
			MessageID string `json:"message_id"`
			Available bool   `json:"available"`
		}{quote.MessageID, false})
	}
	type visibleQuote QuotedMessage
	return json.Marshal(visibleQuote(quote))
}

func boundedPresentationText(value string, limit int) string {
	value = strings.TrimSpace(strings.Map(func(char rune) rune {
		if unicode.IsControl(char) {
			return -1
		}
		return char
	}, value))
	if len(value) > limit {
		value = value[:limit]
		for !utf8.ValidString(value) {
			value = value[:len(value)-1]
		}
	}
	return value
}

func safeMediaFilename(value string) string {
	value = strings.ReplaceAll(value, "\\", "/")
	if offset := strings.LastIndex(value, "/"); offset >= 0 {
		value = value[offset+1:]
	}
	value = boundedPresentationText(value, 255)
	if value == "." || value == ".." {
		return ""
	}
	return value
}

func safeQuotedMessageReference(value string) string {
	value = strings.TrimSpace(value)
	if len(value) == 0 || len(value) > 200 || !utf8.ValidString(value) {
		return ""
	}
	for _, char := range value {
		if unicode.IsControl(char) {
			return ""
		}
	}
	return value
}

func sanitizeMessageLocation(location *MessageLocation) *MessageLocation {
	if location == nil || math.IsNaN(location.Latitude) || math.IsInf(location.Latitude, 0) ||
		math.IsNaN(location.Longitude) || math.IsInf(location.Longitude, 0) ||
		location.Latitude < -90 || location.Latitude > 90 || location.Longitude < -180 || location.Longitude > 180 {
		return nil
	}
	copy := *location
	copy.Name = boundedPresentationText(copy.Name, 160)
	copy.Address = boundedPresentationText(copy.Address, 300)
	return &copy
}

func sanitizeMessageContacts(contacts []MessageContact) []MessageContact {
	result := make([]MessageContact, 0, 5)
	for _, contact := range contacts {
		contact.DisplayName = boundedPresentationText(contact.DisplayName, 160)
		var phones []string
		for _, value := range contact.Phones {
			var digits strings.Builder
			for _, char := range value {
				if char >= '0' && char <= '9' {
					digits.WriteRune(char)
				}
			}
			phone := digits.String()
			if len(phone) < 3 || len(phone) > 32 {
				continue
			}
			if strings.HasPrefix(strings.TrimSpace(value), "+") {
				phone = "+" + phone
			}
			if len(phone) > 32 {
				continue
			}
			phones = uniqueStrings(append(phones, phone)...)
			if len(phones) == 5 {
				break
			}
		}
		contact.Phones = phones
		if contact.DisplayName == "" && len(phones) == 0 {
			continue
		}
		result = append(result, contact)
		if len(result) == 5 {
			break
		}
	}
	return result
}

func applyMessagePresentation(message *Message, payload string) {
	var fields struct {
		Filename string           `json:"media_filename"`
		Location *MessageLocation `json:"location"`
		Contacts []MessageContact `json:"contacts"`
		Quote    *QuotedMessage   `json:"quoted_message"`
	}
	if json.Unmarshal([]byte(payload), &fields) != nil {
		return
	}
	if filename := safeMediaFilename(fields.Filename); filename != "" {
		message.MediaFilename = &filename
	}
	message.Location = sanitizeMessageLocation(fields.Location)
	message.Contacts = sanitizeMessageContacts(fields.Contacts)
	if fields.Quote != nil {
		fields.Quote.MessageID = safeQuotedMessageReference(fields.Quote.MessageID)
		if fields.Quote.MessageID != "" {
			_, validID := normalizeUUID(pointerValue(fields.Quote.ID))
			if !fields.Quote.Available || !validID {
				fields.Quote = &QuotedMessage{MessageID: fields.Quote.MessageID}
			} else {
				if fields.Quote.Content != nil {
					content := stripNullBytes(*fields.Quote.Content)
					if len(content) > 10000 {
						content = content[:10000]
						for !utf8.ValidString(content) {
							content = content[:len(content)-1]
						}
					}
					fields.Quote.Content = &content
				}
				if fields.Quote.SenderName != nil {
					name := boundedPresentationText(*fields.Quote.SenderName, 160)
					fields.Quote.SenderName = &name
				}
				if fields.Quote.MediaFilename != nil {
					filename := safeMediaFilename(*fields.Quote.MediaFilename)
					fields.Quote.MediaFilename = &filename
				}
			}
			message.QuotedMessage = fields.Quote
		}
	}
}
