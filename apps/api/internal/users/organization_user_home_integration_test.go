package users

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// This opt-in fixture never uses the production database or user catalogue.
func TestOrganizationUserHomeCatalogueIntegration(t *testing.T) {
	if os.Getenv("VIMOB_RUN_USER_HOME_DB_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("set VIMOB_RUN_USER_HOME_DB_TESTS=LOCAL_WRITE_TEST for the disposable clone only")
	}
	databaseURL := strings.TrimSpace(os.Getenv("USER_HOME_TEST_DATABASE_URL"))
	target, err := url.Parse(databaseURL)
	if err != nil || target.Hostname() != "127.0.0.1" || target.Port() != "57922" || target.Path != "/vimob_whatsapp_clone" || target.User == nil || target.User.Username() != "postgres" {
		t.Fatal("home catalogue integration requires the exact loopback disposable WhatsApp clone")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 45*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, MaxConns: 2, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(database.Close)
	var actualDatabase string
	if err := database.Pool().QueryRow(ctx, "select current_database()").Scan(&actualDatabase); err != nil || actualDatabase != "vimob_whatsapp_clone" {
		t.Fatal("disposable database identity was not confirmed")
	}
	fixture := createUserLifecycleFixture(t, ctx, database)
	originalOrganization := lifecycleUUID(t)
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := database.Pool().Exec(cleanupCtx, "update public.users set organization_id=null where id=$1::uuid and organization_id=$2::uuid", fixture.sourceUserID, originalOrganization); err != nil {
			t.Errorf("clear original organization from synthetic user: %v", err)
		}
		if _, err := database.Pool().Exec(cleanupCtx, "delete from public.organizations where id=$1::uuid", originalOrganization); err != nil {
			t.Errorf("cleanup original organization: %v", err)
		}
	})
	if _, err := database.Pool().Exec(ctx, `insert into public.organizations(id,name,subscription_status,is_active) values($1::uuid,'Synthetic original organization','active',true)`, originalOrganization); err != nil {
		t.Fatal(err)
	}
	if _, err := database.Pool().Exec(ctx, "update public.users set organization_id=$1::uuid where id=$2::uuid", originalOrganization, fixture.sourceUserID); err != nil {
		t.Fatal(err)
	}
	if _, err := database.Pool().Exec(ctx, `insert into public.organization_members(organization_id,user_id,role,is_active) values($1::uuid,$2::uuid,'user',true) on conflict(user_id,organization_id) do update set is_active=true,deleted_at=null`, originalOrganization, fixture.sourceUserID); err != nil {
		t.Fatal(err)
	}
	// Establish the secondary membership explicitly after the profile moves;
	// profile synchronization is allowed to retire its previous home membership.
	if _, err := database.Pool().Exec(ctx, `insert into public.organization_members(organization_id,user_id,role,is_active) values($1::uuid,$2::uuid,'user',true) on conflict(user_id,organization_id) do update set is_active=true,deleted_at=null`, fixture.organizationID, fixture.sourceUserID); err != nil {
		t.Fatal(err)
	}
	repository := NewRepository(database, AuthAdminConfig{})
	items, err := repository.ListOrganizationUsers(ctx, tenant.Context{OrganizationID: fixture.organizationID, UserID: fixture.actorUserID, MemberRole: "owner"}, OrganizationUserListActive)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != len(fixture.userIDs) {
		t.Fatal("sharing eligibility must not remove secondary memberships from the CRM catalogue")
	}
	for _, item := range items {
		wantHome := fixture.organizationID
		if item.ID == fixture.sourceUserID {
			wantHome = originalOrganization
		}
		if item.OrganizationID == nil || *item.OrganizationID != fixture.organizationID || item.HomeOrganizationID == nil || *item.HomeOrganizationID != wantHome {
			t.Fatal("actual catalogue SQL mixed membership and original organization")
		}
	}
	otherItems, err := repository.ListOrganizationUsers(ctx, tenant.Context{OrganizationID: originalOrganization, UserID: fixture.sourceUserID, MemberRole: "user"}, OrganizationUserListActive)
	if err != nil || len(otherItems) != 1 || otherItems[0].ID != fixture.sourceUserID {
		t.Fatal("the catalogue query crossed organization boundaries")
	}
}
