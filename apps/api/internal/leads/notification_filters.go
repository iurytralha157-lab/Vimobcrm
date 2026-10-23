package leads

import (
	"fmt"
	"net/url"
	"strings"
)

type NotificationListFilters struct {
	UnreadOnly bool
	Categories []string
}

func parseNotificationListFilters(values url.Values) (NotificationListFilters, error) {
	filter := NotificationListFilters{}
	if raw := values.Get("unreadOnly"); raw != "" {
		switch raw {
		case "true", "1":
			filter.UnreadOnly = true
		case "false", "0":
		default:
			return filter, fmt.Errorf("%w: unreadOnly is invalid", ErrInvalidInput)
		}
	}
	seen := map[string]bool{}
	for _, raw := range values["categories"] {
		for _, category := range strings.Split(raw, ",") {
			category = strings.TrimSpace(category)
			if category == "" {
				continue
			}
			switch category {
			case "leads", "whatsapp", "tasks", "system":
			default:
				return filter, fmt.Errorf("%w: notification category is invalid", ErrInvalidInput)
			}
			if !seen[category] {
				filter.Categories = append(filter.Categories, category)
				seen[category] = true
			}
		}
	}
	return filter, nil
}

// Keep this category precedence aligned with the notification list's existing labels.
const notificationCategorySQL = `case
 when lower(coalesce(type,'')) = 'message' or lower(coalesce(type,'')) like '%whatsapp%' then 'whatsapp'
 when lower(coalesce(type,'')) in ('task','schedule','reminder','lead_attention')
   or lower(coalesce(type,'')) ~ '(task|schedule|reminder|cadence|cadencia|agenda)' then 'tasks'
 when lower(coalesce(type,'')) ~ '(lead|deal)' then 'leads'
 else 'system' end`
