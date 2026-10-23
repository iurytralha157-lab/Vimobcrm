package settings

import (
	"context"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/realtime"
)

const (
	avatarTestUser = "10000000-0000-4000-8000-000000000001"
	avatarTestOrgA = "20000000-0000-4000-8000-000000000001"
	avatarTestOrgB = "20000000-0000-4000-8000-000000000002"
)

type avatarAudienceFixture struct {
	organizations []string
	err           error
	ctx           context.Context
	query         string
	args          []any
	calls         int
}

func (fixture *avatarAudienceFixture) QueryRow(ctx context.Context, query string, args ...any) pgx.Row {
	fixture.ctx, fixture.query, fixture.args = ctx, query, args
	fixture.calls++
	return fixture
}

func (fixture *avatarAudienceFixture) Scan(dest ...any) error {
	if fixture.err != nil {
		return fixture.err
	}
	if err := fixture.ctx.Err(); err != nil {
		return err
	}
	*(dest[0].(*[]string)) = append([]string(nil), fixture.organizations...)
	return nil
}

func TestProfileAvatarAudienceReadsOnlyActiveMembershipsForAuthenticatedUser(t *testing.T) {
	fixture := &avatarAudienceFixture{organizations: []string{avatarTestOrgA, avatarTestOrgB}}
	organizations, err := loadProfileAvatarOrganizations(context.Background(), fixture, " "+strings.ToUpper(avatarTestUser)+" ")
	if err != nil || !reflect.DeepEqual(organizations, fixture.organizations) {
		t.Fatalf("unexpected audience: %v, %v", organizations, err)
	}
	if !reflect.DeepEqual(fixture.args, []any{avatarTestUser}) {
		t.Fatalf("the authenticated user must be the sole query argument: %v", fixture.args)
	}
	for _, required := range []string{
		"membership.user_id = $1::uuid", "membership.is_active = true",
		"membership.deleted_at is null", "usr.id = membership.user_id",
		"coalesce(usr.is_active, false) = true", "array_agg(distinct membership.organization_id::text",
	} {
		if !strings.Contains(fixture.query, required) {
			t.Fatalf("missing audience restriction %q", required)
		}
	}
	deadline, bounded := fixture.ctx.Deadline()
	if !bounded || time.Until(deadline) > profileAvatarAudienceTimeout {
		t.Fatalf("audience read must be bounded to %s", profileAvatarAudienceTimeout)
	}
}

func TestProfileAvatarAudienceRejectsInvalidUserBeforeRead(t *testing.T) {
	fixture := &avatarAudienceFixture{}
	_, err := loadProfileAvatarOrganizations(context.Background(), fixture, "not-a-user")
	if !errors.Is(err, ErrInvalidInput) || fixture.calls != 0 {
		t.Fatalf("invalid user performed an audience read: calls=%d err=%v", fixture.calls, err)
	}
}

func TestProfileAvatarAudienceDoesNotInventOrganizationAfterReadFailure(t *testing.T) {
	for _, reason := range []error{context.Canceled, errors.New("synthetic database failure")} {
		fixture := &avatarAudienceFixture{err: reason, organizations: []string{avatarTestOrgA}}
		organizations, err := loadProfileAvatarOrganizations(context.Background(), fixture, avatarTestUser)
		if !errors.Is(err, reason) || len(organizations) != 0 {
			t.Fatalf("failed read must not retain an audience: %v, %v", organizations, err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	fixture := &avatarAudienceFixture{organizations: []string{avatarTestOrgA}}
	organizations, err := loadProfileAvatarOrganizations(ctx, fixture, avatarTestUser)
	if !errors.Is(err, context.Canceled) || len(organizations) != 0 {
		t.Fatalf("cancelled read must not publish an audience: %v, %v", organizations, err)
	}
}

func TestPublishProfileAvatarChangedUsesOnlyExplicitAudienceAndNoPhotoData(t *testing.T) {
	publisher := &recordingPermissionPublisher{}
	handler := Handler{publisher: publisher}
	handler.publishProfileAvatarChanged(avatarTestUser, []string{
		avatarTestOrgA, avatarTestOrgB, strings.ToUpper(avatarTestOrgA), "", "not-an-org",
	})
	if len(publisher.events) != 2 {
		t.Fatalf("expected only the two distinct valid memberships, got %d", len(publisher.events))
	}
	for index, event := range publisher.events {
		expectedOrg := []string{avatarTestOrgA, avatarTestOrgB}[index]
		if event.Type != realtime.EventOrganizationUsersChanged || event.OrganizationID != expectedOrg ||
			event.UserID != avatarTestUser || event.AudienceUserID != "" {
			t.Fatalf("wrong event scope or audience: %#v", event)
		}
		if !reflect.DeepEqual(event.Data, map[string]any{"targetUserId": avatarTestUser, "changeKind": "avatar_updated"}) {
			t.Fatalf("event must contain IDs and change kind only: %#v", event.Data)
		}
	}
}

func TestPublishProfileAvatarChangedCannotBroadcastWithoutMembershipsOrValidUser(t *testing.T) {
	publisher := &recordingPermissionPublisher{}
	handler := Handler{publisher: publisher}
	handler.publishProfileAvatarChanged(avatarTestUser, nil)
	handler.publishProfileAvatarChanged("invalid", []string{avatarTestOrgA})
	handler.publishProfileAvatarChanged(avatarTestUser, []string{"none", "invalid"})
	Handler{}.publishProfileAvatarChanged(avatarTestUser, []string{avatarTestOrgA})
	if len(publisher.events) != 0 {
		t.Fatalf("invalid audiences produced %d events", len(publisher.events))
	}
}

func TestProfileAvatarHandlerPublishesAfterSuccessfulSaveWithoutChangingUploadResponse(t *testing.T) {
	source, err := os.ReadFile("handler.go")
	if err != nil {
		t.Fatal(err)
	}
	start := strings.Index(string(source), "func (handler Handler) UploadProfileAvatar(")
	end := strings.Index(string(source)[start:], "func (handler Handler) UpdateOrganization(")
	if start < 0 || end < 0 {
		t.Fatal("profile avatar handler not found")
	}
	body := string(source)[start : start+end]
	save := strings.Index(body, "uploaded, err := handler.repo.UploadProfileAvatar(")
	failure := strings.Index(body[save:], "if err != nil {") + save
	audience := strings.Index(body, "handler.repo.profileAvatarOrganizations(")
	publish := strings.Index(body, "handler.publishProfileAvatarChanged(")
	response := strings.Index(body, "http.StatusCreated, Envelope[AssetUpload]{Data: uploaded}")
	if save < 0 || failure <= save || audience <= failure || publish <= audience || response <= publish {
		t.Fatal("avatar event must follow successful save and preserve the created response")
	}
	if strings.Contains(body[audience:response], "writeSettingsError") || strings.Contains(body[audience:response], "audienceErr.Error()") {
		t.Fatal("realtime failure must neither reject the saved upload nor log database details")
	}
}
