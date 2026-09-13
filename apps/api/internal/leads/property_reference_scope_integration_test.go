package leads

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestLeadPropertyReferencesRespectCanonicalScopeWithRollback(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("LEAD_PROPERTY_SCOPE_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set LEAD_PROPERTY_SCOPE_TEST_DATABASE_URL to run the local PostgreSQL scope test")
	}
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse LEAD_PROPERTY_SCOPE_TEST_DATABASE_URL: %v", err)
	}
	switch strings.ToLower(target.Hostname()) {
	case "localhost", "127.0.0.1", "::1":
	default:
		t.Fatalf("LEAD_PROPERTY_SCOPE_TEST_DATABASE_URL must point to loopback, got %q", target.Hostname())
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
	organizationID := insertLeadPropertyScopeOrganization(t, ctx, tx, "Lead property scope "+suffix)
	otherOrganizationID := insertLeadPropertyScopeOrganization(t, ctx, tx, "Lead property scope other "+suffix)
	actorID := insertLeadPropertyScopeUser(t, ctx, tx, organizationID, "actor-"+suffix)
	teammateID := insertLeadPropertyScopeUser(t, ctx, tx, organizationID, "teammate-"+suffix)
	outsiderID := insertLeadPropertyScopeUser(t, ctx, tx, organizationID, "outsider-"+suffix)
	neutralID := insertLeadPropertyScopeUser(t, ctx, tx, organizationID, "neutral-"+suffix)
	otherUserID := insertLeadPropertyScopeUser(t, ctx, tx, otherOrganizationID, "other-"+suffix)

	var teamID string
	if err := tx.QueryRow(ctx, `
		insert into public.teams (organization_id, name, is_active)
		values ($1::uuid, $2, true)
		returning id::text
	`, organizationID, "Lead property scope team "+suffix).Scan(&teamID); err != nil {
		t.Fatalf("insert team fixture: %v", err)
	}
	if _, err := tx.Exec(ctx, `
		insert into public.team_members (organization_id, team_id, user_id, is_leader, is_active)
		values
			($1::uuid, $2::uuid, $3::uuid, true, true),
			($1::uuid, $2::uuid, $4::uuid, false, true)
	`, organizationID, teamID, actorID, teammateID); err != nil {
		t.Fatalf("insert team fixtures: %v", err)
	}

	ownResponsibleID := insertLeadPropertyScopeProperty(t, ctx, tx, organizationID, "LEAD-OWN-RESP-"+suffix, actorID, neutralID)
	ownCreatedID := insertLeadPropertyScopeProperty(t, ctx, tx, organizationID, "LEAD-OWN-CREATED-"+suffix, neutralID, actorID)
	teamResponsibleID := insertLeadPropertyScopeProperty(t, ctx, tx, organizationID, "LEAD-TEAM-RESP-"+suffix, teammateID, neutralID)
	teamCreatedID := insertLeadPropertyScopeProperty(t, ctx, tx, organizationID, "LEAD-TEAM-CREATED-"+suffix, neutralID, teammateID)
	outsiderPropertyID := insertLeadPropertyScopeProperty(t, ctx, tx, organizationID, "LEAD-OUTSIDER-"+suffix, outsiderID, neutralID)
	otherOrganizationPropertyID := insertLeadPropertyScopeProperty(t, ctx, tx, otherOrganizationID, "LEAD-OTHER-"+suffix, otherUserID, otherUserID)
	if _, err := tx.Exec(ctx, `update public.properties set preco = 0 where id = any($1::uuid[])`, []string{ownResponsibleID, outsiderPropertyID}); err != nil {
		t.Fatalf("prepare managed commercial-value fixtures: %v", err)
	}

	repository := Repository{}
	ownContext := tenant.Context{OrganizationID: organizationID, UserID: actorID, MemberRole: "user", Permissions: []string{permissions.PropertyView, permissions.LeadOperate}}
	teamContext := ownContext
	teamContext.IsTeamLeader = true
	manageContext := ownContext
	manageContext.Permissions = []string{permissions.PropertyManage, permissions.LeadOperate}

	cases := []struct {
		name       string
		context    tenant.Context
		propertyID string
		allowed    bool
	}{
		{name: "own responsible", context: ownContext, propertyID: ownResponsibleID, allowed: true},
		{name: "own creator", context: ownContext, propertyID: ownCreatedID, allowed: true},
		{name: "leader teammate responsible", context: teamContext, propertyID: teamResponsibleID, allowed: true},
		{name: "leader teammate creator", context: teamContext, propertyID: teamCreatedID, allowed: true},
		{name: "own scope rejects outsider", context: ownContext, propertyID: outsiderPropertyID},
		{name: "team scope rejects outsider", context: teamContext, propertyID: outsiderPropertyID},
		{name: "all scope accepts same organization", context: manageContext, propertyID: outsiderPropertyID, allowed: true},
		{name: "all scope rejects another organization", context: manageContext, propertyID: otherOrganizationPropertyID},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			err := repository.validateProperty(ctx, tx, test.context, &test.propertyID)
			if test.allowed && err != nil {
				t.Fatalf("visible property rejected: %v", err)
			}
			if !test.allowed && !errors.Is(err, ErrInvalidReference) {
				t.Fatalf("invisible property error = %v, want ErrInvalidReference", err)
			}
		})
	}

	commercialInput := updateInput{PropertyID: patchString{Set: true, Value: &outsiderPropertyID}}
	if err := repository.applySelectedPropertyCommercialValues(ctx, tx, ownContext, leadSnapshot{}, &commercialInput); !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("invisible commercial property read error = %v, want ErrInvalidReference", err)
	}
	if commercialInput.InterestValue.Set || commercialInput.CommissionPercentage.Set {
		t.Fatalf("invisible appraisal or commission was copied: %#v", commercialInput)
	}
	viewerInput := updateInput{PropertyID: patchString{Set: true, Value: &ownResponsibleID}}
	if err := repository.applySelectedPropertyCommercialValues(ctx, tx, ownContext, leadSnapshot{}, &viewerInput); err != nil {
		t.Fatalf("read viewer-safe commercial values: %v", err)
	}
	if !viewerInput.InterestValue.Set || viewerInput.InterestValue.Value != nil || viewerInput.CommissionPercentage.Set {
		t.Fatalf("viewer received managed appraisal or commission fallback: %#v", viewerInput)
	}
	managerInput := updateInput{PropertyID: patchString{Set: true, Value: &outsiderPropertyID}}
	if err := repository.applySelectedPropertyCommercialValues(ctx, tx, manageContext, leadSnapshot{}, &managerInput); err != nil {
		t.Fatalf("read manager commercial values: %v", err)
	}
	if managerInput.InterestValue.Value == nil || *managerInput.InterestValue.Value != "987654" || managerInput.CommissionPercentage.Value == nil || *managerInput.CommissionPercentage.Value != "7.5" {
		t.Fatalf("manager commercial values = %#v", managerInput)
	}

	var consumerLeadID string
	if err := tx.QueryRow(ctx, `
		insert into public.leads (
			organization_id, assigned_user_id, name, source, status, deal_status,
			property_id, valor_interesse
		)
		values ($1::uuid, $2::uuid, $3, 'manual', 'active', 'open', $4::uuid, 0)
		returning id::text
	`, organizationID, actorID, "property-consumer-"+suffix, outsiderPropertyID).Scan(&consumerLeadID); err != nil {
		t.Fatalf("insert scoped property consumer lead: %v", err)
	}

	assertProjectedProperty := func(t *testing.T, tenantContext tenant.Context, propertyID string, wantVisible bool) {
		t.Helper()
		args := []any{organizationID, consumerLeadID}
		args, visibility := appendCanonicalPropertyVisibility(args, tenantContext, "visible_property")
		var projected pgtype.Text
		if err := tx.QueryRow(ctx, `
			select `+pipelineBoardVisiblePropertyIDSQL("property_id", visibility)+`
			from public.leads l
			where l.organization_id = $1::uuid and l.id = $2::uuid
		`, args...).Scan(&projected); err != nil {
			t.Fatalf("project pipeline property reference: %v", err)
		}
		if projected.Valid != wantVisible || (wantVisible && projected.String != propertyID) {
			t.Fatalf("pipeline property projection = %#v, want visible=%t id=%q", projected, wantVisible, propertyID)
		}
	}
	assertProjectedProperty(t, ownContext, outsiderPropertyID, false)
	assertProjectedProperty(t, manageContext, outsiderPropertyID, true)

	assertEnrichedProperty := func(t *testing.T, tenantContext tenant.Context, propertyID string, wantVisible bool) {
		t.Helper()
		args := []any{organizationID}
		args, visibility := appendCanonicalPropertyVisibility(args, tenantContext, "property")
		args = append(args, propertyID)
		var projected pgtype.Text
		err := tx.QueryRow(ctx, `
			select property.id::text
			from public.properties property
			where property.organization_id = $1::uuid
			  and `+visibility+`
			  and property.id = $5::uuid
		`, args...).Scan(&projected)
		if !wantVisible {
			if !errors.Is(err, pgx.ErrNoRows) {
				t.Fatalf("invisible enrichment property error = %v, want pgx.ErrNoRows", err)
			}
			return
		}
		if err != nil || !projected.Valid || projected.String != propertyID {
			t.Fatalf("visible enrichment property = %#v, error %v", projected, err)
		}
	}
	assertEnrichedProperty(t, ownContext, outsiderPropertyID, false)
	assertEnrichedProperty(t, manageContext, outsiderPropertyID, true)

	assertDashboardValue := func(t *testing.T, tenantContext tenant.Context, want float64) {
		t.Helper()
		args := []any{organizationID, consumerLeadID}
		args, visibility := appendCanonicalPropertyVisibility(args, tenantContext, "p")
		var value float64
		if err := tx.QueryRow(ctx, `
			select `+dashboardPropertyValueSQL(tenantContext)+`
			from public.leads l
			left join public.properties p
			  on p.organization_id = l.organization_id
			 and p.id = coalesce(l.interest_property_id, l.property_id)
			 and `+visibility+`
			where l.organization_id = $1::uuid and l.id = $2::uuid
		`, args...).Scan(&value); err != nil {
			t.Fatalf("read scoped dashboard value: %v", err)
		}
		if value != want {
			t.Fatalf("dashboard property value = %v, want %v", value, want)
		}
	}
	assertDashboardValue(t, ownContext, 0)
	assertDashboardValue(t, manageContext, 987654)

	viewerActivityInput := updateInput{PropertyID: patchString{Set: true, Value: &ownResponsibleID}}
	if err := repository.insertLeadUpdateActivities(ctx, tx, ownContext, leadSnapshot{ID: consumerLeadID}, viewerActivityInput); err != nil {
		t.Fatalf("insert viewer property-selected activity: %v", err)
	}
	managerActivityInput := updateInput{PropertyID: patchString{Set: true, Value: &outsiderPropertyID}}
	if err := repository.insertLeadUpdateActivities(ctx, tx, manageContext, leadSnapshot{ID: consumerLeadID}, managerActivityInput); err != nil {
		t.Fatalf("insert manager property-selected activity: %v", err)
	}
	var viewerHasCommission, managerHasCommission bool
	if err := tx.QueryRow(ctx, `
		select
			coalesce(bool_or(metadata ? 'commission_percentage') filter (where metadata->>'property_id' = $2), false),
			coalesce(bool_or(metadata ? 'commission_percentage') filter (where metadata->>'property_id' = $3), false)
		from public.activities
		where organization_id = $1::uuid and lead_id = $4::uuid and type = 'property_selected'
	`, organizationID, ownResponsibleID, outsiderPropertyID, consumerLeadID).Scan(&viewerHasCommission, &managerHasCommission); err != nil {
		t.Fatalf("read property-selected activity metadata: %v", err)
	}
	if viewerHasCommission || !managerHasCommission {
		t.Fatalf("activity commission flags viewer=%t manager=%t, want false/true", viewerHasCommission, managerHasCommission)
	}
	activityArgs := []any{organizationID, consumerLeadID, outsiderPropertyID}
	activityArgs, activityPropertyVisibility := appendCanonicalPropertyVisibility(activityArgs, ownContext, "activity_property")
	var redactedActivityMetadata, redactedActivityContent string
	if err := tx.QueryRow(ctx, `
		select
			(`+activityMetadataSQL(ownContext, "activity_property.id is not null")+`)::text,
			`+activityContentSQL("activity_property.id is not null")+`
		from public.activities a
		left join public.properties activity_property
		  on activity_property.organization_id = a.organization_id
		 and activity_property.id::text = `+activityPropertyReferenceSQL()+`
		 and `+activityPropertyVisibility+`
		where a.organization_id = $1::uuid
		  and a.lead_id = $2::uuid
		  and a.metadata->>'property_id' = $3
		limit 1
	`, activityArgs...).Scan(&redactedActivityMetadata, &redactedActivityContent); err != nil {
		t.Fatalf("read redacted legacy activity metadata: %v", err)
	}
	for _, forbidden := range []string{outsiderPropertyID, "commission_percentage", "property_title", "property_code", "property_price"} {
		if strings.Contains(redactedActivityMetadata, forbidden) {
			t.Fatalf("viewer activity metadata exposes %q: %s", forbidden, redactedActivityMetadata)
		}
	}
	if redactedActivityContent != "Imovel selecionado" {
		t.Fatalf("viewer activity content = %q, want generic property selection", redactedActivityContent)
	}
	if strings.TrimSpace(redactedActivityMetadata) == "" {
		t.Fatalf("viewer activity metadata redaction = %s", redactedActivityMetadata)
	}

	won := "won"
	reservation, err := repository.lockWonLeadPropertyForUpdate(ctx, tx, ownContext, leadSnapshot{
		ID:                 "40000000-0000-4000-8000-000000000001",
		DealStatus:         "open",
		InterestPropertyID: outsiderPropertyID,
	}, updateInput{DealStatus: patchString{Set: true, Value: &won}})
	if !errors.Is(err, ErrInvalidReference) || reservation != nil {
		t.Fatalf("invisible won reservation = %#v, error %v", reservation, err)
	}
	var status string
	var publishedOnSite, announce bool
	if err := tx.QueryRow(ctx, `
		select status, published_on_site, anunciar
		from public.properties
		where id = $1::uuid
	`, outsiderPropertyID).Scan(&status, &publishedOnSite, &announce); err != nil {
		t.Fatalf("read rejected won property state: %v", err)
	}
	if status != "active" || !publishedOnSite || !announce {
		t.Fatalf("rejected won changed property/publication state: status=%q published=%t announce=%t", status, publishedOnSite, announce)
	}

	if err := tx.Rollback(ctx); err != nil {
		t.Fatalf("rollback lead property scope fixtures: %v", err)
	}
	var fixtureExists bool
	if err := postgres.Pool().QueryRow(ctx, `select exists(select 1 from public.organizations where id = $1::uuid)`, organizationID).Scan(&fixtureExists); err != nil {
		t.Fatalf("verify fixture rollback: %v", err)
	}
	if fixtureExists {
		t.Fatal("lead property scope fixture survived rollback")
	}
}

func insertLeadPropertyScopeOrganization(t *testing.T, ctx context.Context, tx pgx.Tx, name string) string {
	t.Helper()
	var id string
	if err := tx.QueryRow(ctx, `insert into public.organizations (name, is_active) values ($1, true) returning id::text`, name).Scan(&id); err != nil {
		t.Fatalf("insert organization fixture: %v", err)
	}
	return id
}

func insertLeadPropertyScopeUser(t *testing.T, ctx context.Context, tx pgx.Tx, organizationID string, label string) string {
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
		values ($1::uuid, 'authenticated', 'authenticated', $2, '', now(), '{}'::jsonb, '{}'::jsonb, now(), now())
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

func insertLeadPropertyScopeProperty(t *testing.T, ctx context.Context, tx pgx.Tx, organizationID string, code string, responsibleUserID string, createdBy string) string {
	t.Helper()
	var id string
	if err := tx.QueryRow(ctx, `
		insert into public.properties (
			organization_id, code, title, tipo_de_negocio, status,
			responsible_user_id, created_by, is_demo, preco,
			valor_venda_avaliado, commission_percentage, published_on_site, anunciar
		)
		values ($1::uuid, $2, $2, 'venda', 'active', $3::uuid, $4::uuid, false, 710000, 987654, 7.5, true, true)
		returning id::text
	`, organizationID, code, responsibleUserID, createdBy).Scan(&id); err != nil {
		t.Fatalf("insert property fixture %q: %v", code, err)
	}
	return id
}
