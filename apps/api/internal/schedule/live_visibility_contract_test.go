package schedule

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestLiveScheduleVisibilityContract(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	organizationID := os.Getenv("VIMOB_LIVE_SCHEDULE_ORGANIZATION_ID")
	userID := os.Getenv("VIMOB_LIVE_SCHEDULE_USER_ID")
	startRaw := os.Getenv("VIMOB_LIVE_SCHEDULE_START")
	endRaw := os.Getenv("VIMOB_LIVE_SCHEDULE_END")
	if databaseURL == "" || organizationID == "" || userID == "" || startRaw == "" || endRaw == "" {
		t.Skip("live schedule visibility environment is not configured")
	}

	start, err := time.Parse(time.RFC3339, startRaw)
	if err != nil {
		t.Fatalf("parse live schedule start: %v", err)
	}
	end, err := time.Parse(time.RFC3339, endRaw)
	if err != nil {
		t.Fatalf("parse live schedule end: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:           databaseURL,
		MaxConns:      2,
		HealthTimeout: 10 * time.Second,
	})
	if err != nil {
		t.Fatalf("connect live schedule database: %v", err)
	}
	defer postgres.Close()

	repo := NewRepository(postgres, nil)
	events, err := repo.List(ctx, tenant.Context{
		UserID:         userID,
		OrganizationID: organizationID,
		MemberRole:     "user",
		Permissions: []string{
			permissions.ScheduleView,
			permissions.LeadViewOwn,
			permissions.LeadViewTeam,
		},
	}, ListFilter{StartTime: &start, EndTime: &end})
	if err != nil {
		t.Fatalf("list live schedule events: %v", err)
	}
	if len(events) == 0 {
		t.Fatal("live schedule contract needs at least one event in the configured period")
	}

	maskedDefault := 0
	leaderDefaultDetails := 0
	publicDetails := 0
	privateParticipantEvents := 0

	for _, event := range events {
		participant := eventHasUser(event, userID)

		if event.IsMasked {
			maskedDefault++
			if event.Visibility != "default" {
				t.Fatalf("only default events may be masked, event %s is %s", event.ID, event.Visibility)
			}
			if event.UserID != nil || event.LeadID != nil || event.PropertyID != nil || len(event.AssigneeUserIDs) != 0 {
				t.Fatalf("masked event %s exposed private references", event.ID)
			}
			continue
		}

		switch event.Visibility {
		case "default":
			if !participant {
				leaderDefaultDetails++
			}
		case "public":
			publicDetails++
		case "private":
			privateParticipantEvents++
			if !participant {
				t.Fatalf("private event %s was exposed to a non-participant leader", event.ID)
			}
		}
	}

	t.Logf(
		"events=%d masked_default=%d leader_default_details=%d public_details=%d private_participant_events=%d",
		len(events),
		maskedDefault,
		leaderDefaultDetails,
		publicDetails,
		privateParticipantEvents,
	)
}

func eventHasUser(event Event, userID string) bool {
	if event.UserID != nil && *event.UserID == userID {
		return true
	}
	for _, assigneeID := range event.AssigneeUserIDs {
		if assigneeID == userID {
			return true
		}
	}
	return false
}
