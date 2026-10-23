package schedule

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/realtime"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestScheduleInvalidationDoesNotDisclosePrivateEventAcrossRolesOrTenants(t *testing.T) {
	for _, actorRole := range []string{"user", "leader", "admin"} {
		t.Run(actorRole, func(t *testing.T) {
			hub := realtime.NewHub()
			handler := NewHandler(Repository{}, hub)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			actor := tenant.Context{OrganizationID: "organization-a", UserID: "private-actor", MemberRole: actorRole,
				Permissions: []string{permissions.ScheduleView, permissions.ScheduleManage}}

			// The generic stream includes members with no Agenda permission, other
			// brokers, leaders and admins. None should get private associations.
			for _, viewer := range []string{"no-agenda", "other-broker", "other-leader", "admin"} {
				events, unsubscribe := hub.Subscribe(ctx, actor.OrganizationID, viewer)
				defer unsubscribe()
				otherTenantEvents, unsubscribeOther := hub.Subscribe(ctx, "organization-b", viewer)
				defer unsubscribeOther()
				leadID := "private-lead"
				handler.publishScheduleEvent(actor, "schedule.event.completed", "private-event", &leadID, map[string]any{
					"status": "no_show", "userId": "private-assignee", "commentId": "private-comment",
				})
				select {
				case event := <-events:
					if event.Type != "schedule.changed" || event.UserID != "" || len(event.Data) != 0 {
						t.Fatalf("private event reached %s: %#v", viewer, event)
					}
					encoded, err := json.Marshal(event)
					if err != nil || strings.Contains(string(encoded), "private-") || strings.Contains(string(encoded), "no_show") {
						t.Fatalf("serialized invalidation disclosed details: %s (%v)", encoded, err)
					}
				case <-time.After(time.Second):
					t.Fatal("expected schedule invalidation")
				}
				select {
				case event := <-otherTenantEvents:
					t.Fatalf("another organization received invalidation: %#v", event)
				default:
				}
			}
		})
	}
}
