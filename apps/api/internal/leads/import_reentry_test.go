package leads

import (
	"context"
	"errors"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

type importReentryCaptureExecutor struct {
	query string
	args  []any
	tag   pgconn.CommandTag
	err   error
}

func (executor *importReentryCaptureExecutor) Exec(_ context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	executor.query = query
	executor.args = args
	return executor.tag, executor.err
}

func TestImportReentryPreservesAbsentContactFields(t *testing.T) {
	input, err := (CreateRequest{Name: "Imported name", Phone: "11987654321", ImportMode: true}).Validate()
	if err != nil {
		t.Fatalf("validate minimal imported contact: %v", err)
	}
	executor := &importReentryCaptureExecutor{tag: pgconn.NewCommandTag("UPDATE 1")}
	if err := applyImportReentry(context.Background(), executor, importDistributionOrganizationID, importDistributionActorID, input); err != nil {
		t.Fatalf("apply minimal import reentry: %v", err)
	}
	if executor.args[3] != nil || executor.args[4] != nil {
		t.Fatalf("absent email/message should remain nil: %#v", executor.args)
	}
	query := strings.ToLower(strings.Join(strings.Fields(executor.query), " "))
	if !strings.Contains(query, "email = coalesce($4, email)") || !strings.Contains(query, "message = coalesce($5, message)") {
		t.Fatalf("absent contact fields must preserve stored values: %s", query)
	}
	if !strings.Contains(query, "source = coalesce(source, $6)") {
		t.Fatalf("existing origin must take precedence over import default: %s", query)
	}
}

func TestImportReentryUsesExplicitContactFieldsWithoutCommercialChanges(t *testing.T) {
	email, message := "synthetic@example.test", "Imported message"
	input := createInput{
		ImportMode: true,
		Name:       "Synthetic contact",
		Email:      &email,
		Message:    &message,
		Source:     "spreadsheet",
		// These are valid for a new row, but cannot mutate an existing business.
		PipelineID:     stringPointer("33333333-3333-4333-8333-333333333333"),
		StageID:        stringPointer("44444444-4444-4444-8444-444444444444"),
		DealStatus:     "open",
		LostReason:     stringPointer("Requested replacement"),
		PropertyID:     stringPointer("55555555-5555-4555-8555-555555555555"),
		InterestValue:  stringPointer("750000"),
		AssignedUserID: stringPointer("66666666-6666-4666-8666-666666666666"),
		TeamID:         stringPointer("77777777-7777-4777-8777-777777777777"),
		AutoDistribute: boolPointer(true),
		RoundRobinID:   stringPointer(importDistributionQueueID),
		Metadata:       LeadMetadata{"profile": map[string]any{"cpf": "synthetic"}},
	}
	executor := &importReentryCaptureExecutor{tag: pgconn.NewCommandTag("UPDATE 1")}
	if err := applyImportReentry(context.Background(), executor, importDistributionOrganizationID, importDistributionActorID, input); err != nil {
		t.Fatalf("apply import reentry: %v", err)
	}
	if len(executor.args) != 6 || executor.args[2] != input.Name || executor.args[3] != email || executor.args[4] != message || executor.args[5] != input.Source {
		t.Fatalf("explicit contact fields = %#v", executor.args)
	}

	// This allowlist protects the business, profile and Kanban clocks even when
	// the imported row includes defaults or explicit conflicting values.
	allowed := []string{"name", "email", "message", "source", "last_entry_at", "reentry_count", "updated_at"}
	assignments := regexp.MustCompile(`(?m)^\s*(?:set\s+)?([a-z_]+)\s*=`).FindAllStringSubmatch(executor.query, -1)
	if len(assignments) != len(allowed) {
		t.Fatalf("unexpected number of import reentry assignments: %#v", assignments)
	}
	for _, assignment := range assignments {
		if !slices.Contains(allowed, assignment[1]) {
			t.Fatalf("import reentry mutates protected column %q", assignment[1])
		}
	}
	if !strings.Contains(executor.query, "set name = $3") {
		t.Fatal("explicit name should update the existing contact")
	}
}

func TestImportReentryScopesItsWriteAndDoesNotInterpolateInput(t *testing.T) {
	for _, organizationID := range []string{importDistributionOrganizationID, "99999999-9999-4999-8999-999999999999"} {
		t.Run(organizationID, func(t *testing.T) {
			executor := &importReentryCaptureExecutor{tag: pgconn.NewCommandTag("UPDATE 1")}
			input := createInput{ImportMode: true, Name: "'); drop table public.leads; --", Source: "spreadsheet"}
			if err := applyImportReentry(context.Background(), executor, organizationID, importDistributionActorID, input); err != nil {
				t.Fatalf("apply scoped import reentry: %v", err)
			}
			if executor.args[0] != organizationID || executor.args[1] != importDistributionActorID {
				t.Fatalf("write scope = %#v", executor.args[:2])
			}
			if !strings.Contains(executor.query, "where organization_id = $1::uuid") || !strings.Contains(executor.query, "and id = $2::uuid") {
				t.Fatalf("write must require organization and lead: %s", executor.query)
			}
			if strings.Contains(executor.query, input.Name) {
				t.Fatal("imported name was interpolated into SQL")
			}
		})
	}
}

func TestImportReentryRejectsManualCallsBeforeWriting(t *testing.T) {
	executor := &importReentryCaptureExecutor{tag: pgconn.NewCommandTag("UPDATE 1")}
	err := applyImportReentry(context.Background(), executor, importDistributionOrganizationID, importDistributionActorID, createInput{Name: "Manual contact"})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("manual request error = %v, want invalid input", err)
	}
	if executor.query != "" {
		t.Fatal("manual request reached the import-only writer")
	}
}

func TestImportReentryDoesNotReportSuccessOnMissingLeadOrWriteFailure(t *testing.T) {
	failure := errors.New("synthetic database failure")
	for _, testCase := range []struct {
		name string
		tag  pgconn.CommandTag
		err  error
		want error
	}{
		{name: "missing lead in requested organization", tag: pgconn.NewCommandTag("UPDATE 0"), want: ErrLeadNotFound},
		{name: "write failure", err: failure, want: failure},
		{name: "cancelled request", err: context.Canceled, want: context.Canceled},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			executor := &importReentryCaptureExecutor{tag: testCase.tag, err: testCase.err}
			err := applyImportReentry(context.Background(), executor, importDistributionOrganizationID, importDistributionActorID, createInput{ImportMode: true, Name: "Synthetic contact"})
			if !errors.Is(err, testCase.want) {
				t.Fatalf("write result error = %v, want %v", err, testCase.want)
			}
		})
	}
}
