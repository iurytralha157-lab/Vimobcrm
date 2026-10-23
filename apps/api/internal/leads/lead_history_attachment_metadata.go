package leads

import "strings"

// History describes the attachment; its authorized URL is resolved only by the
// attachment endpoint. Legacy URLs must not survive a later origin denial.
func redactLeadHistoryAttachmentURLs(value any) {
	switch current := value.(type) {
	case map[string]any:
		for key, item := range current {
			if strings.EqualFold(strings.ReplaceAll(key, "_", ""), "fileurl") {
				delete(current, key)
				continue
			}
			redactLeadHistoryAttachmentURLs(item)
		}
	case []any:
		for _, item := range current {
			redactLeadHistoryAttachmentURLs(item)
		}
	case []map[string]any:
		for _, item := range current {
			redactLeadHistoryAttachmentURLs(item)
		}
	}
}
