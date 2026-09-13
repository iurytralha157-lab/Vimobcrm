package ai

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/propertyscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestAIPropertyVisibilityAgainstLocalPostgresRollback(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("AI_PROPERTY_SCOPE_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set AI_PROPERTY_SCOPE_TEST_DATABASE_URL to run the local PostgreSQL scope test")
	}
	parsedURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse AI_PROPERTY_SCOPE_TEST_DATABASE_URL: %v", err)
	}
	switch strings.ToLower(parsedURL.Hostname()) {
	case "localhost", "127.0.0.1", "::1":
	default:
		t.Fatalf("AI_PROPERTY_SCOPE_TEST_DATABASE_URL must point to loopback, got %q", parsedURL.Hostname())
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
	organizationID := insertAIScopeOrganization(t, ctx, tx, "AI property scope "+suffix)
	otherOrganizationID := insertAIScopeOrganization(t, ctx, tx, "AI property scope other "+suffix)
	actorID := insertAIScopeUser(t, ctx, tx, organizationID, "actor-"+suffix)
	teammateID := insertAIScopeUser(t, ctx, tx, organizationID, "teammate-"+suffix)
	outsiderID := insertAIScopeUser(t, ctx, tx, organizationID, "outsider-"+suffix)
	neutralID := insertAIScopeUser(t, ctx, tx, organizationID, "neutral-"+suffix)
	otherUserID := insertAIScopeUser(t, ctx, tx, otherOrganizationID, "other-"+suffix)

	var teamID string
	if err := tx.QueryRow(ctx, `
		insert into public.teams (organization_id, name, is_active)
		values ($1::uuid, $2, true)
		returning id::text
	`, organizationID, "AI property scope team "+suffix).Scan(&teamID); err != nil {
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

	ownResponsible := "AI-OWN-RESP-" + suffix
	ownCreated := "AI-OWN-CREATED-" + suffix
	teamResponsible := "AI-TEAM-RESP-" + suffix
	teamCreated := "AI-TEAM-CREATED-" + suffix
	outsider := "AI-OUTSIDER-" + suffix
	otherOrganization := "AI-OTHER-ORG-" + suffix
	insertAIScopeProperty(t, ctx, tx, organizationID, ownResponsible, actorID, neutralID, "active", false)
	insertAIScopeProperty(t, ctx, tx, organizationID, ownCreated, neutralID, actorID, "active", false)
	insertAIScopeProperty(t, ctx, tx, organizationID, teamResponsible, teammateID, neutralID, "active", false)
	insertAIScopeProperty(t, ctx, tx, organizationID, teamCreated, neutralID, teammateID, "active", false)
	insertAIScopeProperty(t, ctx, tx, organizationID, outsider, outsiderID, neutralID, "active", false)
	insertAIScopeProperty(t, ctx, tx, otherOrganizationID, otherOrganization, otherUserID, otherUserID, "active", false)
	insertAIScopeProperty(t, ctx, tx, organizationID, "AI-INACTIVE-"+suffix, actorID, actorID, "inactive", false)
	insertAIScopeProperty(t, ctx, tx, organizationID, "AI-DEMO-"+suffix, actorID, actorID, "active", true)

	ownOnly := []string{ownCreated, ownResponsible}
	teamScope := []string{ownCreated, ownResponsible, teamCreated, teamResponsible}
	organizationScope := []string{outsider, ownCreated, ownResponsible, teamCreated, teamResponsible}
	tests := []struct {
		name    string
		context tenant.Context
		want    []string
	}{
		{
			name: "property_view is own via responsible or creator",
			context: tenant.Context{OrganizationID: organizationID, UserID: actorID, MemberRole: "user",
				Permissions: []string{permissions.PropertyView}},
			want: ownOnly,
		},
		{
			name: "active leader sees active teammates",
			context: tenant.Context{OrganizationID: organizationID, UserID: actorID, MemberRole: "user",
				Permissions: []string{permissions.PropertyView}, IsTeamLeader: true},
			want: teamScope,
		},
		{
			name: "outsider remains own scoped",
			context: tenant.Context{OrganizationID: organizationID, UserID: outsiderID, MemberRole: "user",
				Permissions: []string{permissions.PropertyView}},
			want: []string{outsider},
		},
		{
			name: "property_manage sees the organization but never another organization",
			context: tenant.Context{OrganizationID: organizationID, UserID: actorID, MemberRole: "user",
				Permissions: []string{permissions.PropertyManage}},
			want: organizationScope,
		},
		{
			name: "legacy all alias resolves to own without widening",
			context: tenant.Context{OrganizationID: organizationID, UserID: actorID, MemberRole: "user",
				Permissions: []string{"property_view_all"}},
			want: ownOnly,
		},
		{
			name: "legacy team alias resolves to own without widening",
			context: tenant.Context{OrganizationID: organizationID, UserID: actorID, MemberRole: "user",
				Permissions: []string{"property_view_team"}},
			want: ownOnly,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := queryAIScopedPropertyCodes(t, ctx, tx, test.context)
			want := slices.Clone(test.want)
			slices.Sort(want)
			if !slices.Equal(got, want) {
				t.Fatalf("visible property codes = %#v, want %#v", got, want)
			}
			if slices.Contains(got, otherOrganization) {
				t.Fatalf("cross-organization property leaked: %#v", got)
			}
		})
	}

	if err := tx.Rollback(ctx); err != nil {
		t.Fatalf("rollback AI property scope fixtures: %v", err)
	}
	var fixtureExists bool
	if err := postgres.Pool().QueryRow(ctx, `
		select exists (select 1 from public.organizations where id = $1::uuid)
	`, organizationID).Scan(&fixtureExists); err != nil {
		t.Fatalf("verify scope fixture rollback: %v", err)
	}
	if fixtureExists {
		t.Fatal("AI property scope fixture survived rollback")
	}
}

func queryAIScopedPropertyCodes(t *testing.T, ctx context.Context, tx pgx.Tx, tenantContext tenant.Context) []string {
	t.Helper()
	rows, err := tx.Query(ctx, `
		select p.code
		from public.properties p
		where p.organization_id = $1::uuid
		  and coalesce(p.is_demo, false) = false
		  and lower(coalesce(p.status, 'ativo')) in ('ativo', 'active')
		  and `+propertyscope.VisibilitySQL("p", "$2", "$3", "$4")+`
		order by p.code
	`, tenantContext.OrganizationID, propertyscope.CanViewAll(tenantContext), tenantContext.UserID, propertyscope.CanViewTeam(tenantContext))
	if err != nil {
		t.Fatalf("query scoped properties: %v", err)
	}
	defer rows.Close()
	codes := []string{}
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			t.Fatalf("scan scoped property: %v", err)
		}
		codes = append(codes, code)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate scoped properties: %v", err)
	}
	return codes
}

func insertAIScopeOrganization(t *testing.T, ctx context.Context, tx pgx.Tx, name string) string {
	t.Helper()
	var id string
	if err := tx.QueryRow(ctx, `
		insert into public.organizations (name, is_active)
		values ($1, true)
		returning id::text
	`, name).Scan(&id); err != nil {
		t.Fatalf("insert organization fixture: %v", err)
	}
	return id
}

func insertAIScopeUser(t *testing.T, ctx context.Context, tx pgx.Tx, organizationID string, label string) string {
	t.Helper()
	var id string
	if err := tx.QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&id); err != nil {
		t.Fatalf("generate user fixture id: %v", err)
	}
	email := label + "@example.test"
	if _, err := tx.Exec(ctx, `
		insert into auth.users (
			id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		)
		values (
			$1::uuid, 'authenticated', 'authenticated', $2, '', now(),
			'{}'::jsonb, '{}'::jsonb, now(), now()
		)
	`, id, email); err != nil {
		t.Fatalf("insert auth user fixture: %v", err)
	}
	commandTag, err := tx.Exec(ctx, `
		update public.users
		set email = $2, name = $3, organization_id = $4::uuid, is_active = true
		where id = $1::uuid
	`, id, email, label, organizationID)
	if err != nil {
		t.Fatalf("update auth-created user fixture: %v", err)
	}
	if commandTag.RowsAffected() != 1 {
		t.Fatalf("update auth-created user fixture affected %d rows, want 1", commandTag.RowsAffected())
	}
	return id
}

func insertAIScopeProperty(
	t *testing.T,
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	code string,
	responsibleUserID string,
	createdBy string,
	status string,
	isDemo bool,
) {
	t.Helper()
	if _, err := tx.Exec(ctx, `
		insert into public.properties (
			organization_id, code, title, tipo_de_negocio, status,
			responsible_user_id, created_by, is_demo
		)
		values ($1::uuid, $2, $2, 'venda', $5, $3::uuid, $4::uuid, $6)
	`, organizationID, code, responsibleUserID, createdBy, status, isDemo); err != nil {
		t.Fatalf("insert property fixture %q: %v", code, err)
	}
}
