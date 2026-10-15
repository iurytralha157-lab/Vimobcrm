package leads

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// Runs only against the disposable, sentinel-marked local substrate provisioned
// for scripts/supabase/test-production-distribution-postgres.mjs. Never reads
// application environment files or the normal DATABASE_URL.
func hotfixPostgres(t *testing.T) (context.Context, Repository) {
	t.Helper()
	configPath := os.Getenv("VIMOB_HOTFIX_POSTGRES_CONFIG")
	if configPath == "" {
		t.Skip("VIMOB_HOTFIX_POSTGRES_CONFIG is not set")
	}
	if !filepath.IsAbs(configPath) {
		t.Fatal("absolute disposable-target config required")
	}
	var config struct {
		Kind, Host, Database, User, Password, RunID string
		Port                                        int
	}
	raw, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &config); err != nil {
		t.Fatal(err)
	}
	if config.Kind != "vimob-production-distribution-hotfix-postgres-v1" || config.Host != "127.0.0.1" || config.Port != 57533 ||
		!regexp.MustCompile(`^vimob_distribution_hotfix_[a-f0-9]{12}$`).MatchString(config.Database) ||
		!regexp.MustCompile(`^[a-f0-9-]{36}$`).MatchString(config.RunID) || len(config.Password) < 24 {
		t.Fatal("refusing a target outside the disposable hotfix contract")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	t.Cleanup(cancel)
	connectionURL := &url.URL{Scheme: "postgres", Host: "127.0.0.1:57533", Path: config.Database,
		User: url.UserPassword(config.User, config.Password), RawQuery: "sslmode=disable&application_name=vimob-hotfix-go&statement_timeout=10000&lock_timeout=8000"}
	db, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: connectionURL.String(), MaxConns: 12, HealthTimeout: 5 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	var database string
	var matches int
	err = db.Pool().QueryRow(ctx, `select current_database(), count(*) from public.production_distribution_hotfix_sentinel where run_id=$1`, config.RunID).Scan(&database, &matches)
	if err != nil || database != config.Database || matches != 1 {
		t.Fatal("disposable database sentinel mismatch", err)
	}
	return ctx, NewRepository(db, nil)
}

type hotfixQueue struct {
	org, queue, lead, pipeline, stage string
	users                             []string
}

func hotfixUUID(t *testing.T) string {
	t.Helper()
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		t.Fatal(err)
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", value[:4], value[4:6], value[6:8], value[8:10], value[10:])
}

func newHotfixQueue(t *testing.T, ctx context.Context, repo Repository, count int) hotfixQueue {
	t.Helper()
	q := hotfixQueue{org: hotfixUUID(t), queue: hotfixUUID(t), lead: hotfixUUID(t), pipeline: hotfixUUID(t), stage: hotfixUUID(t)}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `insert into public.organizations(id) values($1);
		insert into public.pipelines(id,organization_id) values($2,$1);
		insert into public.stages(id,organization_id,pipeline_id,position) values($3,$1,$2,0);
		insert into public.round_robins(id,organization_id,pipeline_id,target_pipeline_id,target_stage_id,settings)
		values($4,$1,$2,$2,$3,'{"timezone":"UTC"}');`, q.org, q.pipeline, q.stage, q.queue)
	if err != nil {
		t.Fatal(err)
	}
	for n := 0; n < count; n++ {
		user := hotfixUUID(t)
		q.users = append(q.users, user)
		_, err = tx.Exec(ctx, `insert into public.users(id,organization_id,name) values($1,$2,'Synthetic Go broker');
			insert into public.organization_members(organization_id,user_id) values($2,$1);
			insert into public.round_robin_members(id,organization_id,round_robin_id,user_id,position) values($3,$2,$4,$1,$5);`, user, q.org, hotfixUUID(t), q.queue, n)
		if err != nil {
			t.Fatal(err)
		}
	}
	_, err = tx.Exec(ctx, `insert into public.leads(id,organization_id,origin_round_robin_id,pipeline_id,stage_id,assigned_user_id,assigned_at)
		values($1,$2,$3,$4,$5,$6,now()-interval '1 day');
		select private.ensure_round_robin_ticket_sequence($3);`, q.lead, q.org, q.queue, q.pipeline, q.stage, q.users[0])
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	return q
}

func hotfixAdmin(q hotfixQueue) tenant.Context {
	return tenant.Context{OrganizationID: q.org, MemberRole: "admin"}
}

func hotfixWorkerTransfer(ctx context.Context, repo Repository, q hotfixQueue) (string, error) {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	current, err := repo.getLeadSnapshotForUpdate(ctx, tx, q.org, q.lead)
	if err != nil {
		return "", err
	}
	job := redistributionJob{OrganizationID: q.org, RoundRobinID: q.queue, LeadID: q.lead, TimeoutMinutes: 10}
	selection, _, err := repo.selectOrDeferRedistribution(ctx, tx, job, current)
	if err != nil {
		return "", err
	}
	if err := repo.transferLeadAssignee(ctx, tx, hotfixAdmin(q), current, &selection.UserID, "auto_redistribution"); err != nil {
		return "", err
	}
	if err := repo.insertAutoRedistributionLog(ctx, tx, job, selection, current.AssignedUserID); err != nil {
		return "", err
	}
	return selection.UserID, tx.Commit(ctx)
}

func TestHotfixPostgresManualAndWorkerShareTwoCompleteRounds(t *testing.T) {
	ctx, repo := hotfixPostgres(t)
	q := newHotfixQueue(t, ctx, repo, 5)
	// An older active queue must not steal a lead with immutable queue affinity.
	otherQueueID := hotfixUUID(t)
	_, err := repo.db.Pool().Exec(ctx, `insert into public.round_robins(id,organization_id,pipeline_id,created_at) values($1,$2,$3,'2000-01-01');
		insert into public.round_robin_logs(organization_id,round_robin_id,lead_id,assigned_user_id,reason,created_at)
		values($2,$4,$5,$6,'canonical_round_robin','2001-01-01'),
		($2,$1,$5,$6,'managed_whatsapp_reentry_keep_assignee','2002-01-01');`, otherQueueID, q.org, q.pipeline, q.queue, q.lead, q.users[0])
	if err != nil {
		t.Fatal(err)
	}
	for n := 0; n < 10; n++ {
		var owner string
		if n%2 == 0 {
			result, err := repo.RedistributeRoundRobin(ctx, hotfixAdmin(q), q.lead, false)
			if err != nil || !result.Success || result.RoundRobinID != q.queue {
				t.Fatalf("manual step%d: %+v %v", n, result, err)
			}
			owner = result.AssignedUserID
		} else {
			owner, err = hotfixWorkerTransfer(ctx, repo, q)
			if err != nil {
				t.Fatalf("worker step%d: %v", n, err)
			}
		}
		if owner != q.users[(n+1)%5] {
			t.Fatalf("step%d owner=%s want index%d", n, owner, (n+1)%5)
		}
	}
	var logs, workerAttempts int
	err = repo.db.Pool().QueryRow(ctx, `select (select count(*) from public.round_robin_logs where organization_id=$1 and lead_id=$2),redistribution_count from public.leads where organization_id=$1 and id=$2`, q.org, q.lead).Scan(&logs, &workerAttempts)
	if err != nil || logs != 12 || workerAttempts != 5 {
		t.Fatalf("logs=%d workerAttempts=%d err=%v", logs, workerAttempts, err)
	}
}

func TestHotfixPostgresConcurrentManualRequestsSerializePerLead(t *testing.T) {
	ctx, repo := hotfixPostgres(t)
	q := newHotfixQueue(t, ctx, repo, 5)
	start := make(chan struct{})
	errorsFound := make(chan error, 8)
	var workers sync.WaitGroup
	for n := 0; n < 8; n++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			result, err := repo.RedistributeRoundRobin(ctx, hotfixAdmin(q), q.lead, false)
			if err == nil && !result.Success {
				err = fmt.Errorf("redistribution rejected: %s", result.Error)
			}
			errorsFound <- err
		}()
	}
	close(start)
	workers.Wait()
	close(errorsFound)
	for err := range errorsFound {
		if err != nil {
			t.Fatal(err)
		}
	}
	var owner string
	var logs int
	err := repo.db.Pool().QueryRow(ctx, `select assigned_user_id::text,(select count(*) from public.round_robin_logs where organization_id=$1 and lead_id=$2) from public.leads where organization_id=$1 and id=$2`, q.org, q.lead).Scan(&owner, &logs)
	if err != nil || owner != q.users[3] || logs != 8 {
		t.Fatalf("owner=%s logs=%d err=%v", owner, logs, err)
	}
}

func TestHotfixPostgresDifferentLeadsDoNotDeadlockOnOneQueue(t *testing.T) {
	ctx, repo := hotfixPostgres(t)
	q := newHotfixQueue(t, ctx, repo, 5)
	leads := []string{q.lead}
	for n := 1; n < 8; n++ {
		id := hotfixUUID(t)
		leads = append(leads, id)
		_, err := repo.db.Pool().Exec(ctx, `insert into public.leads(id,organization_id,origin_round_robin_id,pipeline_id,stage_id,assigned_user_id) values($1,$2,$3,$4,$5,$6)`, id, q.org, q.queue, q.pipeline, q.stage, q.users[0])
		if err != nil {
			t.Fatal(err)
		}
	}
	start := make(chan struct{})
	outcomes := make(chan error, 8)
	for _, id := range leads {
		go func(id string) {
			<-start
			result, err := repo.RedistributeRoundRobin(ctx, hotfixAdmin(q), id, false)
			if err == nil && (!result.Success || result.AssignedUserID != q.users[1]) {
				err = fmt.Errorf("unexpected result: %+v", result)
			}
			outcomes <- err
		}(id)
	}
	close(start)
	for range leads {
		if err := <-outcomes; err != nil {
			t.Fatal(err)
		}
	}
}

func TestHotfixPostgresRollbackDoesNotSpendRecipient(t *testing.T) {
	ctx, repo := hotfixPostgres(t)
	q := newHotfixQueue(t, ctx, repo, 5)
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	current, err := repo.getLeadSnapshotForUpdate(ctx, tx, q.org, q.lead)
	if err != nil {
		t.Fatal(err)
	}
	selection, _, err := repo.selectRoundRobinMemberForRedistribution(ctx, tx, q.org, q.lead, q.queue, current.AssignedUserID, "")
	if err != nil {
		t.Fatal(err)
	}
	if err = repo.transferLeadAssignee(ctx, tx, hotfixAdmin(q), current, &selection.UserID, "auto_redistribution"); err != nil {
		t.Fatal(err)
	}
	if err = repo.insertAutoRedistributionLog(ctx, tx, redistributionJob{OrganizationID: q.org, RoundRobinID: q.queue, LeadID: q.lead}, selection, current.AssignedUserID); err != nil {
		t.Fatal(err)
	}
	if err = tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	result, err := repo.RedistributeRoundRobin(ctx, hotfixAdmin(q), q.lead, false)
	if err != nil || !result.Success || result.AssignedUserID != q.users[1] {
		t.Fatalf("after rollback: %+v %v", result, err)
	}
}

func TestHotfixPostgresTenantAndActorCannotMoveForeignLead(t *testing.T) {
	ctx, repo := hotfixPostgres(t)
	q := newHotfixQueue(t, ctx, repo, 5)
	_, err := repo.RedistributeRoundRobin(ctx, tenant.Context{OrganizationID: hotfixUUID(t), MemberRole: "admin"}, q.lead, false)
	if !errors.Is(err, ErrLeadNotFound) {
		t.Fatalf("foreign tenant error=%v", err)
	}
	_, err = repo.RedistributeRoundRobin(ctx, tenant.Context{OrganizationID: q.org, MemberRole: "broker", UserID: q.users[4]}, q.lead, false)
	if !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("foreign actor error=%v", err)
	}
	var logs int
	var owner string
	err = repo.db.Pool().QueryRow(ctx, `select assigned_user_id::text,(select count(*) from public.round_robin_logs where organization_id=$1 and lead_id=$2) from public.leads where organization_id=$1 and id=$2`, q.org, q.lead).Scan(&owner, &logs)
	if err != nil || logs != 0 || owner != q.users[0] {
		t.Fatalf("permission denial mutated lead: logs=%d err=%v", logs, err)
	}
}

func TestHotfixPostgresOnlyCurrentRecipientDoesNotSelfAssign(t *testing.T) {
	ctx, repo := hotfixPostgres(t)
	q := newHotfixQueue(t, ctx, repo, 1)
	result, err := repo.RedistributeRoundRobin(ctx, hotfixAdmin(q), q.lead, false)
	if err != nil || result.Success || result.Error != "no_member" {
		t.Fatalf("single recipient: %+v %v", result, err)
	}
}

func TestHotfixPostgresManualUnassignedRetryKeepsInitialWeights(t *testing.T) {
	ctx, repo := hotfixPostgres(t)
	q := newHotfixQueue(t, ctx, repo, 5)
	_, err := repo.db.Pool().Exec(ctx, `update public.round_robins set strategy='weighted' where id=$1;
		update public.round_robin_members set weight=4 where round_robin_id=$1 and user_id=$2;`, q.queue, q.users[0])
	if err != nil {
		t.Fatal(err)
	}
	counts := make(map[string]int)
	for n := 0; n < 16; n++ {
		leadID := hotfixUUID(t)
		_, err := repo.db.Pool().Exec(ctx, `insert into public.leads(id,organization_id,origin_round_robin_id,pipeline_id,stage_id)
			values($1,$2,$3,$4,$5)`, leadID, q.org, q.queue, q.pipeline, q.stage)
		if err != nil {
			t.Fatal(err)
		}
		result, err := repo.RedistributeRoundRobin(ctx, hotfixAdmin(q), leadID, n%2 == 0)
		if err != nil || !result.Success || result.RoundRobinID != q.queue {
			t.Fatalf("initial retry%d: %+v %v", n, result, err)
		}
		counts[result.AssignedUserID]++
	}
	for index, user := range q.users {
		want := 2
		if index == 0 {
			want = 8
		}
		if counts[user] != want {
			t.Fatalf("initial broker%d count=%d want=%d", index, counts[user], want)
		}
	}
}
