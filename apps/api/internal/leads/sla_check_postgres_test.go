package leads

import (
	"context"
	"os"
	"regexp"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestSLACheckAgainstIsolatedSchema(t *testing.T) {
	database := os.Getenv("VIMOB_SLA_FIXTURE_DATABASE")
	if database == "" {
		t.Skip("requires the disposable local baseline and its Unix socket")
	}
	if !regexp.MustCompile(`^vimob_local_baseline_phase2_[0-9a-f]{8}$`).MatchString(database) {
		t.Fatal("unexpected database for SLA fixture")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	config, err := pgx.ParseConfig("host=/var/run/postgresql port=5432 user=postgres sslmode=disable dbname=" + database)
	if err != nil {
		t.Fatal("invalid local fixture configuration")
	}
	config.Password = ""
	config.Fallbacks = nil
	conn, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		t.Fatal("connect to the disposable fixture using its local socket")
	}
	defer conn.Close(context.Background())

	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())

	var isolated bool
	if err := tx.QueryRow(ctx, `
		select current_database() = $1 and inet_server_addr() is null
			and not exists(select 1 from pg_extension where extname='pg_cron')
			and to_regclass('private.notification_deliveries') is not null
	`, database).Scan(&isolated); err != nil || !isolated {
		t.Fatalf("local fixture attestation failed: %v", err)
	}
	const organization = "a5210000-0000-4000-8000-000000000001"
	const lead = "a5210000-0000-4000-8000-000000000011"
	var now time.Time
	if err := tx.QueryRow(ctx, "select clock_timestamp()").Scan(&now); err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(ctx, `
		set local time zone 'UTC';
		set local session_replication_role = 'replica';
		insert into public.organizations (id, name) values ('a5210000-0000-4000-8000-000000000001', 'SLA fixture');
		insert into public.pipelines (id, organization_id, name)
		values ('a5210000-0000-4000-8000-000000000002', 'a5210000-0000-4000-8000-000000000001', 'SLA fixture');
		insert into public.pipeline_sla_settings (pipeline_id, warning_hours, critical_hours)
		values ('a5210000-0000-4000-8000-000000000002', 1, 2);
		insert into public.users (id, organization_id, name, email, role, is_active)
		select concat('a5210000-0000-4000-8000-00000000002',idx)::uuid,
		       'a5210000-0000-4000-8000-000000000001', 'SLA fixture',
		       concat('phase52-sla-',idx,'@local.test'), role, active
		from (values (1,'user',true),(2,'manager',true),(3,'admin',true),(4,'admin',false)) u(idx,role,active);
		insert into public.organization_members (organization_id,user_id,role,is_active)
		select 'a5210000-0000-4000-8000-000000000001',id,role,true from public.users
		where email in ('phase52-sla-1@local.test','phase52-sla-2@local.test','phase52-sla-4@local.test');
		insert into public.leads (id,organization_id,pipeline_id,assigned_user_id,name,source,deal_status,first_response_at,
			operational_effects_suppressed,created_at,historical_imported_at,external_source,external_source_id)
		select concat('a5210000-0000-4000-8000-00000000001',idx)::uuid,
			'a5210000-0000-4000-8000-000000000001','a5210000-0000-4000-8000-000000000002',
			'a5210000-0000-4000-8000-000000000021','SLA synthetic','manual',status,responded,suppressed,
			now() - interval '90 minutes', case when suppressed then now() end,
			case when suppressed then 'phase52-sla' end, case when suppressed then idx::text end
		from (values (1,'open',null::timestamptz,false),(2,'won',null,false),
			(3,'open',now(),false),(4,'open',null,true)) l(idx,status,responded,suppressed);
		set local session_replication_role = 'origin';
		set local role service_role;
	`)
	if err != nil {
		t.Fatal(err)
	}
	repo := Repository{}
	for _, step := range []struct {
		at    time.Time
		event string
	}{
		{at: now, event: "sla_warning"},
		{at: now.Add(time.Hour), event: "sla_overdue"},
		{at: now.Add(time.Hour + time.Minute), event: ""},
	} {
		candidates, err := loadSLACandidates(ctx, tx, step.at)
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, c := range candidates {
			if c.organizationID != organization {
				continue
			}
			if found || c.leadID != lead {
				t.Fatal("unexpected SLA-eligible fixture lead")
			}
			found = true
			event, err := repo.applySLACheck(ctx, tx, c, step.at)
			if err != nil || event != step.event {
				t.Fatalf("apply SLA returned event=%q err=%v, expected %q", event, err, step.event)
			}
		}
		if !found {
			t.Fatal("eligible fixture lead missing")
		}
		if _, err := tx.Exec(ctx, "update public.leads set sla_last_checked_at = now()-interval '2 minutes' where id = $1", lead); err != nil {
			t.Fatal(err)
		}
	}

	var notices, wrongRecipients, timeline, activities int
	if err := tx.QueryRow(ctx, `
		select (select count(*) from public.notifications where organization_id = $1 and lead_id = $2),
		       (select count(*) from public.notifications where organization_id = $1 and lead_id = $2 and
		           (user_id::text || ':' || (metadata->>'event_key')) not in (
		            'a5210000-0000-4000-8000-000000000021:sla_warning',
		            'a5210000-0000-4000-8000-000000000021:sla_overdue',
		            'a5210000-0000-4000-8000-000000000022:sla_overdue_manager')),
		       (select count(*) from public.lead_timeline_events where organization_id = $1 and lead_id = $2),
		       (select count(*) from public.activities where organization_id = $1 and lead_id = $2 and type in ('sla_warning','sla_overdue'))
	`, organization, lead).Scan(&notices, &wrongRecipients, &timeline, &activities); err != nil {
		t.Fatal(err)
	}
	if notices != 3 || wrongRecipients != 0 || timeline != 2 || activities != 2 {
		t.Fatalf("notices=%d wrong recipients=%d timeline=%d activities=%d", notices, wrongRecipients, timeline, activities)
	}
}
