package roundrobin

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// ROUND_ROBIN_TEST_DATABASE_URL must point to a disposable loopback database
// with the complete migration chain applied. The fixture intentionally stays
// in that disposable database so cleanup cannot weaken the hard-delete guard.
func TestDeletedQueueRetainsFrozenIntakeIdentity(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("ROUND_ROBIN_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set ROUND_ROBIN_TEST_DATABASE_URL to run the local queue tombstone contract")
	}
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse ROUND_ROBIN_TEST_DATABASE_URL: %v", err)
	}
	switch strings.ToLower(target.Hostname()) {
	case "127.0.0.1", "localhost", "::1":
	default:
		t.Fatalf("ROUND_ROBIN_TEST_DATABASE_URL must use a loopback host, got %q", target.Hostname())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:           databaseURL,
		MaxConns:      6,
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
		values ('Queue tombstone contract', 'queue-tombstone-' || gen_random_uuid()::text, true)
		returning id::text
	`).Scan(&organizationID); err != nil {
		t.Fatalf("insert organization: %v", err)
	}
	insertPipeline := func(name string, isDefault bool, position int) (string, string) {
		t.Helper()
		var pipelineID string
		if err := pool.QueryRow(ctx, `
			insert into public.pipelines (
			  organization_id, name, is_default, is_active, position
			) values ($1::uuid, $2, $3, true, $4)
			returning id::text
		`, organizationID, name, isDefault, position).Scan(&pipelineID); err != nil {
			t.Fatalf("insert pipeline %s: %v", name, err)
		}
		var stageID string
		if err := pool.QueryRow(ctx, `
			insert into public.stages (
			  organization_id, pipeline_id, name, stage_key, position, is_active
			) values ($1::uuid, $2::uuid, $3, 'new', 0, true)
			returning id::text
		`, organizationID, pipelineID, name+" stage").Scan(&stageID); err != nil {
			t.Fatalf("insert stage %s: %v", name, err)
		}
		return pipelineID, stageID
	}

	originalPipelineID, originalStageID := insertPipeline("Original destination", true, 0)
	fallbackPipelineID, fallbackStageID := insertPipeline("Fallback destination", false, 1)

	var queueID string
	if err := pool.QueryRow(ctx, `
		insert into public.round_robins (
		  organization_id, name, is_active, pipeline_id,
		  target_pipeline_id, target_stage_id, reentry_behavior
		) values ($1::uuid, 'Frozen intake queue', true, $2::uuid, $2::uuid, $3::uuid, 'keep_assignee')
		returning id::text
	`, organizationID, originalPipelineID, originalStageID).Scan(&queueID); err != nil {
		t.Fatalf("insert queue: %v", err)
	}
	var ruleID string
	if err := pool.QueryRow(ctx, `
		insert into public.round_robin_rules (
		  organization_id, round_robin_id, match_type, match_value, is_active, priority
		) values ($1::uuid, $2::uuid, 'source', 'whatsapp', true, 100)
		returning id::text
	`, organizationID, queueID).Scan(&ruleID); err != nil {
		t.Fatalf("insert queue rule: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		update public.pipelines
		set default_round_robin_id = $2::uuid
		where organization_id = $1::uuid and id = $3::uuid
	`, organizationID, queueID, originalPipelineID); err != nil {
		t.Fatalf("link pipeline default queue: %v", err)
	}
	var historicalLogID string
	if err := pool.QueryRow(ctx, `
		insert into public.round_robin_logs (
		  organization_id, round_robin_id, reason, metadata
		) values (
		  $1::uuid, $2::uuid, 'queue_tombstone_history_contract',
		  '{"preserve":true}'::jsonb
		)
		returning id::text
	`, organizationID, queueID).Scan(&historicalLogID); err != nil {
		t.Fatalf("insert queue history fixture: %v", err)
	}
	var foreignKeyCleanupQueueID string
	if err := pool.QueryRow(ctx, `
		insert into public.round_robins (
		  organization_id, name, is_active,
		  target_pipeline_id, target_stage_id, reentry_behavior
		) values ($1::uuid, 'Foreign-key cleanup tombstone', true, $2::uuid, $3::uuid, 'keep_assignee')
		returning id::text
	`, organizationID, originalPipelineID, originalStageID).Scan(&foreignKeyCleanupQueueID); err != nil {
		t.Fatalf("insert foreign-key cleanup queue: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		update public.round_robins
		set is_active = false, deleted_at = clock_timestamp()
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, foreignKeyCleanupQueueID); err != nil {
		t.Fatalf("create foreign-key cleanup tombstone: %v", err)
	}
	var otherOrganizationID string
	if err := pool.QueryRow(ctx, `
		insert into public.organizations (name, slug, is_active)
		values ('Queue tenant guard', 'queue-tenant-guard-' || gen_random_uuid()::text, true)
		returning id::text
	`).Scan(&otherOrganizationID); err != nil {
		t.Fatalf("insert second organization: %v", err)
	}
	var tenantGuardPipelineID string
	if err := pool.QueryRow(ctx, `
		insert into public.pipelines (
		  organization_id, name, is_default, is_active, position,
		  default_round_robin_id
		) values ($1::uuid, 'Tenant guard pipeline', false, true, 2, $2::uuid)
		returning id::text
	`, organizationID, queueID).Scan(&tenantGuardPipelineID); err != nil {
		t.Fatalf("insert tenant guard pipeline: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		update public.pipelines
		set organization_id = $2::uuid
		where id = $1::uuid
	`, tenantGuardPipelineID, otherOrganizationID); postgresErrorCode(err) != "23503" {
		t.Fatalf("cross-tenant queue reference error = %v, want SQLSTATE 23503", err)
	}

	repo := NewRepository(postgres)
	admin := tenant.Context{OrganizationID: organizationID, MemberRole: "admin"}
	if err := repo.Delete(ctx, admin, queueID); err != nil {
		t.Fatalf("delete queue: %v", err)
	}

	var active bool
	var deletedAt *time.Time
	var pipelineID, targetPipelineID, targetStageID *string
	var snapshotPipelineID, snapshotStageID string
	if err := pool.QueryRow(ctx, `
		select
		  coalesce(is_active, true), deleted_at,
		  pipeline_id::text, target_pipeline_id::text, target_stage_id::text,
		  tombstone_pipeline_id::text, tombstone_stage_id::text
		from public.round_robins
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, queueID).Scan(
		&active,
		&deletedAt,
		&pipelineID,
		&targetPipelineID,
		&targetStageID,
		&snapshotPipelineID,
		&snapshotStageID,
	); err != nil {
		t.Fatalf("read queue tombstone: %v", err)
	}
	if active || deletedAt == nil {
		t.Fatalf("queue tombstone state = active:%t deletedAt:%v", active, deletedAt)
	}
	if pipelineID != nil || targetPipelineID != nil || targetStageID != nil {
		t.Fatalf("queue retained mutable destination FKs: pipeline=%v target=%v stage=%v", pipelineID, targetPipelineID, targetStageID)
	}
	if snapshotPipelineID != originalPipelineID || snapshotStageID != originalStageID {
		t.Fatalf("frozen destination = %s/%s, want %s/%s", snapshotPipelineID, snapshotStageID, originalPipelineID, originalStageID)
	}

	var defaultQueueID *string
	if err := pool.QueryRow(ctx, `
		select default_round_robin_id::text
		from public.pipelines
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, originalPipelineID).Scan(&defaultQueueID); err != nil {
		t.Fatalf("read pipeline default queue: %v", err)
	}
	if defaultQueueID != nil {
		t.Fatalf("pipeline still references deleted queue %v", defaultQueueID)
	}
	if _, err := pool.Exec(ctx, `
		update public.pipelines
		set default_round_robin_id = $2::uuid
		where organization_id = $1::uuid and id = $3::uuid
	`, organizationID, queueID, originalPipelineID); postgresErrorCode(err) != "23503" {
		t.Fatalf("stale queue relink error = %v, want SQLSTATE 23503", err)
	}
	var childCount int
	if err := pool.QueryRow(ctx, `
		select count(*)::int
		from public.round_robin_rules
		where organization_id = $1::uuid and round_robin_id = $2::uuid
	`, organizationID, queueID).Scan(&childCount); err != nil {
		t.Fatalf("count queue rules: %v", err)
	}
	if childCount != 0 {
		t.Fatalf("deleted queue retained %d routing rules", childCount)
	}
	var historicalLogCount int
	if err := pool.QueryRow(ctx, `
		select count(*)::int
		from public.round_robin_logs
		where organization_id = $1::uuid
		  and round_robin_id = $2::uuid
		  and id = $3::uuid
		  and metadata @> '{"preserve":true}'::jsonb
	`, organizationID, queueID, historicalLogID).Scan(&historicalLogCount); err != nil {
		t.Fatalf("read queue history after tombstone: %v", err)
	}
	if historicalLogCount != 1 {
		t.Fatalf("queue tombstone preserved %d historical logs, want 1", historicalLogCount)
	}

	var scopeKey string
	if err := pool.QueryRow(ctx, `
		select private.lead_intake_scope_for_queue($1::uuid, $2::uuid)
	`, organizationID, queueID).Scan(&scopeKey); err != nil {
		t.Fatalf("resolve tombstone intake scope: %v", err)
	}
	if want := "queue:" + queueID; scopeKey != want {
		t.Fatalf("scope key = %q, want %q", scopeKey, want)
	}

	if queues, err := repo.List(ctx, admin); err != nil {
		t.Fatalf("list queues: %v", err)
	} else if len(queues) != 0 {
		t.Fatalf("list exposed %d deleted queue(s)", len(queues))
	}
	if _, err := repo.Get(ctx, admin, queueID); !errors.Is(err, ErrRoundRobinNotFound) {
		t.Fatalf("Get tombstone error = %v, want ErrRoundRobinNotFound", err)
	}
	if _, err := repo.Update(ctx, admin, queueID, updateInput{
		Name: patchString{Set: true, Value: stringPointer("Resurrected")},
	}); !errors.Is(err, ErrRoundRobinNotFound) {
		t.Fatalf("Update tombstone error = %v, want ErrRoundRobinNotFound", err)
	}
	if _, err := repo.CreateRule(ctx, admin, ruleMutationInput{
		RoundRobinID: queueID,
		MatchType:    "source",
		MatchValue:   "portal",
		IsActive:     true,
	}); !errors.Is(err, ErrRoundRobinNotFound) {
		t.Fatalf("CreateRule tombstone error = %v, want ErrRoundRobinNotFound", err)
	}
	if _, err := repo.AddMember(ctx, admin, queueID, memberMutationInput{}); !errors.Is(err, ErrRoundRobinNotFound) {
		t.Fatalf("AddMember tombstone error = %v, want ErrRoundRobinNotFound", err)
	}
	if err := repo.Delete(ctx, admin, queueID); !errors.Is(err, ErrRoundRobinNotFound) {
		t.Fatalf("second Delete error = %v, want ErrRoundRobinNotFound", err)
	}
	if _, err := pool.Exec(ctx, `
		delete from public.round_robins
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, queueID); postgresErrorCode(err) != "55000" {
		t.Fatalf("hard-delete tombstone error = %v, want SQLSTATE 55000", err)
	}

	insertScopedLead := func(phoneSuffix string) (string, string, string) {
		t.Helper()
		var leadID, leadPipelineID, leadStageID string
		if err := pool.QueryRow(ctx, `
			insert into public.leads (
			  organization_id, name, phone, source,
			  origin_round_robin_id, intake_scope_key
			) values (
			  $1::uuid, $2, $3, 'manual', $4::uuid, 'queue:' || $4::text
			)
			returning id::text, pipeline_id::text, stage_id::text
		`, organizationID, "Delayed queue lead "+phoneSuffix, "5511999"+phoneSuffix, queueID).Scan(
			&leadID,
			&leadPipelineID,
			&leadStageID,
		); err != nil {
			t.Fatalf("insert queue-scoped lead %s: %v", phoneSuffix, err)
		}
		return leadID, leadPipelineID, leadStageID
	}

	firstLeadID, firstPipelineID, firstStageID := insertScopedLead("000001")
	if firstPipelineID != originalPipelineID || firstStageID != originalStageID {
		t.Fatalf("delayed lead destination = %s/%s, want frozen %s/%s", firstPipelineID, firstStageID, originalPipelineID, originalStageID)
	}
	assertDeletedQueueDoesNotDistribute(t, ctx, pool, organizationID, queueID, firstLeadID, "original")
	if _, err := pool.Exec(ctx, `delete from public.leads where id = $1::uuid`, firstLeadID); err != nil {
		t.Fatalf("delete first delayed lead: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		update public.pipelines
		set is_default = false
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, originalPipelineID); err != nil {
		t.Fatalf("demote original pipeline: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		update public.pipelines
		set is_default = true
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, fallbackPipelineID); err != nil {
		t.Fatalf("promote fallback pipeline: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		delete from public.pipelines
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, originalPipelineID); err != nil {
		t.Fatalf("delete original destination after queue tombstone: %v", err)
	}
	var clearedTargetPipelineID, clearedTargetStageID *string
	var retainedSnapshotPipelineID, retainedSnapshotStageID string
	if err := pool.QueryRow(ctx, `
		select
		  target_pipeline_id::text, target_stage_id::text,
		  tombstone_pipeline_id::text, tombstone_stage_id::text
		from public.round_robins
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, foreignKeyCleanupQueueID).Scan(
		&clearedTargetPipelineID,
		&clearedTargetStageID,
		&retainedSnapshotPipelineID,
		&retainedSnapshotStageID,
	); err != nil {
		t.Fatalf("read foreign-key cleanup tombstone: %v", err)
	}
	if clearedTargetPipelineID != nil || clearedTargetStageID != nil {
		t.Fatalf("foreign-key cleanup retained target refs %v/%v", clearedTargetPipelineID, clearedTargetStageID)
	}
	if retainedSnapshotPipelineID != originalPipelineID || retainedSnapshotStageID != originalStageID {
		t.Fatalf(
			"foreign-key cleanup changed frozen destination %s/%s, want %s/%s",
			retainedSnapshotPipelineID,
			retainedSnapshotStageID,
			originalPipelineID,
			originalStageID,
		)
	}

	secondLeadID, secondPipelineID, secondStageID := insertScopedLead("000002")
	if secondPipelineID != fallbackPipelineID || secondStageID != fallbackStageID {
		t.Fatalf("fallback lead destination = %s/%s, want active default %s/%s", secondPipelineID, secondStageID, fallbackPipelineID, fallbackStageID)
	}
	var fallbackAudit bool
	if err := pool.QueryRow(ctx, `
		select coalesce(
		  metadata->'round_robin_tombstone_destination_fallback'->>'round_robin_id' = $2,
		  false
		)
		from public.leads
		where organization_id = $1::uuid and id = $3::uuid
	`, organizationID, queueID, secondLeadID).Scan(&fallbackAudit); err != nil {
		t.Fatalf("read fallback audit metadata: %v", err)
	}
	if !fallbackAudit {
		t.Fatal("fallback destination was not recorded in lead metadata")
	}
	assertDeletedQueueDoesNotDistribute(t, ctx, pool, organizationID, queueID, secondLeadID, "fallback")
}

func TestRoundRobinHardDeleteGuardAllowsOnlyOrganizationCascade(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("ROUND_ROBIN_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set ROUND_ROBIN_TEST_DATABASE_URL to run the local queue tombstone contract")
	}
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse ROUND_ROBIN_TEST_DATABASE_URL: %v", err)
	}
	switch strings.ToLower(target.Hostname()) {
	case "127.0.0.1", "localhost", "::1":
	default:
		t.Fatalf("ROUND_ROBIN_TEST_DATABASE_URL must use a loopback host, got %q", target.Hostname())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:           databaseURL,
		MaxConns:      3,
		HealthTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("connect local PostgreSQL: %v", err)
	}
	t.Cleanup(postgres.Close)
	pool := postgres.Pool()

	var organizationID, queueID string
	if err := pool.QueryRow(ctx, `
		insert into public.organizations (name, slug, is_active)
		values (
		  'Queue hard-delete cascade contract',
		  'queue-hard-delete-' || gen_random_uuid()::text,
		  true
		)
		returning id::text
	`).Scan(&organizationID); err != nil {
		t.Fatalf("insert cascade organization: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		insert into public.round_robins (
		  organization_id, name, is_active, reentry_behavior
		) values ($1::uuid, 'Queue hard-delete guard', true, 'keep_assignee')
		returning id::text
	`, organizationID).Scan(&queueID); err != nil {
		t.Fatalf("insert cascade queue: %v", err)
	}

	var userID string
	if err := pool.QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&userID); err != nil {
		t.Fatalf("generate cascade fixture user: %v", err)
	}
	userEmail := "queue-cascade-" + strings.ReplaceAll(userID, "-", "") + "@example.test"
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		if _, err := pool.Exec(cleanupCtx, `
			update public.users set organization_id = null where id = $1::uuid;
			delete from public.organization_members where user_id = $1::uuid;
			delete from public.organizations where id = $2::uuid;
			delete from public.users where id = $1::uuid;
			delete from auth.users where id = $1::uuid
		`, userID, organizationID); err != nil {
			t.Errorf("cleanup queue cascade fixture: %v", err)
		}
	})
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
		) values (
		  $1::uuid, $3::uuid, 'Queue cascade member', $2, 'admin', true
		)
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
	`, userID, userEmail, organizationID); err != nil {
		t.Fatalf("insert cascade fixture user: %v", err)
	}

	var teamID, teamMemberID, availabilityID, pipelineID string
	if err := pool.QueryRow(ctx, `
		insert into public.teams (organization_id, name, is_active)
		values ($1::uuid, 'Queue cascade team', true)
		returning id::text
	`, organizationID).Scan(&teamID); err != nil {
		t.Fatalf("insert cascade team: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		insert into public.team_members (
		  organization_id, team_id, user_id, is_leader, is_active
		) values ($1::uuid, $2::uuid, $3::uuid, true, true)
		returning id::text
	`, organizationID, teamID, userID).Scan(&teamMemberID); err != nil {
		t.Fatalf("insert cascade team member: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		insert into public.member_availability (
		  organization_id, team_member_id, day_of_week,
		  start_time, end_time, is_all_day, is_active
		) values (
		  $1::uuid, $2::uuid, 1, '08:00'::time, '18:00'::time, false, true
		)
		returning id::text
	`, organizationID, teamMemberID).Scan(&availabilityID); err != nil {
		t.Fatalf("insert cascade member availability: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		insert into public.pipelines (
		  organization_id, name, is_default, is_active, position
		) values ($1::uuid, 'Queue cascade pipeline', true, true, 0)
		returning id::text
	`, organizationID).Scan(&pipelineID); err != nil {
		t.Fatalf("insert cascade pipeline: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		insert into public.team_pipelines (
		  organization_id, team_id, pipeline_id
		) values ($1::uuid, $2::uuid, $3::uuid);
		insert into public.round_robin_members (
		  organization_id, round_robin_id, team_id, weight, position, is_active
		) values ($1::uuid, $4::uuid, $2::uuid, 1, 0, true)
	`, organizationID, teamID, pipelineID, queueID); err != nil {
		t.Fatalf("insert cascade team pipeline and queue member: %v", err)
	}

	var deletedRuleID string
	if err := pool.QueryRow(ctx, `
		insert into public.round_robin_rules (
		  organization_id, round_robin_id, match_type, match_value,
		  is_active, priority
		) values ($1::uuid, $2::uuid, 'source', 'cascade-delete-audit', true, 10)
		returning id::text
	`, organizationID, queueID).Scan(&deletedRuleID); err != nil {
		t.Fatalf("insert directly audited queue rule: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		delete from public.round_robin_rules
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, deletedRuleID); err != nil {
		t.Fatalf("delete queue rule while organization exists: %v", err)
	}
	var directRuleDeleteAuditCount int
	if err := pool.QueryRow(ctx, `
		select count(*)::int
		from public.audit_logs
		where organization_id = $1::uuid
		  and entity_type = 'distribution_queue_rule'
		  and entity_id = $2
		  and action = 'delete'
	`, organizationID, deletedRuleID).Scan(&directRuleDeleteAuditCount); err != nil {
		t.Fatalf("read direct rule delete audit: %v", err)
	}
	if directRuleDeleteAuditCount != 1 {
		t.Fatalf("direct rule delete audits = %d, want 1", directRuleDeleteAuditCount)
	}

	var liveRuleID string
	if err := pool.QueryRow(ctx, `
		insert into public.round_robin_rules (
		  organization_id, round_robin_id, match_type, match_value,
		  is_active, priority
		) values ($1::uuid, $2::uuid, 'source', 'cascade-live-child', true, 20)
		returning id::text
	`, organizationID, queueID).Scan(&liveRuleID); err != nil {
		t.Fatalf("insert cascade live queue rule: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		update public.round_robins
		set is_active = false,
		    deleted_at = clock_timestamp(),
		    updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, queueID); err != nil {
		t.Fatalf("tombstone queue for audit contract: %v", err)
	}
	var tombstoneAuditCount int
	if err := pool.QueryRow(ctx, `
		select count(*)::int
		from public.audit_logs
		where organization_id = $1::uuid
		  and entity_type = 'distribution_queue'
		  and entity_id = $2
		  and action = 'update'
		  and new_data->>'deleted_at' is not null
	`, organizationID, queueID).Scan(&tombstoneAuditCount); err != nil {
		t.Fatalf("read queue tombstone audit: %v", err)
	}
	if tombstoneAuditCount != 1 {
		t.Fatalf("queue tombstone audits = %d, want 1", tombstoneAuditCount)
	}
	var serviceRoleCanDelete, serviceRoleCanTruncate bool
	if err := pool.QueryRow(ctx, `
		select
		  has_table_privilege('service_role', 'public.round_robins', 'delete'),
		  has_table_privilege('service_role', 'public.round_robins', 'truncate')
	`).Scan(&serviceRoleCanDelete, &serviceRoleCanTruncate); err != nil {
		t.Fatalf("read service-role queue privileges: %v", err)
	}
	if serviceRoleCanDelete || serviceRoleCanTruncate {
		t.Fatalf(
			"service_role destructive queue privileges = delete:%t truncate:%t",
			serviceRoleCanDelete,
			serviceRoleCanTruncate,
		)
	}

	truncateTx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin queue truncate defense: %v", err)
	}
	if _, err := truncateTx.Exec(ctx, `set local session_replication_role = replica`); err != nil {
		_ = truncateTx.Rollback(ctx)
		t.Fatalf("enable replica-mode truncate probe: %v", err)
	}
	_, truncateErr := truncateTx.Exec(ctx, `truncate table public.round_robins cascade`)
	_ = truncateTx.Rollback(ctx)
	if postgresErrorCode(truncateErr) != "55000" {
		t.Fatalf("queue truncate error = %v, want SQLSTATE 55000", truncateErr)
	}

	if _, err := pool.Exec(ctx, `
		delete from public.round_robins
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, queueID); postgresErrorCode(err) != "55000" {
		t.Fatalf("autocommit hard delete error = %v, want SQLSTATE 55000", err)
	}
	var rolledBackQueueDeleteAudits int
	if err := pool.QueryRow(ctx, `
		select count(*)::int
		from public.audit_logs
		where organization_id = $1::uuid
		  and entity_type = 'distribution_queue'
		  and entity_id = $2
		  and action = 'delete'
	`, organizationID, queueID).Scan(&rolledBackQueueDeleteAudits); err != nil {
		t.Fatalf("read rolled-back queue delete audit: %v", err)
	}
	if rolledBackQueueDeleteAudits != 0 {
		t.Fatalf("rolled-back queue delete left %d audit rows", rolledBackQueueDeleteAudits)
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin explicit hard delete: %v", err)
	}
	if _, err := tx.Exec(ctx, `
		delete from public.round_robins
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, queueID); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatalf("deferred hard delete statement: %v", err)
	}
	if _, err := tx.Exec(ctx, `set constraints guard_round_robin_hard_delete immediate`); postgresErrorCode(err) != "55000" {
		_ = tx.Rollback(ctx)
		t.Fatalf("forced hard-delete constraint error = %v, want SQLSTATE 55000", err)
	}
	_ = tx.Rollback(ctx)

	var queueStillExists bool
	if err := pool.QueryRow(ctx, `
		select exists (
		  select 1 from public.round_robins
		  where organization_id = $1::uuid and id = $2::uuid
		)
	`, organizationID, queueID).Scan(&queueStillExists); err != nil {
		t.Fatalf("read hard-delete rollback: %v", err)
	}
	if !queueStillExists {
		t.Fatal("hard-delete guard did not roll the queue delete back")
	}

	// A tenant cascade must remain terminal even when a managed WhatsApp ACK is
	// still unresolved. Ordinary queue/rule mutation remains fenced by this
	// snapshot, but deleting the organization owns the complete tenant namespace
	// and cascades the snapshot and its routing configuration together.
	var cascadeSessionID string
	if err := pool.QueryRow(ctx, `
		insert into public.whatsapp_sessions (
		  organization_id, owner_user_id, instance_name,
		  status, is_active, provider
		) values (
		  $1::uuid, $2::uuid, 'queue-cascade-managed-' || $3,
		  'connected', true, 'evolution_go'
		)
		returning id::text
	`, organizationID, userID, strings.ReplaceAll(queueID, "-", "")).Scan(&cascadeSessionID); err != nil {
		t.Fatalf("insert cascade managed WhatsApp session: %v", err)
	}
	var cascadeManagedQueueID string
	if err := pool.QueryRow(ctx, `
		insert into public.round_robins (
		  organization_id, name, is_active, reentry_behavior
		) values ($1::uuid, 'Queue cascade pending managed ACK', true, 'keep_assignee')
		returning id::text
	`, organizationID).Scan(&cascadeManagedQueueID); err != nil {
		t.Fatalf("insert cascade managed queue: %v", err)
	}
	var cascadeManagedRuleID string
	if err := pool.QueryRow(ctx, `
		insert into public.round_robin_rules (
		  organization_id, round_robin_id, match_type, match_value,
		  match, conditions, is_active, priority
		) values (
		  $1::uuid, $2::uuid, 'whatsapp_message_contains', 'cascata',
		  jsonb_build_object('whatsapp_session_id', $3::uuid),
		  jsonb_build_object(
		    'match_type', 'whatsapp_message_contains',
		    'match_value', 'cascata',
		    'match', jsonb_build_object('whatsapp_session_id', $3::uuid)
		  ),
		  true, 100
		)
		returning id::text
	`, organizationID, cascadeManagedQueueID, cascadeSessionID).Scan(&cascadeManagedRuleID); err != nil {
		t.Fatalf("insert cascade managed queue rule: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		insert into public.whatsapp_inbound_rules (
		  id, organization_id, session_id, name, priority, is_active,
		  match_type, match_value, match_field, target_round_robin_id
		) values (
		  $1::uuid, $2::uuid, $3::uuid, 'Queue cascade managed mirror',
		  -1000000001, true, 'contains', 'cascata', 'message', $4::uuid
		)
	`, cascadeManagedRuleID, organizationID, cascadeSessionID, cascadeManagedQueueID); err != nil {
		t.Fatalf("insert cascade managed inbound mirror: %v", err)
	}
	cascadeProviderMessageID := "queue-cascade-managed-" + strings.ReplaceAll(cascadeManagedQueueID, "-", "")
	cascadeInboxEventKey := "messages.upsert:" + cascadeProviderMessageID
	if _, err := pool.Exec(ctx, `
		insert into public.whatsapp_webhook_inbox (
		  organization_id, session_id, provider, event_key,
		  event_type, payload, status, processing_lane
		) values (
		  $1::uuid, $2::uuid, 'evolution_go', $3,
		  'messages.upsert',
		  '{"__vimob_ingress":{"routing_snapshot":{"version":1}}}'::jsonb,
		  'pending', 'live'
		);
		insert into public.whatsapp_webhook_routing_snapshots (
		  organization_id, session_id, provider_message_id,
		  inbox_event_key, processing_lane, routing_key,
		  binding_eligible, target_mode, snapshot
		) values (
		  $1::uuid, $2::uuid, $4, $3, 'live', $5,
		  true, 'snapshot',
		  jsonb_build_object(
		    'managed_message_distribution', true,
		    'origin_round_robin_id', $6::uuid,
		    'rule_id', $7::uuid
		  )
		)
	`, organizationID, cascadeSessionID, cascadeInboxEventKey,
		cascadeProviderMessageID, "phone:5511888888888",
		cascadeManagedQueueID, cascadeManagedRuleID); err != nil {
		t.Fatalf("insert unresolved cascade managed ACK: %v", err)
	}
	var cascadeHasPendingIntake bool
	var cascadeOutcomeCount int
	if err := pool.QueryRow(ctx, `
		select
		  private.round_robin_has_pending_whatsapp_intake($1::uuid, $2::uuid),
		  (
		    select count(*)::int
		    from public.whatsapp_webhook_routing_outcomes
		    where organization_id = $1::uuid
		      and session_id = $3::uuid
		      and provider_message_id = $4
		  )
	`, organizationID, cascadeManagedQueueID, cascadeSessionID,
		cascadeProviderMessageID).Scan(&cascadeHasPendingIntake, &cascadeOutcomeCount); err != nil {
		t.Fatalf("read unresolved cascade managed ACK: %v", err)
	}
	if !cascadeHasPendingIntake {
		t.Fatal("cascade fixture does not expose an unresolved managed ACK")
	}
	if cascadeOutcomeCount != 0 {
		t.Fatalf("cascade fixture routing outcomes = %d, want 0", cascadeOutcomeCount)
	}

	if _, err := pool.Exec(ctx, `
		update public.users
		set organization_id = null
		where id = $2::uuid and organization_id = $1::uuid;
		delete from public.organizations where id = $1::uuid
	`, organizationID, userID); err != nil {
		t.Fatalf("delete organization with queue cascade: %v", err)
	}
	var remainingOrganizations, remainingQueues, remainingRules int
	var remainingQueueMembers, remainingTeams, remainingTeamMembers int
	var remainingAvailability, remainingTeamPipelines int
	var remainingManagedQueues, remainingManagedRules, remainingManagedSessions int
	var remainingManagedInbox, remainingManagedSnapshots int
	if err := pool.QueryRow(ctx, `
		select
		  (select count(*)::int from public.organizations where id = $1::uuid),
		  (select count(*)::int from public.round_robins where id = $2::uuid),
		  (select count(*)::int from public.round_robin_rules where id = $3::uuid),
		  (select count(*)::int from public.round_robin_members where round_robin_id = $2::uuid),
		  (select count(*)::int from public.teams where id = $4::uuid),
		  (select count(*)::int from public.team_members where id = $5::uuid),
		  (select count(*)::int from public.member_availability where id = $6::uuid),
		  (select count(*)::int from public.team_pipelines where team_id = $4::uuid),
		  (select count(*)::int from public.round_robins where id = $7::uuid),
		  (select count(*)::int from public.round_robin_rules where id = $8::uuid),
		  (select count(*)::int from public.whatsapp_sessions where id = $9::uuid),
		  (select count(*)::int from public.whatsapp_webhook_inbox where organization_id = $1::uuid and event_key = $10),
		  (select count(*)::int from public.whatsapp_webhook_routing_snapshots where organization_id = $1::uuid and provider_message_id = $11)
	`, organizationID, queueID, liveRuleID, teamID, teamMemberID, availabilityID,
		cascadeManagedQueueID, cascadeManagedRuleID, cascadeSessionID,
		cascadeInboxEventKey, cascadeProviderMessageID).Scan(
		&remainingOrganizations,
		&remainingQueues,
		&remainingRules,
		&remainingQueueMembers,
		&remainingTeams,
		&remainingTeamMembers,
		&remainingAvailability,
		&remainingTeamPipelines,
		&remainingManagedQueues,
		&remainingManagedRules,
		&remainingManagedSessions,
		&remainingManagedInbox,
		&remainingManagedSnapshots,
	); err != nil {
		t.Fatalf("read organization cascade result: %v", err)
	}
	if remainingOrganizations != 0 || remainingQueues != 0 ||
		remainingRules != 0 || remainingQueueMembers != 0 ||
		remainingTeams != 0 || remainingTeamMembers != 0 ||
		remainingAvailability != 0 || remainingTeamPipelines != 0 ||
		remainingManagedQueues != 0 || remainingManagedRules != 0 ||
		remainingManagedSessions != 0 || remainingManagedInbox != 0 ||
		remainingManagedSnapshots != 0 {
		t.Fatalf(
			"organization cascade left org:%d queue:%d rules:%d queueMembers:%d teams:%d teamMembers:%d availability:%d teamPipelines:%d managedQueues:%d managedRules:%d managedSessions:%d managedInbox:%d managedSnapshots:%d",
			remainingOrganizations,
			remainingQueues,
			remainingRules,
			remainingQueueMembers,
			remainingTeams,
			remainingTeamMembers,
			remainingAvailability,
			remainingTeamPipelines,
			remainingManagedQueues,
			remainingManagedRules,
			remainingManagedSessions,
			remainingManagedInbox,
			remainingManagedSnapshots,
		)
	}
}

func TestQueueDeleteSerializesConcurrentOperationalReference(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("ROUND_ROBIN_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set ROUND_ROBIN_TEST_DATABASE_URL to run the local queue tombstone contract")
	}
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse ROUND_ROBIN_TEST_DATABASE_URL: %v", err)
	}
	switch strings.ToLower(target.Hostname()) {
	case "127.0.0.1", "localhost", "::1":
	default:
		t.Fatalf("ROUND_ROBIN_TEST_DATABASE_URL must use a loopback host, got %q", target.Hostname())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:           databaseURL,
		MaxConns:      6,
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
		values ('Queue reference race', 'queue-reference-race-' || gen_random_uuid()::text, true)
		returning id::text
	`).Scan(&organizationID); err != nil {
		t.Fatalf("insert organization: %v", err)
	}
	var pipelineID string
	if err := pool.QueryRow(ctx, `
		insert into public.pipelines (
		  organization_id, name, is_default, is_active, position
		) values ($1::uuid, 'Reference race pipeline', true, true, 0)
		returning id::text
	`, organizationID).Scan(&pipelineID); err != nil {
		t.Fatalf("insert pipeline: %v", err)
	}
	var queueID string
	if err := pool.QueryRow(ctx, `
		insert into public.round_robins (
		  organization_id, name, is_active, reentry_behavior
		) values ($1::uuid, 'Reference race queue', true, 'keep_assignee')
		returning id::text
	`, organizationID).Scan(&queueID); err != nil {
		t.Fatalf("insert queue: %v", err)
	}

	writer, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin reference writer: %v", err)
	}
	defer func() { _ = writer.Rollback(context.Background()) }()
	if _, err := writer.Exec(ctx, `
		update public.pipelines
		set default_round_robin_id = $2::uuid
		where organization_id = $1::uuid and id = $3::uuid
	`, organizationID, queueID, pipelineID); err != nil {
		t.Fatalf("hold live queue reference: %v", err)
	}

	repo := NewRepository(postgres)
	admin := tenant.Context{OrganizationID: organizationID, MemberRole: "admin"}
	deleteDone := make(chan error, 1)
	go func() {
		deleteDone <- repo.Delete(ctx, admin, queueID)
	}()

	select {
	case err := <-deleteDone:
		t.Fatalf("Delete completed before reference transaction released its queue lock: %v", err)
	case <-time.After(200 * time.Millisecond):
	}

	if err := writer.Commit(ctx); err != nil {
		t.Fatalf("commit reference writer: %v", err)
	}
	select {
	case err := <-deleteDone:
		if err != nil {
			t.Fatalf("delete queue after reference writer commit: %v", err)
		}
	case <-ctx.Done():
		t.Fatalf("Delete did not resume after reference writer commit: %v", ctx.Err())
	}

	var deletedAt *time.Time
	var active bool
	var defaultQueueID *string
	if err := pool.QueryRow(ctx, `
		select queue.deleted_at, coalesce(queue.is_active, true), pipeline.default_round_robin_id::text
		from public.round_robins as queue
		join public.pipelines as pipeline
		  on pipeline.organization_id = queue.organization_id
		 and pipeline.id = $3::uuid
		where queue.organization_id = $1::uuid and queue.id = $2::uuid
	`, organizationID, queueID, pipelineID).Scan(&deletedAt, &active, &defaultQueueID); err != nil {
		t.Fatalf("read serialized delete result: %v", err)
	}
	if deletedAt == nil || active || defaultQueueID != nil {
		t.Fatalf("serialized delete result = deletedAt:%v active:%t defaultQueue:%v", deletedAt, active, defaultQueueID)
	}

	var ownerUserID string
	if err := pool.QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&ownerUserID); err != nil {
		t.Fatalf("generate WhatsApp owner: %v", err)
	}
	ownerEmail := "queue-snapshot-" + strings.ReplaceAll(ownerUserID, "-", "") + "@example.test"
	if _, err := pool.Exec(ctx, `
		insert into auth.users (
		  id, aud, role, email, encrypted_password, email_confirmed_at,
		  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		) values (
		  $1::uuid, 'authenticated', 'authenticated', $2, '', now(),
		  '{}'::jsonb, '{}'::jsonb, now(), now()
		);
		insert into public.users (id, email, name, organization_id, is_active)
		values ($1::uuid, $2, 'Queue snapshot owner', $3::uuid, true)
		on conflict (id) do update
		set email = excluded.email,
		    name = excluded.name,
		    organization_id = excluded.organization_id,
		    is_active = excluded.is_active
	`, ownerUserID, ownerEmail, organizationID); err != nil {
		t.Fatalf("insert WhatsApp owner: %v", err)
	}
	var sessionID string
	if err := pool.QueryRow(ctx, `
		insert into public.whatsapp_sessions (
		  organization_id, owner_user_id, instance_name,
		  status, is_active, provider
		) values ($1::uuid, $2::uuid, 'queue-snapshot-contract', 'connected', true, 'evolution_go')
		returning id::text
	`, organizationID, ownerUserID).Scan(&sessionID); err != nil {
		t.Fatalf("insert WhatsApp session: %v", err)
	}
	var managedQueueID string
	if err := pool.QueryRow(ctx, `
		insert into public.round_robins (
		  organization_id, name, is_active, reentry_behavior
		) values ($1::uuid, 'Managed snapshot queue', true, 'keep_assignee')
		returning id::text
	`, organizationID).Scan(&managedQueueID); err != nil {
		t.Fatalf("insert managed snapshot queue: %v", err)
	}
	var managedRuleID string
	if err := pool.QueryRow(ctx, `
		insert into public.round_robin_rules (
		  organization_id, round_robin_id, match_type, match_value,
		  match, conditions, is_active, priority
		) values (
		  $1::uuid, $2::uuid, 'whatsapp_message_contains', 'comprar',
		  jsonb_build_object('whatsapp_session_id', $3::uuid),
		  jsonb_build_object(
		    'match_type', 'whatsapp_message_contains',
		    'match_value', 'comprar',
		    'match', jsonb_build_object('whatsapp_session_id', $3::uuid)
		  ),
		  true, 100
		)
		returning id::text
	`, organizationID, managedQueueID, sessionID).Scan(&managedRuleID); err != nil {
		t.Fatalf("insert managed snapshot queue rule: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		insert into public.whatsapp_inbound_rules (
		  id, organization_id, session_id, name, priority, is_active,
		  match_type, match_value, match_field, target_round_robin_id
		) values (
		  $1::uuid, $2::uuid, $3::uuid, 'Managed snapshot mirror',
		  -1000000001, true, 'contains', 'comprar', 'message', $4::uuid
		)
	`, managedRuleID, organizationID, sessionID, managedQueueID); err != nil {
		t.Fatalf("insert managed snapshot inbound mirror: %v", err)
	}

	ackTx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin managed snapshot ACK: %v", err)
	}
	defer func() { _ = ackTx.Rollback(context.Background()) }()
	providerMessageID := "managed-snapshot-" + strings.ReplaceAll(managedQueueID, "-", "")
	inboxEventKey := "messages.upsert:" + providerMessageID
	if _, err := ackTx.Exec(ctx, `
		insert into public.whatsapp_webhook_inbox (
		  organization_id, session_id, provider, event_key,
		  event_type, payload, status, processing_lane
		) values (
		  $1::uuid, $2::uuid, 'evolution_go', $3,
		  'messages.upsert',
		  '{"__vimob_ingress":{"routing_snapshot":{"version":1}}}'::jsonb,
		  'pending', 'live'
		)
	`, organizationID, sessionID, inboxEventKey); err != nil {
		t.Fatalf("insert managed snapshot inbox: %v", err)
	}
	var ingressSequence int64
	if err := ackTx.QueryRow(ctx, `
		insert into public.whatsapp_webhook_routing_snapshots (
		  organization_id, session_id, provider_message_id,
		  inbox_event_key, processing_lane, routing_key,
		  binding_eligible, target_mode, snapshot
		) values (
		  $1::uuid, $2::uuid, $3, $4, 'live', $5,
		  true, 'snapshot',
		  jsonb_build_object(
		    'managed_message_distribution', true,
		    'origin_round_robin_id', $6::uuid,
		    'rule_id', $7::uuid
		  )
		)
		returning ingress_sequence
	`, organizationID, sessionID, providerMessageID, inboxEventKey,
		"phone:5511999999999", managedQueueID, managedRuleID).Scan(&ingressSequence); err != nil {
		t.Fatalf("insert managed routing snapshot: %v", err)
	}

	deleteDone = make(chan error, 1)
	go func() {
		deleteDone <- repo.Delete(ctx, admin, managedQueueID)
	}()
	updateDone := make(chan error, 1)
	go func() {
		inactive := false
		_, updateErr := repo.Update(ctx, admin, managedQueueID, updateInput{
			IsActive: patchBool{Set: true, Value: &inactive},
		})
		updateDone <- updateErr
	}()
	deleteRuleDone := make(chan error, 1)
	go func() {
		deleteRuleDone <- repo.DeleteRule(ctx, admin, managedRuleID)
	}()
	directUpdateDone := make(chan error, 1)
	go func() {
		_, updateErr := pool.Exec(ctx, `
			update public.round_robins
			set settings = jsonb_set(
			      coalesce(settings, '{}'::jsonb),
			      '{require_checkin}',
			      'true'::jsonb,
			      true
			    ),
			    updated_at = now()
			where organization_id = $1::uuid and id = $2::uuid
		`, organizationID, managedQueueID)
		directUpdateDone <- updateErr
	}()
	select {
	case err := <-deleteDone:
		t.Fatalf("Delete completed before ACK released its queue lock: %v", err)
	case <-time.After(200 * time.Millisecond):
	}
	for label, result := range map[string]<-chan error{
		"Update":        updateDone,
		"DeleteRule":    deleteRuleDone,
		"direct UPDATE": directUpdateDone,
	} {
		select {
		case err := <-result:
			t.Fatalf("%s completed before ACK released its queue lock: %v", label, err)
		default:
		}
	}
	if err := ackTx.Commit(ctx); err != nil {
		t.Fatalf("commit managed snapshot ACK: %v", err)
	}
	select {
	case err := <-deleteDone:
		if !errors.Is(err, ErrPendingWhatsAppIntake) {
			t.Fatalf("Delete after unresolved ACK error = %v, want ErrPendingWhatsAppIntake", err)
		}
	case <-ctx.Done():
		t.Fatalf("Delete did not resume after managed snapshot ACK: %v", ctx.Err())
	}
	select {
	case err := <-updateDone:
		if !errors.Is(err, ErrPendingWhatsAppIntake) {
			t.Fatalf("Update after unresolved ACK error = %v, want ErrPendingWhatsAppIntake", err)
		}
	case <-ctx.Done():
		t.Fatalf("Update did not resume after managed snapshot ACK: %v", ctx.Err())
	}
	select {
	case err := <-deleteRuleDone:
		if !errors.Is(err, ErrPendingWhatsAppIntake) {
			t.Fatalf("DeleteRule after unresolved ACK error = %v, want ErrPendingWhatsAppIntake", err)
		}
	case <-ctx.Done():
		t.Fatalf("DeleteRule did not resume after managed snapshot ACK: %v", ctx.Err())
	}
	select {
	case err := <-directUpdateDone:
		if postgresErrorCode(err) != "55000" {
			t.Fatalf("direct UPDATE after unresolved ACK error = %v, want SQLSTATE 55000", err)
		}
	case <-ctx.Done():
		t.Fatalf("direct UPDATE did not resume after managed snapshot ACK: %v", ctx.Err())
	}
	for label, statement := range map[string]string{
		"round-robin rule": `
			update public.round_robin_rules
			set match_value = 'alterado', updated_at = now()
			where organization_id = $1::uuid and id = $2::uuid
		`,
		"WhatsApp mirror": `
			update public.whatsapp_inbound_rules
			set match_value = 'alterado', updated_at = now()
			where organization_id = $1::uuid and id = $2::uuid
		`,
	} {
		if _, err := pool.Exec(ctx, statement, organizationID, managedRuleID); postgresErrorCode(err) != "55000" {
			t.Fatalf("direct %s mutation with unresolved ACK error = %v, want SQLSTATE 55000", label, err)
		}
	}

	var managedQueueDeletedAt *time.Time
	var managedRuleCount int
	if err := pool.QueryRow(ctx, `
		select
		  queue.deleted_at,
		  (select count(*)::int from public.round_robin_rules as rule
		   where rule.organization_id = queue.organization_id
		     and rule.round_robin_id = queue.id)
		from public.round_robins as queue
		where queue.organization_id = $1::uuid and queue.id = $2::uuid
	`, organizationID, managedQueueID).Scan(&managedQueueDeletedAt, &managedRuleCount); err != nil {
		t.Fatalf("read blocked managed queue delete: %v", err)
	}
	if managedQueueDeletedAt != nil || managedRuleCount != 1 {
		t.Fatalf("blocked delete mutated queue: deletedAt=%v ruleCount=%d", managedQueueDeletedAt, managedRuleCount)
	}

	if _, err := pool.Exec(ctx, `
		update public.whatsapp_webhook_inbox
		set status = 'dead', dead_lettered_at = clock_timestamp(), updated_at = now()
		where organization_id = $1::uuid and session_id = $2::uuid and event_key = $3
	`, organizationID, sessionID, inboxEventKey); err != nil {
		t.Fatalf("dead-letter managed snapshot inbox: %v", err)
	}
	if err := repo.Delete(ctx, admin, managedQueueID); !errors.Is(err, ErrPendingWhatsAppIntake) {
		t.Fatalf("Delete with unresolved dead inbox error = %v, want ErrPendingWhatsAppIntake", err)
	}

	if _, err := pool.Exec(ctx, `
		insert into public.whatsapp_webhook_routing_outcomes (
		  organization_id, session_id, provider_message_id,
		  ingress_sequence, completed_inbox_event_key
		) values ($1::uuid, $2::uuid, $3, $4, $5)
	`, organizationID, sessionID, providerMessageID, ingressSequence, inboxEventKey); err != nil {
		t.Fatalf("record managed snapshot terminal outcome: %v", err)
	}
	if err := repo.Delete(ctx, admin, managedQueueID); err != nil {
		t.Fatalf("delete managed queue after terminal outcome: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		select
		  queue.deleted_at,
		  (select count(*)::int from public.round_robin_rules as rule
		   where rule.organization_id = queue.organization_id
		     and rule.round_robin_id = queue.id)
		from public.round_robins as queue
		where queue.organization_id = $1::uuid and queue.id = $2::uuid
	`, organizationID, managedQueueID).Scan(&managedQueueDeletedAt, &managedRuleCount); err != nil {
		t.Fatalf("read completed managed queue delete: %v", err)
	}
	if managedQueueDeletedAt == nil || managedRuleCount != 0 {
		t.Fatalf("completed delete result = deletedAt:%v ruleCount:%d", managedQueueDeletedAt, managedRuleCount)
	}
	replayTag, err := pool.Exec(ctx, `
		insert into public.whatsapp_webhook_routing_snapshots (
		  organization_id, session_id, provider_message_id,
		  inbox_event_key, processing_lane, routing_key,
		  binding_eligible, target_mode, snapshot
		) values (
		  $1::uuid, $2::uuid, $3, $4, 'live', $5,
		  true, 'snapshot',
		  jsonb_build_object(
		    'managed_message_distribution', true,
		    'origin_round_robin_id', $6::uuid,
		    'rule_id', $7::uuid
		  )
		)
		on conflict (organization_id, session_id, provider_message_id) do nothing
	`, organizationID, sessionID, providerMessageID, inboxEventKey,
		"phone:5511999999999", managedQueueID, managedRuleID)
	if err != nil {
		t.Fatalf("exact managed snapshot replay after tombstone: %v", err)
	}
	if replayTag.RowsAffected() != 0 {
		t.Fatalf("exact managed snapshot replay inserted %d rows, want immutable no-op", replayTag.RowsAffected())
	}
	if _, err := pool.Exec(ctx, `
		insert into public.whatsapp_webhook_routing_snapshots (
		  organization_id, session_id, provider_message_id,
		  inbox_event_key, processing_lane, routing_key,
		  binding_eligible, target_mode, snapshot
		) values (
		  $1::uuid, $2::uuid, $3, $4, 'live', $5 || ':divergent',
		  true, 'snapshot',
		  jsonb_build_object(
		    'managed_message_distribution', true,
		    'origin_round_robin_id', $6::uuid,
		    'rule_id', $7::uuid
		  )
		)
		on conflict (organization_id, session_id, provider_message_id) do nothing
	`, organizationID, sessionID, providerMessageID, inboxEventKey,
		"phone:5511999999999", managedQueueID, managedRuleID); postgresErrorCode(err) != "23503" {
		t.Fatalf("divergent managed snapshot replay error = %v, want SQLSTATE 23503", err)
	}
	if _, err := pool.Exec(ctx, `
		insert into public.whatsapp_webhook_routing_snapshots (
		  organization_id, session_id, provider_message_id,
		  inbox_event_key, processing_lane, routing_key,
		  binding_eligible, target_mode, snapshot
		) values (
		  $1::uuid, $2::uuid, $3 || '-new', $4 || ':new', 'live', $5,
		  true, 'snapshot',
		  jsonb_build_object(
		    'managed_message_distribution', true,
		    'origin_round_robin_id', $6::uuid,
		    'rule_id', $7::uuid
		  )
		)
	`, organizationID, sessionID, providerMessageID, inboxEventKey,
		"phone:5511999999999", managedQueueID, managedRuleID); postgresErrorCode(err) != "23503" {
		t.Fatalf("new managed route after tombstone error = %v, want SQLSTATE 23503", err)
	}
}

func assertDeletedQueueDoesNotDistribute(
	t *testing.T,
	ctx context.Context,
	queryer distribution.Queryer,
	organizationID string,
	queueID string,
	leadID string,
	label string,
) {
	t.Helper()
	source := "whatsapp"
	result, err := distribution.Distribute(ctx, queryer, distribution.Request{
		OrganizationID:     organizationID,
		LeadID:             leadID,
		IdempotencyKey:     fmt.Sprintf("round-robin-tombstone:%s:%s", label, leadID),
		RoundRobinID:       &queueID,
		RoundRobinResolved: true,
		PreserveAssignee:   true,
		Source:             &source,
		OccurredAt:         time.Now().UTC(),
	})
	if err != nil {
		t.Fatalf("distribute %s delayed lead: %v", label, err)
	}
	if result.Reason != "no_matching_queue" {
		t.Fatalf("distribution reason = %q, want no_matching_queue", result.Reason)
	}
}

func postgresErrorCode(err error) string {
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) {
		return postgresError.Code
	}
	return ""
}
