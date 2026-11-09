package whatsapp

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type conversationMembershipFixture struct {
	organizationID, userID, sessionID, teamID, conversationID, leadID      string
	privateSessionID, privateConversationID, privateLeadID, privateOwnerID string
}

// Reuses the explicitly opted-in disposable fixture and exercises the actual
// list, unread-count and both catalog repository queries. No new DB/service is started.
func assertConversationSecondaryOrganizationFilters(t *testing.T, ctx context.Context, repo Repository, viewer tenant.Context, f conversationMembershipFixture) {
	t.Helper()
	exec := func(t *testing.T, query string, args ...any) {
		t.Helper()
		if _, err := repo.db.Pool().Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	var primaryOrganizationID, otherTeamID, leadName string
	name := fmt.Sprintf("wa-secondary-filter-%d", time.Now().UnixNano())
	if err := repo.db.Pool().QueryRow(ctx, `insert into public.organizations(name,slug) values ($1,$1) returning id::text`, name).Scan(&primaryOrganizationID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		for _, statement := range []struct {
			query string
			args  []any
		}{
			{`update public.users set organization_id=$1::uuid,is_active=true where id=$2::uuid`, []any{f.organizationID, f.userID}},
			{`update public.organization_members set is_active=true,deleted_at=null where organization_id=$1::uuid and user_id=$2::uuid`, []any{f.organizationID, f.userID}},
			{`update public.teams set is_active=true where id=$1::uuid`, []any{f.teamID}},
			{`update public.team_members tm set is_active=true,membership_generation=om.membership_generation from public.organization_members om where tm.team_id=$1::uuid and tm.user_id=$2::uuid and om.organization_id=tm.organization_id and om.user_id=tm.user_id`, []any{f.teamID, f.userID}},
			{`update public.leads set assigned_user_id=$1::uuid where id=$2::uuid`, []any{f.privateOwnerID, f.privateLeadID}},
			{`delete from public.team_members where organization_id=$1::uuid`, []any{primaryOrganizationID}},
			{`delete from public.teams where organization_id=$1::uuid`, []any{primaryOrganizationID}},
			{`delete from public.organization_members where organization_id=$1::uuid`, []any{primaryOrganizationID}},
			{`delete from public.organizations where id=$1::uuid`, []any{primaryOrganizationID}},
		} {
			if _, err := repo.db.Pool().Exec(cleanupCtx, statement.query, statement.args...); err != nil {
				t.Errorf("restore disposable secondary-organization fixture: %v", err)
			}
		}
	})
	exec(t, `insert into public.organization_members(organization_id,user_id,role,is_active) values ($1::uuid,$2::uuid,'user',true)`, primaryOrganizationID, f.userID)
	if err := repo.db.Pool().QueryRow(ctx, `insert into public.teams(organization_id,name,created_by,is_active) values ($1::uuid,$2,$3::uuid,true) returning id::text`, primaryOrganizationID, name, f.userID).Scan(&otherTeamID); err != nil {
		t.Fatal(err)
	}
	exec(t, `insert into public.team_members(organization_id,team_id,user_id,is_leader,is_active) values ($1::uuid,$2::uuid,$3::uuid,false,true)`, primaryOrganizationID, otherTeamID, f.userID)
	if err := repo.db.Pool().QueryRow(ctx, `select name from public.leads where id=$1::uuid`, f.leadID).Scan(&leadName); err != nil {
		t.Fatal(err)
	}
	reset := func(t *testing.T) {
		exec(t, `update public.users set organization_id=$1::uuid,is_active=true where id=$2::uuid`, primaryOrganizationID, f.userID)
		exec(t, `update public.organization_members set is_active=true,deleted_at=null where organization_id=$1::uuid and user_id=$2::uuid`, f.organizationID, f.userID)
		exec(t, `update public.teams set is_active=true where id=$1::uuid`, f.teamID)
		exec(t, `update public.team_members tm set is_active=true,membership_generation=om.membership_generation from public.organization_members om where tm.team_id=$1::uuid and tm.user_id=$2::uuid and om.organization_id=tm.organization_id and om.user_id=tm.user_id`, f.teamID, f.userID)
	}
	contains := func(options []ConversationFilterOption, id string) bool {
		for _, option := range options {
			if option.ID == id {
				return true
			}
		}
		return false
	}
	for _, item := range []struct {
		name, mutation               string
		wantLead, wantUser, wantTeam bool
	}{
		{"active membership in B with primary organization A", "", true, true, true},
		{"revoked membership", `update public.organization_members set is_active=false where organization_id=$1::uuid and user_id=$2::uuid`, false, false, false},
		{"deleted membership", `update public.organization_members set deleted_at=now() where organization_id=$1::uuid and user_id=$2::uuid`, false, false, false},
		{"previous team membership generation", `update public.organization_members set deleted_at=now() where organization_id=$1::uuid and user_id=$2::uuid;
		  update public.organization_members set deleted_at=null,is_active=true where organization_id=$1::uuid and user_id=$2::uuid`, false, true, false},
		{"inactive team", `update public.teams set is_active=false where organization_id=$1::uuid and id=$2::uuid`, false, true, false},
		{"inactive team member", `update public.team_members set is_active=false where organization_id=$1::uuid and user_id=$2::uuid and team_id=$3::uuid`, false, true, false},
		{"inactive user", `update public.users set is_active=false where id=$2::uuid and organization_id=$1::uuid`, false, false, false},
		{"valid membership restored after negative cases", "", true, true, true},
	} {
		t.Run(item.name, func(t *testing.T) {
			reset(t)
			if item.mutation != "" {
				// All mutation arguments are synthetic UUIDs. Inactive-user uses the primary org.
				org := f.organizationID
				if item.name == "inactive user" {
					org = primaryOrganizationID
				}
				if item.name == "inactive team" {
					exec(t, item.mutation, org, f.teamID)
				} else if item.name == "inactive team member" {
					exec(t, item.mutation, org, f.userID, f.teamID)
				} else {
					exec(t, item.mutation, org, f.userID)
				}
			}
			if item.name == "previous team membership generation" {
				// Ordinary UPDATE cannot forge the server-owned generation. A real
				// removal/reinvite must leave the old team participation stale.
				var staleGeneration bool
				if err := repo.db.Pool().QueryRow(ctx, `select tm.membership_generation is distinct from om.membership_generation
					from public.team_members tm join public.organization_members om
					on om.organization_id=tm.organization_id and om.user_id=tm.user_id
					where tm.organization_id=$1::uuid and tm.team_id=$2::uuid and tm.user_id=$3::uuid`,
					f.organizationID, f.teamID, f.userID).Scan(&staleGeneration); err != nil || !staleGeneration {
					t.Fatalf("fixture did not establish stale membership generation: stale=%t error=%v", staleGeneration, err)
				}
			}
			filter := ConversationListFilter{SessionID: f.sessionID, TeamID: f.teamID, Search: leadName, Limit: 120}
			leads, err := repo.ListConversations(ctx, viewer, filter)
			if err != nil {
				t.Fatal(err)
			}
			wantCount := 0
			if item.wantLead {
				wantCount = 1
			}
			if len(leads) != wantCount || (item.wantLead && leads[0].ID != f.conversationID) {
				t.Fatalf("secondary-org team list returned %d conversations, want %d", len(leads), wantCount)
			}
			leader := viewer
			leader.Permissions = []string{"lead_view_team"}
			assertSupervisoryFixtureRow(t, ctx, repo, leader, f.privateConversationID, item.wantLead)
			count, err := repo.CountUnreadMessages(ctx, viewer, filter)
			wantUnread := int64(0)
			if item.wantLead {
				wantUnread = 2
			}
			if err != nil || count != wantUnread {
				t.Fatalf("team unread=%d, want %d: %v", count, wantUnread, err)
			}
			for _, expanded := range []bool{false, true} {
				options, err := repo.ListConversationFilterOptions(ctx, viewer, ConversationListFilter{SessionID: f.sessionID, ExpandedOptions: expanded, OptionsLimit: 100})
				if err != nil {
					t.Fatal(err)
				}
				if contains(options.Users, f.userID) != item.wantUser || contains(options.Teams, f.teamID) != item.wantTeam || contains(options.Teams, otherTeamID) {
					t.Fatalf("expanded=%v: secondary-org users/teams=%#v/%#v", expanded, options.Users, options.Teams)
				}
			}
		})
	}
	reset(t)
	t.Run("other tenant team does not match B lead", func(t *testing.T) {
		leads, err := repo.ListConversations(ctx, viewer, ConversationListFilter{SessionID: f.sessionID, TeamID: otherTeamID, Limit: 120})
		if err != nil || len(leads) != 0 {
			t.Fatalf("foreign-tenant team matched B lead: %v %v", leads, err)
		}
	})
	t.Run("other tenant cannot query B session", func(t *testing.T) {
		foreign := viewer
		foreign.OrganizationID = primaryOrganizationID
		filter := ConversationListFilter{SessionID: f.sessionID, TeamID: otherTeamID, Limit: 120}
		leads, err := repo.ListConversations(ctx, foreign, filter)
		if err != nil || len(leads) != 0 {
			t.Fatalf("foreign tenant returned B conversation: %v %v", leads, err)
		}
		count, err := repo.CountUnreadMessages(ctx, foreign, filter)
		if err != nil || count != 0 {
			t.Fatalf("foreign tenant unread=%d: %v", count, err)
		}
		for _, expanded := range []bool{false, true} {
			options, err := repo.ListConversationFilterOptions(ctx, foreign, ConversationListFilter{SessionID: f.sessionID, ExpandedOptions: expanded})
			if err != nil || len(options.Users) != 0 || len(options.Teams) != 0 {
				t.Fatalf("foreign tenant catalog leaked: %#v %v", options, err)
			}
		}
	})
	t.Run("assignment and valid team cannot replace a number grant", func(t *testing.T) {
		exec(t, `update public.leads set assigned_user_id=$1::uuid where id=$2::uuid`, f.userID, f.privateLeadID)
		filter := ConversationListFilter{SessionID: f.privateSessionID, TeamID: f.teamID, Limit: 120}
		leads, err := repo.ListConversations(ctx, viewer, filter)
		if err != nil || len(leads) != 0 {
			t.Fatalf("ungranted session returned assigned lead: %v %v", leads, err)
		}
		count, err := repo.CountUnreadMessages(ctx, viewer, filter)
		if err != nil || count != 0 {
			t.Fatalf("ungranted session unread=%d: %v", count, err)
		}
		for _, expanded := range []bool{false, true} {
			options, err := repo.ListConversationFilterOptions(ctx, viewer, ConversationListFilter{SessionID: f.privateSessionID, ExpandedOptions: expanded})
			if err != nil || len(options.Users) != 0 || len(options.Teams) != 0 {
				t.Fatalf("ungranted catalog leaked: %#v %v", options, err)
			}
		}
	})
	t.Run("session ownership does not replace lead scope", func(t *testing.T) {
		unprivileged := viewer
		unprivileged.Permissions = nil
		filter := ConversationListFilter{SessionID: f.sessionID, TeamID: f.teamID, Limit: 120}
		leads, err := repo.ListConversations(ctx, unprivileged, filter)
		if err != nil || len(leads) != 0 {
			t.Fatalf("missing lead permission returned a lead: %v %v", leads, err)
		}
		count, err := repo.CountUnreadMessages(ctx, unprivileged, filter)
		if err != nil || count != 0 {
			t.Fatalf("missing lead permission unread=%d: %v", count, err)
		}
		for _, expanded := range []bool{false, true} {
			options, err := repo.ListConversationFilterOptions(ctx, unprivileged, ConversationListFilter{SessionID: f.sessionID, ExpandedOptions: expanded})
			if err != nil || len(options.Users) != 0 || len(options.Teams) != 0 {
				t.Fatalf("missing lead permission catalog leaked: %#v %v", options, err)
			}
		}
	})
}
