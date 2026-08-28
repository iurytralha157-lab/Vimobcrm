package leads

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	notificationTestOrganizationID = "11111111-1111-4111-8111-111111111111"
	notificationTestUserID         = "22222222-2222-4222-8222-222222222222"
	notificationTestRecipientID    = "33333333-3333-4333-8333-333333333333"
)

func TestPublicNotificationDispatchBlocksForgedSelfExternalDelivery(t *testing.T) {
	t.Parallel()

	member := tenant.Context{
		UserID:         notificationTestUserID,
		OrganizationID: notificationTestOrganizationID,
		MemberRole:     "user",
	}

	for _, channel := range []string{"email", "whatsapp"} {
		channel := channel
		t.Run(channel, func(t *testing.T) {
			t.Parallel()

			_, err := (Repository{}).DispatchNotification(context.Background(), member, DispatchNotificationRequest{
				EventKey: "deal_won",
				UserID:   notificationTestUserID,
				Channels: []string{channel},
			})
			if !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
				t.Fatalf("self-dispatch through %s error = %v, want permission denied", channel, err)
			}
		})
	}

	_, err := (Repository{}).DispatchNotification(context.Background(), member, DispatchNotificationRequest{
		EventKey: "deal_won",
		UserID:   notificationTestUserID,
	})
	if !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("self-dispatch with default external channels error = %v, want permission denied", err)
	}
}

func TestPlatformTransactionalNotificationsAreBackendOnly(t *testing.T) {
	t.Parallel()

	manager := tenant.Context{
		UserID:         notificationTestUserID,
		OrganizationID: notificationTestOrganizationID,
		MemberRole:     "owner",
	}

	for _, eventKey := range []string{
		"onboarding_welcome",
		"onboarding_email_confirmation",
		"billing_payment_receipt",
		" BILLING_due_today ",
	} {
		eventKey := eventKey
		t.Run(eventKey, func(t *testing.T) {
			t.Parallel()

			_, dispatchErr := (Repository{}).DispatchNotification(context.Background(), manager, DispatchNotificationRequest{
				EventKey: eventKey,
				UserID:   notificationTestUserID,
				Channels: []string{"system"},
			})
			if !errors.Is(dispatchErr, tenant.ErrOrganizationAccessDenied) {
				t.Fatalf("public dispatch for %q error = %v, want permission denied", eventKey, dispatchErr)
			}

			_, createErr := (Repository{}).CreateNotification(context.Background(), manager, CreateNotificationRequest{
				UserID: notificationTestUserID,
				Title:  "Forged transactional notification",
				Type:   "info",
				Metadata: map[string]any{
					"event_key": eventKey,
				},
			})
			if !errors.Is(createErr, tenant.ErrOrganizationAccessDenied) {
				t.Fatalf("public create for %q error = %v, want permission denied", eventKey, createErr)
			}
		})
	}

	_, err := (Repository{}).CreateNotification(context.Background(), manager, CreateNotificationRequest{
		UserID: notificationTestUserID,
		Title:  "Forged billing notification through type",
		Type:   "billing_payment_receipt",
	})
	if !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("public create with a transactional type error = %v, want permission denied", err)
	}
}

func TestPublicNotificationDispatchAllowsAuthorizedExternalChannels(t *testing.T) {
	t.Parallel()

	authorized := tenant.Context{
		UserID:         notificationTestUserID,
		OrganizationID: notificationTestOrganizationID,
		Permissions:    []string{permissions.WhatsAppManage},
	}
	if err := authorizePublicNotificationDispatch(
		authorized,
		"deal_won",
		notificationTestRecipientID,
		[]string{"system", "email", "whatsapp"},
	); err != nil {
		t.Fatalf("authorized external dispatch was rejected: %v", err)
	}
}

func TestPublicNotificationDispatchKeepsSelfSystemAndPushChannels(t *testing.T) {
	t.Parallel()

	member := tenant.Context{
		UserID:         notificationTestUserID,
		OrganizationID: notificationTestOrganizationID,
		MemberRole:     "user",
	}

	for _, channels := range [][]string{
		{"system"},
		{"push"},
		{"system", "push"},
		nil,
	} {
		eventKey := "deal_won"
		if channels == nil {
			// This event supports only in-app/push delivery, so the default
			// channel expansion remains safe for a regular member.
			eventKey = "gamification_update"
		}
		if err := authorizePublicNotificationDispatch(member, eventKey, notificationTestUserID, channels); err != nil {
			t.Fatalf("self system/push dispatch for %q with %#v was rejected: %v", eventKey, channels, err)
		}
	}
}

func TestCreateNotificationValidatesActiveRecipientMembershipBeforeInsert(t *testing.T) {
	t.Parallel()

	source, err := os.ReadFile("support_resources.go")
	if err != nil {
		t.Fatalf("read support_resources.go: %v", err)
	}
	all := string(source)
	start := strings.Index(all, "func (repo Repository) CreateNotification(")
	end := strings.Index(all, "func (repo Repository) DispatchNotification(")
	if start < 0 || end <= start {
		t.Fatal("could not isolate CreateNotification implementation")
	}
	scope := all[start:end]
	membershipCheck := strings.Index(scope, "repo.getNotificationRecipient(ctx, organizationID, userID)")
	insert := strings.Index(scope, "insert into public.notifications")
	if membershipCheck < 0 {
		t.Fatal("CreateNotification does not validate the recipient's active organization membership")
	}
	if insert < 0 || membershipCheck > insert {
		t.Fatal("recipient membership must be validated before notification insertion")
	}
}
