package integrations

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// TestMetaFormConfigWritersWaitOnQueueBeforeMutatingChildren models the queue
// FOR SHARE lock held while an immutable webhook routing snapshot is captured.
// Both privileged Meta writers must wait on the parent row before they can
// touch meta_form_configs or round_robin_rules, so they cannot retain a child
// tuple while upgrading the parent lock.
func TestMetaFormConfigWritersWaitOnQueueBeforeMutatingChildren(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("META_FORM_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set META_FORM_TEST_DATABASE_URL to run the Meta form lock-order contract")
	}
	target, err := url.Parse(databaseURL)
	if err != nil || !isOutboundMessagingLoopbackHost(target.Hostname()) {
		t.Fatalf("META_FORM_TEST_DATABASE_URL must use a loopback host")
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

	suffix := strings.ReplaceAll(fmt.Sprintf("%d", time.Now().UnixNano()), "-", "")
	var organizationID, userID string
	if err := pool.QueryRow(ctx, `
		insert into public.organizations (name, slug, is_active)
		values ($1, $2, true)
		returning id::text
	`, "Meta form lock "+suffix, "meta-form-lock-"+suffix).Scan(&organizationID); err != nil {
		t.Fatalf("insert organization: %v", err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		if userID != "" {
			if _, err := pool.Exec(cleanupCtx, `
				delete from public.organization_members
				where organization_id = $1::uuid and user_id = $2::uuid
			`, organizationID, userID); err != nil {
				t.Errorf("delete Meta form lock membership: %v", err)
				return
			}
			if _, err := pool.Exec(cleanupCtx, `delete from public.users where id = $1::uuid`, userID); err != nil {
				t.Errorf("delete Meta form lock public user: %v", err)
				return
			}
			if _, err := pool.Exec(cleanupCtx, `delete from auth.users where id = $1::uuid`, userID); err != nil {
				t.Errorf("delete Meta form lock auth user: %v", err)
				return
			}
		}
		if _, err := pool.Exec(cleanupCtx, `delete from public.organizations where id = $1::uuid`, organizationID); err != nil {
			t.Errorf("delete Meta form lock organization: %v", err)
		}
	})

	if err := pool.QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&userID); err != nil {
		t.Fatalf("generate user: %v", err)
	}
	email := "meta-form-lock-" + strings.ReplaceAll(userID, "-", "") + "@example.test"
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
		) values ($1::uuid, $3::uuid, 'Meta form lock admin', $2, 'admin', true)
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
		    deleted_at = null;
	`, userID, email, organizationID); err != nil {
		t.Fatalf("insert admin user: %v", err)
	}

	var integrationID string
	if err := pool.QueryRow(ctx, `
		insert into public.meta_integrations (
		  organization_id, page_id, page_name, is_connected
		) values ($1::uuid, $2, 'Meta form lock page', false)
		returning id::text
	`, organizationID, "page-"+suffix).Scan(&integrationID); err != nil {
		t.Fatalf("insert Meta integration: %v", err)
	}
	var firstQueueID, secondQueueID, thirdQueueID string
	if err := pool.QueryRow(ctx, `
		insert into public.round_robins (
		  organization_id, name, is_active, reentry_behavior
		) values ($1::uuid, 'Meta form lock queue', true, 'keep_assignee')
		returning id::text
	`, organizationID).Scan(&firstQueueID); err != nil {
		t.Fatalf("insert queue: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		insert into public.round_robins (
		  organization_id, name, is_active, reentry_behavior
		) values ($1::uuid, 'Meta form replacement queue', true, 'keep_assignee')
		returning id::text
	`, organizationID).Scan(&secondQueueID); err != nil {
		t.Fatalf("insert replacement queue: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		insert into public.round_robins (
		  organization_id, name, is_active, reentry_behavior
		) values ($1::uuid, 'Meta form third queue', true, 'keep_assignee')
		returning id::text
	`, organizationID).Scan(&thirdQueueID); err != nil {
		t.Fatalf("insert third queue: %v", err)
	}
	queueIDs := []string{firstQueueID, secondQueueID, thirdQueueID}
	sort.Strings(queueIDs)
	// Use stable semantic names for the stale-snapshot regression: B sorts
	// before A, matching the adversarial lock-order interleaving.
	queueBID, queueAID, queueCID := queueIDs[0], queueIDs[1], queueIDs[2]

	repository := NewRepository(postgres, ExternalConfig{})
	tenantContext := tenant.Context{
		OrganizationID: organizationID,
		UserID:         userID,
		UserRole:       "admin",
		MemberRole:     "admin",
	}
	formID := "form-" + suffix
	initialFormName := "Meta form initial"
	initialPurpose := "buy"
	initialSource := "meta"
	request := MetaFormConfigRequest{
		IntegrationID: integrationID,
		FormID:        formID,
		FormName:      &initialFormName,
		RoundRobinID:  &queueAID,
		Purpose:       &initialPurpose,
		Source:        &initialSource,
	}

	assertCounts := func(wantConfig int, wantRule int) {
		t.Helper()
		var configCount, ruleCount int
		if err := pool.QueryRow(ctx, `
			select
			  (select count(*)::int
			   from public.meta_form_configs
			   where organization_id = $1::uuid and form_id = $2),
			  (select count(*)::int
			   from public.round_robin_rules
			   where organization_id = $1::uuid
			     and coalesce(nullif(match_type, ''), conditions->>'match_type', name, '') = 'meta_form'
			     and coalesce(nullif(match_value, ''), conditions->>'match_value', '') = $2)
		`, organizationID, formID).Scan(&configCount, &ruleCount); err != nil {
			t.Fatalf("read Meta form children: %v", err)
		}
		if configCount != wantConfig || ruleCount != wantRule {
			t.Fatalf("Meta form child counts = config:%d rule:%d, want config:%d rule:%d", configCount, ruleCount, wantConfig, wantRule)
		}
	}

	assertReferences := func(wantQueueID string) {
		t.Helper()
		var configQueueID, ruleQueueID string
		if err := pool.QueryRow(ctx, `
			select config.round_robin_id::text, rule.round_robin_id::text
			from public.meta_form_configs as config
			join public.round_robin_rules as rule
			  on rule.organization_id = config.organization_id
			 and coalesce(nullif(rule.match_type, ''), rule.conditions->>'match_type', rule.name, '') = 'meta_form'
			 and coalesce(nullif(rule.match_value, ''), rule.conditions->>'match_value', '') = config.form_id
			where config.organization_id = $1::uuid and config.form_id = $2
		`, organizationID, formID).Scan(&configQueueID, &ruleQueueID); err != nil {
			t.Fatalf("read Meta form references: %v", err)
		}
		if configQueueID != wantQueueID || ruleQueueID != wantQueueID {
			t.Fatalf("Meta form references = config:%s rule:%s, want %s", configQueueID, ruleQueueID, wantQueueID)
		}
	}

	blockQueue := func(blockedQueueID string) pgx.Tx {
		t.Helper()
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin queue blocker: %v", err)
		}
		if _, err := tx.Exec(ctx, `
			select 1
			from public.round_robins
			where organization_id = $1::uuid and id = $2::uuid
			for share
		`, organizationID, blockedQueueID); err != nil {
			_ = tx.Rollback(ctx)
			t.Fatalf("lock queue like webhook ACK: %v", err)
		}
		return tx
	}
	assertChildrenUnlocked := func(tx pgx.Tx) {
		t.Helper()
		var configID, ruleID string
		if err := tx.QueryRow(ctx, `
			select id::text
			from public.meta_form_configs
			where organization_id = $1::uuid and form_id = $2
			for update nowait
		`, organizationID, formID).Scan(&configID); err != nil {
			t.Fatalf("Meta form writer locked config before parent queue: %v", err)
		}
		if err := tx.QueryRow(ctx, `
			select id::text
			from public.round_robin_rules
			where organization_id = $1::uuid
			  and coalesce(nullif(match_type, ''), conditions->>'match_type', name, '') = 'meta_form'
			  and coalesce(nullif(match_value, ''), conditions->>'match_value', '') = $2
			for update nowait
		`, organizationID, formID).Scan(&ruleID); err != nil {
			t.Fatalf("Meta form writer locked rule before parent queue: %v", err)
		}
	}

	if _, err := repository.SaveMetaFormConfig(ctx, tenantContext, request); err != nil {
		t.Fatalf("seed Meta form config: %v", err)
	}
	assertCounts(1, 1)
	assertReferences(queueAID)

	decodeFailure := errors.New("forced Meta form readback decode failure")
	failingRepository := repository
	failingRepository.unmarshalJSON = func([]byte, any) error {
		return decodeFailure
	}
	failedFormID := formID + "-decode-failure"
	failedRequest := request
	failedRequest.FormID = failedFormID
	if _, err := failingRepository.SaveMetaFormConfig(ctx, tenantContext, failedRequest); !errors.Is(err, decodeFailure) {
		t.Fatalf("SaveMetaFormConfig decode failure = %v, want %v", err, decodeFailure)
	}
	var failedConfigCount, failedRuleCount int
	if err := pool.QueryRow(ctx, `
		select
		  (select count(*)::int
		   from public.meta_form_configs
		   where organization_id = $1::uuid and form_id = $2),
		  (select count(*)::int
		   from public.round_robin_rules
		   where organization_id = $1::uuid
		     and coalesce(nullif(match_type, ''), conditions->>'match_type', name, '') = 'meta_form'
		     and coalesce(nullif(match_value, ''), conditions->>'match_value', '') = $2)
	`, organizationID, failedFormID).Scan(&failedConfigCount, &failedRuleCount); err != nil {
		t.Fatalf("read rolled-back Meta form decode failure: %v", err)
	}
	if failedConfigCount != 0 || failedRuleCount != 0 {
		t.Fatalf(
			"Meta form decode failure committed children: config=%d rule=%d",
			failedConfigCount,
			failedRuleCount,
		)
	}

	moveBlocker := blockQueue(queueBID)
	moveRequest := request
	moveRequest.RoundRobinID = &queueBID
	updatedFormName := "Meta form updated"
	updatedPurpose := "rent"
	updatedSource := "meta-updated"
	moveRequest.FormName = &updatedFormName
	moveRequest.Purpose = &updatedPurpose
	moveRequest.Source = &updatedSource
	saveDone := make(chan error, 1)
	go func() {
		_, saveErr := repository.SaveMetaFormConfig(ctx, tenantContext, moveRequest)
		saveDone <- saveErr
	}()
	select {
	case saveErr := <-saveDone:
		t.Fatalf("SaveMetaFormConfig bypassed the parent queue lock: %v", saveErr)
	case <-time.After(200 * time.Millisecond):
	}
	assertChildrenUnlocked(moveBlocker)
	if err := moveBlocker.Commit(ctx); err != nil {
		t.Fatalf("release move queue blocker: %v", err)
	}
	select {
	case saveErr := <-saveDone:
		if saveErr != nil {
			t.Fatalf("SaveMetaFormConfig after queue release: %v", saveErr)
		}
	case <-ctx.Done():
		t.Fatalf("SaveMetaFormConfig did not resume: %v", ctx.Err())
	}
	assertCounts(1, 1)
	assertReferences(queueBID)
	var persistedFormName, persistedPurpose, persistedSource string
	if err := pool.QueryRow(ctx, `
		select form_name, purpose, source
		from public.meta_form_configs
		where organization_id = $1::uuid and form_id = $2
	`, organizationID, formID).Scan(
		&persistedFormName,
		&persistedPurpose,
		&persistedSource,
	); err != nil {
		t.Fatalf("read updated Meta form fields: %v", err)
	}
	if persistedFormName != updatedFormName ||
		persistedPurpose != updatedPurpose ||
		persistedSource != updatedSource {
		t.Fatalf(
			"updated Meta form fields = name:%q purpose:%q source:%q",
			persistedFormName,
			persistedPurpose,
			persistedSource,
		)
	}

	// Reproduce the adversarial three-writer sequence. T2 begins while T1 owns
	// the form scope. The advisory lock must make T2 discover the route only
	// after T1 commits A->B; it therefore locks B+C, never stale A+C. T3 is
	// serialized the same way behind T2 and subsequently locks C+A.
	if _, err := repository.SaveMetaFormConfig(ctx, tenantContext, request); err != nil {
		t.Fatalf("reset Meta form route to queue A: %v", err)
	}
	assertReferences(queueAID)

	moveRoute := func(tx pgx.Tx, targetQueueID string) {
		t.Helper()
		if _, err := tx.Exec(ctx, `
			update public.meta_form_configs
			set round_robin_id = $3::uuid, updated_at = now()
			where organization_id = $1::uuid and form_id = $2
		`, organizationID, formID, targetQueueID); err != nil {
			t.Fatalf("move Meta form config to %s: %v", targetQueueID, err)
		}
		if _, err := tx.Exec(ctx, `
			update public.round_robin_rules
			set round_robin_id = $3::uuid, updated_at = now()
			where organization_id = $1::uuid
			  and coalesce(nullif(match_type, ''), conditions->>'match_type', name, '') = 'meta_form'
			  and coalesce(nullif(match_value, ''), conditions->>'match_value', '') = $2
		`, organizationID, formID, targetQueueID); err != nil {
			t.Fatalf("move Meta form rule to %s: %v", targetQueueID, err)
		}
	}
	assertQueueLocked := func(queueID string, wantLocked bool) {
		t.Helper()
		probe, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin queue lock probe: %v", err)
		}
		_, lockErr := probe.Exec(ctx, `
			select 1
			from public.round_robins
			where organization_id = $1::uuid and id = $2::uuid
			for update nowait
		`, organizationID, queueID)
		_ = probe.Rollback(ctx)
		var postgresError *pgconn.PgError
		locked := errors.As(lockErr, &postgresError) && postgresError.Code == "55P03"
		if lockErr != nil && !locked {
			t.Fatalf("probe queue %s lock: %v", queueID, lockErr)
		}
		if locked != wantLocked {
			t.Fatalf("queue %s locked=%t error=%v, want locked=%t", queueID, locked, lockErr, wantLocked)
		}
	}
	startScopeLock := func(tx pgx.Tx, requestedQueueID string) <-chan error {
		done := make(chan error, 1)
		go func() {
			done <- repository.lockMetaFormRoundRobins(
				ctx,
				tx,
				organizationID,
				&requestedQueueID,
				formID,
			)
		}()
		return done
	}

	tx1, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin stale-race writer T1: %v", err)
	}
	if err := repository.lockMetaFormRoundRobins(ctx, tx1, organizationID, &queueBID, formID); err != nil {
		_ = tx1.Rollback(ctx)
		t.Fatalf("lock stale-race writer T1: %v", err)
	}
	tx2, err := pool.Begin(ctx)
	if err != nil {
		_ = tx1.Rollback(ctx)
		t.Fatalf("begin stale-race writer T2: %v", err)
	}
	t2Locked := startScopeLock(tx2, queueCID)
	select {
	case lockErr := <-t2Locked:
		_ = tx1.Rollback(ctx)
		_ = tx2.Rollback(ctx)
		t.Fatalf("T2 bypassed T1 advisory scope: %v", lockErr)
	case <-time.After(200 * time.Millisecond):
	}
	moveRoute(tx1, queueBID)
	if err := tx1.Commit(ctx); err != nil {
		_ = tx2.Rollback(ctx)
		t.Fatalf("commit stale-race writer T1: %v", err)
	}
	if lockErr := <-t2Locked; lockErr != nil {
		_ = tx2.Rollback(ctx)
		t.Fatalf("T2 lock after T1 commit: %v", lockErr)
	}

	tx3, err := pool.Begin(ctx)
	if err != nil {
		_ = tx2.Rollback(ctx)
		t.Fatalf("begin stale-race writer T3: %v", err)
	}
	t3Locked := startScopeLock(tx3, queueAID)
	select {
	case lockErr := <-t3Locked:
		_ = tx2.Rollback(ctx)
		_ = tx3.Rollback(ctx)
		t.Fatalf("T3 bypassed T2 advisory scope: %v", lockErr)
	case <-time.After(200 * time.Millisecond):
	}
	assertQueueLocked(queueAID, false)
	assertQueueLocked(queueBID, true)
	assertQueueLocked(queueCID, true)
	moveRoute(tx2, queueCID)
	if err := tx2.Commit(ctx); err != nil {
		_ = tx3.Rollback(ctx)
		t.Fatalf("commit stale-race writer T2: %v", err)
	}
	if lockErr := <-t3Locked; lockErr != nil {
		_ = tx3.Rollback(ctx)
		t.Fatalf("T3 lock after T2 commit: %v", lockErr)
	}
	assertQueueLocked(queueAID, true)
	assertQueueLocked(queueBID, false)
	assertQueueLocked(queueCID, true)
	moveRoute(tx3, queueAID)
	if err := tx3.Commit(ctx); err != nil {
		t.Fatalf("commit stale-race writer T3: %v", err)
	}
	assertReferences(queueAID)

	toggleBlocker := blockQueue(queueAID)
	toggleDone := make(chan error, 1)
	go func() {
		toggleDone <- repository.ToggleMetaFormConfig(ctx, tenantContext, ToggleMetaFormConfigRequest{
			IntegrationID: integrationID,
			FormID:        formID,
			IsActive:      false,
		})
	}()
	select {
	case toggleErr := <-toggleDone:
		t.Fatalf("ToggleMetaFormConfig bypassed the parent queue lock: %v", toggleErr)
	case <-time.After(200 * time.Millisecond):
	}
	assertChildrenUnlocked(toggleBlocker)
	if err := toggleBlocker.Commit(ctx); err != nil {
		t.Fatalf("release toggle queue blocker: %v", err)
	}
	select {
	case toggleErr := <-toggleDone:
		if toggleErr != nil {
			t.Fatalf("ToggleMetaFormConfig after queue release: %v", toggleErr)
		}
	case <-ctx.Done():
		t.Fatalf("ToggleMetaFormConfig did not resume: %v", ctx.Err())
	}
	var active bool
	if err := pool.QueryRow(ctx, `
		select is_active
		from public.meta_form_configs
		where organization_id = $1::uuid and form_id = $2
	`, organizationID, formID).Scan(&active); err != nil {
		t.Fatalf("read toggled Meta form config: %v", err)
	}
	if active {
		t.Fatal("ToggleMetaFormConfig did not persist the inactive state")
	}
	if err := repository.ToggleMetaFormConfig(ctx, tenantContext, ToggleMetaFormConfigRequest{
		IntegrationID: integrationID,
		FormID:        formID,
		IsActive:      true,
	}); err != nil {
		t.Fatalf("reactivate Meta form config: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		select is_active
		from public.meta_form_configs
		where organization_id = $1::uuid and form_id = $2
	`, organizationID, formID).Scan(&active); err != nil {
		t.Fatalf("read reactivated Meta form config: %v", err)
	}
	if !active {
		t.Fatal("ToggleMetaFormConfig did not persist the reactivated state")
	}

	deleteBlocker := blockQueue(queueAID)
	deleteDone := make(chan error, 1)
	go func() {
		deleteDone <- repository.DeleteMetaFormConfig(ctx, tenantContext, integrationID, formID)
	}()
	select {
	case deleteErr := <-deleteDone:
		t.Fatalf("DeleteMetaFormConfig bypassed the parent queue lock: %v", deleteErr)
	case <-time.After(200 * time.Millisecond):
	}
	assertChildrenUnlocked(deleteBlocker)
	if err := deleteBlocker.Commit(ctx); err != nil {
		t.Fatalf("release delete queue blocker: %v", err)
	}
	select {
	case deleteErr := <-deleteDone:
		if deleteErr != nil {
			t.Fatalf("DeleteMetaFormConfig after queue release: %v", deleteErr)
		}
	case <-ctx.Done():
		t.Fatalf("DeleteMetaFormConfig did not resume: %v", ctx.Err())
	}
	assertCounts(0, 0)

	recreated := moveRequest
	recreated.RoundRobinID = &queueCID
	if _, err := repository.SaveMetaFormConfig(ctx, tenantContext, recreated); err != nil {
		t.Fatalf("re-create Meta form config after delete: %v", err)
	}
	assertCounts(1, 1)
	assertReferences(queueCID)
}
