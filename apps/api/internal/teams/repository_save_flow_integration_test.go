package teams

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/managementintent"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// CRM_SAVE_FLOW_TEST_DATABASE_URL must point to a disposable loopback database
// with the complete migration chain applied.
func TestTeamCreateUpdateRepeatSaveAndReload(t *testing.T) {
	databaseURL := localSaveFlowDatabaseURL(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:           databaseURL,
		MaxConns:      4,
		HealthTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("connect local PostgreSQL: %v", err)
	}
	t.Cleanup(postgres.Close)
	pool := postgres.Pool()

	var organizationID, userID string
	if err := pool.QueryRow(ctx, `
		insert into public.organizations (name, slug, is_active)
		values ('Team save flow contract', 'team-save-flow-' || gen_random_uuid()::text, true)
		returning id::text
	`).Scan(&organizationID); err != nil {
		t.Fatalf("insert organization: %v", err)
	}
	if err := pool.QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&userID); err != nil {
		t.Fatalf("generate user id: %v", err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		if _, err := pool.Exec(cleanupCtx, `
			update public.users set organization_id = null where id = $1::uuid;
			delete from public.teams where organization_id = $2::uuid;
			delete from public.organization_members where user_id = $1::uuid;
			delete from public.audit_logs where organization_id = $2::uuid;
			delete from public.organizations where id = $2::uuid;
			delete from public.users where id = $1::uuid;
			delete from auth.users where id = $1::uuid
		`, userID, organizationID); err != nil {
			t.Errorf("cleanup team save-flow fixture: %v", err)
		}
	})

	email := fmt.Sprintf("team-save-flow-%s@example.test", strings.ReplaceAll(userID, "-", ""))
	if _, err := pool.Exec(ctx, `
		insert into auth.users (
			id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		) values (
			$1::uuid, 'authenticated', 'authenticated', $2, '', now(),
			'{}'::jsonb, '{}'::jsonb, now(), now()
		);
		insert into public.users (
			id, organization_id, name, email, role, is_active
		) values ($1::uuid, $3::uuid, 'Team save-flow member', $2, 'admin', true)
		on conflict (id) do update
		set organization_id = excluded.organization_id,
		    name = excluded.name,
		    email = excluded.email,
		    role = excluded.role,
		    is_active = excluded.is_active;
		insert into public.organization_members (
			organization_id, user_id, role, is_active
		) values ($3::uuid, $1::uuid, 'admin', true)
		on conflict (user_id, organization_id) do update
		set role = excluded.role,
		    is_active = excluded.is_active,
		    deleted_at = null
	`, userID, email, organizationID); err != nil {
		t.Fatalf("insert team save-flow user: %v", err)
	}

	admin := tenant.Context{
		OrganizationID: organizationID,
		UserID:         userID,
		MemberRole:     "admin",
	}
	repo := NewRepository(postgres, StorageConfig{})
	createWeek := integrationAvailabilityWeek("22:00", "08:00")
	created, err := repo.Create(ctx, admin, CreateTeamRequest{
		IdempotencyKey: "44444444-4444-4444-8444-444444444444",
		Name:           "Equipe noturna",
		Members: []TeamMemberInput{{
			UserID:       userID,
			IsLeader:     true,
			Availability: createWeek,
		}},
	})
	if err != nil {
		t.Fatalf("create team: %v", err)
	}
	if created.ID == "" || len(created.Members) != 1 {
		t.Fatalf("created team shape = id %q, members %d", created.ID, len(created.Members))
	}
	createReplay := CreateTeamRequest{
		IdempotencyKey: "44444444-4444-4444-8444-444444444444", Name: "Equipe noturna",
		Members: []TeamMemberInput{{UserID: userID, IsLeader: true, Availability: createWeek}},
	}
	replayed, err := repo.Create(ctx, admin, createReplay)
	if err != nil || replayed.ID != created.ID || replayed.Revision != created.Revision {
		t.Fatalf("creation replay changed result: team=%#v err=%v", replayed, err)
	}
	createReplay.Name = "Outro pedido"
	if _, err := repo.Create(ctx, admin, createReplay); !errors.Is(err, managementintent.ErrConflict) {
		t.Fatalf("reused key accepted a different request: %v", err)
	}
	memberID := created.Members[0].ID
	assertIntegrationOvernightAvailability(t, ctx, repo, admin, memberID, "22:00:00", "08:00:00")
	if created.Revision != 1 {
		t.Fatalf("new team revision = %d, want 1", created.Revision)
	}
	listed, err := repo.List(ctx, admin, false)
	if err != nil || len(listed) != 1 || listed[0].ID != created.ID || listed[0].Revision != created.Revision {
		t.Fatalf("team list did not expose current revision: items=%#v err=%v", listed, err)
	}

	updatedName := "Equipe noturna editada"
	updateWeek := integrationAvailabilityWeek("23:00", "07:00")
	expectedRevision := created.Revision
	updateRequest := UpdateTeamRequest{
		ExpectedRevision:  &expectedRevision,
		ExpectedMemberIDs: []string{memberID},
		Name:              &updatedName,
		Members: []TeamMemberInput{{
			UserID:       userID,
			IsLeader:     true,
			Availability: updateWeek,
		}},
	}
	updated, err := repo.Update(ctx, admin, created.ID, updateRequest)
	if err != nil {
		t.Fatalf("update team: %v", err)
	}
	if updated.ID != created.ID || updated.Name != updatedName || len(updated.Members) != 1 || updated.Members[0].ID != memberID {
		t.Fatalf("unexpected updated team identity: %#v", updated)
	}
	if updated.Revision != created.Revision+1 {
		t.Fatalf("updated team revision = %d, want %d", updated.Revision, created.Revision+1)
	}

	expectedRevision = updated.Revision
	repeated, err := repo.Update(ctx, admin, created.ID, updateRequest)
	if err != nil {
		t.Fatalf("repeat identical team save: %v", err)
	}
	if repeated.ID != created.ID || len(repeated.Members) != 1 || repeated.Members[0].ID != memberID {
		t.Fatalf("repeat save changed team/member identity: %#v", repeated)
	}
	if repeated.Revision != updated.Revision {
		t.Fatalf("identical save advanced revision: got %d, want %d", repeated.Revision, updated.Revision)
	}

	reloaded, err := repo.Get(ctx, admin, created.ID)
	if err != nil {
		t.Fatalf("reload team: %v", err)
	}
	if reloaded.Name != updatedName || len(reloaded.Members) != 1 || reloaded.Members[0].ID != memberID {
		t.Fatalf("unexpected reloaded team: %#v", reloaded)
	}
	assertIntegrationOvernightAvailability(t, ctx, repo, admin, memberID, "23:00:00", "07:00:00")

	var memberCount, availabilityCount int
	if err := pool.QueryRow(ctx, `
		select
			(select count(*) from public.team_members where organization_id = $1::uuid and team_id = $2::uuid),
			(select count(*) from public.member_availability where organization_id = $1::uuid and team_member_id = $3::uuid)
	`, organizationID, created.ID, memberID).Scan(&memberCount, &availabilityCount); err != nil {
		t.Fatalf("count persisted team rows: %v", err)
	}
	if memberCount != 1 || availabilityCount != 7 {
		t.Fatalf("persisted row counts = members %d, availability %d; want 1 and 7", memberCount, availabilityCount)
	}

	type competingSave struct {
		name string
		team Team
		err  error
	}
	start := make(chan struct{})
	results := make(chan competingSave, 2)
	for _, contender := range []struct {
		name  string
		start string
		end   string
	}{
		{name: "Equipe noturna editora A", start: "21:00", end: "06:00"},
		{name: "Equipe noturna editora B", start: "20:00", end: "05:00"},
	} {
		go func(name, startTime, endTime string) {
			<-start
			expected := repeated.Revision
			team, saveErr := repo.Update(ctx, admin, created.ID, UpdateTeamRequest{
				ExpectedRevision:  &expected,
				ExpectedMemberIDs: []string{memberID},
				Name:              &name,
				Members: []TeamMemberInput{{
					UserID:       userID,
					IsLeader:     true,
					Availability: integrationAvailabilityWeek(startTime, endTime),
				}},
			})
			results <- competingSave{name: name, team: team, err: saveErr}
		}(contender.name, contender.start, contender.end)
	}
	close(start)
	first, second := <-results, <-results
	saves := []competingSave{first, second}
	successCount, conflictCount := 0, 0
	var winner competingSave
	for _, save := range saves {
		switch {
		case save.err == nil:
			successCount++
			winner = save
		case errors.Is(save.err, ErrTeamRevisionConflict):
			conflictCount++
		default:
			t.Fatalf("competing save %q returned unexpected error: %v", save.name, save.err)
		}
	}
	if successCount != 1 || conflictCount != 1 {
		t.Fatalf("competing saves = %d success, %d conflict; want one of each", successCount, conflictCount)
	}
	if winner.team.Revision != repeated.Revision+1 {
		t.Fatalf("winning revision = %d, want %d", winner.team.Revision, repeated.Revision+1)
	}
	finalTeam, err := repo.Get(ctx, admin, created.ID)
	if err != nil || finalTeam.Name != winner.name || finalTeam.Revision != winner.team.Revision {
		t.Fatalf("winning save was overwritten: team=%#v err=%v", finalTeam, err)
	}
	if winner.name == "Equipe noturna editora A" {
		assertIntegrationOvernightAvailability(t, ctx, repo, admin, memberID, "21:00:00", "06:00:00")
	} else {
		assertIntegrationOvernightAvailability(t, ctx, repo, admin, memberID, "20:00:00", "05:00:00")
	}
	var auditBefore int
	if err := pool.QueryRow(ctx, `
		select count(*) from public.audit_logs where organization_id = $1::uuid
	`, organizationID).Scan(&auditBefore); err != nil {
		t.Fatalf("count all audit rows before stale replay: %v", err)
	}
	staleName := "Equipe noturna tentativa antiga"
	if _, err := repo.Update(ctx, admin, created.ID, UpdateTeamRequest{
		ExpectedRevision: &repeated.Revision,
		Name:             &staleName,
	}); !errors.Is(err, ErrTeamRevisionConflict) {
		t.Fatalf("stale replay error = %v, want revision conflict", err)
	}
	var auditAfter int
	if err := pool.QueryRow(ctx, `
		select count(*) from public.audit_logs where organization_id = $1::uuid
	`, organizationID).Scan(&auditAfter); err != nil {
		t.Fatalf("count all audit rows after stale replay: %v", err)
	}
	if auditAfter != auditBefore {
		t.Fatalf("stale replay wrote audit rows: before=%d after=%d", auditBefore, auditAfter)
	}
	unchanged, err := repo.Get(ctx, admin, created.ID)
	if err != nil || unchanged.Name != winner.name || unchanged.Revision != winner.team.Revision || len(unchanged.Members) != 1 {
		t.Fatalf("stale replay changed team or members: team=%#v err=%v", unchanged, err)
	}
	if winner.name == "Equipe noturna editora A" {
		assertIntegrationOvernightAvailability(t, ctx, repo, admin, memberID, "21:00:00", "06:00:00")
	} else {
		assertIntegrationOvernightAvailability(t, ctx, repo, admin, memberID, "20:00:00", "05:00:00")
	}

	statusChanged, err := repo.UpdateStatus(ctx, admin, created.ID, false)
	if err != nil || statusChanged.Revision != winner.team.Revision+1 {
		t.Fatalf("status change did not advance revision: team=%#v err=%v", statusChanged, err)
	}
	statusRepeated, err := repo.UpdateStatus(ctx, admin, created.ID, false)
	if err != nil || statusRepeated.Revision != statusChanged.Revision {
		t.Fatalf("repeated status change advanced revision: team=%#v err=%v", statusRepeated, err)
	}
	updatedMonday := integrationAvailabilityWeek("19:00", "04:00")[1]
	updatedMonday.TeamMemberID = memberID
	updatedMonday.ExpectedRevision = &statusChanged.Revision
	if _, err := repo.UpsertAvailability(ctx, admin, updatedMonday); err != nil {
		t.Fatalf("auxiliary availability update: %v", err)
	}
	afterAvailability, err := repo.Get(ctx, admin, created.ID)
	if err != nil || afterAvailability.Revision != statusChanged.Revision+1 {
		t.Fatalf("availability update did not advance team revision: team=%#v err=%v", afterAvailability, err)
	}
	if _, err := repo.UpsertAvailability(ctx, admin, updatedMonday); !errors.Is(err, ErrTeamRevisionConflict) {
		t.Fatalf("stale availability PATCH overwrote the week: %v", err)
	}
	if _, err := repo.ReplaceAvailability(ctx, admin, memberID, createWeek, &statusChanged.Revision); !errors.Is(err, ErrTeamRevisionConflict) {
		t.Fatalf("stale availability PUT overwrote the week: %v", err)
	}
	availabilitySnapshot, err := repo.GetAvailabilitySnapshot(ctx, admin, memberID)
	if err != nil || availabilitySnapshot.Revision != afterAvailability.Revision || len(availabilitySnapshot.Data) != 7 {
		t.Fatalf("availability snapshot does not bind current revision: snapshot=%#v err=%v", availabilitySnapshot, err)
	}
	if _, err := repo.Update(ctx, admin, created.ID, UpdateTeamRequest{
		ExpectedRevision: &statusChanged.Revision,
		Name:             &staleName,
	}); !errors.Is(err, ErrTeamRevisionConflict) {
		t.Fatalf("editor did not conflict after availability update: %v", err)
	}
	leadershipRequest := SetTeamLeaderRequest{TeamID: created.ID, UserID: userID, IsLeader: false}
	if err := repo.SetTeamLeader(ctx, admin, leadershipRequest); err != nil {
		t.Fatalf("auxiliary leadership update: %v", err)
	}
	afterLeadership, err := repo.Get(ctx, admin, created.ID)
	if err != nil || afterLeadership.Revision != afterAvailability.Revision+1 || len(afterLeadership.Members) != 1 || afterLeadership.Members[0].IsLeader {
		t.Fatalf("leadership update did not advance team revision: team=%#v err=%v", afterLeadership, err)
	}
	if err := repo.SetTeamLeader(ctx, admin, leadershipRequest); err != nil {
		t.Fatalf("repeat identical leadership update: %v", err)
	}
	repeatedLeadership, err := repo.Get(ctx, admin, created.ID)
	if err != nil || repeatedLeadership.Revision != afterLeadership.Revision {
		t.Fatalf("repeat leadership update advanced revision: team=%#v err=%v", repeatedLeadership, err)
	}
	if _, err := repo.Update(ctx, admin, created.ID, UpdateTeamRequest{
		ExpectedRevision: &afterAvailability.Revision,
		Name:             &staleName,
	}); !errors.Is(err, ErrTeamRevisionConflict) {
		t.Fatalf("editor did not conflict after leadership update: %v", err)
	}
}

func TestTemporaryMemberSuspensionPreservesTeamScheduleAndQueue(t *testing.T) {
	databaseURL := localSaveFlowDatabaseURL(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:           databaseURL,
		MaxConns:      4,
		HealthTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("connect local PostgreSQL: %v", err)
	}
	t.Cleanup(postgres.Close)
	pool := postgres.Pool()

	var organizationID string
	if err := pool.QueryRow(ctx, `
		insert into public.organizations (name, slug, is_active)
		values ('Team suspension contract', 'team-suspension-' || gen_random_uuid()::text, true)
		returning id::text
	`).Scan(&organizationID); err != nil {
		t.Fatalf("insert organization: %v", err)
	}
	userIDs := make([]string, 3)
	for index := range userIDs {
		if err := pool.QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&userIDs[index]); err != nil {
			t.Fatalf("generate user %d id: %v", index, err)
		}
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		if _, err := pool.Exec(cleanupCtx, `
			delete from public.round_robin_members where organization_id = $1::uuid;
			delete from public.round_robins where organization_id = $1::uuid;
			update public.users set organization_id = null where id = any($2::uuid[]);
			delete from public.teams where organization_id = $1::uuid;
			delete from public.organization_members where organization_id = $1::uuid;
			delete from public.audit_logs where organization_id = $1::uuid;
			delete from public.organizations where id = $1::uuid;
			delete from public.users where id = any($2::uuid[]);
			delete from auth.users where id = any($2::uuid[])
		`, organizationID, userIDs); err != nil {
			t.Errorf("cleanup team suspension fixture: %v", err)
		}
	})
	for index, userID := range userIDs {
		email := fmt.Sprintf("team-suspension-%s@example.test", strings.ReplaceAll(userID, "-", ""))
		if _, err := pool.Exec(ctx, `
			insert into auth.users (
				id, aud, role, email, encrypted_password, email_confirmed_at,
				raw_app_meta_data, raw_user_meta_data, created_at, updated_at
			) values (
				$1::uuid, 'authenticated', 'authenticated', $2, '', now(),
				'{}'::jsonb, '{}'::jsonb, now(), now()
			);
			insert into public.users (id, organization_id, name, email, role, is_active)
			values ($1::uuid, $3::uuid, $4, $2, 'admin', true)
			on conflict (id) do update
			set organization_id = excluded.organization_id,
			    name = excluded.name,
			    email = excluded.email,
			    role = excluded.role,
			    is_active = excluded.is_active;
			insert into public.organization_members (organization_id, user_id, role, is_active)
			values ($3::uuid, $1::uuid, 'admin', true)
			on conflict (user_id, organization_id) do update
			set role = excluded.role,
			    is_active = excluded.is_active,
			    deleted_at = null
		`, userID, email, organizationID, fmt.Sprintf("Team suspension user %d", index)); err != nil {
			t.Fatalf("insert user %d: %v", index, err)
		}
	}
	admin := tenant.Context{OrganizationID: organizationID, UserID: userIDs[0], MemberRole: "admin"}
	repo := NewRepository(postgres, StorageConfig{})
	week := integrationAvailabilityWeek("22:00", "08:00")
	created, err := repo.Create(ctx, admin, CreateTeamRequest{
		IdempotencyKey: "44444444-4444-4444-8444-444444444444",
		Name:           "Equipe com suspensao",
		Members: []TeamMemberInput{
			{UserID: userIDs[1], Availability: week},
			{UserID: userIDs[2], Availability: week},
		},
	})
	if err != nil || len(created.Members) != 2 {
		t.Fatalf("create team with two members: team=%#v err=%v", created, err)
	}
	memberIDs := map[string]string{}
	for _, member := range created.Members {
		memberIDs[member.UserID] = member.ID
	}
	var queueID, queueMemberID string
	if err := pool.QueryRow(ctx, `
		insert into public.round_robins (organization_id, name, is_active)
		values ($1::uuid, 'Team suspension queue', true)
		returning id::text
	`, organizationID).Scan(&queueID); err != nil {
		t.Fatalf("insert queue: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		insert into public.round_robin_members
		  (organization_id, round_robin_id, team_id, user_id, weight, position, is_active)
		values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 7, 0, true)
		returning id::text
	`, organizationID, queueID, created.ID, userIDs[1]).Scan(&queueMemberID); err != nil {
		t.Fatalf("insert team queue member: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		update public.organization_members set is_active = false
		where organization_id = $1::uuid and user_id = any($2::uuid[])
	`, organizationID, userIDs[1:]); err != nil {
		t.Fatalf("temporarily suspend both team members: %v", err)
	}
	hidden, err := repo.Get(ctx, admin, created.ID)
	if err != nil || len(hidden.Members) != 0 || hidden.Revision != created.Revision {
		t.Fatalf("suspended members remained visible or revision changed: team=%#v err=%v", hidden, err)
	}
	newName := "Equipe com suspensao editada"
	saved, err := repo.Update(ctx, admin, created.ID, UpdateTeamRequest{
		ExpectedRevision:  &hidden.Revision,
		ExpectedMemberIDs: []string{},
		Name:              &newName,
		Members:           []TeamMemberInput{},
	})
	if err != nil || saved.Name != newName || saved.Revision != created.Revision+1 || len(saved.Members) != 0 {
		t.Fatalf("save editor while members are suspended: team=%#v err=%v", saved, err)
	}
	var teamMemberCount, availabilityCount, queueMemberCount int
	if err := pool.QueryRow(ctx, `
		select
		  (select count(*) from public.team_members where organization_id = $1::uuid and team_id = $2::uuid),
		  (select count(*) from public.member_availability where organization_id = $1::uuid and team_member_id = any($3::uuid[])),
		  (select count(*) from public.round_robin_members where organization_id = $1::uuid and round_robin_id = $4::uuid)
	`, organizationID, created.ID, []string{memberIDs[userIDs[1]], memberIDs[userIDs[2]]}, queueID).Scan(&teamMemberCount, &availabilityCount, &queueMemberCount); err != nil {
		t.Fatalf("read suspended member persistence: %v", err)
	}
	if teamMemberCount != 2 || availabilityCount != 14 || queueMemberCount != 1 {
		t.Fatalf("suspended rows changed: team members=%d availability=%d queue members=%d", teamMemberCount, availabilityCount, queueMemberCount)
	}
	if _, err := pool.Exec(ctx, `
		update public.organization_members set is_active = true
		where organization_id = $1::uuid and user_id = any($2::uuid[])
	`, organizationID, userIDs[1:]); err != nil {
		t.Fatalf("reactivate both team members: %v", err)
	}
	restored, err := repo.Get(ctx, admin, created.ID)
	if err != nil || len(restored.Members) != 2 || restored.Revision != saved.Revision {
		t.Fatalf("reactivated members did not return: team=%#v err=%v", restored, err)
	}
	for _, member := range restored.Members {
		if member.ID != memberIDs[member.UserID] {
			t.Fatalf("reactivation changed team member ID: member=%#v", member)
		}
		assertIntegrationOvernightAvailability(t, ctx, repo, admin, member.ID, "22:00:00", "08:00:00")
	}
	var actualQueueID string
	var actualWeight, actualPosition int
	var actualActive bool
	var queueGeneration, membershipGeneration int64
	if err := pool.QueryRow(ctx, `
		select rrm.id::text, rrm.weight, rrm.position, rrm.is_active,
		       rrm.membership_generation, om.membership_generation
		from public.round_robin_members rrm
		join public.organization_members om
		  on om.organization_id = rrm.organization_id and om.user_id = rrm.user_id
		where rrm.organization_id = $1::uuid and rrm.round_robin_id = $2::uuid
	`, organizationID, queueID).Scan(&actualQueueID, &actualWeight, &actualPosition, &actualActive, &queueGeneration, &membershipGeneration); err != nil {
		t.Fatalf("read restored queue member: %v", err)
	}
	if actualQueueID != queueMemberID || actualWeight != 7 || actualPosition != 0 || !actualActive || queueGeneration != membershipGeneration {
		t.Fatalf("queue member changed across temporary suspension: id=%s weight=%d position=%d active=%t generation=%d membership=%d", actualQueueID, actualWeight, actualPosition, actualActive, queueGeneration, membershipGeneration)
	}
	if _, err := pool.Exec(ctx, `
		insert into public.round_robin_members
		  (organization_id, round_robin_id, team_id, user_id, weight, position, is_active)
		values ($1::uuid, $2::uuid, null, $3::uuid, 23, 9, false)
	`, organizationID, queueID, userIDs[0]); err != nil {
		t.Fatalf("insert independent direct participant: %v", err)
	}
	_, err = repo.Update(ctx, admin, created.ID, UpdateTeamRequest{
		ExpectedRevision:  &restored.Revision,
		ExpectedMemberIDs: []string{memberIDs[userIDs[1]], memberIDs[userIDs[2]]},
		Members:           []TeamMemberInput{{UserID: userIDs[1], Availability: week}, {UserID: userIDs[2], Availability: week}, {UserID: userIDs[0], Availability: week}},
	})
	if err != nil {
		t.Fatalf("add independently participating user to team: %v", err)
	}
	var directPreserved bool
	if err := pool.QueryRow(ctx, `
		select team_id is null and weight = 23 and position = 9 and is_active = false
		from public.round_robin_members where organization_id = $1::uuid and round_robin_id = $2::uuid and user_id = $3::uuid
	`, organizationID, queueID, userIDs[0]).Scan(&directPreserved); err != nil || !directPreserved {
		t.Fatalf("team sync altered direct membership: preserved=%t err=%v", directPreserved, err)
	}
}

func TestReinvitedUserNeedsExplicitTeamReenrollment(t *testing.T) {
	databaseURL := localSaveFlowDatabaseURL(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:           databaseURL,
		MaxConns:      4,
		HealthTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("connect local PostgreSQL: %v", err)
	}
	t.Cleanup(postgres.Close)
	pool := postgres.Pool()

	var organizationID, userID string
	if err := pool.QueryRow(ctx, `
		insert into public.organizations (name, slug, is_active)
		values ('Team generation contract', 'team-generation-' || gen_random_uuid()::text, true)
		returning id::text
	`).Scan(&organizationID); err != nil {
		t.Fatalf("insert organization: %v", err)
	}
	if err := pool.QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&userID); err != nil {
		t.Fatalf("generate user id: %v", err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		if _, err := pool.Exec(cleanupCtx, `
			update public.users set organization_id = null where id = $1::uuid;
			delete from public.round_robin_members where organization_id = $2::uuid;
			delete from public.round_robins where organization_id = $2::uuid;
			delete from public.teams where organization_id = $2::uuid;
			delete from public.organization_members where user_id = $1::uuid;
			delete from public.audit_logs where organization_id = $2::uuid;
			delete from public.organizations where id = $2::uuid;
			delete from public.users where id = $1::uuid;
			delete from auth.users where id = $1::uuid
		`, userID, organizationID); err != nil {
			t.Errorf("cleanup team generation fixture: %v", err)
		}
	})
	email := fmt.Sprintf("team-generation-%s@example.test", strings.ReplaceAll(userID, "-", ""))
	if _, err := pool.Exec(ctx, `
		insert into auth.users (
			id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		) values (
			$1::uuid, 'authenticated', 'authenticated', $2, '', now(),
			'{}'::jsonb, '{}'::jsonb, now(), now()
		);
		insert into public.users (
			id, organization_id, name, email, role, is_active
		) values ($1::uuid, $3::uuid, 'Team generation member', $2, 'admin', true)
		on conflict (id) do update
		set organization_id = excluded.organization_id,
		    name = excluded.name,
		    email = excluded.email,
		    role = excluded.role,
		    is_active = excluded.is_active;
		insert into public.organization_members (
			organization_id, user_id, role, is_active
		) values ($3::uuid, $1::uuid, 'admin', true)
		on conflict (user_id, organization_id) do update
		set role = excluded.role,
		    is_active = excluded.is_active,
		    deleted_at = null
	`, userID, email, organizationID); err != nil {
		t.Fatalf("insert team generation user: %v", err)
	}

	admin := tenant.Context{OrganizationID: organizationID, UserID: userID, MemberRole: "admin"}
	repo := NewRepository(postgres, StorageConfig{})
	week := integrationAvailabilityWeek("22:00", "08:00")
	created, err := repo.Create(ctx, admin, CreateTeamRequest{
		IdempotencyKey: "44444444-4444-4444-8444-444444444444",
		Name:           "Equipe geracao",
		Members: []TeamMemberInput{{
			UserID: userID, IsLeader: true, Availability: week,
		}},
	})
	if err != nil || len(created.Members) != 1 {
		t.Fatalf("create team with member: team=%#v err=%v", created, err)
	}
	memberID := created.Members[0].ID
	var queueID, queueMemberID string
	if err := pool.QueryRow(ctx, `
		insert into public.round_robins (organization_id, name, is_active)
		values ($1::uuid, 'Team generation queue', true)
		returning id::text
	`, organizationID).Scan(&queueID); err != nil {
		t.Fatalf("insert generation queue: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		insert into public.round_robin_members
		  (organization_id, round_robin_id, team_id, user_id, position, is_active)
		values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 4, true)
		returning id::text
	`, organizationID, queueID, created.ID, userID).Scan(&queueMemberID); err != nil {
		t.Fatalf("insert generation queue member: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		update public.organization_members
		set is_active = false, deleted_at = now()
		where organization_id = $1::uuid and user_id = $2::uuid
	`, organizationID, userID); err != nil {
		t.Fatalf("remove organization membership: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		update public.organization_members
		set is_active = true, deleted_at = null
		where organization_id = $1::uuid and user_id = $2::uuid
	`, organizationID, userID); err != nil {
		t.Fatalf("restore organization membership: %v", err)
	}

	var currentGeneration, teamGeneration int64
	if err := pool.QueryRow(ctx, `
		select om.membership_generation, tm.membership_generation
		from public.organization_members om
		join public.team_members tm
		  on tm.organization_id = om.organization_id and tm.user_id = om.user_id
		where om.organization_id = $1::uuid and om.user_id = $2::uuid
	`, organizationID, userID).Scan(&currentGeneration, &teamGeneration); err != nil {
		t.Fatalf("read membership generations: %v", err)
	}
	if currentGeneration <= teamGeneration {
		t.Fatalf("reinvitation did not advance generation: organization=%d team=%d", currentGeneration, teamGeneration)
	}
	var staleQueueGeneration int64
	if err := pool.QueryRow(ctx, `
		select membership_generation from public.round_robin_members where id = $1::uuid
	`, queueMemberID).Scan(&staleQueueGeneration); err != nil {
		t.Fatalf("read stale queue generation: %v", err)
	}
	if staleQueueGeneration >= currentGeneration {
		t.Fatalf("queue member was implicitly re-enrolled: queue=%d organization=%d", staleQueueGeneration, currentGeneration)
	}
	stale, err := repo.Get(ctx, admin, created.ID)
	if err != nil || len(stale.Members) != 0 {
		t.Fatalf("stale team member remains visible: team=%#v err=%v", stale, err)
	}
	if stale.Revision != created.Revision {
		t.Fatalf("membership lifecycle unexpectedly advanced team revision: before=%d after=%d", created.Revision, stale.Revision)
	}
	availability, err := repo.ListAvailability(ctx, admin, []string{memberID})
	if err != nil || len(availability) != 0 {
		t.Fatalf("stale member availability remains visible: rows=%#v err=%v", availability, err)
	}
	if err := repo.SetTeamLeader(ctx, admin, SetTeamLeaderRequest{TeamID: created.ID, UserID: userID, IsLeader: true}); !errors.Is(err, ErrTeamMemberNotFound) {
		t.Fatalf("set leader on stale team member: %v", err)
	}
	if _, err := repo.UpsertAvailability(ctx, admin, AvailabilityRequest{
		ExpectedRevision: &stale.Revision,
		TeamMemberID:     memberID,
		DayOfWeek:        1,
		StartTime:        week[1].StartTime,
		EndTime:          week[1].EndTime,
		IsAllDay:         week[1].IsAllDay,
		IsActive:         week[1].IsActive,
	}); !errors.Is(err, ErrTeamMemberNotFound) {
		t.Fatalf("upsert availability on stale team member: %v", err)
	}
	if _, err := repo.ReplaceAvailability(ctx, admin, memberID, week, &stale.Revision); !errors.Is(err, ErrTeamMemberNotFound) {
		t.Fatalf("replace availability on stale team member: %v", err)
	}
	if _, err := repo.Update(ctx, admin, created.ID, UpdateTeamRequest{
		ExpectedRevision:  &created.Revision,
		ExpectedMemberIDs: []string{memberID},
		Members:           []TeamMemberInput{{UserID: userID, IsLeader: true, Availability: week}},
	}); !errors.Is(err, ErrTeamRevisionConflict) {
		t.Fatalf("old editor re-enrolled a removed member: %v", err)
	}
	if _, err := repo.Update(ctx, admin, created.ID, UpdateTeamRequest{
		ExpectedRevision: &created.Revision,
		Members:          []TeamMemberInput{{UserID: userID, IsLeader: true, Availability: week}},
	}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("member replacement without expected_member_ids: %v", err)
	}
	if _, err := repo.Update(ctx, admin, created.ID, UpdateTeamRequest{
		ExpectedRevision:  &created.Revision,
		ExpectedMemberIDs: []string{memberID, memberID},
		Members:           []TeamMemberInput{{UserID: userID, IsLeader: true, Availability: week}},
	}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("duplicate expected_member_ids: %v", err)
	}
	if _, err := repo.Update(ctx, admin, created.ID, UpdateTeamRequest{
		ExpectedRevision:  &created.Revision,
		ExpectedMemberIDs: []string{},
		Members:           []TeamMemberInput{{UserID: userID, IsLeader: true}},
	}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("re-enroll without a new availability week: %v", err)
	}
	updatedName := "Equipe geracao renomeada"
	renamed, err := repo.Update(ctx, admin, created.ID, UpdateTeamRequest{
		ExpectedRevision:  &created.Revision,
		ExpectedMemberIDs: []string{},
		Name:              &updatedName,
		Members:           []TeamMemberInput{},
	})
	if err != nil || renamed.Name != updatedName || renamed.Revision != created.Revision+1 || len(renamed.Members) != 0 {
		t.Fatalf("save name with stale member hidden: team=%#v err=%v", renamed, err)
	}
	var preservedTeamMemberID, preservedQueueMemberID string
	var preservedQueueGeneration int64
	var preservedQueuePosition int
	if err := pool.QueryRow(ctx, `
		select tm.id::text, rrm.id::text, rrm.membership_generation, rrm.position
		from public.team_members tm
		join public.round_robin_members rrm
		  on rrm.organization_id = tm.organization_id
		 and rrm.team_id = tm.team_id
		 and rrm.user_id = tm.user_id
		where tm.id = $1::uuid and rrm.round_robin_id = $2::uuid
	`, memberID, queueID).Scan(&preservedTeamMemberID, &preservedQueueMemberID, &preservedQueueGeneration, &preservedQueuePosition); err != nil {
		t.Fatalf("read stale member and queue after name save: %v", err)
	}
	if preservedTeamMemberID != memberID || preservedQueueMemberID != queueMemberID || preservedQueueGeneration != staleQueueGeneration || preservedQueuePosition != 4 {
		t.Fatalf("name save changed stale member or queue: team_member=%s queue_member=%s generation=%d position=%d", preservedTeamMemberID, preservedQueueMemberID, preservedQueueGeneration, preservedQueuePosition)
	}

	reenrolled, err := repo.Update(ctx, admin, created.ID, UpdateTeamRequest{
		ExpectedRevision:  &renamed.Revision,
		ExpectedMemberIDs: []string{},
		Members:           []TeamMemberInput{{UserID: userID, IsLeader: true, Availability: week}},
	})
	if err != nil || len(reenrolled.Members) != 1 || reenrolled.Members[0].ID != memberID {
		t.Fatalf("explicit team re-enrollment: team=%#v err=%v", reenrolled, err)
	}
	if err := pool.QueryRow(ctx, `
		select tm.membership_generation
		from public.team_members tm
		where tm.id = $1::uuid
	`, memberID).Scan(&teamGeneration); err != nil {
		t.Fatalf("read rebound team generation: %v", err)
	}
	if teamGeneration != currentGeneration {
		t.Fatalf("explicit team save did not rebind generation: organization=%d team=%d", currentGeneration, teamGeneration)
	}
	var reboundQueueID string
	var reboundQueueGeneration int64
	var reboundQueuePosition int
	var reboundQueueActive bool
	if err := pool.QueryRow(ctx, `
		select id::text, membership_generation, position, is_active
		from public.round_robin_members
		where organization_id = $1::uuid and round_robin_id = $2::uuid and user_id = $3::uuid
	`, organizationID, queueID, userID).Scan(&reboundQueueID, &reboundQueueGeneration, &reboundQueuePosition, &reboundQueueActive); err != nil {
		t.Fatalf("read rebound queue member: %v", err)
	}
	if reboundQueueID != queueMemberID || reboundQueueGeneration != currentGeneration || reboundQueuePosition != 4 || !reboundQueueActive {
		t.Fatalf("explicit team save did not rebind queue member: id=%s generation=%d position=%d active=%t want id=%s generation=%d position=4", reboundQueueID, reboundQueueGeneration, reboundQueuePosition, reboundQueueActive, queueMemberID, currentGeneration)
	}
	assertIntegrationOvernightAvailability(t, ctx, repo, admin, memberID, "22:00:00", "08:00:00")
}

func localSaveFlowDatabaseURL(t *testing.T) string {
	t.Helper()
	databaseURL := strings.TrimSpace(os.Getenv("CRM_SAVE_FLOW_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set CRM_SAVE_FLOW_TEST_DATABASE_URL to run local save-flow integration contracts")
	}
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse CRM_SAVE_FLOW_TEST_DATABASE_URL: %v", err)
	}
	switch strings.ToLower(target.Hostname()) {
	case "127.0.0.1", "localhost", "::1":
	default:
		t.Fatalf("CRM_SAVE_FLOW_TEST_DATABASE_URL must use a loopback host, got %q", target.Hostname())
	}
	return databaseURL
}

func integrationAvailabilityWeek(overnightStart string, overnightEnd string) []AvailabilityRequest {
	week := make([]AvailabilityRequest, 0, 7)
	for day := 0; day < 7; day++ {
		start, end := "08:00", "18:00"
		if day == 1 {
			start, end = overnightStart, overnightEnd
		}
		active := true
		allDay := false
		week = append(week, AvailabilityRequest{
			DayOfWeek: day,
			StartTime: &start,
			EndTime:   &end,
			IsAllDay:  &allDay,
			IsActive:  &active,
		})
	}
	return week
}

func assertIntegrationOvernightAvailability(
	t *testing.T,
	ctx context.Context,
	repo Repository,
	tenantContext tenant.Context,
	memberID string,
	wantStart string,
	wantEnd string,
) {
	t.Helper()
	availability, err := repo.ListAvailability(ctx, tenantContext, []string{memberID})
	if err != nil {
		t.Fatalf("list member availability: %v", err)
	}
	if len(availability) != 7 {
		t.Fatalf("availability rows = %d, want 7", len(availability))
	}
	for _, entry := range availability {
		if entry.DayOfWeek != 1 {
			continue
		}
		if entry.StartTime == nil || entry.EndTime == nil || *entry.StartTime != wantStart || *entry.EndTime != wantEnd {
			t.Fatalf("overnight availability = %v-%v, want %s-%s", entry.StartTime, entry.EndTime, wantStart, wantEnd)
		}
		return
	}
	t.Fatal("overnight Monday availability not found")
}
