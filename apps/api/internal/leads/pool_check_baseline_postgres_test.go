package leads

import (
	"context"
	"fmt"
	"os"
	"regexp"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestPoolCheckWithInstalledRPCs(t *testing.T) {
	database := os.Getenv("VIMOB_POOL_INSTALLED_RPC_TEST_DATABASE")
	if database == "" {
		t.Skip("requires VIMOB_POOL_INSTALLED_RPC_TEST_DATABASE inside the disposable local PostgreSQL container")
	}
	if !regexp.MustCompile(`^vimob_local_baseline_[a-z0-9_]+$`).MatchString(database) {
		t.Fatal("expected a disposable local baseline database name")
	}
	cfg, err := pgx.ParseConfig("host=/var/run/postgresql sslmode=disable user=postgres dbname=" + database)
	if err != nil || cfg.Host != "/var/run/postgresql" || len(cfg.Fallbacks) != 0 {
		t.Fatal("expected the local PostgreSQL Unix socket")
	}
	cfg.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
	defer cancel()
	conn, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		t.Fatal("cannot connect to the disposable local database")
	}
	defer conn.Close(context.Background())
	tx, err := conn.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	var safe bool
	if err := tx.QueryRow(ctx, `
		select current_database() = $1 and inet_server_addr() is null
			and to_regclass('cron.job') is null
			and not exists (select 1 from pg_extension where extname = 'pg_cron')
			and not exists (select 1 from public.pipelines where pool_enabled)
	`, database).Scan(&safe); err != nil || !safe {
		t.Fatal("expected a local baseline with no scheduler or enabled pool")
	}

	runAt := time.Date(2026, 11, 20, 12, 14, 0, 65_000_000, time.UTC)
	uid := func(n int) string { return fmt.Sprintf("52200000-0000-4000-8000-%012d", n) }
	org, pipeline, stage, queue, owner, nextOwner := uid(1), uid(2), uid(3), uid(4), uid(5), uid(6)
	warningLead, overdueLead, contactedLead := uid(7), uid(8), uid(9)
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`insert into public.organizations(id,name,slug,is_active)
		values($1,'Synthetic pool checker','synthetic-pool-checker',true)`, org)
	for i, user := range []string{owner, nextOwner} {
		email := fmt.Sprintf("synthetic-pool-checker-%d@example.invalid", i)
		exec(`insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
			values($1,'authenticated','authenticated',$2,'',now(),'{}','{}');
			insert into public.users(id,organization_id,name,email,role,is_active)
			values($1,$3,'Synthetic broker',$2,'user',true)
			on conflict(id) do update set organization_id=excluded.organization_id, role=excluded.role, is_active=true;
			insert into public.organization_members(organization_id,user_id,role,is_active)
			values($3,$1,'user',true)
			on conflict(user_id,organization_id) do update set is_active=true`, user, email, org)
	}
	exec(`insert into public.pipelines(id,organization_id,name,is_active,pool_enabled,pool_enabled_at,pool_timeout_minutes,pool_warning_minutes,pool_max_redistributions)
		values($1,$2,'Synthetic pool pipeline',true,true,$3,10,2,3);
		insert into public.stages(id,organization_id,pipeline_id,name,stage_key,position,is_active)
		values($4,$2,$1,'Synthetic stage','synthetic-pool-stage',1,true);
		insert into public.round_robins(id,organization_id,name,strategy,is_active,pipeline_id,target_pipeline_id,target_stage_id,settings)
		values($5,$2,'Synthetic pool queue','simple',true,$1,$1,$4,'{"ignore_availability":true}');
		insert into public.round_robin_members(organization_id,round_robin_id,user_id,position,is_active)
		values($2,$5,$6,1,true),($2,$5,$7,2,true)`, pipeline, org, runAt.Add(-time.Hour), stage, queue, owner, nextOwner)
	for _, fixture := range []struct {
		lead       string
		ageMinutes time.Duration
	}{{warningLead, 9}, {overdueLead, 11}, {contactedLead, 12}} {
		assignedAt := runAt.Add(-fixture.ageMinutes * time.Minute)
		exec(`insert into public.leads (id,organization_id,pipeline_id,stage_id,name,source,metadata,assigned_user_id,deal_status,redistribution_count,stage_entered_at,created_at)
			values($1,$2,$3,$4,'Synthetic lead','site','{"distribution_deferred":true}',$5,'open',0,$6,$6);
			update public.leads set assigned_at=$6 where id=$1;
			insert into public.assignments_log(organization_id,lead_id,assigned_user_id,round_robin_id,new_user_id,reason,assigned_at,created_at)
			values($2,$1,$5,$7,$5,'canonical_round_robin',$6,$6)`, fixture.lead, org, pipeline, stage, owner, assignedAt, queue)
	}
	exec("set local role service_role")
	pipelines, err := listPoolCheckPipelines(ctx, tx)
	if err != nil || len(pipelines) != 1 || pipelines[0].ID != pipeline || pipelines[0].ActivationAt == nil {
		t.Fatalf("expected one synthetic pool pipeline: %+v, error %v", pipelines, err)
	}
	timeout := runAt.Add(-10 * time.Minute)
	pool := pipelines[0]
	snapshots, err := listPoolCheckCandidates(ctx, tx, pool, *pool.ActivationAt, timeout, nil)
	if err != nil || len(snapshots) != 2 || snapshots[0].LeadID != contactedLead || snapshots[1].LeadID != overdueLead {
		t.Fatalf("expected both overdue snapshots before the first contact: %+v, error %v", snapshots, err)
	}
	warnings, err := listPoolCheckCandidates(ctx, tx, pool, *pool.ActivationAt, runAt.Add(-8*time.Minute), &timeout)
	if err != nil || len(warnings) != 1 || warnings[0].LeadID != warningLead {
		t.Fatalf("expected one lead in the warning window: %+v, error %v", warnings, err)
	}
	exec(`update public.leads set first_response_at=$2 where id=$1`, contactedLead, runAt.Add(-time.Minute))
	if stale := runPoolCheckAttempt(ctx, tx, org, snapshots[0], false, runAt); !stale.Skipped || stale.Error != "lead_has_activity_after_distribution" {
		t.Fatalf("pool did not revalidate activity after discovery: %+v", stale)
	}
	clock := func() time.Time { return runAt }
	result, err := runPoolCheck(ctx, tx, clock)
	if err != nil || !result.Success || result.Redistributed != 1 ||
		len(result.Warnings) != 1 || result.Warnings[0].LeadID != warningLead ||
		len(result.Results) != 1 || result.Results[0].LeadID != overdueLead {
		t.Fatalf("installed pool RPCs did not settle the synthetic leads: %+v, error %v", result, err)
	}
	retry, err := runPoolCheck(ctx, tx, clock)
	if err != nil || !retry.Success || len(retry.Warnings) != 0 || len(retry.Results) != 0 {
		t.Fatalf("another sweep attempted a completed lead: %+v, error %v", retry, err)
	}
	if replay := runPoolCheckAttempt(ctx, tx, org, warnings[0], true, runAt); !replay.Skipped || replay.Error != "warning_already_sent" {
		t.Fatalf("warning did not deduplicate the original candidate: %+v", replay)
	}
	if replay := runPoolCheckAttempt(ctx, tx, org, snapshots[1], false, runAt); !replay.Success || replay.Skipped {
		t.Fatalf("redistribution did not replay the finalized result: %+v", replay)
	}
	exec("reset role")

	var persisted bool
	if err := tx.QueryRow(ctx, `
		select exists(select 1 from public.leads where id=$1 and organization_id=$4 and assigned_user_id=$5 and redistribution_warning_sent_at=$7)
			and exists(select 1 from public.leads where id=$2 and organization_id=$4 and assigned_user_id=$6 and redistribution_count=1 and last_redistributed_at=$7)
			and exists(select 1 from public.leads where id=$3 and organization_id=$4 and assigned_user_id=$5 and redistribution_count=0)
			and (select count(*) from public.notifications where organization_id=$4 and lead_id=$1 and user_id=$5 and type='lead_redistribution_warning')=1
			and (select count(*) from public.lead_pool_history where organization_id=$4 and lead_id=$2 and from_user_id=$5 and to_user_id=$6)=1
			and exists(select 1 from private.lead_distribution_events event
				join public.lead_pool_history history on history.id=event.id
				join public.notifications notice on notice.id=event.id and notice.user_id=$5 and notice.type='lead_redistributed'
				where event.organization_id=$4 and event.lead_id=$2
				  and event.idempotency_key like 'pool-timeout:%' and event.result->>'pool_finalized'='true')
	`, warningLead, overdueLead, contactedLead, org, owner, nextOwner, runAt).Scan(&persisted); err != nil || !persisted {
		t.Fatalf("expected one notice, one finalized redistribution and no mutation to the contacted lead: %v", err)
	}
}
