package automations

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestListExecutionHistoryProtectsLeadPayload(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("AUTOMATIONS_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set AUTOMATIONS_TEST_DATABASE_URL to the disposable loopback PostgreSQL database")
	}
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal("AUTOMATIONS_TEST_DATABASE_URL is invalid")
	}
	if (target.Scheme != "postgres" && target.Scheme != "postgresql") ||
		(target.Hostname() != "127.0.0.1" && target.Hostname() != "localhost" && target.Hostname() != "::1") {
		t.Fatal("AUTOMATIONS_TEST_DATABASE_URL must point to disposable loopback PostgreSQL")
	}
	for key := range target.Query() {
		if key != "sslmode" {
			t.Fatal("AUTOMATIONS_TEST_DATABASE_URL must not override the loopback target")
		}
	}

	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(database.Close)
	pool := database.Pool()
	exec := func(ctx context.Context, query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	type executionFixture struct {
		org, actor, flow, version, lead, execution, issue string
	}
	create := func(label string, org string, flow string, version string) executionFixture {
		t.Helper()
		var f executionFixture
		f.org, f.flow, f.version = org, flow, version
		suffix := fmt.Sprintf("execution-scope-%s-%d", label, time.Now().UnixNano())
		if err := pool.QueryRow(ctx, `select gen_random_uuid()::text, gen_random_uuid()::text,
			gen_random_uuid()::text, gen_random_uuid()::text`).Scan(&f.actor, &f.lead, &f.execution, &f.issue); err != nil {
			t.Fatal(err)
		}
		if org == "" {
			if err := pool.QueryRow(ctx, `insert into public.organizations (name, slug, is_active)
				values ($1, $1, true) returning id::text`, suffix).Scan(&f.org); err != nil {
				t.Fatal(err)
			}
		}
		t.Cleanup(func() {
			cleanup, stop := context.WithTimeout(context.Background(), 8*time.Second)
			defer stop()
			exec(cleanup, `delete from public.automation_event_outbox where id = $1::uuid`, f.issue)
			exec(cleanup, `delete from public.automation_executions where id = $1::uuid`, f.execution)
			exec(cleanup, `delete from public.leads where id = $1::uuid`, f.lead)
			// Activity from transferring the other fixture's lead can still
			// reference this synthetic actor when its own lead has been deleted.
			exec(cleanup, `delete from public.activities where user_id = $1::uuid`, f.actor)
			if org == "" {
				exec(cleanup, `delete from public.automations where id = nullif($1, '')::uuid`, f.flow)
				exec(cleanup, `update public.users set organization_id = null where id = $1::uuid`, f.actor)
				exec(cleanup, `delete from public.organizations where id = $1::uuid`, f.org)
			}
			exec(cleanup, `delete from public.users where id = $1::uuid`, f.actor)
			exec(cleanup, `delete from auth.users where id = $1::uuid`, f.actor)
		})
		exec(ctx, `insert into auth.users (id, aud, role, email, encrypted_password,
			email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
			values ($1::uuid, 'authenticated', 'authenticated', $2, '', now(), '{}'::jsonb, '{}'::jsonb, now(), now())`,
			f.actor, suffix+"@example.invalid")
		exec(ctx, `insert into public.users (id, organization_id, name, email, role, is_active)
			values ($1::uuid, $2::uuid, $3, $4, 'user', true)
			on conflict (id) do update set organization_id = excluded.organization_id, role = 'user', is_active = true`,
			f.actor, f.org, suffix, suffix+"@example.invalid")
		exec(ctx, `insert into public.organization_members (organization_id, user_id, role, is_active)
			values ($1::uuid, $2::uuid, 'user', true)
			on conflict (user_id, organization_id) do update set role = 'user', is_active = true, deleted_at = null`, f.org, f.actor)
		if org == "" {
			if err := pool.QueryRow(ctx, `insert into public.automations (organization_id, created_by, name, trigger_type, is_active)
				values ($1::uuid, $2::uuid, $3, 'manual', false) returning id::text`, f.org, f.actor, suffix).Scan(&f.flow); err != nil {
				t.Fatal(err)
			}
			if err := pool.QueryRow(ctx, `insert into public.automation_flow_versions
				(organization_id, automation_id, version, trigger_type, graph, graph_checksum, first_node_key, created_by)
				values ($1::uuid, $2::uuid, 1, 'manual', '{}'::jsonb, 'synthetic', 'trigger', $3::uuid)
				returning id::text`, f.org, f.flow, f.actor).Scan(&f.version); err != nil {
				t.Fatal(err)
			}
		}
		exec(ctx, `insert into public.leads (id, organization_id, assigned_user_id, name, source)
			values ($1::uuid, $2::uuid, $3::uuid, $4, 'manual')`, f.lead, f.org, f.actor, suffix)
		exec(ctx, `insert into public.automation_executions
			(id, automation_id, organization_id, lead_id, status, execution_data, error_message, flow_version_id)
			values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'failed',
			'{"reply_payload":{"content":"synthetic reply"},"trigger_data":{"content":"synthetic trigger"}}'::jsonb,
			'synthetic private execution error', $5::uuid)`, f.execution, f.flow, f.org, f.lead, f.version)
		exec(ctx, `insert into public.automation_execution_steps
			(organization_id, execution_id, flow_version_id, node_key, node_type, status, error_message)
			values ($1::uuid, $2::uuid, $3::uuid, 'trigger', 'trigger', 'failed', 'synthetic private step error')`,
			f.org, f.execution, f.version)
		exec(ctx, `insert into public.automation_event_outbox
			(id, organization_id, event_type, aggregate_type, aggregate_id, lead_id, dedupe_key, status, last_error)
			values ($1::uuid, $2::uuid, 'manual', 'lead', $3::uuid, $3::uuid, $1::uuid::text,
			'failed', 'synthetic private issue error')`, f.issue, f.org, f.lead)
		return f
	}
	own := create("own", "", "", "")
	colleague := create("colleague", own.org, own.flow, own.version)
	foreign := create("foreign", "", "", "")
	repo := NewRepository(database, FunctionsConfig{}, StorageConfig{})
	actor := tenant.Context{UserID: own.actor, OrganizationID: own.org, MemberRole: "user",
		Permissions: []string{permissions.AutomationsView, permissions.LeadViewOwn}}

	rows, err := repo.ListExecutions(ctx, actor, ExecutionFilter{AutomationID: own.flow, Status: "failed"})
	if err != nil || len(rows) != 2 {
		t.Fatalf("organization monitoring returned %d executions, want 2: %v", len(rows), err)
	}
	for _, row := range rows {
		if row.ID == own.execution {
			if row.LeadID == nil || *row.LeadID != own.lead || !strings.Contains(string(row.ExecutionData), "synthetic reply") || row.ErrorMessage == nil {
				t.Fatal("authorized lead detail was lost")
			}
			continue
		}
		if row.ID != colleague.execution || row.LeadID != nil || row.Lead != nil || row.ConversationID != nil ||
			string(row.ExecutionData) != "{}" || row.ErrorMessage != nil {
			t.Fatal("monitoring row leaked another lead's details")
		}
	}
	for _, f := range []executionFixture{colleague, foreign} {
		rows, err = repo.ListExecutions(ctx, actor, ExecutionFilter{LeadID: f.lead, Offset: 0})
		if err != nil || len(rows) != 0 {
			t.Fatalf("an out-of-scope lead filter returned %d executions: %v", len(rows), err)
		}
	}
	steps, err := repo.ListExecutionSteps(ctx, actor, colleague.execution, ExecutionStepFilter{})
	if err != nil || len(steps) != 1 || steps[0].ErrorMessage != nil {
		t.Fatal("out-of-scope step error must remain private while status is visible")
	}
	steps, err = repo.ListExecutionSteps(ctx, actor, own.execution, ExecutionStepFilter{})
	if err != nil || len(steps) != 1 || steps[0].ErrorMessage == nil || *steps[0].ErrorMessage != "synthetic private step error" {
		t.Fatal("authorized step error must stay visible")
	}
	issues, err := repo.ListRuntimeIssues(ctx, actor, 10, 0)
	if err != nil || len(issues.Issues) != 2 || issues.Summary.FailedEvents != 2 {
		t.Fatalf("organization monitoring lost issue status or counts: %v", err)
	}
	for _, issue := range issues.Issues {
		if issue.ID == colleague.issue && (issue.LeadID != nil || issue.Message == nil || *issue.Message != "failed_event" || string(issue.Details) != "{}") {
			t.Fatal("runtime issue leaked another lead's error details")
		}
		if issue.ID == own.issue && (issue.LeadID == nil || *issue.LeadID != own.lead || issue.Message == nil || *issue.Message != "synthetic private issue error") {
			t.Fatal("authorized runtime issue detail was lost")
		}
	}

	t.Cleanup(func() {
		cleanup, stop := context.WithTimeout(context.Background(), 8*time.Second)
		defer stop()
		exec(cleanup, `update public.leads set assigned_user_id = $1::uuid
			where organization_id = $2::uuid and id = $3::uuid and assigned_user_id = $4::uuid`,
			own.actor, own.org, own.lead, colleague.actor)
	})
	exec(ctx, `update public.leads set assigned_user_id = $1::uuid where id = $2::uuid`, colleague.actor, own.lead)
	rows, err = repo.ListExecutions(ctx, actor, ExecutionFilter{LeadID: own.lead})
	if err != nil || len(rows) != 0 {
		t.Fatalf("a transferred lead returned %d executions to its former assignee: %v", len(rows), err)
	}
	actor.UserID = colleague.actor
	rows, err = repo.ListExecutions(ctx, actor, ExecutionFilter{LeadID: own.lead, Limit: 1})
	if err != nil || len(rows) != 1 || !strings.Contains(string(rows[0].ExecutionData), "synthetic reply") {
		t.Fatal("new assignee could not read retained execution details")
	}
}
