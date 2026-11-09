package whatsapp

import (
	"context"
	"errors"
	"net/url"
	"slices"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func assertSupervisoryDifferentTeam(t *testing.T, ctx context.Context, repo Repository, leader tenant.Context,
	ledTeamID, assigneeID, conversationID string,
) {
	t.Helper()
	pool := repo.db.Pool()
	var otherTeamID string
	if err := pool.QueryRow(ctx, `insert into public.teams(organization_id,name,created_by)
		values ($1::uuid,'another supervisory fixture team',$2::uuid) returning id::text`,
		leader.OrganizationID, leader.UserID).Scan(&otherTeamID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := pool.Exec(ctx, `update public.team_members set is_active=true where team_id=$1::uuid and user_id=$2::uuid;
			delete from public.team_members where team_id=$3::uuid; delete from public.teams where id=$3::uuid`, ledTeamID, assigneeID, otherTeamID); err != nil {
			t.Error(err)
		}
	})
	if _, err := pool.Exec(ctx, `update public.team_members set is_active=false where team_id=$1::uuid and user_id=$2::uuid;
		insert into public.team_members(organization_id,team_id,user_id,is_active)
		values ($4::uuid,$3::uuid,$2::uuid,true)`, ledTeamID, assigneeID, otherTeamID, leader.OrganizationID); err != nil {
		t.Fatal(err)
	}
	assertSupervisoryFixtureRow(t, ctx, repo, leader, conversationID, false)
}

func assertSupervisoryFixtureRow(t *testing.T, ctx context.Context, repo Repository, actor tenant.Context, id string, want bool) {
	t.Helper()
	items, err := repo.ListConversations(ctx, actor, ConversationListFilter{IncludeSupervisoryLeads: true, Limit: 120})
	if err != nil {
		t.Fatal(err)
	}
	index := slices.IndexFunc(items, func(row Conversation) bool { return row.ID == id })
	if (index >= 0) != want || index >= 0 && (!items[index].SupervisoryLeadView || !items[index].HistoricalLeadView) {
		t.Fatalf("supervisory conversation present=%t, want %t", index >= 0, want)
	}
}

func assertSupervisoryAdminInbox(t *testing.T, ctx context.Context, repo Repository, admin tenant.Context,
	conversationID, leadID, unlinkedID, sessionID, assigneeID string, now time.Time,
) {
	t.Helper()
	pool := repo.db.Pool()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	foreign := createSessionConversationLockFixture(t, ctx, pool, "supervisory-foreign")
	t.Cleanup(func() {
		if _, err := pool.Exec(ctx, `
			delete from public.whatsapp_conversations where id=$1::uuid and organization_id=$5::uuid;
			delete from public.whatsapp_sessions where id=$2::uuid and organization_id=$5::uuid;
			delete from public.leads where id=$3::uuid and organization_id=$5::uuid;
			delete from public.organization_members where user_id=$4::uuid and organization_id=$5::uuid;
			delete from public.users where id=$4::uuid and organization_id=$5::uuid;
			delete from auth.users where id=$4::uuid;
			delete from public.organizations where id=$5::uuid
		`, foreign.conversationID, foreign.sessionID, foreign.leadID, foreign.userID, foreign.organizationID); err != nil {
			t.Error(err)
		}
	})
	newerPhysicalTimestamp := now.Add(time.Minute)
	exec(`update public.whatsapp_conversations set presence_updated_at=$2,last_message_at=$3 where id=$1::uuid`,
		conversationID, now, newerPhysicalTimestamp)
	t.Cleanup(func() {
		exec(`update public.whatsapp_conversations set presence_updated_at=null,last_message_at=$2,archived_at=null where id=$1::uuid`, conversationID, now)
		exec(`update public.leads set deal_status='open' where id=$1::uuid`, leadID)
		exec(`update public.organization_members set role='admin' where organization_id=$1::uuid and user_id=$2::uuid`, admin.OrganizationID, admin.UserID)
	})

	query := url.Values{"includeSupervisoryLeads": {"true"}, "limit": {"1"}}
	filter, err := ParseConversationListFilter(query)
	if err != nil {
		t.Fatal(err)
	}
	items, cursor, err := repo.listConversationsPage(ctx, admin, filter)
	if err != nil || len(items) != 1 || cursor == nil {
		t.Fatalf("supervisory first page length=%d cursor=%v error=%v", len(items), cursor, err)
	}
	row := items[0]
	if row.ID != conversationID || row.LeadID == nil || *row.LeadID != leadID ||
		!row.HistoricalLeadView || !row.SupervisoryLeadView || row.UnreadCount != 0 ||
		row.Session != nil || row.SessionID != sessionID || row.PresenceUpdatedAt != nil || row.ContactPresence != nil ||
		row.LastMessage == nil || *row.LastMessage != "private media" || row.LastMessageAt == nil || !row.LastMessageAt.Equal(now) {
		t.Fatalf("incorrect supervisory projection: %#v", row)
	}
	query.Set("cursor", *cursor)
	page, err := ParseConversationListFilter(query)
	if err != nil || page.CursorLastMessageAt == nil || !page.CursorLastMessageAt.Equal(newerPhysicalTimestamp) {
		t.Fatalf("supervisory redaction changed cursor: %#v, %v", page, err)
	}
	following, _, err := repo.listConversationsPage(ctx, admin, page)
	if err != nil || len(following) != 1 || following[0].ID == conversationID || following[0].SupervisoryLeadView {
		t.Fatalf("unexpected operational row after supervisory page: %#v %v", following, err)
	}
	for _, candidate := range []ConversationListFilter{
		{IncludeSupervisoryLeads: true}, {IncludeSupervisoryLeads: true, OnlyLeads: true},
		{IncludeSupervisoryLeads: true, OnlyLeads: true, UserID: assigneeID},
	} {
		rows, err := repo.ListConversations(ctx, admin, candidate)
		if err != nil || !slices.ContainsFunc(rows, func(row Conversation) bool { return row.ID == conversationID && row.SupervisoryLeadView }) {
			t.Fatalf("active lead missing from selected scope: %#v, %v", candidate, err)
		}
		if slices.ContainsFunc(rows, func(row Conversation) bool { return row.ID == unlinkedID || row.ID == foreign.conversationID }) {
			t.Fatal("supervisory read included a private unlinked or foreign-organization conversation")
		}
	}
	for _, candidate := range []ConversationListFilter{
		{IncludeSupervisoryLeads: true, SessionID: sessionID},
		{IncludeSupervisoryLeads: true, AccessibleProvided: true, SessionIDs: []string{sessionID}},
		{IncludeSupervisoryLeads: true, AccessibleProvided: true},
		{IncludeSupervisoryLeads: true, PendingReply: true},
		{IncludeSupervisoryLeads: true, ShowArchived: true},
		{IncludeSupervisoryLeads: true, WithoutLead: true},
	} {
		rows, err := repo.ListConversations(ctx, admin, candidate)
		if err != nil || slices.ContainsFunc(rows, func(row Conversation) bool { return row.SupervisoryLeadView }) {
			t.Fatalf("supervisory scope widened filtered operational inbox: %#v, %v", candidate, err)
		}
	}
	unread, err := repo.CountUnreadMessages(ctx, admin, ConversationListFilter{IncludeSupervisoryLeads: true})
	if err != nil || unread != 14 {
		t.Fatalf("supervisory read changed operational unread count: %d %v", unread, err)
	}
	for _, expanded := range []bool{false, true} {
		options, err := repo.ListConversationFilterOptions(ctx, admin, ConversationListFilter{ExpandedOptions: expanded, IncludeSupervisoryLeads: true})
		if err != nil || !slices.ContainsFunc(options.Users, func(user ConversationFilterOption) bool { return user.ID == assigneeID }) {
			t.Fatalf("expanded=%t supervisory assignee catalog = %#v, %v", expanded, options.Users, err)
		}
	}
	for _, mutate := range []func() error{
		func() error { return repo.MarkConversationAsRead(ctx, admin, conversationID, leadID) },
		func() error { return repo.MarkAsSeenOnWhatsApp(ctx, admin, conversationID, leadID) },
		func() error { return repo.ArchiveConversation(ctx, admin, conversationID, true, leadID) },
		func() error { return repo.DeleteConversation(ctx, admin, conversationID, leadID) },
	} {
		if err := mutate(); !errors.Is(err, ErrConversationNotFound) {
			t.Fatalf("supervisory access authorized inbox mutation: %v", err)
		}
	}
	exec(`update public.leads set deal_status='lost' where id=$1::uuid`, leadID)
	assertSupervisoryFixtureRow(t, ctx, repo, admin, conversationID, false)
	exec(`update public.leads set deal_status='open' where id=$1::uuid`, leadID)
	exec(`update public.whatsapp_conversations set archived_at=now() where id=$1::uuid`, conversationID)
	assertSupervisoryFixtureRow(t, ctx, repo, admin, conversationID, false)
	exec(`update public.whatsapp_conversations set archived_at=null where id=$1::uuid`, conversationID)
	exec(`update public.organization_members set role='user' where organization_id=$1::uuid and user_id=$2::uuid`, admin.OrganizationID, admin.UserID)
	assertSupervisoryFixtureRow(t, ctx, repo, admin, conversationID, false)
	superAdmin := admin
	superAdmin.MemberRole = ""
	superAdmin.IsSuperAdmin = true
	assertSupervisoryFixtureRow(t, ctx, repo, superAdmin, conversationID, false)
}
