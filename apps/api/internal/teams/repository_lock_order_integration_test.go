package teams

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// A queue writer holds round_robins before inserting its member. The insert
// needs FK key-share locks on users and teams while a team save may already
// hold those rows and wait for the queue. Neither side may deadlock.
func TestTeamSaveAndQueueMemberInsertLockOrder(t *testing.T) {
	databaseURL := localSaveFlowDatabaseURL(t)
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL: databaseURL, MaxConns: 4, HealthTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("connect local PostgreSQL: %v", err)
	}
	t.Cleanup(postgres.Close)
	pool := postgres.Pool()

	var organizationID, userID, teamID, queueID string
	if err := pool.QueryRow(ctx, `
		insert into public.organizations (name, slug, is_active)
		values ('Team queue lock contract', 'team-queue-lock-' || gen_random_uuid()::text, true)
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
			t.Errorf("cleanup team queue lock fixture: %v", err)
		}
	})
	email := fmt.Sprintf("team-queue-lock-%s@example.test", strings.ReplaceAll(userID, "-", ""))
	if _, err := pool.Exec(ctx, `
		insert into auth.users (
			id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		) values (
			$1::uuid, 'authenticated', 'authenticated', $2, '', now(),
			'{}'::jsonb, '{}'::jsonb, now(), now()
		);
		insert into public.users (id, organization_id, name, email, role, is_active)
		values ($1::uuid, $3::uuid, 'Team queue lock member', $2, 'admin', true)
		on conflict (id) do update
		set organization_id = excluded.organization_id,
		    name = excluded.name,
		    email = excluded.email,
		    role = excluded.role,
		    is_active = excluded.is_active;
		insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($3::uuid, $1::uuid, 'admin', true)
		on conflict (user_id, organization_id) do update
		set role = excluded.role, is_active = excluded.is_active, deleted_at = null
	`, userID, email, organizationID); err != nil {
		t.Fatalf("insert user and membership: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		insert into public.teams (organization_id, name, is_active, created_by)
		values ($1::uuid, 'Team queue lock contract', true, $2::uuid)
		returning id::text
	`, organizationID, userID).Scan(&teamID); err != nil {
		t.Fatalf("insert team: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		insert into public.team_members (organization_id, team_id, user_id, is_active)
		values ($1::uuid, $2::uuid, $3::uuid, true)
	`, organizationID, teamID, userID); err != nil {
		t.Fatalf("insert team member: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		insert into public.round_robins (organization_id, name, is_active)
		values ($1::uuid, 'Team queue lock contract', true)
		returning id::text
	`, organizationID).Scan(&queueID); err != nil {
		t.Fatalf("insert round robin: %v", err)
	}

	queueTx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin queue transaction: %v", err)
	}
	defer queueTx.Rollback(context.Background())
	var lockedQueueID string
	if err := queueTx.QueryRow(ctx, `
		select id::text from public.round_robins
		where id = $1::uuid for update
	`, queueID).Scan(&lockedQueueID); err != nil {
		t.Fatalf("lock queue: %v", err)
	}

	teamTx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin team transaction: %v", err)
	}
	defer teamTx.Rollback(context.Background())
	if _, err := lockTeamRevision(ctx, teamTx, organizationID, teamID); err != nil {
		t.Fatalf("lock team: %v", err)
	}
	if err := lockTeamRosterDependencies(ctx, teamTx, organizationID, teamID, []string{userID}); err != nil {
		t.Fatalf("lock roster: %v", err)
	}
	var teamPID int32
	if err := teamTx.QueryRow(ctx, `select pg_backend_pid()`).Scan(&teamPID); err != nil {
		t.Fatalf("read team transaction pid: %v", err)
	}

	queueLockDone := make(chan error, 1)
	go func() {
		var id string
		queueLockDone <- teamTx.QueryRow(ctx, `
			select id::text from public.round_robins
			where id = $1::uuid for update
		`, queueID).Scan(&id)
	}()
	waitCtx, waitCancel := context.WithTimeout(ctx, 3*time.Second)
	defer waitCancel()
	for {
		var waitingForLock bool
		if err := pool.QueryRow(waitCtx, `
			select wait_event_type = 'Lock'
			from pg_stat_activity where pid = $1
		`, teamPID).Scan(&waitingForLock); err != nil {
			t.Fatalf("observe team lock wait: %v", err)
		}
		if waitingForLock {
			break
		}
		select {
		case err := <-queueLockDone:
			t.Fatalf("team queue lock finished before queue transaction committed: %v", err)
		case <-waitCtx.Done():
			t.Fatalf("team transaction did not wait for queue lock: %v", waitCtx.Err())
		case <-time.After(10 * time.Millisecond):
		}
	}
	insertCtx, insertCancel := context.WithTimeout(ctx, 3*time.Second)
	defer insertCancel()
	if _, err := queueTx.Exec(insertCtx, `
		insert into public.round_robin_members
		  (organization_id, round_robin_id, team_id, user_id, position, is_active)
		values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 0, true)
	`, organizationID, queueID, teamID, userID); err != nil {
		t.Fatalf("queue insert blocked by team parent/user locks: %v", err)
	}
	if err := queueTx.Commit(ctx); err != nil {
		t.Fatalf("commit queue insert: %v", err)
	}
	select {
	case err := <-queueLockDone:
		if err != nil {
			t.Fatalf("team queue lock after queue commit: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("team queue lock did not finish after queue commit")
	}
	if err := teamTx.Commit(ctx); err != nil {
		t.Fatalf("commit team transaction: %v", err)
	}

	// The delete pre-lock must also allow a queue insert to complete. The FK
	// then reports that the team is in use when the delete races that insert.
	if _, err := pool.Exec(ctx, `
		delete from public.round_robin_members
		where organization_id = $1::uuid and round_robin_id = $2::uuid
	`, organizationID, queueID); err != nil {
		t.Fatalf("clear queue before delete race: %v", err)
	}
	deleteTx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin delete transaction: %v", err)
	}
	defer deleteTx.Rollback(context.Background())
	if _, err := lockTeamRevision(ctx, deleteTx, organizationID, teamID); err != nil {
		t.Fatalf("lock team before delete: %v", err)
	}
	var deletePID int32
	if err := deleteTx.QueryRow(ctx, `select pg_backend_pid()`).Scan(&deletePID); err != nil {
		t.Fatalf("read delete transaction pid: %v", err)
	}
	secondQueueTx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin second queue transaction: %v", err)
	}
	defer secondQueueTx.Rollback(context.Background())
	if err := secondQueueTx.QueryRow(ctx, `
		select id::text from public.round_robins
		where id = $1::uuid for update
	`, queueID).Scan(&lockedQueueID); err != nil {
		t.Fatalf("lock queue before delete: %v", err)
	}
	insertCtx, insertCancel = context.WithTimeout(ctx, 3*time.Second)
	defer insertCancel()
	if _, err := secondQueueTx.Exec(insertCtx, `
		insert into public.round_robin_members
		  (organization_id, round_robin_id, team_id, user_id, position, is_active)
		values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 0, true)
	`, organizationID, queueID, teamID, userID); err != nil {
		t.Fatalf("queue insert blocked by delete pre-lock: %v", err)
	}
	deleteRepo := Repository{beginMutationTx: func(context.Context) (pgx.Tx, error) {
		return deleteTx, nil
	}}
	deleteDone := make(chan error, 1)
	go func() {
		deleteDone <- deleteRepo.Delete(ctx, tenant.Context{
			OrganizationID: organizationID, UserID: userID, MemberRole: "admin",
		}, teamID)
	}()
	waitCtx, waitCancel = context.WithTimeout(ctx, 3*time.Second)
	defer waitCancel()
	for {
		var waitingForLock bool
		if err := pool.QueryRow(waitCtx, `
			select wait_event_type = 'Lock'
			from pg_stat_activity where pid = $1
		`, deletePID).Scan(&waitingForLock); err != nil {
			t.Fatalf("observe delete lock wait: %v", err)
		}
		if waitingForLock {
			break
		}
		select {
		case err := <-deleteDone:
			t.Fatalf("delete finished while queue insert was uncommitted: %v", err)
		case <-waitCtx.Done():
			t.Fatalf("delete did not wait for queue insert: %v", waitCtx.Err())
		case <-time.After(10 * time.Millisecond):
		}
	}
	if err := secondQueueTx.Commit(ctx); err != nil {
		t.Fatalf("commit second queue insert: %v", err)
	}
	select {
	case err := <-deleteDone:
		if !errors.Is(err, ErrTeamInUse) {
			t.Fatalf("delete race error = %v, want team in use", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("delete did not finish after queue commit")
	}
}
