package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/leads"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

const sessionHealthFixtureDB = "vimob_phase52_session_health"

func TestSessionHealthSupervisorPostgres(t *testing.T) {
	rawURL := os.Getenv("VIMOB_SESSION_HEALTH_TEST_DATABASE_URL")
	if rawURL == "" {
		t.Skip("requires the disposable session-health PostgreSQL fixture")
	}
	target, err := url.Parse(rawURL)
	if err != nil || target.Scheme != "postgres" || target.Hostname() != "127.0.0.1" || target.Port() == "" ||
		target.Path != "/"+sessionHealthFixtureDB || target.User == nil || target.User.Username() != "postgres" ||
		target.Fragment != "" || target.RawQuery != "sslmode=disable" {
		t.Fatal("session-health fixture must use the dedicated loopback database")
	}
	ctx, cancel := context.WithTimeout(t.Context(), time.Minute)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: rawURL, MaxConns: 5, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal("could not connect to the session-health fixture")
	}
	defer database.Close()
	pool := database.Pool()
	var databaseName string
	var isolated bool
	if err := pool.QueryRow(ctx, `
		select current_database(), to_regclass('cron.job') is null
		    and current_setting('vimob.test_fixture', true) = 'session-health-disposable'
		    and not exists (select 1 from public.whatsapp_sessions)
	`).Scan(&databaseName, &isolated); err != nil || databaseName != sessionHealthFixtureDB || !isolated {
		t.Fatal("session-health fixture must be a fresh, unscheduled database with its test marker")
	}

	notices := leads.NewRepository(database, nil)
	for _, tc := range []struct {
		name, second, wantStatus   string
		newerWebhook, enqueueFails bool
		wantEffects                int
	}{
		{name: "confirmed disconnect", second: "disconnected", wantStatus: "disconnected", wantEffects: 1},
		{name: "recovered during recheck", second: "connected", wantStatus: "connected"},
		{name: "newer webhook wins", second: "disconnected", wantStatus: "connected", newerWebhook: true},
		{name: "queue failure rolls back", second: "disconnected", wantStatus: "connected", enqueueFails: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			organization, session, owner, admin, foreignOrg := seedSessionHealthPostgres(t, ctx, database)
			var probeCount atomic.Int32
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodGet || r.URL.Path != "/instance/status" || r.Header.Get("apikey") != "synthetic-session-key" {
					t.Error("supervisor must send only session-scoped status requests")
					http.Error(w, "unexpected provider request", http.StatusBadRequest)
					return
				}
				state := "disconnected"
				if probeCount.Add(1) == 2 {
					state = tc.second
					if tc.newerWebhook {
						if _, err := pool.Exec(ctx, `
							update public.whatsapp_sessions
							set advanced_settings = advanced_settings || '{"webhook_state_event_key":"newer-webhook"}',
							    updated_at = clock_timestamp()
							where id = $1::uuid and organization_id = $2::uuid
						`, session, organization); err != nil {
							t.Error("could not persist synthetic newer provider observation")
							http.Error(w, "synthetic webhook error", http.StatusInternalServerError)
							return
						}
					}
				}
				w.Header().Set("Content-Type", "application/json")
				fmt.Fprintf(w, `{"data":{"state":%q}}`, state)
			}))
			defer provider.Close()
			repo := NewRepository(database, nil, StorageConfig{EvolutionGo: EvolutionGoConfig{APIURL: provider.URL, APIKey: "synthetic-global-key"}}).
				WithSessionHealthNotifications(func(ctx context.Context, tx pgx.Tx, orgID, userID, event, key string, variables map[string]any) error {
					if err := notices.EnqueueSessionHealthNotification(ctx, tx, orgID, userID, event, key, variables); err != nil {
						return err
					}
					if tc.enqueueFails {
						return errors.New("synthetic failure after canonical enqueue")
					}
					return nil
				})
			logger := slog.New(slog.NewTextHandler(io.Discard, nil))
			if err := repo.superviseActiveSessionsWithLimit(ctx, logger, 1, time.Minute, nil); err != nil {
				t.Fatal(err)
			}
			if probeCount.Load() != 2 {
				t.Fatalf("supervisor probes=%d, want 2", probeCount.Load())
			}
			if tc.wantEffects == 1 {
				// An already recorded loss remains silent on the next due probe.
				if _, err := pool.Exec(ctx, `
					update private.whatsapp_session_supervisor_state
					set last_claimed_at = now() - interval '2 minutes'
					where session_id = $1::uuid
				`, session); err != nil {
					t.Fatal(err)
				}
				if err := repo.superviseActiveSessionsWithLimit(ctx, logger, 1, time.Minute, nil); err != nil {
					t.Fatal(err)
				}
				if probeCount.Load() != 3 {
					t.Fatalf("supervisor probes=%d after next cycle, want 3", probeCount.Load())
				}
			}
			var status string
			var ownerNotices, adminNotices, totalNotices, auditRows, queuedDeliveries, foreignEffects int
			if err := pool.QueryRow(ctx, `
				select status,
				    (select count(*) from public.notifications where organization_id = $1 and user_id = $3
				        and metadata->>'event_key' = 'whatsapp_disconnected'),
				    (select count(*) from public.notifications where organization_id = $1 and user_id = $4
				        and metadata->>'event_key' = 'whatsapp_disconnected_admin'),
				    (select count(*) from public.notifications where organization_id = $1),
				    (select count(*) from public.audit_logs where organization_id = $1 and entity_id = $2::uuid::text
				        and action = 'whatsapp.session_disconnected'),
				    (select count(*) from private.notification_deliveries
				        where organization_id = $1 and status = 'queued' and channel = 'whatsapp' and user_id = $3),
				    (select count(*) from public.notifications where organization_id = $5) +
				    (select count(*) from private.notification_deliveries where organization_id = $5) +
				    (select count(*) from public.audit_logs where organization_id = $5)
				from public.whatsapp_sessions where organization_id = $1 and id = $2
			`, organization, session, owner, admin, foreignOrg).Scan(&status, &ownerNotices, &adminNotices, &totalNotices, &auditRows, &queuedDeliveries, &foreignEffects); err != nil {
				t.Fatal(err)
			}
			if status != tc.wantStatus || auditRows != tc.wantEffects || ownerNotices != tc.wantEffects ||
				adminNotices != tc.wantEffects || totalNotices != 2*tc.wantEffects || queuedDeliveries != tc.wantEffects || foreignEffects != 0 {
				t.Fatalf("status=%q owner=%d admin=%d total=%d audit=%d queued=%d foreign=%d",
					status, ownerNotices, adminNotices, totalNotices, auditRows, queuedDeliveries, foreignEffects)
			}
			// Keep this session's state for assertions, while excluding it from
			// the next subtest's global supervisor claim.
			if _, err := pool.Exec(ctx, `update public.whatsapp_sessions set is_active = false where id = $1::uuid`, session); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func seedSessionHealthPostgres(t *testing.T, ctx context.Context, database *dbpkg.Postgres) (organization, session, owner, admin, foreignOrg string) {
	t.Helper()
	pool := database.Pool()
	var foreignAdmin string
	if err := pool.QueryRow(ctx, `
		select gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text,
		    gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text
	`).Scan(&organization, &foreignOrg, &session, &owner, &admin, &foreignAdmin); err != nil {
		t.Fatal(err)
	}
	label := "synthetic-session-health-" + strings.ReplaceAll(session, "-", "")
	if _, err := pool.Exec(ctx, `
		insert into public.organizations(id, name) values ($1::uuid, $7), ($2::uuid, $7 || '-foreign');
		insert into public.users(id, organization_id, name, email, role, is_active)
		    values ($4::uuid, $1::uuid, 'Synthetic owner', $7 || '-owner@example.invalid', 'user', true),
		           ($5::uuid, $1::uuid, 'Synthetic admin', $7 || '-admin@example.invalid', 'admin', true),
		           ($6::uuid, $2::uuid, 'Synthetic foreign admin', $7 || '-foreign@example.invalid', 'admin', true);
		insert into public.organization_members(organization_id, user_id, role, is_active)
		    values ($1::uuid, $4::uuid, 'user', true), ($1::uuid, $5::uuid, 'admin', true),
		           ($2::uuid, $6::uuid, 'admin', true);
		insert into public.whatsapp_sessions(id, organization_id, owner_user_id, instance_name, instance_id,
		    provider, status, is_active, advanced_settings)
		values ($3::uuid, $1::uuid, $4::uuid, $7, $7, 'evolution_go', 'connected', true,
		    '{"token":"synthetic-session-key","webhook_token":"synthetic-webhook-key"}');
	`, pgx.QueryExecModeSimpleProtocol, organization, foreignOrg, session, owner, admin, foreignAdmin, label); err != nil {
		t.Fatal(err)
	}
	return
}
