package pipelines

import (
	"context"
	"errors"
	"slices"
	"sort"
	"testing"
	"time"
)

func TestStageArchivePostgresRejectsUnsafeTargetsBeforeConnecting(t *testing.T) {
	for _, dsn := range []string{
		"", "postgres://postgres@example.test/postgres", "postgres://postgres@localhost/vimob",
		"postgres://other@localhost/postgres", "https://postgres@localhost/postgres",
		"postgres://postgres@localhost/postgres?host=example.test",
		"postgres://postgres@localhost/postgres?dbname=vimob",
	} {
		if _, err := stageArchiveTestConfig(dsn); err == nil {
			t.Fatal("unsafe test target was accepted")
		}
	}
	for _, dsn := range []string{"postgres://postgres@127.0.0.1/postgres", "postgresql://postgres@[::1]/postgres"} {
		if _, err := stageArchiveTestConfig(dsn); err != nil {
			t.Fatalf("synthetic loopback target rejected: %v", err)
		}
	}
}

// This executes the production SQL and Go destination precedence, not a mock.
// Explicit local opt-in is required; ordinary go test reports a skip, not a pass
// for PostgreSQL. All cases use two synthetic tenants in a generated database.
func TestStageArchivePostgresRouting(t *testing.T) {
	ctx, conn := openStageArchivePostgresFixture(t)
	for _, scenario := range stageArchivePostgresScenarios() {
		t.Run(scenario.name, func(t *testing.T) {
			tx, err := conn.Begin(ctx)
			if err != nil {
				t.Fatalf("begin isolated scenario: %v", err)
			}
			t.Cleanup(func() {
				rollbackCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				if err := tx.Rollback(rollbackCtx); err != nil {
					t.Errorf("rollback synthetic scenario: %v", err)
				}
			})
			fixture := stageArchivePostgresFixture{t: t, ctx: ctx, tx: tx}
			fixture.seed()
			if scenario.prepare != nil {
				scenario.prepare(fixture)
			}
			for _, target := range []struct{ stage, pipeline, org int }{
				{201, 101, 1}, {202, 101, 1}, {203, 102, 1}, {211, 111, 2},
			} {
				err := (Repository{}).ensureStageArchiveRoutingSafe(ctx, tx, stageArchiveFixtureID(target.org), stageArchiveFixtureID(target.pipeline), stageArchiveFixtureID(target.stage))
				var got []string
				if err != nil {
					var dependencies *StageArchiveDependenciesError
					if !errors.As(err, &dependencies) {
						t.Fatalf("real routing query failed for stage %d: %v", target.stage, err)
					}
					got = slices.Clone(dependencies.Categories)
				}
				want := slices.Clone(scenario.want[target.stage])
				sort.Strings(got)
				sort.Strings(want)
				if !slices.Equal(got, want) {
					t.Errorf("stage %d dependencies = %v, want %v", target.stage, got, want)
				}
			}
			var retained int
			if err := tx.QueryRow(ctx, `select (select count(*) from public.lead_stage_history)
			  + (select count(*) from public.lead_stage_cycles) + (select count(*) from public.cadence_templates)
			  + (select count(*) from public.lead_attention_policies)`).Scan(&retained); err != nil || retained != 4 {
				t.Fatalf("retained history/configuration changed: rows=%d error=%v", retained, err)
			}
		})
	}
}

type stageArchivePostgresScenario struct {
	name    string
	prepare func(stageArchivePostgresFixture)
	want    map[int][]string
}

func stageArchivePostgresScenarios() []stageArchivePostgresScenario {
	return []stageArchivePostgresScenario{
		{name: "history and retained cadence or attention configuration allow archive"},
		{name: "Meta explicit form stage wins queue and unused form pipeline", prepare: func(f stageArchivePostgresFixture) {
			f.queue(1, 203, 102, 0, true, "")
			f.meta(1, 202, 101, 301, 201, 101, true, true)
		}, want: map[int][]string{202: {"meta_forms"}, 203: {"round_robin"}}},
		{name: "Meta queue stage precedes form pipeline and integration", prepare: func(f stageArchivePostgresFixture) {
			f.queue(1, 203, 102, 0, true, "")
			f.meta(1, 0, 101, 301, 202, 101, true, true)
		}, want: map[int][]string{203: {"round_robin", "meta_forms"}}},
		{name: "Meta queue pipeline precedes form pipeline", prepare: func(f stageArchivePostgresFixture) {
			f.queue(1, 0, 102, 0, true, "")
			f.meta(1, 0, 101, 301, 0, 101, true, true)
		}, want: map[int][]string{203: {"round_robin", "meta_forms"}}},
		{name: "Meta queue legacy pipeline and nullable active flag are resolved", prepare: func(f stageArchivePostgresFixture) {
			f.queue(1, 0, 0, 102, nil, "")
			f.meta(1, 0, 101, 301, 0, 101, true, true)
		}, want: map[int][]string{203: {"round_robin", "meta_forms"}}},
		{name: "Meta legacy queue stage is a validated UUID", prepare: func(f stageArchivePostgresFixture) {
			f.queue(1, 0, 0, 0, true, `{"target_stage_id":"`+stageArchiveFixtureID(203)+`"}`)
			f.meta(1, 0, 101, 301, 0, 101, true, true)
		}, want: map[int][]string{203: {"round_robin", "meta_forms"}}},
		{name: "malformed legacy queue UUID does not break SQL or invent a route", prepare: func(f stageArchivePostgresFixture) {
			f.queue(1, 0, 0, 0, true, `{"target_stage_id":"not-a-uuid"}`)
		}},
		{name: "Meta untargeted active queue allows form pipeline fallback", prepare: func(f stageArchivePostgresFixture) {
			f.queue(1, 0, 0, 0, true, "")
			f.meta(1, 0, 102, 301, 201, 101, true, true)
		}, want: map[int][]string{203: {"meta_forms"}}},
		{name: "Meta inactive required queue rejects even an explicit form stage", prepare: func(f stageArchivePostgresFixture) {
			f.queue(1, 203, 102, 0, false, "")
			f.meta(1, 201, 101, 301, 201, 101, true, true)
		}},
		{name: "Meta missing required queue does not invent fallback", prepare: func(f stageArchivePostgresFixture) {
			f.meta(1, 201, 101, 399, 201, 101, true, true)
		}},
		{name: "Meta empty valid queue pipeline does not fall through", prepare: func(f stageArchivePostgresFixture) {
			f.queue(1, 0, 103, 0, true, "")
			f.meta(1, 0, 101, 301, 201, 101, true, true)
		}},
		{name: "Meta form pipeline wins integration stage", prepare: func(f stageArchivePostgresFixture) {
			f.meta(1, 0, 102, 0, 202, 101, true, true)
		}, want: map[int][]string{203: {"meta_forms"}}},
		{name: "Meta empty valid form pipeline does not fall through", prepare: func(f stageArchivePostgresFixture) {
			f.meta(1, 0, 103, 0, 201, 101, true, true)
		}},
		{name: "Meta inactive form stage falls back to form pipeline", prepare: func(f stageArchivePostgresFixture) {
			f.meta(1, 204, 102, 0, 201, 101, true, true)
		}, want: map[int][]string{203: {"meta_forms"}}},
		{name: "Meta integration stage wins integration pipeline", prepare: func(f stageArchivePostgresFixture) {
			f.meta(1, 0, 0, 0, 202, 102, true, true)
		}, want: map[int][]string{202: {"meta_default"}}},
		{name: "Meta integration pipeline resolves its first stage", prepare: func(f stageArchivePostgresFixture) {
			f.meta(1, 0, 0, 0, 0, 102, true, true)
		}, want: map[int][]string{203: {"meta_default"}}},
		{name: "Meta inactive integration pipeline falls back to organization", prepare: func(f stageArchivePostgresFixture) {
			f.meta(1, 0, 0, 0, 0, 104, true, true)
		}, want: map[int][]string{201: {"meta_default"}}},
		{name: "Meta all null destinations use default pipeline first active stage", prepare: func(f stageArchivePostgresFixture) {
			f.meta(1, 0, 0, 0, 0, 0, true, true)
		}, want: map[int][]string{201: {"meta_default"}}},
		{name: "Meta disconnected integration ignores active form", prepare: func(f stageArchivePostgresFixture) {
			f.meta(1, 201, 101, 0, 201, 101, true, false)
		}},
		{name: "Meta inactive form ignores connected integration default", prepare: func(f stageArchivePostgresFixture) {
			f.meta(1, 201, 101, 0, 201, 101, false, true)
		}},
		{name: "Meta integration without active form is not an intake route", prepare: func(f stageArchivePostgresFixture) {
			f.meta(1, 201, 101, 0, 201, 101, true, true)
			f.exec(`delete from public.meta_form_configs`)
		}},
		{name: "Meta nullable form active matches legacy reader and categories deduplicate", prepare: func(f stageArchivePostgresFixture) {
			f.meta(1, 201, 101, 0, 0, 0, true, true)
			f.exec(`update public.meta_form_configs set is_active = null`)
			f.exec(`insert into public.meta_form_configs select $1::uuid,organization_id,integration_id,is_active,stage_id,pipeline_id,round_robin_id from public.meta_form_configs`, stageArchiveFixtureID(599))
		}, want: map[int][]string{201: {"meta_forms"}}},
		{name: "portal explicit stage wins queue while unused pipeline stays free", prepare: func(f stageArchivePostgresFixture) {
			f.queue(1, 203, 102, 0, true, "")
			f.portal(1, 202, 101, 301, true)
		}, want: map[int][]string{202: {"portals"}, 203: {"round_robin"}}},
		{name: "portal queue stage wins integration pipeline", prepare: func(f stageArchivePostgresFixture) {
			f.queue(1, 203, 102, 0, true, "")
			f.portal(1, 0, 101, 301, true)
		}, want: map[int][]string{203: {"round_robin", "portals"}}},
		{name: "portal explicit pipeline wins queue pipeline when no stage", prepare: func(f stageArchivePostgresFixture) {
			f.queue(1, 0, 101, 0, true, "")
			f.portal(1, 0, 102, 301, true)
		}, want: map[int][]string{201: {"round_robin"}, 203: {"portals"}}},
		{name: "portal queue pipeline supplies missing integration pipeline", prepare: func(f stageArchivePostgresFixture) {
			f.queue(1, 0, 102, 0, true, "")
			f.portal(1, 0, 0, 301, true)
		}, want: map[int][]string{203: {"round_robin", "portals"}}},
		{name: "portal missing explicit stage uses chosen pipeline", prepare: func(f stageArchivePostgresFixture) {
			f.portal(1, 299, 102, 0, true)
		}, want: map[int][]string{203: {"portals"}}},
		{name: "portal inactive explicit stage uses chosen pipeline", prepare: func(f stageArchivePostgresFixture) {
			f.portal(1, 204, 102, 0, true)
		}, want: map[int][]string{203: {"portals"}}},
		{name: "portal inactive chosen pipeline uses organization default", prepare: func(f stageArchivePostgresFixture) {
			f.portal(1, 0, 104, 0, true)
		}, want: map[int][]string{201: {"portals"}}},
		{name: "portal empty valid chosen pipeline does not fall through", prepare: func(f stageArchivePostgresFixture) {
			f.portal(1, 0, 103, 0, true)
		}},
		{name: "portal all null destinations use organization default", prepare: func(f stageArchivePostgresFixture) {
			f.portal(1, 0, 0, 0, true)
		}, want: map[int][]string{201: {"portals"}}},
		{name: "portal inactive queue still uses explicit integration pipeline", prepare: func(f stageArchivePostgresFixture) {
			f.queue(1, 201, 101, 0, false, "")
			f.portal(1, 0, 102, 301, true)
		}, want: map[int][]string{203: {"portals"}}},
		{name: "all inactive consumers and expired key allow retained history", prepare: func(f stageArchivePostgresFixture) {
			f.queue(1, 201, 101, 0, false, "")
			f.meta(1, 201, 101, 0, 201, 101, false, true)
			f.portal(1, 201, 101, 0, false)
			f.direct("webhooks_integrations", 1, 201, 101, false)
			f.direct("whatsapp_inbound_rules", 1, 201, 101, false)
			f.api(1, true, true, time.Now().Add(-time.Hour))
		}},
		{name: "active routes in another tenant never block this tenant", prepare: func(f stageArchivePostgresFixture) {
			f.queue(2, 211, 111, 0, true, "")
			f.meta(2, 211, 111, 302, 211, 111, true, true)
			f.portal(2, 211, 111, 302, true)
			f.direct("webhooks_integrations", 2, 211, 111, true)
			f.direct("whatsapp_inbound_rules", 2, 211, 111, true)
			f.api(2, true, true, nil)
		}, want: map[int][]string{211: {"round_robin", "meta_forms", "portals", "incoming_webhooks", "whatsapp_rules", "public_api_default"}}},
		{name: "foreign stage and pipeline references are not joined across tenants", prepare: func(f stageArchivePostgresFixture) {
			f.meta(1, 211, 111, 0, 211, 111, true, true)
			f.portal(1, 211, 111, 0, true)
		}, want: map[int][]string{201: {"meta_default", "portals"}}},
		{name: "foreign queue is unavailable for Meta and ignored by portal", prepare: func(f stageArchivePostgresFixture) {
			f.queue(2, 211, 111, 0, true, "")
			f.meta(1, 201, 101, 302, 201, 101, true, true)
			f.portal(1, 0, 0, 302, true)
		}, want: map[int][]string{201: {"portals"}, 211: {"round_robin"}}},
		{name: "explicit direct routes block only their target stage", prepare: func(f stageArchivePostgresFixture) {
			f.queue(1, 202, 101, 0, true, "")
			f.direct("webhooks_integrations", 1, 202, 101, true)
			f.direct("whatsapp_inbound_rules", 1, 202, 101, true)
		}, want: map[int][]string{202: {"round_robin", "incoming_webhooks", "whatsapp_rules"}}},
		{name: "direct pipeline routes block only that pipeline first stage", prepare: func(f stageArchivePostgresFixture) {
			f.direct("webhooks_integrations", 1, 0, 102, true)
			f.direct("whatsapp_inbound_rules", 1, 0, 102, true)
		}, want: map[int][]string{203: {"incoming_webhooks", "whatsapp_rules"}}},
		{name: "global intake defaults block only effective first stage", prepare: func(f stageArchivePostgresFixture) {
			f.direct("webhooks_integrations", 1, 0, 0, true)
			f.direct("whatsapp_inbound_rules", 1, 0, 0, true)
			f.api(1, true, true, nil)
		}, want: map[int][]string{201: {"incoming_webhooks", "whatsapp_rules", "public_api_default"}}},
		{name: "outgoing webhook is not an intake dependency", prepare: func(f stageArchivePostgresFixture) {
			f.direct("webhooks_integrations", 1, 201, 101, true)
			f.exec(`update public.webhooks_integrations set type='outgoing'`)
		}},
		{name: "inactive API key does not reserve default destination", prepare: func(f stageArchivePostgresFixture) {
			f.api(1, false, true, nil)
		}},
		{name: "API key without enabled API module is not intake", prepare: func(f stageArchivePostgresFixture) {
			f.api(1, true, false, nil)
		}},
		{name: "foreign enabled API module cannot activate local key", prepare: func(f stageArchivePostgresFixture) {
			f.api(1, true, true, nil)
			f.exec(`update public.organization_modules set organization_id=$1`, stageArchiveFixtureID(2))
		}},
		{name: "default stage follows current order and skips inactive predecessor", prepare: func(f stageArchivePostgresFixture) {
			f.exec(`update public.stages set position=3 where id=$1`, stageArchiveFixtureID(201))
			f.meta(1, 0, 0, 0, 0, 0, true, true)
			f.portal(1, 0, 0, 0, true)
			f.api(1, true, true, nil)
		}, want: map[int][]string{202: {"meta_default", "portals", "public_api_default"}}},
		{name: "equal stage positions resolve by created time then ID", prepare: func(f stageArchivePostgresFixture) {
			f.exec(`update public.stages set position=1,created_at='2026-01-01T00:00:00Z' where pipeline_id=$1`, stageArchiveFixtureID(101))
			f.meta(1, 0, 0, 0, 0, 0, true, true)
			f.portal(1, 0, 0, 0, true)
		}, want: map[int][]string{201: {"meta_default", "portals"}}},
		{name: "legacy nullable pipeline default preserves distinct intake sort contracts", prepare: func(f stageArchivePostgresFixture) {
			f.exec(`update public.pipelines set is_default=null where id=$1`, stageArchiveFixtureID(102))
			f.meta(1, 0, 0, 0, 0, 0, true, true)
			f.portal(1, 0, 0, 0, true)
			f.api(1, true, true, nil)
		}, want: map[int][]string{201: {"meta_default"}, 203: {"portals", "public_api_default"}}},
	}
}
