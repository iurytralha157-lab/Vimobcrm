package leads

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
)

var contactDocumentLabel = regexp.MustCompile(`(?i)(^|[^a-z0-9])(cpf|rg)([^a-z0-9]|$)`)
var contactCamelLabel = regexp.MustCompile(`([a-z])([A-Z])`)

func contactSensitiveDocument(value string) string {
	if strings.EqualFold(value, "hasCPF") || strings.EqualFold(value, "hasRG") {
		return ""
	}
	match := contactDocumentLabel.FindStringSubmatch(contactCamelLabel.ReplaceAllString(value, "$1 $2"))
	if len(match) < 3 {
		return ""
	}
	return strings.ToUpper(match[2])
}

// Exportable JSON is a report, never the sensitive-document endpoint. Keep
// numeric lexemes intact and redact documents in nested objects and Meta answers.
func sanitizedLeadMetadataJSON(raw pgtype.Text) *string {
	if !raw.Valid || strings.TrimSpace(raw.String) == "" {
		return nil
	}
	var value any
	decoder := json.NewDecoder(strings.NewReader(raw.String))
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil {
		empty := "{}"
		return &empty
	}
	sanitizeContactJSON(value)
	payload, err := json.Marshal(value)
	if err != nil {
		empty := "{}"
		return &empty
	}
	text := string(payload)
	return &text
}

func sanitizeContactJSON(value any) {
	switch current := value.(type) {
	case []any:
		for _, item := range current {
			sanitizeContactJSON(item)
		}
	case map[string]any:
		for _, key := range []string{"name", "question", "label", "field_label", "field_name", "key", "title"} {
			label, ok := current[key].(string)
			if !ok {
				continue
			}
			document := contactSensitiveDocument(label)
			if document == "" {
				continue
			}
			present := false
			for _, responseKey := range []string{"values", "value", "answer", "response", "field_value", "text"} {
				if response, exists := current[responseKey]; exists {
					present = present || contactDocumentPresent(response)
					delete(current, responseKey)
				}
			}
			current["has"+document] = present
		}
		for key, item := range current {
			if document := contactSensitiveDocument(key); document != "" {
				current["has"+document] = contactDocumentPresent(item)
				delete(current, key)
			} else {
				sanitizeContactJSON(item)
			}
		}
	}
}

func contactDocumentPresent(value any) bool {
	if value == nil {
		return false
	}
	if list, ok := value.([]any); ok {
		for _, item := range list {
			if contactDocumentPresent(item) {
				return true
			}
		}
		return false
	}
	return strings.TrimSpace(fmt.Sprint(value)) != ""
}
