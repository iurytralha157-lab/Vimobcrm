package schedule

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

func TestQueuePoolReviewScheduleNewLeadLinkPostgres(t *testing.T) {
	raw := os.Getenv("REVIEW_DATABASE_URL")
	if raw == "" {
		t.Skip("REVIEW_DATABASE_URL is not set: requires the attested disposable review fixture")
	}
	target, err := url.Parse(raw)
	if err != nil || target.Hostname() != "127.0.0.1" || target.Path != "/vimob_review_distribution_20261016_83dfa4ae" {
		t.Fatal("unapproved local review target")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: raw, MaxConns: 3, HealthTimeout: 10 * time.Second})
	if err != nil {
		t.Fatal("local review connection failed")
	}
	defer database.Close()
	var runID string
	if err := database.Pool().QueryRow(ctx, `select run_id::text from vimob_local_bootstrap.sentinel where singleton`).Scan(&runID); err != nil || runID != "fb4b49ef-b2c8-477f-9b8b-c3da63b7eb3d" {
		t.Fatal("local sentinel mismatch")
	}
	const org = "d1610001-0000-4000-8000-000000000001"
	pooled := "d1610005-0000-4000-8000-000000009002"
	admin := tenant.Context{OrganizationID: org, UserID: "d1610002-0000-4000-8000-000000000006", MemberRole: "admin", Permissions: []string{"*"}}
	outsider := tenant.Context{OrganizationID: org, UserID: "d1610002-0000-4000-8000-000000000007", MemberRole: "user", Permissions: []string{permissions.LeadViewAll, permissions.LeadOperate}}
	repo := NewRepository(database, nil)
	for _, actor := range []tenant.Context{admin, outsider} {
		tx, err := database.Pool().Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if err := repo.validateLead(ctx, tx, actor, &pooled); !errors.Is(err, ErrInvalidReference) {
			t.Fatalf("new schedule link bypassed claim: %v", err)
		}
		tx.Rollback(ctx)
	}
	var leadID string
	if err := database.Pool().QueryRow(ctx, `insert into public.leads(organization_id,name,source,assigned_user_id,assigned_at)
	 values($1::uuid,'Synthetic ordinary schedule link review','manual',$2::uuid,clock_timestamp()) returning id::text`, org, admin.UserID).Scan(&leadID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := database.Pool().Exec(cleanup, `delete from public.leads where organization_id=$1::uuid and id=$2::uuid`, org, leadID); err != nil {
			t.Error("schedule link fixture cleanup failed")
		}
	}()
	tx, err := database.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if err := repo.validateLead(ctx, tx, admin, &leadID); err != nil {
		t.Fatalf("ordinary authorized lead link refused: %v", err)
	}
	foreign := admin
	foreign.OrganizationID = "d1610001-0000-4000-8000-000000000002"
	foreign.UserID = "d1610002-0000-4000-8000-000000000008"
	if err := repo.validateLead(ctx, tx, foreign, &leadID); !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("schedule link crossed tenants: %v", err)
	}
	t.Log("new/replaced linked lead rejects private pool even for admin; ordinary authorized link remains; independently authorized existing event edits unchanged")
}
