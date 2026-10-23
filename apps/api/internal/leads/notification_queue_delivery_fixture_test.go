package leads

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type queueDeliveryFixture struct {
	ctx                                                                           context.Context
	repo                                                                          Repository
	org, admin, actor, queue, lead, episode, event, notification, pipeline, stage string
}

func queueNotificationIsolationRequired(other int) error {
	if other > 0 {
		return errors.New("notification fixture requires an empty outbox in its dedicated database")
	}
	return nil
}

func queueNotificationTestTarget(raw, optIn, runID, environment string) (*url.URL, error) {
	target, err := url.Parse(raw)
	if err != nil || optIn != "LOCAL_WRITE_TEST" || environment != "test" || len(runID) != 36 ||
		target == nil || (target.Scheme != "postgres" && target.Scheme != "postgresql") ||
		target.Hostname() != "127.0.0.1" || target.Port() != "57422" || !regexp.MustCompile(`^/vimob_queue_notify20261016_[0-9a-f]{8}$`).MatchString(target.Path) ||
		target.User == nil || target.User.Username() != "postgres" || target.Fragment != "" {
		return nil, errors.New("queue notification tests require the attested disposable local target")
	}
	for key, values := range target.Query() {
		if key != "sslmode" || len(values) != 1 || values[0] != "disable" {
			return nil, errors.New("unexpected database connection option")
		}
	}
	return target, nil
}

func newQueueDeliveryFixture(t *testing.T, pool bool) *queueDeliveryFixture {
	t.Helper()
	optIn := os.Getenv("VIMOB_RUN_QUEUE_NOTIFICATION_DB_TESTS")
	if optIn == "" {
		t.Skip("requires explicit attested disposable notification fixture")
	}
	runID := os.Getenv("VIMOB_QUEUE_TEST_RUN_ID")
	target, err := queueNotificationTestTarget(os.Getenv("QUEUE_NOTIFICATION_TEST_DATABASE_URL"), optIn, runID, os.Getenv("API_ENV"))
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"EVOLUTION_GO_API_URL", "EVOLUTION_GO_API_KEY", "RESEND_API_KEY", "FCM_SERVER_KEY"} {
		if os.Getenv(key) != "" {
			t.Fatalf("external provider environment forbidden: %s", key)
		}
	}
	ctx, cancel := context.WithTimeout(t.Context(), 45*time.Second)
	t.Cleanup(cancel)
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: target.String(), MaxConns: 6, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal("cannot connect to disposable queue database")
	}
	t.Cleanup(database.Close)
	f := &queueDeliveryFixture{ctx: ctx, repo: Repository{db: database}}
	var actualRun, project string
	var cron, unexpected, pending int
	err = database.Pool().QueryRow(ctx, `select
	 (select run_id::text from private.queue_homologation_sentinel where singleton),
	 (select project_id from private.queue_homologation_sentinel where singleton),
	 (select count(*)::int from pg_extension where extname='pg_cron')+(case when to_regclass('cron.job') is null then 0 else 1 end),
	 (select count(*)::int from public.organizations where email is null or email not like '%@queue.local.test'),
	 (select count(*)::int from private.notification_deliveries where status in('queued','retry_wait','leased','sending','blocked_dependency'))`).Scan(&actualRun, &project, &cron, &unexpected, &pending)
	if err != nil || actualRun != runID || project != "queue-notification-dispatch-20261016" || cron != 0 || unexpected != 0 {
		t.Fatal("disposable target sentinel, synthetic ownership, cron or outbox is not quiescent")
	}
	if err := queueNotificationIsolationRequired(pending); err != nil {
		t.Fatal(err)
	}
	if err := database.Pool().QueryRow(ctx, `select gen_random_uuid()::text,gen_random_uuid()::text,gen_random_uuid()::text,
	 gen_random_uuid()::text,gen_random_uuid()::text,gen_random_uuid()::text,gen_random_uuid()::text,gen_random_uuid()::text,gen_random_uuid()::text`).Scan(&f.org, &f.admin, &f.actor, &f.queue, &f.lead, &f.episode, &f.event, &f.pipeline, &f.stage); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, done := context.WithTimeout(context.Background(), 30*time.Second)
		defer done()
		_, err := database.Pool().Exec(cleanup, `delete from public.notifications where organization_id=$1::uuid;
		 delete from private.queue_lead_runtime where organization_id=$1::uuid;
		 delete from public.leads where organization_id=$1::uuid;
		 delete from private.queue_pool_alert_throttle where organization_id=$1::uuid;
		 delete from private.queue_runtime_events where organization_id=$1::uuid;
		 delete from private.queue_pool_claim_receipts where organization_id=$1::uuid;
		 delete from public.round_robins where organization_id=$1::uuid;
		 update public.users set organization_id=null where organization_id=$1::uuid;
		 delete from public.organizations where id=$1::uuid;
		 delete from public.users where id=any($2::uuid[]);delete from auth.users where id=any($2::uuid[])`, f.org, []string{f.admin, f.actor})
		if err != nil {
			t.Errorf("cleanup queue delivery fixture: %v", err)
		}
	})
	f.exec(t, `insert into public.organizations(id,name,email,is_active) values($1::uuid,'Queue notification synthetic','notification-'||$1||'@queue.local.test',true);
	 insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
	 select id,'authenticated','authenticated','notification-'||id||'@queue.local.test','',now(),'{}','{}',now(),now() from unnest(array[$2::uuid,$3::uuid]) id;
	 insert into public.users(id,organization_id,name,email,role,is_active,whatsapp)
	 select id,$1::uuid,'Synthetic queue recipient','notification-'||id||'@queue.local.test',case when id=$2::uuid then 'admin' else 'user' end,true,'5511999990000'
	 from unnest(array[$2::uuid,$3::uuid]) id on conflict(id) do update set organization_id=excluded.organization_id,role=excluded.role,is_active=true,whatsapp=excluded.whatsapp;
	 insert into public.organization_members(organization_id,user_id,role,is_active)
	 select $1::uuid,id,case when id=$2::uuid then 'admin' else 'user' end,true from unnest(array[$2::uuid,$3::uuid]) id
	 on conflict(user_id,organization_id) do update set role=excluded.role,is_active=true,deleted_at=null;
	 insert into public.pipelines(id,organization_id,name,position,is_default,is_active,pool_enabled) values($11::uuid,$1::uuid,'Synthetic notification pipeline',0,true,true,false);
	 insert into public.stages(id,organization_id,pipeline_id,name,stage_key,color,position,is_active) values($12::uuid,$1::uuid,$11::uuid,'Synthetic new','new','#ff4529',0,true);
	 insert into public.round_robins(id,organization_id,name,is_active,pipeline_id,target_pipeline_id,target_stage_id,settings) values($4::uuid,$1::uuid,'Synthetic notification queue',true,$11::uuid,$11::uuid,$12::uuid,
	 jsonb_build_object('operating_schedule',jsonb_build_object('version',1,'timezone','UTC','days',
	 (select jsonb_agg(jsonb_build_object('day_of_week',d,'is_active',$13::boolean,'is_all_day',true,'start_time',null,'end_time',null)) from generate_series(0,6) d)),
	 'enable_redistribution',true,'redistribution_timeout_minutes',10,'redistribution_warning_minutes',5,'pool_notifications',jsonb_build_object('enabled',false)));
	 insert into public.round_robin_members(organization_id,round_robin_id,user_id,position,is_active)
	 values($1::uuid,$4::uuid,$2::uuid,0,true),($1::uuid,$4::uuid,$3::uuid,1,true);
	 insert into public.leads(id,organization_id,assigned_user_id,name,source,origin_round_robin_id,assigned_at,pipeline_id,stage_id)
	 values($5::uuid,$1::uuid,$8::uuid,'Private synthetic customer','manual',$4::uuid,clock_timestamp(),$11::uuid,$12::uuid);
	 insert into private.queue_lead_runtime(organization_id,lead_id,round_robin_id,episode_id,revision,state,reason,max_assignments,last_user_id,baseline_at,assigned_at,due_at,next_action_at,last_distribution_event_id,entered_pool_at)
	 values($1::uuid,$5::uuid,$4::uuid,$6::uuid,1,$9,$10,0,$8::uuid,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '4 minutes',clock_timestamp()+interval '4 minutes',$7::uuid,case when $9='pool_waiting' then clock_timestamp() end)
	 on conflict(organization_id,lead_id) do update set episode_id=excluded.episode_id,revision=excluded.revision,state=excluded.state,reason=excluded.reason,last_user_id=excluded.last_user_id,
	 baseline_at=excluded.baseline_at,assigned_at=excluded.assigned_at,due_at=excluded.due_at,next_action_at=excluded.next_action_at,last_distribution_event_id=excluded.last_distribution_event_id,entered_pool_at=excluded.entered_pool_at;
	 insert into public.whatsapp_sessions(organization_id,owner_user_id,instance_name,provider,status,is_active,is_notification_session,advanced_settings)
	 values($1::uuid,$2::uuid,'synthetic-notification','evolution_go','connected',true,true,'{"token":"synthetic-only"}');`,
		f.org, f.admin, f.actor, f.queue, f.lead, f.episode, f.event, func() any {
			if pool {
				return nil
			}
			return f.actor
		}(), func() string {
			if pool {
				return "pool_waiting"
			}
			return "auto_assigned"
		}(), func() string {
			if pool {
				return "queue_closed"
			}
			return "initial_distribution"
		}(), f.pipeline, f.stage, !pool)
	f.exec(t, `update public.round_robins set settings=settings||'{"pool_notifications":{"enabled":true}}'::jsonb where id=$1::uuid`, f.queue)
	f.enableSyntheticWhatsApp(t)
	return f
}

func (f *queueDeliveryFixture) exec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := f.repo.db.Pool().Exec(f.ctx, query, args...); err != nil {
		t.Fatal(err)
	}
}

func (f *queueDeliveryFixture) addForeignSyntheticSender(t *testing.T) {
	t.Helper()
	var foreign string
	if err := f.repo.db.Pool().QueryRow(f.ctx, `select gen_random_uuid()::text`).Scan(&foreign); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := f.repo.db.Pool().Exec(ctx, `delete from public.whatsapp_sessions where organization_id=$1::uuid;delete from public.organizations where id=$1::uuid`, foreign); err != nil {
			t.Errorf("cleanup foreign synthetic sender: %v", err)
		}
	})
	f.exec(t, `insert into public.organizations(id,name,email,is_active) values($1::uuid,'Queue notification foreign synthetic','notification-'||$1||'@queue.local.test',true);
	 insert into public.organization_members(organization_id,user_id,role,is_active) values($1::uuid,$2::uuid,'admin',true);
	 insert into public.whatsapp_sessions(organization_id,owner_user_id,instance_name,provider,status,is_active,is_notification_session,advanced_settings)
	 values($1::uuid,$2::uuid,'synthetic-foreign-notification','evolution_go','connected',true,true,'{"token":"synthetic-only"}')`, foreign, f.admin)
}

func (f *queueDeliveryFixture) enableSyntheticWhatsApp(t *testing.T) {
	t.Helper()
	var id, raw string
	var updated *time.Time
	err := f.repo.db.Pool().QueryRow(f.ctx, `select id::text,value::text,updated_at from public.system_settings where key='notifications'`).Scan(&id, &raw, &updated)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		t.Fatal(err)
	}
	existed := err == nil
	if existed {
		f.exec(t, `update public.system_settings set value='{"notification_dispatch":{"whatsapp":{"enabled":true}}}'::jsonb where id=$1::uuid`, id)
	} else {
		if err := f.repo.db.Pool().QueryRow(f.ctx, `insert into public.system_settings(key,value) values('notifications','{"notification_dispatch":{"whatsapp":{"enabled":true}}}') returning id::text`).Scan(&id); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		var err error
		if existed {
			_, err = f.repo.db.Pool().Exec(ctx, `update public.system_settings set value=$2::jsonb,updated_at=$3 where id=$1::uuid`, id, raw, updated)
		} else {
			_, err = f.repo.db.Pool().Exec(ctx, `delete from public.system_settings where id=$1::uuid`, id)
		}
		if err != nil {
			t.Errorf("restore local notification configuration: %v", err)
		}
	})
}

func (f *queueDeliveryFixture) notify(t *testing.T, event string) {
	t.Helper()
	if err := f.repo.db.Pool().QueryRow(f.ctx, `insert into public.notifications(organization_id,user_id,lead_id,type,title,content,metadata)
	 values($1::uuid,$2::uuid,$3::uuid,'lead','Synthetic queue event','Synthetic queue message',jsonb_build_object('event_key',$4::text,'episode_id',$5::text,'revision','1',
	 'distribution_event_id',$6::text,'dedupe_key','synthetic:'||gen_random_uuid()::text,'dispatch',jsonb_build_object('whatsapp',jsonb_build_object('required',true),'push',jsonb_build_object('required',false),'email',jsonb_build_object('required',false)))) returning id::text`,
		f.org, f.actor, f.lead, event, f.episode, f.event).Scan(&f.notification); err != nil {
		t.Fatal(err)
	}
	f.exec(t, `delete from public.notifications where organization_id=$1::uuid and id<>$2::uuid;select private.materialize_notification_deliveries($2::uuid,false)`, f.org, f.notification)
}

type queueNotificationLoopbackTransport struct {
	allowed    string
	underlying http.RoundTripper
}

func (transport queueNotificationLoopbackTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.URL.Scheme+"://"+r.URL.Host != transport.allowed || r.URL.Hostname() != "127.0.0.1" {
		return nil, errors.New("external notification HTTP is forbidden")
	}
	return transport.underlying.RoundTrip(r)
}

func (f *queueDeliveryFixture) fakeProvider(t *testing.T, outcomeUnknown bool, entered, release chan struct{}) *atomic.Int32 {
	t.Helper()
	requests := &atomic.Int32{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.Method != "POST" || r.URL.Path != "/send/text" || r.Header.Get("apikey") != "synthetic-only" {
			t.Error("unexpected synthetic provider request")
		}
		var body map[string]any
		raw, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Error(err)
		}
		if strings.Contains(string(raw), "Private synthetic customer") {
			t.Error("notification leaked private customer name")
		}
		if entered != nil {
			close(entered)
			<-release
		}
		w.Header().Set("Content-Type", "application/json")
		if outcomeUnknown {
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = io.WriteString(w, `{"error":"synthetic uncertain result"}`)
			return
		}
		_, _ = fmt.Fprintf(w, `{"id":%q}`, body["id"])
	}))
	t.Cleanup(server.Close)
	original := http.DefaultTransport
	http.DefaultTransport = queueNotificationLoopbackTransport{allowed: server.URL, underlying: original}
	t.Cleanup(func() { http.DefaultTransport = original })
	f.repo.evolutionGoAPIURL = server.URL
	f.repo.evolutionGoAPIKey = "synthetic-only"
	return requests
}

func (f *queueDeliveryFixture) dispatch(t *testing.T) bool {
	t.Helper()
	processed, err := f.repo.processOneNormalizedNotificationDelivery(f.ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	return processed
}
