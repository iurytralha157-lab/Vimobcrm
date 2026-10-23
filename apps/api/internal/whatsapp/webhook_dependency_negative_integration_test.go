package whatsapp

import (
	"testing"
	"time"
)

func TestClaimTransitiveBacklogDependencyFailsClosed(t *testing.T) {
	ctx, postgres := webhookDependencyDatabase(t)
	var strictSnapshotAdmission bool
	if err := postgres.Pool().QueryRow(ctx, `
		select exists (select 1 from pg_catalog.pg_constraint
		  where conrelid = 'public.whatsapp_webhook_inbox'::regclass
		    and conname = 'whatsapp_webhook_active_routing_snapshot_v1_check'
		    and convalidated)
	`).Scan(&strictSnapshotAdmission); err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []struct {
		name   string
		mutate func(*webhookDependencyEvent, *webhookDependencyEvent, *webhookDependencyEvent)
	}{
		{"wrong_provider_pair", func(_, middle, _ *webhookDependencyEvent) { middle.predecessorProvider = "wrong" }},
		{"missing_inbox_key", func(_, _, live *webhookDependencyEvent) { live.predecessorKey = "absent" }},
		{"different_route", func(_, middle, _ *webhookDependencyEvent) { middle.route = "jid:wrong" }},
		{"session_wide_route", func(root, middle, live *webhookDependencyEvent) {
			root.route, middle.route, live.route = "__session__", "__session__", "__session__"
		}},
		{"dead_middle", func(_, middle, _ *webhookDependencyEvent) { middle.status = "dead" }},
		{"exhausted_middle", func(_, middle, _ *webhookDependencyEvent) { middle.attempts = 12 }},
		{"future_retry_middle", func(_, middle, _ *webhookDependencyEvent) {
			middle.status, middle.due = "retry", time.Hour
		}},
		{"non_message_middle", func(_, middle, _ *webhookDependencyEvent) { middle.eventType = "receipt" }},
		{"legacy_snapshot_middle", func(_, middle, _ *webhookDependencyEvent) { middle.version = "0" }},
		{"retained_epoch_middle", func(_, middle, _ *webhookDependencyEvent) {
			middle.epoch, middle.withoutLedger = 0, true
		}},
		{"chronologically_reversed_edge", func(root, middle, _ *webhookDependencyEvent) { middle.age = root.age + time.Minute }},
		{"cycle", func(root, _, live *webhookDependencyEvent) {
			root.predecessorKey, root.predecessorProvider = live.key, live.providerID
		}},
		{"ineligible_middle", func(_, middle, _ *webhookDependencyEvent) {
			middle.snapshots = []map[string]any{{"provider_message_id": middle.providerID,
				"binding_eligible": false, "processing_epoch": 1}}
			middle.withoutLedger = true
		}},
		{"multiple_message_middle", func(_, middle, _ *webhookDependencyEvent) {
			middle.snapshots = []map[string]any{
				{"provider_message_id": middle.providerID, "binding_eligible": true, "processing_epoch": 1,
					"predecessor_inbox_event_key": middle.predecessorKey, "predecessor_provider_message_id": middle.predecessorProvider},
				{"provider_message_id": "extra", "binding_eligible": true, "processing_epoch": 1},
			}
		}},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			fixture := newWebhookDependencyFixture(t, ctx, postgres, scenario.name)
			root := webhookDependencyEvent{key: fixture.suffix + "-root", providerID: "root", route: "jid:dependent",
				lane: evolutionWebhookLaneBacklog, epoch: 1, age: 4 * time.Minute}
			middle := webhookDependencyEvent{key: fixture.suffix + "-middle", providerID: "middle", route: root.route,
				lane: evolutionWebhookLaneBacklog, epoch: 1, age: 3 * time.Minute,
				predecessorKey: root.key, predecessorProvider: root.providerID}
			live := webhookDependencyEvent{key: fixture.suffix + "-live", providerID: "live", route: root.route,
				lane: evolutionWebhookLaneLive, epoch: 1, age: 2 * time.Minute,
				predecessorKey: middle.key, predecessorProvider: middle.providerID}
			scenario.mutate(&root, &middle, &live)
			// With canonical B2 applied, a new active legacy snapshot cannot
			// legally exist. Prove its exact admission rejection; without B2,
			// retain the original selector-level legacy exclusion test.
			middle.expectSnapshotAdmissionError = strictSnapshotAdmission && scenario.name == "legacy_snapshot_middle"
			insertWebhookDependencyEvent(t, ctx, postgres, fixture, root)
			insertWebhookDependencyEvent(t, ctx, postgres, fixture, middle)
			insertWebhookDependencyEvent(t, ctx, postgres, fixture, live)
			insertWebhookDependencyEvent(t, ctx, postgres, fixture, webhookDependencyEvent{
				key: fixture.suffix + "-other-live", providerID: "other-live", route: "jid:other",
				lane: evolutionWebhookLaneLive, epoch: 1, age: time.Minute,
			})
			repo := NewRepository(postgres, nil, StorageConfig{})
			claimed, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneBacklog, 1, "")
			if err != nil {
				t.Fatal(err)
			}
			if len(claimed) != 0 {
				t.Fatalf("unsafe dependency bypassed live priority: %#v", claimed)
			}
		})
	}
}

func TestClaimTransitiveBacklogDependencyRejectsAnotherOrganization(t *testing.T) {
	ctx, postgres := webhookDependencyDatabase(t)
	fixture := newWebhookDependencyFixture(t, ctx, postgres, "dependency-origin")
	other := newWebhookDependencyFixture(t, ctx, postgres, "dependency-other-tenant")
	// This valid foreign tenant fixture must not become a lookup target or a
	// claim candidate. No production identifiers or inconsistent tenant rows.
	if _, err := postgres.Pool().Exec(ctx, `update public.whatsapp_sessions set is_active = false where id = $1::uuid`, other.sessionID); err != nil {
		t.Fatal(err)
	}
	rootKey, middleKey := fixture.suffix+"-root", fixture.suffix+"-foreign-middle"
	insertWebhookDependencyEvent(t, ctx, postgres, fixture, webhookDependencyEvent{
		key: rootKey, providerID: "root", route: "jid:dependent", lane: evolutionWebhookLaneBacklog, epoch: 1, age: 4 * time.Minute,
	})
	insertWebhookDependencyEvent(t, ctx, postgres, other, webhookDependencyEvent{
		key: middleKey, providerID: "middle", route: "jid:dependent", lane: evolutionWebhookLaneBacklog,
		predecessorKey: rootKey, predecessorProvider: "root", epoch: 1, age: 3 * time.Minute,
	})
	insertWebhookDependencyEvent(t, ctx, postgres, fixture, webhookDependencyEvent{
		key: fixture.suffix + "-live", providerID: "live", route: "jid:dependent", lane: evolutionWebhookLaneLive,
		predecessorKey: middleKey, predecessorProvider: "middle", epoch: 1, age: 2 * time.Minute,
	})
	insertWebhookDependencyEvent(t, ctx, postgres, fixture, webhookDependencyEvent{
		key: fixture.suffix + "-other-live", providerID: "other-live", route: "jid:other", lane: evolutionWebhookLaneLive,
		epoch: 1, age: time.Minute,
	})
	repo := NewRepository(postgres, nil, StorageConfig{})
	claimed, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneBacklog, 1, "")
	if err != nil || len(claimed) != 0 {
		t.Fatalf("cross-tenant dependency claim = %#v, error = %v", claimed, err)
	}
}

func TestDependencyClaimCannotManufactureRoutingOutcome(t *testing.T) {
	ctx, postgres := webhookDependencyDatabase(t)
	fixture := newWebhookDependencyFixture(t, ctx, postgres, "dependency-missing-provenance")
	rootKey := fixture.suffix + "-root"
	rootID := insertWebhookDependencyEvent(t, ctx, postgres, fixture, webhookDependencyEvent{
		key: rootKey, providerID: "root", route: "jid:dependent", lane: evolutionWebhookLaneBacklog,
		epoch: 1, age: 3 * time.Minute, withoutLedger: true,
	})
	insertWebhookDependencyEvent(t, ctx, postgres, fixture, webhookDependencyEvent{
		key: fixture.suffix + "-live", providerID: "live", route: "jid:dependent", lane: evolutionWebhookLaneLive,
		predecessorKey: rootKey, predecessorProvider: "root", epoch: 1, age: 2 * time.Minute,
	})
	repo := NewRepository(postgres, nil, StorageConfig{})
	claimed, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneBacklog, 1, "")
	if err != nil || len(claimed) != 1 || claimed[0].ID != rootID {
		t.Fatalf("claim root with absent ledger = %#v, error = %v", claimed, err)
	}
	if err := repo.markEvolutionWebhookProcessed(ctx, claimed[0]); err == nil {
		t.Fatal("completion fabricated an outcome without immutable routing provenance")
	}
	var status string
	var outcomes int
	if err := postgres.Pool().QueryRow(ctx, `
		select status, (select count(*) from public.whatsapp_webhook_routing_outcomes
		  where organization_id = $2::uuid and session_id = $3::uuid)
		from public.whatsapp_webhook_inbox where id = $1::uuid
	`, rootID, fixture.organizationID, fixture.sessionID).Scan(&status, &outcomes); err != nil {
		t.Fatal(err)
	}
	if status != "processing" || outcomes != 0 {
		t.Fatalf("failed completion status = %q, outcomes = %d", status, outcomes)
	}
}

func TestClaimTransitiveBacklogDependencyRejectsAnotherSession(t *testing.T) {
	ctx, postgres := webhookDependencyDatabase(t)
	fixture := newWebhookDependencyFixture(t, ctx, postgres, "dependency-other-session")
	other := fixture
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_sessions (
			organization_id, owner_user_id, instance_name, instance_id, provider, status, is_active
		) select organization_id, owner_user_id, $2, $2, 'evolution_go', 'connected', false
		from public.whatsapp_sessions where id = $1::uuid returning id::text
	`, fixture.sessionID, fixture.suffix+"-another-session").Scan(&other.sessionID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into private.whatsapp_webhook_session_cutovers (session_id, active_epoch, cutover_at)
		values ($1::uuid, 1, now() - interval '10 minutes')
	`, other.sessionID); err != nil {
		t.Fatal(err)
	}
	rootKey, middleKey := fixture.suffix+"-root", fixture.suffix+"-foreign-session-middle"
	insertWebhookDependencyEvent(t, ctx, postgres, fixture, webhookDependencyEvent{
		key: rootKey, providerID: "root", route: "jid:dependent", lane: evolutionWebhookLaneBacklog, epoch: 1, age: 4 * time.Minute,
	})
	insertWebhookDependencyEvent(t, ctx, postgres, other, webhookDependencyEvent{
		key: middleKey, providerID: "middle", route: "jid:dependent", lane: evolutionWebhookLaneBacklog,
		predecessorKey: rootKey, predecessorProvider: "root", epoch: 1, age: 3 * time.Minute,
	})
	insertWebhookDependencyEvent(t, ctx, postgres, fixture, webhookDependencyEvent{
		key: fixture.suffix + "-live", providerID: "live", route: "jid:dependent", lane: evolutionWebhookLaneLive,
		predecessorKey: middleKey, predecessorProvider: "middle", epoch: 1, age: 2 * time.Minute,
	})
	insertWebhookDependencyEvent(t, ctx, postgres, fixture, webhookDependencyEvent{
		key: fixture.suffix + "-other-live", providerID: "other-live", route: "jid:other", lane: evolutionWebhookLaneLive,
		epoch: 1, age: time.Minute,
	})
	roots, _, err := NewRepository(postgres, nil, StorageConfig{}).claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneBacklog, 1, "")
	if err != nil || len(roots) != 0 {
		t.Fatalf("same-organization cross-session dependency claim = %#v, error = %v", roots, err)
	}
}
