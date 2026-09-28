package leads

import (
	"context"
	"errors"
	"math"
	"os"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// Run explicitly with a read-only database URL. This validates the SQL and the
// aggregate/detail contract against the deployed schema without modifying data.
func TestDashboardFirstContactReadOnlyIntegration(t *testing.T) {
	databaseURL := os.Getenv("VIMOB_DASHBOARD_READONLY_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set VIMOB_DASHBOARD_READONLY_DATABASE_URL for the read-only integration check")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	db, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, MaxConns: 1, ForceReadOnly: true, HealthTimeout: 8 * time.Second})
	if err != nil {
		t.Fatalf("connect read-only database: %v", err)
	}
	defer db.Close()
	var readOnly string
	if err := db.Pool().QueryRow(ctx, "show default_transaction_read_only").Scan(&readOnly); err != nil || readOnly != "on" {
		t.Fatalf("database session is not read-only: %v", err)
	}
	var organizationID string
	err = db.Pool().QueryRow(ctx, `
		select organization_id::text from public.leads
		where created_at >= now() - interval '30 days'
		group by organization_id order by count(*) desc limit 1
	`).Scan(&organizationID)
	if err != nil {
		t.Skipf("no organization in recent cohort: %v", err)
	}
	from, to := time.Now().AddDate(0, 0, -29), time.Now()
	filter := DashboardFilter{DateFrom: &from, DateTo: &to}
	tenantContext := tenant.Context{OrganizationID: organizationID, UserID: organizationID, MemberRole: "admin"}
	repo := NewRepository(db, nil)
	queryStarted := time.Now()
	all, err := repo.GetDashboardFirstContact(ctx, tenantContext, filter)
	if err != nil {
		t.Fatalf("first contact aggregate query: %v", err)
	}
	t.Logf("aggregate query: %s", time.Since(queryStarted).Round(time.Millisecond))
	if all.ContactedLeads > all.LeadCount {
		t.Fatalf("measured responses %d exceed cohort %d", all.ContactedLeads, all.LeadCount)
	}
	for _, broker := range all.Brokers {
		if broker.HandledLeads < broker.ReceivedLeads || broker.HandledLeads < broker.ContactedLeads {
			t.Fatalf("broker passage count does not cover receipts and responses")
		}
	}
	var brokerID string
	for _, broker := range all.Brokers {
		if broker.ContactedLeads > 0 {
			brokerID = broker.ID
			break
		}
	}
	if brokerID == "" {
		t.Skip("no measured response in recent cohort")
	}
	filter.UserID = brokerID
	queryStarted = time.Now()
	selected, err := repo.GetDashboardFirstContact(ctx, tenantContext, filter)
	if err != nil {
		t.Fatalf("selected broker aggregate query: %v", err)
	}
	t.Logf("selected broker query: %s", time.Since(queryStarted).Round(time.Millisecond))
	if len(selected.Brokers) != 1 || selected.Brokers[0].ID != brokerID {
		t.Fatalf("selected broker was not isolated: %d rows", len(selected.Brokers))
	}
	if selected.LeadCount != selected.Brokers[0].HandledLeads {
		t.Fatalf("selected broker lead cohort does not equal distinct leads that passed through them: cohort=%d handled=%d", selected.LeadCount, selected.Brokers[0].HandledLeads)
	}
	var sourceLeads, sourceContacts int64
	for _, source := range selected.Sources {
		sourceLeads += source.LeadCount
		sourceContacts += source.ContactedLeads
	}
	if sourceLeads != selected.LeadCount || sourceContacts != selected.ContactedLeads {
		t.Fatalf("selected broker source breakdown does not reconcile: leads=%d/%d contacts=%d/%d", sourceLeads, selected.LeadCount, sourceContacts, selected.ContactedLeads)
	}
	queryStarted = time.Now()
	aggregate, err := repo.dashboardAggregate(ctx, db.Pool(), tenantContext, filter, dashboardLeadWhereOptions{DateColumn: "created_at"})
	if err != nil {
		t.Fatalf("KPI aggregate query: %v", err)
	}
	t.Logf("KPI query: %s", time.Since(queryStarted).Round(time.Millisecond))
	if (aggregate.AverageResponseSecs == nil) != (selected.AverageResponseSeconds == nil) ||
		(aggregate.AverageResponseSecs != nil && math.Abs(*aggregate.AverageResponseSecs-*selected.AverageResponseSeconds) > 0.001) {
		t.Fatalf("KPI and dialog first-contact averages differ")
	}
	queryStarted = time.Now()
	page, err := repo.ListDashboardFirstContactLeads(ctx, tenantContext, filter, brokerID, 0, 25)
	if err != nil {
		t.Fatalf("first-contact lead page query: %v", err)
	}
	t.Logf("lead page query: %s", time.Since(queryStarted).Round(time.Millisecond))
	if page.Total != selected.ContactedLeads || len(page.Items) > 25 || page.HasMore != (page.Total > int64(len(page.Items))) {
		t.Fatalf("lead page does not reconcile with measured responses: total=%d measured=%d items=%d", page.Total, selected.ContactedLeads, len(page.Items))
	}
	// A team filter scopes both the lead cohort and the responding people. A
	// response by an outsider to a lead now owned by the team must not appear.
	var selectedTeamID string
	err = db.Pool().QueryRow(ctx, `
		select tm.team_id::text from public.team_members tm
		join public.teams t on t.id = tm.team_id and t.organization_id = tm.organization_id and coalesce(t.is_active, true) = true
		join public.users u on u.id = tm.user_id and coalesce(u.is_active, false) = true
		join public.organization_members om on om.organization_id = tm.organization_id and om.user_id = tm.user_id
		  and coalesce(om.is_active, false) = true and om.deleted_at is null
		join public.leads l on l.organization_id = tm.organization_id and l.assigned_user_id = tm.user_id
		  and l.created_at >= $2 and l.created_at <= $3
		where tm.organization_id = $1::uuid and coalesce(tm.is_active, true) = true
		order by case when t.name = 'Equipe Bruno' then 0 else 1 end
		limit 1
	`, organizationID, from, to).Scan(&selectedTeamID)
	if err == nil {
		teamFilter := DashboardFilter{DateFrom: &from, DateTo: &to, TeamID: selectedTeamID}
		teamStarted := time.Now()
		teamData, err := repo.GetDashboardFirstContact(ctx, tenantContext, teamFilter)
		if err != nil {
			t.Fatalf("selected team aggregate query: %v", err)
		}
		t.Logf("selected team aggregate query: %s", time.Since(teamStarted).Round(time.Millisecond))
		var activeMemberIDs []string
		err = db.Pool().QueryRow(ctx, `
			select array_agg(tm.user_id::text) from public.team_members tm
			join public.teams t on t.id = tm.team_id and t.organization_id = tm.organization_id and coalesce(t.is_active, true) = true
			join public.users u on u.id = tm.user_id and coalesce(u.is_active, false) = true
			join public.organization_members om on om.organization_id = tm.organization_id and om.user_id = tm.user_id
			  and coalesce(om.is_active, false) = true and om.deleted_at is null
			where tm.organization_id = $1::uuid and tm.team_id = $2::uuid and coalesce(tm.is_active, true) = true
		`, organizationID, selectedTeamID).Scan(&activeMemberIDs)
		if err != nil {
			t.Fatalf("read active team members: %v", err)
		}
		activeMembers := make(map[string]bool, len(activeMemberIDs))
		for _, memberID := range activeMemberIDs {
			activeMembers[memberID] = true
		}
		var teamSourceLeads, teamSourceContacts, brokerContacts int64
		for _, source := range teamData.Sources {
			teamSourceLeads += source.LeadCount
			teamSourceContacts += source.ContactedLeads
		}
		for _, broker := range teamData.Brokers {
			if !activeMembers[broker.ID] {
				t.Fatalf("team aggregate includes non-member broker %s", broker.ID)
			}
			brokerContacts += broker.ContactedLeads
		}
		if teamSourceLeads != teamData.LeadCount || teamSourceContacts != teamData.ContactedLeads || brokerContacts != teamData.ContactedLeads {
			t.Fatalf("team breakdown does not reconcile: leads=%d/%d source contacts=%d/%d broker contacts=%d/%d", teamSourceLeads, teamData.LeadCount, teamSourceContacts, teamData.ContactedLeads, brokerContacts, teamData.ContactedLeads)
		}
		for _, outsider := range all.Brokers {
			if activeMembers[outsider.ID] || outsider.ContactedLeads == 0 {
				continue
			}
			outsiderPage, err := repo.ListDashboardFirstContactLeads(ctx, tenantContext, teamFilter, outsider.ID, 0, 25)
			if err != nil || outsiderPage.Total != 0 || len(outsiderPage.Items) != 0 {
				t.Fatalf("team detail exposed outsider %s: total=%d items=%d error=%v", outsider.ID, outsiderPage.Total, len(outsiderPage.Items), err)
			}
			break
		}

		// Exercise the same day/team/person combination as the dashboard without
		// relying on a fixture or changing live data.
		brazil := time.FixedZone("America/Sao_Paulo", -3*60*60)
		now := time.Now().In(brazil)
		todayFrom := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, brazil).UTC()
		todayTo := todayFrom.Add(24*time.Hour - time.Nanosecond)
		todayTeamFilter := DashboardFilter{DateFrom: &todayFrom, DateTo: &todayTo, TeamID: selectedTeamID}
		todayStarted := time.Now()
		todayTeam, err := repo.GetDashboardFirstContact(ctx, tenantContext, todayTeamFilter)
		if err != nil {
			t.Fatalf("today team aggregate query: %v", err)
		}
		t.Logf("today team first contact: %s (leads=%d, measured=%d, redistributions=%d, brokers=%d)",
			time.Since(todayStarted).Round(time.Millisecond), todayTeam.LeadCount, todayTeam.ContactedLeads,
			todayTeam.RedistributedLeads, len(todayTeam.Brokers))
		teamKPI, err := repo.dashboardAggregate(ctx, db.Pool(), tenantContext, todayTeamFilter, dashboardLeadWhereOptions{DateColumn: "created_at"})
		if err != nil {
			t.Fatalf("today team KPI query: %v", err)
		}
		if (teamKPI.AverageResponseSecs == nil) != (todayTeam.AverageResponseSeconds == nil) ||
			(teamKPI.AverageResponseSecs != nil && math.Abs(*teamKPI.AverageResponseSecs-*todayTeam.AverageResponseSeconds) > 0.001) {
			t.Fatalf("today team KPI and detail averages differ")
		}
		for _, broker := range todayTeam.Brokers {
			if !activeMembers[broker.ID] {
				t.Fatalf("today team aggregate includes non-member broker %s", broker.ID)
			}
			if broker.ContactedLeads == 0 {
				continue
			}
			todayPersonFilter := todayTeamFilter
			todayPersonFilter.UserID = broker.ID
			personStarted := time.Now()
			person, err := repo.GetDashboardFirstContact(ctx, tenantContext, todayPersonFilter)
			if err != nil {
				t.Fatalf("today team person aggregate query: %v", err)
			}
			t.Logf("today team person first contact: %s (leads=%d, measured=%d)",
				time.Since(personStarted).Round(time.Millisecond), person.LeadCount, person.ContactedLeads)
			if len(person.Brokers) != 1 || person.LeadCount != person.Brokers[0].HandledLeads {
				t.Fatalf("today team person lead counts do not reconcile: brokers=%d cohort=%d", len(person.Brokers), person.LeadCount)
			}
			var personSourceLeads, personSourceContacts int64
			for _, source := range person.Sources {
				personSourceLeads += source.LeadCount
				personSourceContacts += source.ContactedLeads
			}
			if personSourceLeads != person.LeadCount || personSourceContacts != person.ContactedLeads {
				t.Fatalf("today team person source counts do not reconcile: leads=%d/%d contacts=%d/%d", personSourceLeads, person.LeadCount, personSourceContacts, person.ContactedLeads)
			}
			personPage, err := repo.ListDashboardFirstContactLeads(ctx, tenantContext, todayPersonFilter, broker.ID, 0, 25)
			if err != nil || personPage.Total != person.ContactedLeads {
				t.Fatalf("today team person detail does not reconcile: total=%d measured=%d error=%v", personPage.Total, person.ContactedLeads, err)
			}
			break
		}
	}
	var leaderID string
	var ledUserIDs []string
	err = db.Pool().QueryRow(ctx, `
		select leader.user_id::text, array_agg(distinct member.user_id::text)
		from public.team_members leader
		join public.team_members member on member.organization_id = leader.organization_id
		  and member.team_id = leader.team_id and member.is_active = true
		where leader.organization_id = $1::uuid and leader.is_active = true and leader.is_leader = true
		group by leader.user_id limit 1
	`, organizationID).Scan(&leaderID, &ledUserIDs)
	if err == nil && len(ledUserIDs) > 0 {
		leader := tenant.Context{
			OrganizationID: organizationID, UserID: leaderID, MemberRole: "member",
			Permissions: []string{permissions.LeadViewTeam}, IsTeamLeader: true, LedUserIDs: ledUserIDs,
		}
		teamData, err := repo.GetDashboardFirstContact(ctx, leader, DashboardFilter{DateFrom: &from, DateTo: &to})
		if err != nil {
			t.Fatalf("team leader aggregate query: %v", err)
		}
		for _, broker := range teamData.Brokers {
			if !dashboardFirstContactCanSeeActor(leader, broker.ID) {
				t.Fatal("team leader received a broker outside their team")
			}
		}
		if _, err := repo.ListDashboardFirstContactLeads(ctx, leader, DashboardFilter{}, organizationID, 0, 25); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
			t.Fatalf("team leader could request a broker outside their team: %v", err)
		}
	}
}
