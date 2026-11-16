package homefocus

import (
	"context"
	"net/url"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestCadenceFallbackWarningPostgres(t *testing.T) {
	dsn := os.Getenv("HOMEFOCUS_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set HOMEFOCUS_TEST_DATABASE_URL to an owned loopback PostgreSQL fixture")
	}
	target, err := url.Parse(dsn)
	if err != nil || target.Scheme != "postgres" || target.Hostname() != "127.0.0.1" ||
		target.Path != "/vimob_homefocus_test" || target.RawQuery != "sslmode=disable" {
		t.Fatal("expected the dedicated local Home focus fixture")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal("cannot open the local Home focus fixture")
	}
	defer conn.Close(ctx)
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, cadenceFallbackFixtureSQL); err != nil {
		t.Fatal(err)
	}

	// Only the temporary table namespace differs from the repository query.
	rows, err := tx.Query(ctx, strings.ReplaceAll(listFocusSQL, "public.", "pg_temp."),
		"10000000-0000-4000-8000-000000000001", "mine",
		"20000000-0000-4000-8000-000000000001", []string{}, 30)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var actual []string
	for rows.Next() {
		item, err := scanItem(rows)
		if err != nil {
			t.Fatal(err)
		}
		actual = append(actual, item.Title+":"+item.Kind+":"+item.Status+":"+item.Tone)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	want := []string{
		"overdue:task:breached:critical",
		"inside:task:warning:warning",
		"boundary:task:warning:warning",
		"active attention:attention:due:neutral",
		"ordinary:task:due:neutral",
		"invalid:task:due:neutral",
		"overflow:task:due:neutral",
		"outsized:task:due:neutral",
		"disabled warning:task:due:neutral",
		"historical:task:due:neutral",
		"before:task:due:neutral",
		"date only:task:due:neutral",
	}
	if !reflect.DeepEqual(actual, want) {
		t.Errorf("focus items = %v\nwant          %v", actual, want)
	}
}

const cadenceFallbackFixtureSQL = `
create temp table leads(id uuid, organization_id uuid, name text, pipeline_id uuid, stage_id uuid,
  deal_status text, attention_eligible boolean, attention_enrolled_at timestamptz, assigned_user_id uuid);
create temp table pipelines(id uuid, organization_id uuid, name text);
create temp table stages(id uuid, organization_id uuid, name text);
create temp table lead_stage_cycles(id uuid, organization_id uuid, lead_id uuid, stage_id uuid, entered_at timestamptz, exited_at timestamptz);
create temp table lead_assignment_cycles(id uuid, organization_id uuid, lead_id uuid, ended_at timestamptz);
create temp table cadence_enrollments(id uuid, organization_id uuid, stage_cycle_id uuid, status text, metadata jsonb);
create temp table lead_tasks(id uuid, organization_id uuid, lead_id uuid, title text, description text, type text,
  due_at timestamptz, due_date date, status text, is_done boolean, cadence_enrollment_id uuid, assigned_user_id uuid, metadata jsonb);
create temp table lead_attention_policies(id uuid, organization_id uuid, policy_type text, name text, config jsonb,
  pipeline_id uuid, stage_id uuid, status text);
create temp table lead_attention_instances(id uuid, organization_id uuid, lead_id uuid, policy_id uuid, cycle_key text,
  metadata jsonb, due_at timestamptz, status text, assigned_user_id uuid, shadow boolean,
  snoozed_until timestamptz, assignment_cycle_id uuid, stage_cycle_id uuid);

insert into leads
select ('30000000-0000-4000-8000-00000000000' || n)::uuid, ('10000000-0000-4000-8000-00000000000' || n)::uuid,
  'Synthetic lead', '40000000-0000-4000-8000-000000000001', ('50000000-0000-4000-8000-00000000000' || n)::uuid,
  'open', true, now(), '20000000-0000-4000-8000-000000000001'
from generate_series(1, 2) n;
insert into stages select stage_id, organization_id, 'Stage' from leads;
insert into lead_stage_cycles
select stage_id, organization_id, id, stage_id, now() - interval '2 minutes', null from leads;
insert into cadence_enrollments
select ('60000000-0000-4000-8000-00000000000' || v.n)::uuid, l.organization_id, l.stage_id, v.status, v.metadata::jsonb
from (values (1, 1, 'active', '{}'), (2, 1, 'active', '{"historical_backfill":true}'),
  (3, 1, 'cancelled', '{}'), (4, 2, 'active', '{}')) as v(n, tenant, status, metadata)
join leads l on l.id = ('30000000-0000-4000-8000-00000000000' || v.tenant)::uuid;

insert into lead_tasks
select ('70000000-0000-4000-8000-' || lpad(v.n::text, 12, '0'))::uuid, l.organization_id, l.id, v.title, null, 'note',
  now() + make_interval(secs => v.seconds), case when v.seconds is null then current_date + 1 end, 'pending', false,
  ('60000000-0000-4000-8000-00000000000' || v.enrollment)::uuid,
  ('20000000-0000-4000-8000-00000000000' || v.owner)::uuid, v.metadata::jsonb
from (values
  (1, 'overdue', -1, 1, 1, 1, '{"warning_minutes":1}'),
  (2, 'inside', 30, 1, 1, 1, '{"warning_minutes":1}'),
  (3, 'boundary', 60, 1, 1, 1, '{"warning_minutes":"1"}'),
  (4, 'active attention', 10, 1, 1, 1, '{"warning_minutes":1}'),
  (5, 'ordinary', 31, null, 1, 1, '{"warning_minutes":1}'),
  (6, 'invalid', 32, 1, 1, 1, '{"warning_minutes":"wat"}'),
  (7, 'overflow', 33, 1, 1, 1, '{"warning_minutes":"999999999999999999999999"}'),
  (8, 'outsized', 34, 1, 1, 1, '{"warning_minutes":3}'),
  (9, 'disabled warning', 35, 1, 1, 1, '{"warning_minutes":0}'),
  (10, 'historical', 36, 2, 1, 1, '{"warning_minutes":1}'),
  (11, 'before', 61, 1, 1, 1, '{"warning_minutes":1}'),
  (12, 'date only', null, 1, 1, 1, '{"warning_minutes":1}'),
  (13, 'cancelled enrollment', 30, 3, 1, 1, '{"warning_minutes":1}'),
  (14, 'other tenant', 30, 4, 2, 1, '{"warning_minutes":1}'),
  (15, 'other owner', 30, 1, 1, 2, '{"warning_minutes":1}')
) as v(n, title, seconds, enrollment, tenant, owner, metadata)
join leads l on l.id = ('30000000-0000-4000-8000-00000000000' || v.tenant)::uuid;

insert into lead_attention_policies values ('90000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001', 'cadence_task', 'Policy', '{}', null, null, 'enabled');
insert into lead_attention_instances
select lt.id, lt.organization_id, lt.lead_id, '90000000-0000-4000-8000-000000000001',
  lt.id::text, jsonb_build_object('lead_task_id', lt.id, 'task_title', lt.title), lt.due_at,
  case when lt.title = 'inside' then 'warning' else 'monitoring' end,
  lt.assigned_user_id, lt.title = 'inside', null, null, null
from lead_tasks lt where lt.title in ('inside', 'active attention');
`
