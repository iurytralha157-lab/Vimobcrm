package attention

import (
	"context"
	"errors"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestQueuePoolReviewAttentionReadAndMutationBoundariesPostgres(t *testing.T) {
	raw := os.Getenv("REVIEW_DATABASE_URL")
	if raw == "" {
		t.Skip("REVIEW_DATABASE_URL is not set: requires the attested disposable review fixture")
	}
	target, err := url.Parse(raw)
	if err != nil || target.Hostname() != "127.0.0.1" || target.Path != "/vimob_review_distribution_20261016_83dfa4ae" {
		t.Fatal("unapproved local review target")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: raw, MaxConns: 4, HealthTimeout: 10 * time.Second})
	if err != nil {
		t.Fatal("local review connection failed")
	}
	defer database.Close()
	var runID string
	if err := database.Pool().QueryRow(ctx, `select run_id::text from vimob_local_bootstrap.sentinel where singleton`).Scan(&runID); err != nil || runID != "fb4b49ef-b2c8-477f-9b8b-c3da63b7eb3d" {
		t.Fatal("local sentinel mismatch")
	}
	const org = "d1610001-0000-4000-8000-000000000001"
	const lead = "d1610005-0000-4000-8000-000000009002"
	outsider := tenant.Context{OrganizationID: org, UserID: "d1610002-0000-4000-8000-000000000007", MemberRole: "user", Permissions: []string{permissions.LeadViewAll, permissions.LeadOperate}}
	admin := tenant.Context{OrganizationID: org, UserID: "d1610002-0000-4000-8000-000000000006", MemberRole: "admin", Permissions: []string{"*"}}
	var privateAccess bool
	if err := database.Pool().QueryRow(ctx, `select private.queue_pool_read_access($1::uuid,$2::uuid,$3::uuid)`, org, lead, outsider.UserID).Scan(&privateAccess); err != nil || privateAccess {
		t.Fatal("expected exact pooled fixture and excluded general reader")
	}
	var policyID, itemID string
	if err := database.Pool().QueryRow(ctx, `insert into public.lead_attention_policies(organization_id,name,policy_type,status,threshold_minutes,warning_minutes,notify_assignee,notify_leaders,notify_admins,config)
	 values($1::uuid,'Synthetic private pool read review','first_contact','enabled',15,0,false,false,false,'{"source":"stage_operational_rules"}') returning id::text`, org).Scan(&policyID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := database.Pool().Exec(cleanup, `delete from public.lead_attention_instances where organization_id=$1::uuid and policy_id=$2::uuid;`, org, policyID); err != nil {
			t.Error("attention fixture cleanup failed")
		}
		if _, err := database.Pool().Exec(cleanup, `delete from public.lead_attention_policies where organization_id=$1::uuid and id=$2::uuid`, org, policyID); err != nil {
			t.Error("attention policy cleanup failed")
		}
	}()
	if err := database.Pool().QueryRow(ctx, `insert into public.lead_attention_instances(organization_id,lead_id,policy_id,policy_version,cycle_key,baseline_at,due_at,next_evaluation_at,status,shadow)
	 values($1::uuid,$2::uuid,$3::uuid,1,'synthetic-pool-review',clock_timestamp(),clock_timestamp()+interval '15 minutes',clock_timestamp(),'monitoring',false) returning id::text`, org, lead, policyID).Scan(&itemID); err != nil {
		t.Fatal(err)
	}
	repo := NewRepository(database)
	for _, actor := range []tenant.Context{outsider, admin} {
		page, err := repo.ListItems(ctx, actor, ListFilter{Scope: "organization"})
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, item := range page.Items {
			if item.ID == itemID {
				found = true
			}
		}
		if found != (actor.UserID == admin.UserID) {
			t.Fatalf("private pool list mismatch for actor %s", actor.UserID)
		}
		summary, err := repo.Summary(ctx, actor, "organization")
		if err != nil {
			t.Fatal(err)
		}
		if actor.UserID == admin.UserID && summary.Total < 1 {
			t.Fatal("admin lost the visible pool attention item")
		}
		if actor.UserID == outsider.UserID && summary.Total != 0 {
			t.Fatal("excluded reader learned pool attention summary")
		}
		wantMutationError := ErrNotFound
		if actor.UserID == admin.UserID {
			wantMutationError = ErrForbidden
		}
		if _, err := repo.AcknowledgeItem(ctx, actor, itemID, AcknowledgeRequest{}); !errors.Is(err, wantMutationError) {
			t.Fatalf("pool item acknowledgement without claim: %v", err)
		}
		if _, err := repo.SnoozeItem(ctx, actor, itemID, SnoozeRequest{Minutes: 5}); !errors.Is(err, wantMutationError) {
			t.Fatalf("pool item snooze without claim: %v", err)
		}
	}
	foreign := outsider
	foreign.OrganizationID = "d1610001-0000-4000-8000-000000000002"
	foreign.UserID = "d1610002-0000-4000-8000-000000000008"
	page, err := repo.ListItems(ctx, foreign, ListFilter{Scope: "organization"})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range page.Items {
		if item.ID == itemID {
			t.Fatal("attention item crossed tenants")
		}
	}
	if _, err := repo.AcknowledgeItem(ctx, foreign, itemID, AcknowledgeRequest{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign attention mutation: %v", err)
	}
	var status string
	if err := database.Pool().QueryRow(ctx, `select status from public.lead_attention_instances where id=$1::uuid`, itemID).Scan(&status); err != nil || status != "monitoring" {
		t.Fatal("rejected pool commands changed attention state")
	}
	t.Log("real ListItems/Summary hide pool from broad outsider; admin reads; pool mutations denied; foreign tenant denied; fixture cleanup scoped")
}
