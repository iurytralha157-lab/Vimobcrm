package leads

import (
	"context"
	"fmt"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestPoolCheckIdempotencyMatchesEdgeSerializer(t *testing.T) {
	t.Parallel()
	zero, two := 0, 2
	for _, test := range []struct {
		assignmentAt string
		count        *int
		digest       string
	}{
		{"2026-11-20T12:00:00+00:00", nil, "a43b23014604f03fb1ebac8f352e52b0263512b160beb2bb5b7e9de641eb5319"},
		{"2026-11-20T12:00:00.123456+00:00", &zero, "271ce492772859ec849c0105033ae2cb15378fe1709bc05883a12f65285f7455"},
		{"2026-11-20T12:00:00.123456+00:00", &two, "19192decbd88968a481f83b1a24cddb095812c2cdf2e4d933c01e6bb5a025d60"},
	} {
		candidate := poolCheckCandidate{
			LeadID: "10000000-0000-4000-8000-000000000001", AssignedUserID: "10000000-0000-4000-8000-000000000002",
			RoundRobinID: "10000000-0000-4000-8000-000000000003", DistributionKeyAt: test.assignmentAt,
			RedistributionCount: test.count,
		}
		key, err := poolCheckIdempotencyKey(candidate)
		if err != nil || key != "pool-timeout:"+test.digest {
			t.Fatalf("Edge idempotency differs for %s: got %q, error %v", test.assignmentAt, key, err)
		}
	}
}

func TestPoolCheckDiscoveryAndRPCContractAgainstPostgres(t *testing.T) {
	dsn := os.Getenv("VIMOB_POOL_CHECK_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set VIMOB_POOL_CHECK_TEST_DATABASE_URL to an empty disposable loopback PostgreSQL test database")
	}
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil || cfg.Host != "127.0.0.1" || cfg.Port <= 1024 || cfg.Database != "vimob_pool_check_test" || cfg.User != "postgres" || len(cfg.Fallbacks) != 0 {
		t.Fatal("disposable pool-check target required")
	}
	cfg.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	conn, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	var empty bool
	if err := tx.QueryRow(ctx, `select to_regclass('public.pipelines') is null`).Scan(&empty); err != nil || !empty {
		t.Fatal("expected an empty local pool-check fixture")
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(poolCheckFixtureSQL)
	exec("set local time zone 'America/Sao_Paulo'")

	uid := func(n int) string { return fmt.Sprintf("20000000-0000-4000-8000-%012d", n) }
	now := time.Date(2026, 11, 20, 12, 14, 0, 65_000_000, time.UTC)
	old := now.Add(-11 * time.Minute)
	org, otherOrg, pipeline, disabled, noActivation, unlimited := uid(50), uid(51), uid(52), uid(53), uid(54), uid(55)
	owner, previousOwner, queue, closedStage := uid(60), uid(61), uid(62), uid(63)
	exec(`insert into pipelines values ($1,$2,true,10,2,3,$6), ($3,$2,false,10,2,3,$6),
		($4,$2,true,10,2,3,null), ($5,$2,true,10,0,0,$6)`, pipeline, org, disabled, noActivation, unlimited, now.Add(-time.Hour))
	for i := 1; i <= 21; i++ {
		exec(`insert into leads (id, organization_id, pipeline_id, deal_status, assigned_user_id, assigned_at, created_at,
			operational_effects_suppressed) values ($1,$2,$3,'open',$4,$5,$5,false);
			insert into assignments_log (lead_id, organization_id, assigned_user_id, round_robin_id, reason, created_at, assigned_at)
			values ($1,$2,$4,$6,'canonical_round_robin',$5,$5)`, uid(i), org, pipeline, owner, old, queue)
	}

	exec(`update leads set assigned_at=$1 where id=$2`, now.Add(-9*time.Minute), uid(2))
	exec(`update leads set assigned_at=$1 where id=$2`, now.Add(-10*time.Minute), uid(3))
	exec(`update leads set assigned_at=$1 where id=$2`, now.Add(-8*time.Minute), uid(4))
	exec(`update leads set deal_status='lost' where id=$1`, uid(5))
	exec(`insert into stages values ($1,$2,$3,false,true); update leads set stage_id=$1 where id=$4`,
		closedStage, pipeline, org, uid(6))
	exec(`update leads set operational_effects_suppressed=true where id=$1`, uid(7))
	exec(`update leads set first_response_at=assigned_at where id=$1`, uid(8))
	exec(`update leads set stage_entered_at=assigned_at+interval '10 seconds 1 millisecond' where id=$1`, uid(9))
	exec(`update leads set stage_entered_at=assigned_at+interval '10 seconds 999 microseconds' where id=$1`, uid(10))
	exec(`update assignments_log set assigned_user_id=$1 where lead_id=$2`, previousOwner, uid(11))
	exec(`update assignments_log set reason='manual' where lead_id=$1`, uid(12))
	exec(`update assignments_log set assigned_at=$1 where lead_id=$2`, now.Add(-2*time.Hour), uid(13))
	exec(`update leads set redistribution_count=3 where id=$1; update leads set redistribution_count=25, pipeline_id=$3 where id=$2`,
		uid(14), uid(21), unlimited)
	exec(`insert into lead_timeline_events values ($1,$3,'note_created',$4), ($2,$5,'note_created',$4)`,
		uid(15), uid(16), org, old.Add(-5*time.Second), otherOrg)
	exec(`insert into whatsapp_messages values ($1,$4,'suppressed',true,null,$5), ($2,$4,null,true,null,$5),
		($3,$4,null,false,$6,$5)`, uid(17), uid(18), uid(19), org, old.Add(-5*time.Second), owner)
	exec(`update leads set pipeline_id=$1 where id=$2`, noActivation, uid(20))
	exec(`insert into pool_test_outcomes values ($1,'warning','{"success":true,"skipped":true,"reason":"warning_already_sent"}'),
		($2,'redistribution','{"success":false,"skipped":true,"reason":"stale_pool_candidate"}'),
		($3,'redistribution','{"success":true,"pool_finalized":false,"assigned_user_id":"broker"}'),
		($4,'redistribution','{"success":true,"skipped":true,"pool_finalized":true,"assigned_user_id":"broker","reason":"ignored"}')`,
		uid(3), uid(16), uid(17), uid(10))

	result, err := runPoolCheck(ctx, tx, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	if result.Success || result.Redistributed != 3 || result.Skipped != 2 || result.Failed != 1 {
		t.Fatalf("unexpected totals: %+v", result)
	}
	expectedWarnings := []PoolCheckAttempt{
		{LeadID: uid(3), Success: true, Skipped: true, Error: "warning_already_sent"},
		{LeadID: uid(2), Success: true},
	}
	expectedRedistributions := []PoolCheckAttempt{
		{LeadID: uid(1), Success: true}, {LeadID: uid(10), Success: true},
		{LeadID: uid(16), Skipped: true, Error: "stale_pool_candidate"},
		{LeadID: uid(17), Error: "pool_distribution_not_finalized"}, {LeadID: uid(21), Success: true},
	}
	if !reflect.DeepEqual(result.Warnings, expectedWarnings) || !reflect.DeepEqual(result.Results, expectedRedistributions) {
		t.Fatalf("candidate selection differs: warnings=%+v results=%+v", result.Warnings, result.Results)
	}
	var recorded int
	if err := tx.QueryRow(ctx, `select count(*) from pool_test_calls where org=$1 and queue=$2 and broker=$3 and attempted=$4`,
		org, queue, owner, now).Scan(&recorded); err != nil || recorded != 7 {
		t.Fatalf("RPC snapshot arguments differ: matching calls=%d err=%v", recorded, err)
	}
	var expectedCount int
	var wire string
	if err := tx.QueryRow(ctx, `select expected_count,dedupe from pool_test_calls where lead=$1`, uid(1)).Scan(&expectedCount, &wire); err != nil {
		t.Fatal(err)
	}
	wantKey, err := poolCheckIdempotencyKey(poolCheckCandidate{
		LeadID: uid(1), AssignedUserID: owner, RoundRobinID: queue, DistributionKeyAt: "2026-11-20T12:03:00.065+00:00",
	})
	if err != nil || expectedCount != 0 || wire != wantKey {
		t.Fatalf("RPC NULL count or PostgreSQL timestamp identity changed: count=%d key=%s err=%v", expectedCount, wire, err)
	}
}

const poolCheckFixtureSQL = `
	create table public.pipelines (id uuid, organization_id uuid, pool_enabled bool, pool_timeout_minutes int,
		pool_warning_minutes int, pool_max_redistributions int, pool_enabled_at timestamptz);
	create table public.leads (id uuid, organization_id uuid, pipeline_id uuid, stage_id uuid, deal_status text,
		assigned_user_id uuid, assigned_at timestamptz, created_at timestamptz, first_response_at timestamptz,
		first_touch_at timestamptz, owner_last_activity_at timestamptz, last_contact_at timestamptz,
		redistribution_warning_sent_at timestamptz, redistribution_count int, operational_effects_suppressed bool,
		stage_entered_at timestamptz);
	create table public.assignments_log (id uuid default gen_random_uuid(), lead_id uuid, organization_id uuid,
		assigned_user_id uuid, round_robin_id uuid, reason text, created_at timestamptz, assigned_at timestamptz);
	create table public.stages (id uuid, pipeline_id uuid, organization_id uuid, is_won bool, is_lost bool);
	create table public.lead_timeline_events (lead_id uuid, organization_id uuid, event_type text, created_at timestamptz);
	create table public.whatsapp_messages (lead_id uuid, organization_id uuid, capture_state text, from_me bool,
		sender_user_id uuid, created_at timestamptz);
	create table public.pool_test_calls (kind text, org uuid, lead uuid, queue uuid, broker uuid, assigned timestamptz,
		distribution timestamptz, expected_count int, attempted timestamptz, dedupe text);
	create table public.pool_test_outcomes (lead uuid, kind text, response jsonb);
	create function public.send_pool_redistribution_warning_from_backend(uuid,uuid,uuid,uuid,timestamptz,timestamptz,int,timestamptz)
	returns jsonb language sql as $$
		insert into pool_test_calls values ('warning',$1,$2,$3,$4,$5,$6,$7,$8,null);
		select coalesce((select response from pool_test_outcomes where lead=$2 and kind='warning'), '{"success":true}'::jsonb)
	$$;
	create function public.redistribute_lead_from_pool_backend(uuid,uuid,text,uuid,uuid,timestamptz,int,timestamptz)
	returns jsonb language sql as $$
		insert into pool_test_calls values ('redistribution',$1,$2,$4,$5,$6,null,$7,$8,$3);
		select coalesce((select response from pool_test_outcomes where lead=$2 and kind='redistribution'),
			'{"success":true,"pool_finalized":true,"assigned_user_id":"broker"}'::jsonb)
	$$;
`
