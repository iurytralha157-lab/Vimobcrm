package distribution

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DISTRIBUTION_INTAKE_TEST_DATABASE_URL must point to a disposable loopback
// PostgreSQL/Supabase database. Every fixture is created inside one rollback-only
// transaction so this test cannot mutate a shared or remote project.
func TestResolveIntakeDestinationAgainstLocalPostgres(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("DISTRIBUTION_INTAKE_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set DISTRIBUTION_INTAKE_TEST_DATABASE_URL to run the local intake routing contract")
	}
	parsedURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse DISTRIBUTION_INTAKE_TEST_DATABASE_URL: %v", err)
	}
	switch strings.ToLower(parsedURL.Hostname()) {
	case "127.0.0.1", "localhost", "::1":
	default:
		t.Fatalf("DISTRIBUTION_INTAKE_TEST_DATABASE_URL must use a loopback host, got %q", parsedURL.Hostname())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("connect local PostgreSQL: %v", err)
	}
	t.Cleanup(pool.Close)
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin fixture transaction: %v", err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()

	var organizationID string
	if err := tx.QueryRow(ctx, `
		insert into public.organizations (name, slug, is_active)
		values ('Intake routing contract', 'intake-routing-' || gen_random_uuid()::text, true)
		returning id::text
	`).Scan(&organizationID); err != nil {
		t.Fatalf("insert organization: %v", err)
	}
	var pipelineID string
	if err := tx.QueryRow(ctx, `
		insert into public.pipelines (organization_id, name, position, is_active)
		values ($1::uuid, 'Intake routing', 1, true)
		returning id::text
	`, organizationID).Scan(&pipelineID); err != nil {
		t.Fatalf("insert pipeline: %v", err)
	}

	propertyIDs := make([]string, 2)
	for index := range propertyIDs {
		if err := tx.QueryRow(ctx, `
			insert into public.properties (organization_id, code, title, status)
			values ($1::uuid, $2, $3, 'active')
			returning id::text
		`, organizationID, "INTAKE-"+string(rune('A'+index)), "Imovel intake "+string(rune('A'+index))).Scan(&propertyIDs[index]); err != nil {
			t.Fatalf("insert property %d: %v", index, err)
		}
	}

	insertQueue := func(name string, reentryBehavior string) string {
		t.Helper()
		var queueID string
		if err := tx.QueryRow(ctx, `
			insert into public.round_robins (
			  organization_id, name, is_active, pipeline_id, reentry_behavior
			) values ($1::uuid, $2, true, $3::uuid, $4)
			returning id::text
		`, organizationID, name, pipelineID, reentryBehavior).Scan(&queueID); err != nil {
			t.Fatalf("insert queue %s: %v", name, err)
		}
		return queueID
	}
	insertRule := func(queueID string, matchType string, matchValue string, priority int) {
		t.Helper()
		if _, err := tx.Exec(ctx, `
			insert into public.round_robin_rules (
			  organization_id, round_robin_id, match_type, match_value, is_active, priority
			) values ($1::uuid, $2::uuid, $3, $4, true, $5)
		`, organizationID, queueID, matchType, matchValue, priority); err != nil {
			t.Fatalf("insert %s rule for %s: %v", matchType, queueID, err)
		}
	}

	propertyQueueA := insertQueue("Property A", "keep_assignee")
	propertyQueueB := insertQueue("Property B", "redistribute")
	insertRule(propertyQueueA, "property", propertyIDs[0], 100)
	insertRule(propertyQueueB, "property", propertyIDs[1], 100)

	resolveProperty := func(propertyID string) IntakeDestination {
		t.Helper()
		destination, err := ResolveIntakeDestination(ctx, tx, IntakeContext{
			OrganizationID:     organizationID,
			PipelineID:         &pipelineID,
			Source:             "site",
			PropertyID:         &propertyID,
			InterestPropertyID: &propertyID,
		})
		if err != nil {
			t.Fatalf("resolve property %s: %v", propertyID, err)
		}
		return destination
	}
	propertyA := resolveProperty(propertyIDs[0])
	propertyARepeat := resolveProperty(propertyIDs[0])
	propertyB := resolveProperty(propertyIDs[1])
	assertIntakeQueue(t, propertyA, propertyQueueA, "keep_assignee")
	assertIntakeQueue(t, propertyARepeat, propertyQueueA, "keep_assignee")
	assertIntakeQueue(t, propertyB, propertyQueueB, "redistribute")
	if IntakeScopeKey(propertyA.RoundRobinID) == IntakeScopeKey(propertyB.RoundRobinID) {
		t.Fatal("same phone routed by property A/B would reuse one intake scope")
	}
	if !PreserveAssigneeForIntake(true, propertyA) || PreserveAssigneeForIntake(true, propertyB) {
		t.Fatal("queue-local reentry behavior was not preserved")
	}

	var tagID string
	if err := tx.QueryRow(ctx, `
		insert into public.tags (organization_id, name)
		values ($1::uuid, 'Intake routing tag')
		returning id::text
	`, organizationID).Scan(&tagID); err != nil {
		t.Fatalf("insert routing tag: %v", err)
	}
	tagQueue := insertQueue("Tag queue", "redistribute")
	insertRule(tagQueue, "tag", tagID, 300)
	tagDestination, err := ResolveIntakeDestination(ctx, tx, IntakeContext{
		OrganizationID: organizationID,
		PipelineID:     &pipelineID,
		Source:         "webhook",
		TagIDs:         []string{tagID},
	})
	if err != nil {
		t.Fatalf("resolve existing tenant tag: %v", err)
	}
	assertIntakeQueue(t, tagDestination, tagQueue, "redistribute")
	if len(tagDestination.TagIDs) != 1 || tagDestination.TagIDs[0] != tagID {
		t.Fatalf("validated tag snapshot = %#v, want %s", tagDestination.TagIDs, tagID)
	}
	if _, err := tx.Exec(ctx, `delete from public.tags where organization_id = $1::uuid and id = $2::uuid`, organizationID, tagID); err != nil {
		t.Fatalf("delete routing tag: %v", err)
	}
	staleTagDestination, err := ResolveIntakeDestination(ctx, tx, IntakeContext{
		OrganizationID: organizationID,
		PipelineID:     &pipelineID,
		Source:         "webhook",
		TagIDs:         []string{tagID},
	})
	if err != nil {
		t.Fatalf("resolve deleted tenant tag: %v", err)
	}
	if !staleTagDestination.Resolved || staleTagDestination.RoundRobinID != nil {
		t.Fatalf("deleted tag selected a queue: %#v", staleTagDestination)
	}
	if len(staleTagDestination.TagIDs) != 0 {
		t.Fatalf("deleted tag survived tenant filter: %#v", staleTagDestination.TagIDs)
	}

	webhookIDs := []string{
		"77777777-7777-4777-8777-777777777771",
		"77777777-7777-4777-8777-777777777772",
	}
	webhookQueueA := insertQueue("Webhook A", "redistribute")
	webhookQueueB := insertQueue("Webhook B", "redistribute")
	insertRule(webhookQueueA, "webhook", webhookIDs[0], 200)
	insertRule(webhookQueueB, "webhook", webhookIDs[1], 200)
	for index, webhookID := range webhookIDs {
		destination, err := ResolveIntakeDestination(ctx, tx, IntakeContext{
			OrganizationID:  organizationID,
			PipelineID:      &pipelineID,
			Source:          "webhook",
			SourceWebhookID: &webhookID,
		})
		if err != nil {
			t.Fatalf("resolve webhook %d: %v", index, err)
		}
		wantQueue := webhookQueueA
		if index == 1 {
			wantQueue = webhookQueueB
		}
		assertIntakeQueue(t, destination, wantQueue, "redistribute")
	}

	fallbackQueue := insertQueue("Pipeline fallback", "keep_assignee")
	insertRule(fallbackQueue, "source", "never_matches_this_test", 1)
	if _, err := tx.Exec(ctx, `
		update public.pipelines
		set default_round_robin_id = $2::uuid
		where organization_id = $1::uuid and id = $3::uuid
	`, organizationID, fallbackQueue, pipelineID); err != nil {
		t.Fatalf("set pipeline fallback: %v", err)
	}
	fallback, err := ResolveIntakeDestination(ctx, tx, IntakeContext{
		OrganizationID: organizationID,
		PipelineID:     &pipelineID,
		Source:         "no_matching_source",
	})
	if err != nil {
		t.Fatalf("resolve pipeline fallback: %v", err)
	}
	assertIntakeQueue(t, fallback, fallbackQueue, "keep_assignee")

	// An active ruleless queue and a pipeline default are deliberate fallbacks
	// for ordinary intake, but neither can claim a campaign from a connected
	// WhatsApp account without a matching distribution rule.
	genericQueue := insertQueue("Generic queue", "redistribute")
	generic, err := ResolveIntakeDestination(ctx, tx, IntakeContext{
		OrganizationID: organizationID,
		PipelineID:     &pipelineID,
		Source:         "whatsapp",
	})
	if err != nil {
		t.Fatalf("resolve generic queue: %v", err)
	}
	assertIntakeQueue(t, generic, genericQueue, "redistribute")
	withoutRule, err := ResolveIntakeDestination(ctx, tx, IntakeContext{
		OrganizationID:      organizationID,
		PipelineID:          &pipelineID,
		Source:              "whatsapp",
		RequireExplicitRule: true,
	})
	if err != nil {
		t.Fatalf("resolve WhatsApp campaign without matching rule: %v", err)
	}
	if !withoutRule.Resolved || withoutRule.RoundRobinID != nil {
		t.Fatalf("generic/default queue claimed WhatsApp campaign: %#v", withoutRule)
	}

	sessionID := "88888888-8888-4888-8888-888888888888"
	filteredQueue := insertQueue("WhatsApp session filter", "keep_assignee")
	insertRule(filteredQueue, "whatsapp_session", sessionID, 500)
	withRule, err := ResolveIntakeDestination(ctx, tx, IntakeContext{
		OrganizationID:      organizationID,
		PipelineID:          &pipelineID,
		Source:              "whatsapp",
		SourceSessionID:     &sessionID,
		RequireExplicitRule: true,
	})
	if err != nil {
		t.Fatalf("resolve WhatsApp campaign with matching rule: %v", err)
	}
	assertIntakeQueue(t, withRule, filteredQueue, "keep_assignee")
}

func assertIntakeQueue(t *testing.T, destination IntakeDestination, queueID string, reentryBehavior string) {
	t.Helper()
	if destination.RoundRobinID == nil || *destination.RoundRobinID != queueID {
		t.Fatalf("queue = %#v, want %s", destination.RoundRobinID, queueID)
	}
	if destination.ReentryBehavior != reentryBehavior {
		t.Fatalf("reentry behavior = %q, want %q", destination.ReentryBehavior, reentryBehavior)
	}
}

var _ Queryer = (pgx.Tx)(nil)
