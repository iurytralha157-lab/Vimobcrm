package distribution

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

type intakeRoutingQueryCall struct {
	sql  string
	args []any
}

type intakeRoutingQueryer struct {
	calls []intakeRoutingQueryCall
	rows  []pgx.Row
}

func (stub *intakeRoutingQueryer) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	stub.calls = append(stub.calls, intakeRoutingQueryCall{sql: sql, args: args})
	if len(stub.rows) == 0 {
		return intakeRoutingRow{err: errors.New("unexpected query")}
	}
	row := stub.rows[0]
	stub.rows = stub.rows[1:]
	return row
}

type intakeRoutingRow struct {
	values []any
	err    error
}

func (row intakeRoutingRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	if len(dest) != len(row.values) {
		return errors.New("unexpected scan target count")
	}
	for index, value := range row.values {
		switch target := dest[index].(type) {
		case *string:
			text, ok := value.(string)
			if !ok {
				return errors.New("unexpected string scan value")
			}
			*target = text
		case *bool:
			boolean, ok := value.(bool)
			if !ok {
				return errors.New("unexpected boolean scan value")
			}
			*target = boolean
		case *[]string:
			texts, ok := value.([]string)
			if !ok {
				return errors.New("unexpected string slice scan value")
			}
			*target = append((*target)[:0], texts...)
		default:
			return errors.New("unexpected scan target")
		}
	}
	return nil
}

func TestResolveIntakeDestinationFreezesQueueAndReentryBehavior(t *testing.T) {
	t.Parallel()

	const queueID = "22222222-2222-4222-8222-222222222222"
	const pipelineID = "33333333-3333-4333-8333-333333333333"
	propertyID := "44444444-4444-4444-8444-444444444444"
	webhookID := "55555555-5555-4555-8555-555555555555"
	tagID := "66666666-6666-4666-8666-666666666666"
	formID := "form-a"
	category := "landing-a"
	stub := &intakeRoutingQueryer{rows: []pgx.Row{
		intakeRoutingRow{values: []any{queueID, true, []string{tagID}}},
		intakeRoutingRow{values: []any{queueID, "keep_assignee"}},
		intakeRoutingRow{values: []any{queueID, true, []string{tagID}}},
	}}

	destination, err := ResolveIntakeDestination(t.Context(), stub, IntakeContext{
		OrganizationID:  "11111111-1111-4111-8111-111111111111",
		PipelineID:      stringPointerForIntakeTest(pipelineID),
		Source:          "webhook",
		PropertyID:      &propertyID,
		TagIDs:          []string{tagID},
		FormID:          &formID,
		SourceWebhookID: &webhookID,
		WebsiteCategory: &category,
	})
	if err != nil {
		t.Fatalf("ResolveIntakeDestination() error = %v", err)
	}
	if destination.RoundRobinID == nil || *destination.RoundRobinID != queueID {
		t.Fatalf("queue = %#v, want %s", destination.RoundRobinID, queueID)
	}
	if destination.ReentryBehavior != "keep_assignee" {
		t.Fatalf("reentry behavior = %q", destination.ReentryBehavior)
	}
	if !destination.Resolved {
		t.Fatal("resolved queue did not carry the frozen-routing marker")
	}
	if len(destination.TagIDs) != 1 || destination.TagIDs[0] != tagID {
		t.Fatalf("validated tags = %#v, want %s", destination.TagIDs, tagID)
	}
	if len(stub.calls) != 3 {
		t.Fatalf("query calls = %d, want 3", len(stub.calls))
	}
	if len(stub.calls[0].args) != 15 {
		t.Fatalf("resolver argument count = %d, want 15", len(stub.calls[0].args))
	}
	if stub.calls[0].args[1] != pipelineID || stub.calls[0].args[3] != propertyID || stub.calls[0].args[7] != webhookID {
		t.Fatalf("resolver lost exact intake context: %#v", stub.calls[0].args)
	}
	if stub.calls[0].args[14] != false {
		t.Fatalf("non-WhatsApp intake unexpectedly requires an explicit rule: %#v", stub.calls[0].args)
	}
	if !strings.Contains(stub.calls[1].sql, "for share") || strings.Contains(stub.calls[1].sql, "for key share") {
		t.Fatal("resolved queue is not locked before intake identity is used")
	}
	if stub.calls[0].sql != stub.calls[2].sql {
		t.Fatal("queue selection is not revalidated after acquiring the row lock")
	}
}

func TestResolveIntakeDestinationSupportsDeliberatelyUnscopedIntake(t *testing.T) {
	t.Parallel()

	stub := &intakeRoutingQueryer{rows: []pgx.Row{
		intakeRoutingRow{values: []any{"", true, []string{}}},
	}}
	destination, err := ResolveIntakeDestination(t.Context(), stub, IntakeContext{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		Source:         "site",
	})
	if err != nil {
		t.Fatalf("ResolveIntakeDestination() error = %v", err)
	}
	if !destination.Resolved || destination.RoundRobinID != nil || IntakeScopeKey(destination.RoundRobinID) != "unscoped" {
		t.Fatalf("unexpected destination: %#v", destination)
	}
	if len(stub.calls) != 1 {
		t.Fatalf("unscoped resolver query calls = %d, want 1", len(stub.calls))
	}
}

func TestResolveIntakeDestinationCanRequireExplicitMatchingRule(t *testing.T) {
	t.Parallel()
	stub := &intakeRoutingQueryer{rows: []pgx.Row{
		intakeRoutingRow{values: []any{"", true, []string{}}},
	}}
	destination, err := ResolveIntakeDestination(t.Context(), stub, IntakeContext{
		OrganizationID:      "11111111-1111-4111-8111-111111111111",
		Source:              "whatsapp",
		RequireExplicitRule: true,
	})
	if err != nil {
		t.Fatalf("ResolveIntakeDestination() error = %v", err)
	}
	if !destination.Resolved || destination.RoundRobinID != nil {
		t.Fatalf("unmatched WhatsApp campaign selected a queue: %#v", destination)
	}
	if len(stub.calls) != 1 || len(stub.calls[0].args) != 15 || stub.calls[0].args[14] != true {
		t.Fatalf("explicit-rule requirement was not sent to the resolver: %#v", stub.calls)
	}
	for _, fragment := range []string{
		"(not lead.require_explicit_rule and not rule_state.has_rules)",
		"not (select require_explicit_rule from lead_context)",
	} {
		if !strings.Contains(stub.calls[0].sql, fragment) {
			t.Fatalf("explicit-rule resolver is missing %q", fragment)
		}
	}
}

func TestResolveIntakeDestinationFailsClosedForDriftedPipelineOrQueue(t *testing.T) {
	t.Parallel()

	pipelineID := "33333333-3333-4333-8333-333333333333"
	for name, rows := range map[string][]pgx.Row{
		"pipeline": {
			intakeRoutingRow{values: []any{"", false, []string{}}},
		},
		"queue": {
			intakeRoutingRow{values: []any{"22222222-2222-4222-8222-222222222222", true, []string{}}},
			intakeRoutingRow{err: pgx.ErrNoRows},
		},
		"reclassified after lock": {
			intakeRoutingRow{values: []any{"22222222-2222-4222-8222-222222222222", true, []string{}}},
			intakeRoutingRow{values: []any{"22222222-2222-4222-8222-222222222222", "redistribute"}},
			intakeRoutingRow{values: []any{"99999999-9999-4999-8999-999999999999", true, []string{}}},
		},
		"tag snapshot changed after lock": {
			intakeRoutingRow{values: []any{"22222222-2222-4222-8222-222222222222", true, []string{"66666666-6666-4666-8666-666666666666"}}},
			intakeRoutingRow{values: []any{"22222222-2222-4222-8222-222222222222", "redistribute"}},
			intakeRoutingRow{values: []any{"22222222-2222-4222-8222-222222222222", true, []string{"77777777-7777-4777-8777-777777777777"}}},
		},
	} {
		t.Run(name, func(t *testing.T) {
			stub := &intakeRoutingQueryer{rows: rows}
			_, err := ResolveIntakeDestination(t.Context(), stub, IntakeContext{
				OrganizationID: "11111111-1111-4111-8111-111111111111",
				PipelineID:     &pipelineID,
				Source:         "site",
			})
			if !errors.Is(err, ErrInvalidIntakeRouting) {
				t.Fatalf("error = %v, want ErrInvalidIntakeRouting", err)
			}
		})
	}
}

func TestResolveIntakeDestinationMirrorsCanonicalRuleOrderingAndFallback(t *testing.T) {
	t.Parallel()

	for _, fragment := range []string{
		"normalized.match_type in ('all', 'any')",
		"normalized.match_type = 'source'",
		"normalized.match_type in ('property', 'interest_property')",
		"normalized.match_type = 'tag'",
		"normalized.match_type in ('meta_form', 'form')",
		"normalized.match_type = 'webhook'",
		"normalized.match_type = 'whatsapp_session'",
		"normalized.match_type = 'city'",
		"normalized.match_type = 'website_category'",
		"normalized.match_type = 'campaign_contains'",
		"(matched_rule.matched_priority is null) asc",
		"(queue.pipeline_id is null) asc",
		"matched_rule.matched_priority desc nulls last",
		"queue.created_at asc",
		"queue.id asc",
		"pipeline.default_round_robin_id",
		"not exists (select 1 from matched_queue)",
	} {
		if !strings.Contains(resolveIntakeQueueIDSQL, fragment) {
			t.Fatalf("canonical intake resolver is missing %q", fragment)
		}
	}

	priority := strings.Index(resolveIntakeQueueIDSQL, "matched_rule.matched_priority desc nulls last")
	created := strings.Index(resolveIntakeQueueIDSQL, "queue.created_at asc")
	queueID := strings.Index(resolveIntakeQueueIDSQL, "queue.id asc")
	if priority < 0 || created <= priority || queueID <= created {
		t.Fatal("canonical queue tie-break ordering drifted")
	}
}

func TestResolveIntakeDestinationFiltersAndLocksTenantTags(t *testing.T) {
	t.Parallel()

	for _, fragment := range []string{
		"locked_tags as materialized",
		"join public.tags as tag",
		"tag.organization_id = input.organization_id",
		"tag.id = any(input.requested_tag_ids)",
		"order by tag.id",
		"for key share of tag",
		"from locked_tags as locked_tag",
	} {
		if !strings.Contains(resolveIntakeQueueIDSQL, fragment) {
			t.Fatalf("tenant-safe tag resolution is missing %q", fragment)
		}
	}
	if strings.Contains(resolveIntakeQueueIDSQL, "where private.safe_uuid(value) = any(input.requested_tag_ids)") {
		t.Fatal("queue rules must not match unvalidated raw tag ids")
	}
}

func TestPreserveAssigneeForIntakeHonorsSameQueueReentryBehavior(t *testing.T) {
	t.Parallel()

	queueID := "22222222-2222-4222-8222-222222222222"
	for _, test := range []struct {
		name        string
		reentry     bool
		destination IntakeDestination
		want        bool
	}{
		{name: "initial", destination: IntakeDestination{RoundRobinID: &queueID, ReentryBehavior: "redistribute"}, want: true},
		{name: "redistribute reentry", reentry: true, destination: IntakeDestination{RoundRobinID: &queueID, ReentryBehavior: "redistribute"}, want: false},
		{name: "keep reentry", reentry: true, destination: IntakeDestination{RoundRobinID: &queueID, ReentryBehavior: "keep_assignee"}, want: true},
		{name: "unscoped reentry", reentry: true, destination: IntakeDestination{}, want: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := PreserveAssigneeForIntake(test.reentry, test.destination); got != test.want {
				t.Fatalf("PreserveAssigneeForIntake() = %v, want %v", got, test.want)
			}
		})
	}
}

func stringPointerForIntakeTest(value string) *string {
	return &value
}
