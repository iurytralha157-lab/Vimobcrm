package whatsapp

import (
	"sort"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/realtime"
)

// publishNativeLeadChanges emits only tenant and lead identifiers after the
// native webhook transaction commits. Conversation and message contents stay
// on their dedicated, permission-scoped realtime channel.
func (repo Repository) publishNativeLeadChanges(organizationID string, leadIDs map[string]struct{}) {
	organizationID = strings.TrimSpace(organizationID)
	if organizationID == "" || len(leadIDs) == 0 || repo.leadPublisher == nil {
		return
	}

	orderedIDs := make([]string, 0, len(leadIDs))
	for leadID := range leadIDs {
		if leadID = strings.TrimSpace(leadID); leadID != "" {
			orderedIDs = append(orderedIDs, leadID)
		}
	}
	sort.Strings(orderedIDs)

	for _, leadID := range orderedIDs {
		repo.leadPublisher.Publish(realtime.NewEvent(
			"lead.whatsapp_activity",
			organizationID,
			"",
			map[string]any{"leadId": leadID},
		))
	}
}
