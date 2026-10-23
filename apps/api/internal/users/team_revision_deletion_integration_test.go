package users

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestOrganizationUserDeletionBumpsOnlyAffectedTeamRevisions(t *testing.T) {
	database, ctx := openDisposableMembershipAccessDatabase(t)

	organizationID, otherOrganizationID := lifecycleUUID(t), lifecycleUUID(t)
	actorID, userID := lifecycleUUID(t), lifecycleUUID(t)
	firstTeamID, secondTeamID := lifecycleUUID(t), lifecycleUUID(t)
	untouchedTeamID, otherOrganizationTeamID := lifecycleUUID(t), lifecycleUUID(t)
	for _, organization := range []string{organizationID, otherOrganizationID} {
		mustMembershipExec(t, ctx, database, `insert into public.organizations (id, name) values ($1::uuid, 'Synthetic organization')`, organization)
	}
	for _, user := range []string{actorID, userID} {
		mustMembershipExec(t, ctx, database, `insert into public.users (id, organization_id, name, email) values ($1::uuid, $2::uuid, 'Synthetic user', $3)`, user, organizationID, user+"@example.test")
	}
	mustMembershipExec(t, ctx, database, `insert into public.organization_members (organization_id, user_id, role) values ($1::uuid, $2::uuid, 'owner')`, organizationID, actorID)
	for _, organization := range []string{organizationID, otherOrganizationID} {
		mustMembershipExec(t, ctx, database, `insert into public.organization_members (organization_id, user_id, role) values ($1::uuid, $2::uuid, 'user')`, organization, userID)
	}
	for _, pair := range [][2]string{{firstTeamID, organizationID}, {secondTeamID, organizationID}, {untouchedTeamID, organizationID}, {otherOrganizationTeamID, otherOrganizationID}} {
		mustMembershipExec(t, ctx, database, `insert into public.teams (id, organization_id) values ($1::uuid, $2::uuid)`, pair[0], pair[1])
	}
	for _, pair := range [][2]string{{firstTeamID, organizationID}, {secondTeamID, organizationID}, {otherOrganizationTeamID, otherOrganizationID}} {
		mustMembershipExec(t, ctx, database, `insert into public.team_members (team_id, organization_id, user_id) values ($1::uuid, $2::uuid, $3::uuid)`, pair[0], pair[1], userID)
	}

	repository := NewRepository(database, AuthAdminConfig{})
	// Hold the first team while the removal helper waits for it. It must not
	// lock the user yet, or a Teams writer holding this parent would deadlock.
	blocker, err := database.Pool().Begin(ctx)
	if err != nil {
		t.Fatalf("begin team writer: %v", err)
	}
	defer blocker.Rollback(context.Background())
	var lockedTeamID string
	if err := blocker.QueryRow(ctx, `select id::text from public.teams where id = $1::uuid for no key update`, firstTeamID).Scan(&lockedTeamID); err != nil {
		t.Fatalf("lock team parent: %v", err)
	}
	lockResult := make(chan error, 1)
	go func() {
		deletionTx, lockErr := repository.beginOrganizationUserDeletion(ctx, organizationID, userID)
		if lockErr == nil {
			lockErr = deletionTx.Rollback(context.Background())
		}
		lockResult <- lockErr
	}()
	blocked := false
	for until := time.Now().Add(3 * time.Second); time.Now().Before(until); time.Sleep(20 * time.Millisecond) {
		if err := database.Pool().QueryRow(ctx, `
			select exists (
				select 1 from pg_stat_activity
				where datname = current_database()
				  and pid <> pg_backend_pid()
				  and wait_event_type = 'Lock'
				  and query like '%from public.teams%'
			)
		`).Scan(&blocked); err != nil {
			t.Fatalf("inspect team lock wait: %v", err)
		}
		if blocked {
			break
		}
	}
	if !blocked {
		t.Fatal("user removal did not wait on team parent")
	}
	probeCtx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	var lockedUserID string
	if err := blocker.QueryRow(probeCtx, `select id::text from public.users where id = $1::uuid for no key update`, userID).Scan(&lockedUserID); err != nil {
		t.Fatalf("team writer could not lock user while removal waited on parent: %v", err)
	}
	if err := blocker.Rollback(ctx); err != nil {
		t.Fatalf("release team writer: %v", err)
	}
	select {
	case err := <-lockResult:
		if err != nil {
			t.Fatalf("finish user removal lock probe: %v", err)
		}
	case <-ctx.Done():
		t.Fatalf("wait for user removal lock probe: %v", ctx.Err())
	}
	actor := tenant.Context{
		OrganizationID: organizationID,
		UserID:         actorID,
		MemberRole:     "owner",
		Permissions:    []string{permissions.UsersManage, permissions.PermissionsManage},
	}
	result, err := repository.DeleteOrganizationUser(ctx, actor, userID, DeleteUserInput{})
	if err != nil {
		t.Fatalf("remove organization member: %v", err)
	}
	if !result.Success || result.Impact.Teams != 2 {
		t.Fatalf("unexpected removal result: %#v", result)
	}
	for _, pair := range []struct {
		teamID  string
		want    int64
		members int64
	}{{firstTeamID, 2, 0}, {secondTeamID, 2, 0}, {untouchedTeamID, 1, 0}, {otherOrganizationTeamID, 1, 1}} {
		assertMembershipNumber(t, ctx, database, `select revision from public.teams where id = $1::uuid`, pair.want, pair.teamID)
		assertMembershipNumber(t, ctx, database, `select count(*) from public.team_members where team_id = $1::uuid and user_id = $2::uuid`, pair.members, pair.teamID, userID)
	}

	// The compact fixture has no team FK. An orphaned legacy row must produce a
	// bounded conflict instead of making the deletion request loop forever.
	orphanUserID, missingTeamID := lifecycleUUID(t), lifecycleUUID(t)
	mustMembershipExec(t, ctx, database, `insert into public.users (id, organization_id, name) values ($1::uuid, $2::uuid, 'Orphaned user')`, orphanUserID, organizationID)
	mustMembershipExec(t, ctx, database, `insert into public.organization_members (organization_id, user_id, role) values ($1::uuid, $2::uuid, 'user')`, organizationID, orphanUserID)
	mustMembershipExec(t, ctx, database, `insert into public.team_members (team_id, organization_id, user_id) values ($1::uuid, $2::uuid, $3::uuid)`, missingTeamID, organizationID, orphanUserID)
	orphanTx, err := repository.beginOrganizationUserDeletion(ctx, organizationID, orphanUserID)
	if orphanTx != nil {
		_ = orphanTx.Rollback(context.Background())
		t.Fatal("orphaned team member unexpectedly returned a deletion transaction")
	}
	if !errors.Is(err, ErrUserTeamMembershipChanged) {
		t.Fatalf("orphaned team member error = %v, want conflict", err)
	}
}
