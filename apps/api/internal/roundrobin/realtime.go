package roundrobin

import (
	"github.com/vimob-crm/vimob-crm/apps/api/internal/realtime"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// Membership and configuration changes invalidate claim capabilities in every
// open client. Each client re-reads its own scope; no queue/member IDs are sent.
func (handler Handler) publishQueueChanged(actor tenant.Context) {
	if handler.publisher != nil {
		handler.publisher.Publish(realtime.NewEvent("round_robin.changed", actor.OrganizationID, "", nil))
	}
}
