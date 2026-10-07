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

	unchangedHidden := updateInput{
		PropertyID:         patchString{Set: true, Value: &outsiderPropertyID},
		InterestPropertyID: patchString{Set: true, Value: &outsiderPropertyID},
	}
	if err := repository.validateUpdatePropertyReferences(ctx, tx, ownContext, leadSnapshot{
		PropertyID: outsiderPropertyID, InterestPropertyID: outsiderPropertyID,
	}, unchangedHidden); err != nil {
		t.Fatalf("unchanged hidden property rejected during lead edit: %v", err)
	}
	if err := repository.validateUpdatePropertyReferences(ctx, tx, ownContext, leadSnapshot{}, unchangedHidden); !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("new hidden property link error = %v, want ErrInvalidReference", err)
	}
	otherOrganizationLink := updateInput{PropertyID: patchString{Set: true, Value: &otherOrganizationPropertyID}}
	if err := repository.validateUpdatePropertyReferences(ctx, tx, ownContext, leadSnapshot{PropertyID: otherOrganizationPropertyID}, otherOrganizationLink); !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("unchanged cross-organization property link error = %v, want ErrInvalidReference", err)
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
	assertLeadResponseProperty := func(t *testing.T, viewer tenant.Context, wantVisible bool) {
		t.Helper()
		args, visibility := appendCanonicalPropertyVisibility([]any{organizationID, consumerLeadID}, viewer, "visible_property")
		lead, err := scanLead(tx.QueryRow(ctx, `
			select `+leadSelectFields(visibility)+`
			from public.leads l
			left join public.stages s on s.id = l.stage_id
			left join public.users u on u.id = l.assigned_user_id
			where l.organization_id = $1::uuid and l.id = $2::uuid
		`, args...))
		if err != nil {
			t.Fatalf("project lead response: %v", err)
		}
		if (lead.PropertyID == outsiderPropertyID) != wantVisible || lead.InterestPropertyID != "" {
			t.Fatalf("lead response property visibility = property %q interest %q, want visible=%t", lead.PropertyID, lead.InterestPropertyID, wantVisible)
		}
	}
	assertLeadResponseProperty(t, ownContext, false)
	assertLeadResponseProperty(t, manageContext, true)

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
	if err != nil || reservation == nil || reservation.PropertyID != outsiderPropertyID {
		t.Fatalf("existing same-organization hidden lead property reservation = %#v, error %v", reservation, err)
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
	if status != "reserved" || publishedOnSite || announce {
		t.Fatalf("won reservation state: status=%q published=%t announce=%t", status, publishedOnSite, announce)
	}
	if _, err := tx.Exec(ctx, `
		update public.properties
		set status = 'active', published_on_site = true, anunciar = true,
		    metadata = metadata - $2::text
		where id = $1::uuid
	`, outsiderPropertyID, activeWonLeadReservationEventIDKey); err != nil {
		t.Fatalf("restore rollback-only fixture before reopen checks: %v", err)
	}

	open := "open"
	reopenInput := updateInput{DealStatus: patchString{Set: true, Value: &open}}
	reopenCurrent := leadSnapshot{ID: consumerLeadID, DealStatus: "lost", InterestPropertyID: outsiderPropertyID}
	for _, inactiveStatus := range []string{"active", "inactive"} {
		if _, err := tx.Exec(ctx, `update public.properties set status = $2 where id = $1::uuid`, outsiderPropertyID, inactiveStatus); err != nil {
			t.Fatalf("prepare hidden %s property: %v", inactiveStatus, err)
		}
		if err := repository.releaseReopenedLeadProperty(ctx, tx, ownContext, reopenCurrent, reopenInput); err != nil {
			t.Fatalf("reopen lead with hidden %s property: %v", inactiveStatus, err)
		}
		if err := tx.QueryRow(ctx, `select status from public.properties where id = $1::uuid`, outsiderPropertyID).Scan(&status); err != nil {
			t.Fatalf("read hidden property after reopen: %v", err)
		}
		if status != inactiveStatus {
			t.Fatalf("reopen changed hidden property status to %q, want %q", status, inactiveStatus)
		}
	}

	if _, err := tx.Exec(ctx, `
		update public.properties
		set status = 'reserved', published_on_site = false, anunciar = false
		where id = $1::uuid
	`, outsiderPropertyID); err != nil {
		t.Fatalf("prepare hidden reserved property: %v", err)
	}
	if err := repository.releaseReopenedLeadProperty(ctx, tx, ownContext, reopenCurrent, reopenInput); err != nil {
		t.Fatalf("lost lead must not release unowned hidden reservation: %v", err)
	}
	if err := tx.QueryRow(ctx, `select status from public.properties where id = $1::uuid`, outsiderPropertyID).Scan(&status); err != nil || status != "reserved" {
		t.Fatalf("hidden reserved property after rejected reopen: status=%q error=%v", status, err)
	}

	for _, invalidPropertyID := range []string{otherOrganizationPropertyID, "40000000-0000-4000-8000-000000000002"} {
		invalidCurrent := reopenCurrent
		invalidCurrent.InterestPropertyID = invalidPropertyID
		if err := repository.releaseReopenedLeadProperty(ctx, tx, ownContext, invalidCurrent, reopenInput); !errors.Is(err, ErrInvalidReference) {
			t.Fatalf("reopen with invalid linked property %q error = %v, want ErrInvalidReference", invalidPropertyID, err)
		}
	}
	if _, err := tx.Exec(ctx, `
		update public.properties
		set status = 'available', published_on_site = false, anunciar = null
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, outsiderPropertyID); err != nil {
		t.Fatalf("prepare exact restore fixture: %v", err)
	}
	winningLead := leadSnapshot{ID: consumerLeadID, Name: "winning lead", DealStatus: "open", InterestPropertyID: outsiderPropertyID}
	exactReservation, err := repository.lockWonLeadPropertyForUpdate(ctx, tx, ownContext, winningLead, updateInput{DealStatus: patchString{Set: true, Value: &won}})
	if err != nil || exactReservation == nil {
		t.Fatalf("reserve already-linked hidden property: %#v / %v", exactReservation, err)
	}
	if _, err := repository.reserveWonLeadProperty(ctx, tx, ownContext, winningLead, updateInput{DealStatus: patchString{Set: true, Value: &won}}, exactReservation); err != nil {
		t.Fatalf("record exact reservation provenance: %v", err)
	}
	var marker string
	var propertyUpdatedAt, reservationCreatedAt time.Time
	if err := tx.QueryRow(ctx, `
		select coalesce(property.metadata->>$3::text, ''), property.updated_at, reservation.created_at
		from public.properties property
		join public.events reservation on reservation.id = $4::uuid
		where property.organization_id = $1::uuid and property.id = $2::uuid
	`, organizationID, outsiderPropertyID, activeWonLeadReservationEventIDKey, exactReservation.EventID).Scan(&marker, &propertyUpdatedAt, &reservationCreatedAt); err != nil {
		t.Fatalf("inspect reservation event marker: %v", err)
	}
	if marker != exactReservation.EventID {
		t.Fatalf("property marker = %q, want reservation event %q", marker, exactReservation.EventID)
	}
	if !propertyUpdatedAt.After(reservationCreatedAt) {
		t.Fatalf("expected monotonic publication trigger to advance updated_at beyond event.created_at: property=%v event=%v", propertyUpdatedAt, reservationCreatedAt)
	}
	winningLead.DealStatus = "won"
	lost := "lost"
	otherReservationID := "88888888-8888-4888-8888-888888888888"
	if _, err := tx.Exec(ctx, `
		update public.properties
		set metadata = jsonb_set(metadata, array[$3::text], to_jsonb($4::text))
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, outsiderPropertyID, activeWonLeadReservationEventIDKey, otherReservationID); err != nil {
		t.Fatalf("replace reservation marker for false release check: %v", err)
	}
	if err := repository.releaseReopenedLeadProperty(ctx, tx, ownContext, winningLead, updateInput{DealStatus: patchString{Set: true, Value: &lost}}); !errors.Is(err, ErrLeadReservationUnverified) {
		t.Fatalf("mismatched reservation marker must fail closed: %v", err)
	}
	if err := tx.QueryRow(ctx, `select status from public.properties where organization_id = $1::uuid and id = $2::uuid`, organizationID, outsiderPropertyID).Scan(&status); err != nil || status != "reserved" {
		t.Fatalf("false release changed property: status=%q error=%v", status, err)
	}
	if _, err := tx.Exec(ctx, `
		update public.properties
		set metadata = jsonb_set(metadata, array[$3::text], to_jsonb($4::text))
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, outsiderPropertyID, activeWonLeadReservationEventIDKey, exactReservation.EventID); err != nil {
		t.Fatalf("restore reservation marker for proven release: %v", err)
	}
	if err := repository.releaseReopenedLeadProperty(ctx, tx, ownContext, winningLead, updateInput{DealStatus: patchString{Set: true, Value: &lost}}); err != nil {
		t.Fatalf("release proven hidden property on won-to-lost: %v", err)
	}
	var restoredStatus string
	var restoredPublished, restoredAnnounce pgtype.Bool
	if err := tx.QueryRow(ctx, `
		select status, published_on_site, anunciar
		from public.properties
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, outsiderPropertyID).Scan(&restoredStatus, &restoredPublished, &restoredAnnounce); err != nil {
		t.Fatalf("inspect exact property restoration: %v", err)
	}
	if restoredStatus != "available" || !restoredPublished.Valid || restoredPublished.Bool || restoredAnnounce.Valid {
		t.Fatalf("restoration changed original values: status=%q published=%#v announce=%#v", restoredStatus, restoredPublished, restoredAnnounce)
	}
	var activeReservationID string
	if err := tx.QueryRow(ctx, `
		select coalesce(metadata->>$3::text, '') from public.properties
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, outsiderPropertyID, activeWonLeadReservationEventIDKey).Scan(&activeReservationID); err != nil || activeReservationID != "" {
		t.Fatalf("release left reservation marker %q: %v", activeReservationID, err)
	}
	var releaseEvents int
	if err := tx.QueryRow(ctx, `
		select count(*) from public.events
		where organization_id = $1::uuid and entity_id = $2::uuid
		  and event_type = 'property_released_by_lost_lead'
	`, organizationID, outsiderPropertyID).Scan(&releaseEvents); err != nil || releaseEvents != 1 {
		t.Fatalf("won-to-lost release events = %d, error %v", releaseEvents, err)
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
