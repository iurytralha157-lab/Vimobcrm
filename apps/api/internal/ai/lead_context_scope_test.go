package ai

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestAIRunWithLeadIDRejectsMissingLeadScopeBeforeService(t *testing.T) {
	handler := Handler{}
	request := httptest.NewRequest(http.MethodPost, "/v1/ai/run", bytes.NewBufferString(`{
		"message":"resuma o lead",
		"leadId":"30000000-0000-4000-8000-000000000001"
	}`))
	request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{
		OrganizationID: "10000000-0000-4000-8000-000000000001",
		UserID:         "20000000-0000-4000-8000-000000000001",
		MemberRole:     "user",
		Permissions:    []string{permissions.SettingsAI, permissions.PropertyView},
	}))
	response := httptest.NewRecorder()

	handler.Run(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("AI lead-context status = %d, want %d", response.Code, http.StatusForbidden)
	}
}

func TestLoadLeadContextRejectsLeadIDWithoutLeadScopeBeforeDatabase(t *testing.T) {
	_, err := (Repository{}).LoadLeadContext(context.Background(), tenant.Context{
		OrganizationID: "10000000-0000-4000-8000-000000000001",
		UserID:         "20000000-0000-4000-8000-000000000001",
		Permissions:    []string{permissions.SettingsAI, permissions.PropertyView},
	}, "30000000-0000-4000-8000-000000000001", "resuma")
	if !errors.Is(err, ErrPermission) {
		t.Fatalf("lead context without lead permission error = %v, want ErrPermission", err)
	}
}

func TestAIServiceRejectsLeadIDWithoutLeadScopeBeforeRepository(t *testing.T) {
	_, err := (Service{}).Run(context.Background(), tenant.Context{
		OrganizationID: "10000000-0000-4000-8000-000000000001",
		UserID:         "20000000-0000-4000-8000-000000000001",
		Permissions:    []string{permissions.SettingsAI, permissions.PropertyView},
	}, RunRequest{
		Message: "resuma",
		LeadID:  "30000000-0000-4000-8000-000000000001",
	})
	if !errors.Is(err, ErrPermission) {
		t.Fatalf("service lead context without lead permission error = %v, want ErrPermission", err)
	}
}

func TestAILeadContextScopeAgainstLocalPostgresRollback(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("AI_PROPERTY_SCOPE_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set AI_PROPERTY_SCOPE_TEST_DATABASE_URL to run the local PostgreSQL scope test")
	}
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse AI_PROPERTY_SCOPE_TEST_DATABASE_URL: %v", err)
	}
	switch strings.ToLower(target.Hostname()) {
	case "localhost", "127.0.0.1", "::1":
	default:
		t.Fatalf("AI_PROPERTY_SCOPE_TEST_DATABASE_URL must point to loopback, got %q", target.Hostname())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL: databaseURL, MaxConns: 2, MinConns: 0, HealthTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("connect local PostgreSQL: %v", err)
	}
	t.Cleanup(postgres.Close)
	tx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatalf("begin rollback fixture: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	organizationID := insertAIScopeOrganization(t, ctx, tx, "AI lead scope "+suffix)
	otherOrganizationID := insertAIScopeOrganization(t, ctx, tx, "AI lead scope other "+suffix)
	actorID := insertAIScopeUser(t, ctx, tx, organizationID, "lead-actor-"+suffix)
	teammateID := insertAIScopeUser(t, ctx, tx, organizationID, "lead-teammate-"+suffix)
	outsiderID := insertAIScopeUser(t, ctx, tx, organizationID, "lead-outsider-"+suffix)
	otherUserID := insertAIScopeUser(t, ctx, tx, otherOrganizationID, "lead-other-"+suffix)

	var teamID string
	if err := tx.QueryRow(ctx, `
		insert into public.teams (organization_id, name, is_active)
		values ($1::uuid, $2, true)
		returning id::text
	`, organizationID, "AI lead scope team "+suffix).Scan(&teamID); err != nil {
		t.Fatalf("insert team fixture: %v", err)
	}
	if _, err := tx.Exec(ctx, `
		insert into public.team_members (organization_id, team_id, user_id, is_leader, is_active)
		values
			($1::uuid, $2::uuid, $3::uuid, true, true),
			($1::uuid, $2::uuid, $4::uuid, false, true)
	`, organizationID, teamID, actorID, teammateID); err != nil {
		t.Fatalf("insert team membership fixtures: %v", err)
	}

	ownLeadID := insertAILeadScopeLead(t, ctx, tx, organizationID, actorID, "", "own-"+suffix)
	teamLeadID := insertAILeadScopeLead(t, ctx, tx, organizationID, teammateID, teamID, "team-"+suffix)
	legacyTeamLeadID := insertAILeadScopeLead(t, ctx, tx, organizationID, teammateID, "", "legacy-team-"+suffix)
	outsiderLeadID := insertAILeadScopeLead(t, ctx, tx, organizationID, outsiderID, "", "outsider-"+suffix)
	otherOrganizationLeadID := insertAILeadScopeLead(t, ctx, tx, otherOrganizationID, otherUserID, "", "other-"+suffix)

	ownContext := tenant.Context{OrganizationID: organizationID, UserID: actorID, MemberRole: "user", Permissions: []string{permissions.LeadViewOwn}}
	teamContext := tenant.Context{OrganizationID: organizationID, UserID: actorID, MemberRole: "user", Permissions: []string{permissions.LeadViewTeam}}
	allContext := tenant.Context{OrganizationID: organizationID, UserID: actorID, MemberRole: "user", Permissions: []string{permissions.LeadViewAll}}
	cases := []struct {
		name    string
		context tenant.Context
		leadID  string
		allowed bool
	}{
		{name: "own", context: ownContext, leadID: ownLeadID, allowed: true},
		{name: "own rejects outsider", context: ownContext, leadID: outsiderLeadID},
		{name: "team explicit", context: teamContext, leadID: teamLeadID, allowed: true},
		{name: "team legacy assignee", context: teamContext, leadID: legacyTeamLeadID, allowed: true},
		{name: "team rejects outsider", context: teamContext, leadID: outsiderLeadID},
		{name: "all same organization", context: allContext, leadID: outsiderLeadID, allowed: true},
		{name: "all rejects other organization", context: allContext, leadID: otherOrganizationLeadID},
	}
	repository := Repository{}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			lead, err := repository.loadLeadWithQueryer(ctx, tx, test.context, test.leadID)
			if !test.allowed {
				if !errors.Is(err, ErrInvalidInput) {
					t.Fatalf("invisible lead error = %v, want ErrInvalidInput", err)
				}
				if len(lead) != 0 {
					t.Fatalf("invisible lead PII returned: %#v", lead)
				}
				return
			}
			if err != nil {
				t.Fatalf("load visible lead: %v", err)
			}
			if lead["email"] != "pii-"+test.leadID+"@example.test" || lead["phone"] != "private-phone-"+test.leadID {
				t.Fatalf("visible lead payload = %#v", lead)
			}
			activities, err := repository.loadLeadActivitiesWithQueryer(ctx, tx, test.context, test.leadID)
			if err != nil {
				t.Fatalf("load visible lead activities: %v", err)
			}
			if len(activities) != 1 || activities[0]["content"] != "private-activity-"+test.leadID {
				t.Fatalf("visible lead activities = %#v", activities)
			}
			metadata, ok := activities[0]["metadata"].(map[string]any)
			if !ok || metadata["private"] != true {
				t.Fatalf("visible lead activity metadata = %#v", activities[0]["metadata"])
			}
			if _, leaked := metadata["commission_percentage"]; leaked {
				t.Fatalf("AI activity leaked managed commission: %#v", metadata)
			}
		})
	}
	managerContext := tenant.Context{
		OrganizationID: organizationID,
		UserID:         actorID,
		MemberRole:     "user",
		Permissions:    []string{permissions.LeadViewAll, permissions.PropertyManage},
	}
	managerActivities, err := repository.loadLeadActivitiesWithQueryer(ctx, tx, managerContext, outsiderLeadID)
	if err != nil {
		t.Fatalf("load manager activities: %v", err)
	}
	managerMetadata, ok := managerActivities[0]["metadata"].(map[string]any)
	if !ok || managerMetadata["commission_percentage"] != "7.5" {
		t.Fatalf("manager activity metadata = %#v", managerActivities[0]["metadata"])
	}

	if err := tx.Rollback(ctx); err != nil {
		t.Fatalf("rollback AI lead scope fixtures: %v", err)
	}
	var fixtureExists bool
	if err := postgres.Pool().QueryRow(ctx, `select exists(select 1 from public.organizations where id = $1::uuid)`, organizationID).Scan(&fixtureExists); err != nil {
		t.Fatalf("verify fixture rollback: %v", err)
	}
	if fixtureExists {
		t.Fatal("AI lead scope fixture survived rollback")
	}
}

func insertAILeadScopeLead(t *testing.T, ctx context.Context, tx pgx.Tx, organizationID string, assignedUserID string, teamID string, label string) string {
	t.Helper()
	var id string
	if err := tx.QueryRow(ctx, `
		insert into public.leads (
			organization_id, assigned_user_id, team_id, name, email, phone,
			source, message, status, deal_status
		)
		values (
			$1::uuid, $2::uuid, nullif($3, '')::uuid, $4,
			'pending', null, 'manual', $4, 'active', 'open'
		)
		returning id::text
	`, organizationID, assignedUserID, teamID, label).Scan(&id); err != nil {
		t.Fatalf("insert lead fixture %q: %v", label, err)
	}
	if _, err := tx.Exec(ctx, `
		update public.leads
		set email = $2,
		    phone = $3
		where id = $1::uuid
	`, id, "pii-"+id+"@example.test", "private-phone-"+id); err != nil {
		t.Fatalf("set lead PII fixture: %v", err)
	}
	if _, err := tx.Exec(ctx, `
		insert into public.activities (organization_id, lead_id, user_id, type, content, metadata)
		values (
			$1::uuid, $2::uuid, $3::uuid, 'note', $4,
			jsonb_build_object('private', true, 'commission_percentage', '7.5')
		)
	`, organizationID, id, assignedUserID, "private-activity-"+id); err != nil {
		t.Fatalf("insert lead activity fixture: %v", err)
	}
	return id
}
