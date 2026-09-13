package users

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

const localUserLifecycleTestGuard = "LOCAL_WRITE_TEST"

type userLifecycleFixture struct {
	organizationID string
	actorUserID    string
	sourceUserID   string
	targetUserID   string
	emptyUserID    string
	userIDs        []string
}

type userLifecycleResources struct {
	leadIDs     []string
	propertyIDs []string
	sessionID   string
}

func TestOrganizationUserLifecycleAndDeletionAgainstLocalDatabase(t *testing.T) {
	database, ctx := openUserLifecycleTestDatabase(t)
	fixture := createUserLifecycleFixture(t, ctx, database)

	repository := NewRepository(database, AuthAdminConfig{})
	tenantRepository := tenant.NewRepository(database)
	actorContext := lifecycleActorContext(fixture)
	emptyResult, err := repository.DeleteOrganizationUser(
		ctx,
		actorContext,
		fixture.emptyUserID,
		DeleteUserInput{},
	)
	if err != nil {
		t.Fatalf("delete membership without transferable resources: %v", err)
	}
	if !emptyResult.Success || emptyResult.Impact != (DeleteUserImpact{}) {
		t.Fatalf("unexpected empty membership deletion result: %#v", emptyResult)
	}

	if _, err := tenantRepository.Resolve(ctx, fixture.sourceUserID, fixture.organizationID); err != nil {
		t.Fatalf("resolve active source membership: %v", err)
	}

	inactive := false
	updated, err := repository.UpdateOrganizationUser(ctx, actorContext, fixture.sourceUserID, UpdateUserInput{
		IsActive: &inactive,
	})
	if err != nil {
		t.Fatalf("deactivate membership: %v", err)
	}
	if updated.IsActive {
		t.Fatal("deactivated membership returned as active")
	}

	assertMembershipState(t, ctx, database, fixture, false, false)
	assertUserListState(t, ctx, repository, actorContext, fixture.sourceUserID, false, true)
	if _, err := tenantRepository.Resolve(ctx, fixture.sourceUserID, fixture.organizationID); !errors.Is(err, tenant.ErrUserInactive) && !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("resolve deactivated membership error = %v, want access denial", err)
	}

	active := true
	updated, err = repository.UpdateOrganizationUser(ctx, actorContext, fixture.sourceUserID, UpdateUserInput{
		IsActive: &active,
	})
	if err != nil {
		t.Fatalf("reactivate membership: %v", err)
	}
	if !updated.IsActive {
		t.Fatal("reactivated membership returned as inactive")
	}
	assertMembershipState(t, ctx, database, fixture, true, false)
	assertUserListState(t, ctx, repository, actorContext, fixture.sourceUserID, true, true)
	if _, err := tenantRepository.Resolve(ctx, fixture.sourceUserID, fixture.organizationID); err != nil {
		t.Fatalf("resolve reactivated membership: %v", err)
	}

	resources := createUserLifecycleResources(t, ctx, database, fixture)
	impact, err := repository.GetDeleteUserImpact(ctx, actorContext, fixture.sourceUserID)
	if err != nil {
		t.Fatalf("get deletion impact: %v", err)
	}
	if impact.Leads != 2 || impact.Properties != 4 || impact.WhatsAppSessions != 1 {
		t.Fatalf("unexpected deletion impact: %#v", impact)
	}
	if _, err := repository.DeleteOrganizationUser(
		ctx,
		actorContext,
		fixture.sourceUserID,
		DeleteUserInput{},
	); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("delete without required recipients error = %v, want ErrInvalidInput", err)
	}
	assertMembershipState(t, ctx, database, fixture, true, false)
	assertLifecycleResourcesUnchanged(t, ctx, database, fixture, resources)

	missingTargetID := lifecycleUUID(t)
	_, err = repository.DeleteOrganizationUser(ctx, actorContext, fixture.sourceUserID, DeleteUserInput{
		TransferLeadsToUserID:      &fixture.targetUserID,
		TransferPropertiesToUserID: &missingTargetID,
	})
	if !errors.Is(err, ErrUserNotFound) {
		t.Fatalf("delete with invalid property target error = %v, want ErrUserNotFound", err)
	}
	assertMembershipState(t, ctx, database, fixture, true, false)
	assertLifecycleResourcesUnchanged(t, ctx, database, fixture, resources)

	result, err := repository.DeleteOrganizationUser(ctx, actorContext, fixture.sourceUserID, DeleteUserInput{
		TransferLeadsToUserID:      &fixture.targetUserID,
		TransferPropertiesToUserID: &fixture.targetUserID,
	})
	if err != nil {
		t.Fatalf("delete membership: %v", err)
	}
	if !result.Success || result.Impact != impact {
		t.Fatalf("unexpected deletion result: %#v", result)
	}

	assertMembershipState(t, ctx, database, fixture, false, true)
	assertUserListState(t, ctx, repository, actorContext, fixture.sourceUserID, false, false)
	assertLifecycleResourcesTransferred(t, ctx, database, fixture, resources)
	if _, err := tenantRepository.Resolve(ctx, fixture.sourceUserID, fixture.organizationID); !errors.Is(err, tenant.ErrUserInactive) && !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("resolve deleted membership error = %v, want access denial", err)
	}
	if _, err := repository.UpdateOrganizationUser(ctx, actorContext, fixture.sourceUserID, UpdateUserInput{
		IsActive: &active,
	}); !errors.Is(err, ErrUserNotFound) {
		t.Fatalf("direct reactivation of tombstone error = %v, want ErrUserNotFound", err)
	}
}

func TestMembershipRemovalSerializesConcurrentAssignments(t *testing.T) {
	database, ctx := openUserLifecycleTestDatabase(t)
	fixture := createUserLifecycleFixture(t, ctx, database)
	resources := createConcurrentAssignmentResources(t, ctx, database, fixture)

	lifecycleTx, err := database.Pool().Begin(ctx)
	if err != nil {
		t.Fatalf("begin lifecycle transaction: %v", err)
	}
	defer lifecycleTx.Rollback(context.Background())
	if err := lockCanonicalUserAccess(ctx, lifecycleTx, fixture.sourceUserID); err != nil {
		t.Fatalf("lock canonical user: %v", err)
	}
	if _, err := organizationMemberRoleForUpdate(
		ctx,
		lifecycleTx,
		fixture.organizationID,
		fixture.sourceUserID,
	); err != nil {
		t.Fatalf("lock membership: %v", err)
	}

	type assignmentResult struct {
		kind string
		err  error
	}
	results := make(chan assignmentResult, 2)
	go func() {
		_, updateErr := database.Pool().Exec(ctx, `
			update public.leads
			set assigned_user_id = $3::uuid
			where organization_id = $1::uuid
			  and id = $2::uuid
		`, fixture.organizationID, resources.leadIDs[0], fixture.sourceUserID)
		results <- assignmentResult{kind: "lead", err: updateErr}
	}()
	go func() {
		_, updateErr := database.Pool().Exec(ctx, `
			update public.properties
			set corretor_id = $3::uuid
			where organization_id = $1::uuid
			  and id = $2::uuid
		`, fixture.organizationID, resources.propertyIDs[0], fixture.sourceUserID)
		results <- assignmentResult{kind: "property", err: updateErr}
	}()

	for completed := 0; completed < 2; completed++ {
		select {
		case result := <-results:
			t.Fatalf("concurrent %s assignment completed before lifecycle commit: %v", result.kind, result.err)
		case <-time.After(150 * time.Millisecond):
		}
	}

	if _, err := lifecycleTx.Exec(ctx, `
		update public.organization_members
		set is_active = false,
		    deleted_at = now(),
		    updated_at = now()
		where organization_id = $1::uuid
		  and user_id = $2::uuid
	`, fixture.organizationID, fixture.sourceUserID); err != nil {
		t.Fatalf("tombstone membership: %v", err)
	}
	if err := syncCanonicalUserAccess(
		ctx,
		lifecycleTx,
		fixture.sourceUserID,
		fixture.organizationID,
	); err != nil {
		t.Fatalf("sync canonical access: %v", err)
	}
	if err := lifecycleTx.Commit(ctx); err != nil {
		t.Fatalf("commit lifecycle transaction: %v", err)
	}

	for completed := 0; completed < 2; completed++ {
		select {
		case result := <-results:
			var databaseError *pgconn.PgError
			if !errors.As(result.err, &databaseError) || databaseError.Code != "23514" {
				t.Fatalf("concurrent %s assignment error = %v, want 23514", result.kind, result.err)
			}
		case <-ctx.Done():
			t.Fatalf("wait for concurrent assignment: %v", ctx.Err())
		}
	}

	assertNoLifecycleAssignmentToUser(t, ctx, database, fixture, resources, fixture.sourceUserID)
}

func openUserLifecycleTestDatabase(t *testing.T) (*dbpkg.Postgres, context.Context) {
	t.Helper()
	if os.Getenv("VIMOB_RUN_USER_LIFECYCLE_DB_TESTS") != localUserLifecycleTestGuard {
		t.Skip("set VIMOB_RUN_USER_LIFECYCLE_DB_TESTS=LOCAL_WRITE_TEST for the local lifecycle regression")
	}

	databaseURL := strings.TrimSpace(os.Getenv("USER_LIFECYCLE_TEST_DATABASE_URL"))
	target, err := url.Parse(databaseURL)
	if err != nil ||
		(target.Hostname() != "127.0.0.1" && target.Hostname() != "localhost") ||
		target.User == nil || target.User.Username() != "postgres" ||
		target.Path != "/postgres" {
		t.Fatal("user lifecycle integration test requires the local postgres database")
	}

	ctx, cancel := context.WithTimeout(t.Context(), 45*time.Second)
	t.Cleanup(cancel)
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:           databaseURL,
		MaxConns:      8,
		HealthTimeout: 3 * time.Second,
	})
	if err != nil {
		t.Fatalf("open user lifecycle database: %v", err)
	}
	t.Cleanup(database.Close)
	return database, ctx
}

func createUserLifecycleFixture(t *testing.T, ctx context.Context, database *dbpkg.Postgres) userLifecycleFixture {
	t.Helper()
	fixture := userLifecycleFixture{
		organizationID: lifecycleUUID(t),
		actorUserID:    lifecycleUUID(t),
		sourceUserID:   lifecycleUUID(t),
		targetUserID:   lifecycleUUID(t),
		emptyUserID:    lifecycleUUID(t),
	}
	fixture.userIDs = []string{
		fixture.actorUserID,
		fixture.sourceUserID,
		fixture.targetUserID,
		fixture.emptyUserID,
	}
	t.Cleanup(func() {
		cleanupUserLifecycleFixture(t, database, fixture)
	})

	if _, err := database.Pool().Exec(ctx, `
		insert into public.organizations (id, name, subscription_status, is_active)
		values ($1::uuid, $2, 'active', true)
	`, fixture.organizationID, "User lifecycle integration "+fixture.organizationID); err != nil {
		t.Fatalf("insert lifecycle organization: %v", err)
	}

	roles := []string{"admin", "user", "user", "user"}
	memberRoles := []string{"owner", "user", "user", "user"}
	for index, userID := range fixture.userIDs {
		email := fmt.Sprintf("user-lifecycle-%s@example.test", userID)
		name := fmt.Sprintf("Lifecycle user %d", index+1)
		if _, err := database.Pool().Exec(ctx, `
			insert into auth.users (
				id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
				created_at, updated_at
			)
			values (
				$1::uuid, 'authenticated', 'authenticated', $2,
				'{}'::jsonb, jsonb_build_object('name', $3::text), now(), now()
			)
		`, userID, email, name); err != nil {
			t.Fatalf("insert auth user %s: %v", userID, err)
		}
		if _, err := database.Pool().Exec(ctx, `
			update public.users
			set organization_id = $2::uuid,
			    role = $3,
			    is_active = true,
			    updated_at = now()
			where id = $1::uuid
		`, userID, fixture.organizationID, roles[index]); err != nil {
			t.Fatalf("configure public user %s: %v", userID, err)
		}
		if _, err := database.Pool().Exec(ctx, `
			insert into public.organization_members (
				organization_id, user_id, role, is_active, deleted_at
			)
			values ($1::uuid, $2::uuid, $3, true, null)
			on conflict (user_id, organization_id)
			do update set
				role = excluded.role,
				is_active = true,
				deleted_at = null,
				updated_at = now()
		`, fixture.organizationID, userID, memberRoles[index]); err != nil {
			t.Fatalf("insert organization membership %s: %v", userID, err)
		}
	}

	return fixture
}

func createUserLifecycleResources(
	t *testing.T,
	ctx context.Context,
	database *dbpkg.Postgres,
	fixture userLifecycleFixture,
) userLifecycleResources {
	t.Helper()
	resources := userLifecycleResources{}
	for index := 0; index < 2; index++ {
		var leadID string
		if err := database.Pool().QueryRow(ctx, `
			insert into public.leads (
				organization_id, assigned_user_id, name, source, deal_status, metadata
			)
			values ($1::uuid, $2::uuid, $3, 'manual', 'open', $4::jsonb)
			returning id::text
		`,
			fixture.organizationID,
			fixture.sourceUserID,
			fmt.Sprintf("Lifecycle lead %d", index+1),
			fmt.Sprintf(`{"user_lifecycle_test":%q}`, fixture.organizationID),
		).Scan(&leadID); err != nil {
			t.Fatalf("insert lifecycle lead: %v", err)
		}
		resources.leadIDs = append(resources.leadIDs, leadID)
	}

	propertyInputs := []struct {
		responsibleUserID *string
		createdByUserID   string
		legacyUserID      string
		brokerUserID      *string
	}{
		{&fixture.sourceUserID, fixture.sourceUserID, fixture.sourceUserID, &fixture.sourceUserID},
		{&fixture.targetUserID, fixture.targetUserID, fixture.targetUserID, &fixture.sourceUserID},
		{nil, fixture.sourceUserID, fixture.sourceUserID, nil},
		{&fixture.targetUserID, fixture.targetUserID, fixture.sourceUserID, nil},
	}
	for index, input := range propertyInputs {
		var propertyID string
		if err := database.Pool().QueryRow(ctx, `
			insert into public.properties (
				organization_id, code, title, tipo_de_imovel, tipo_de_negocio,
				status, responsible_user_id, created_by, cadastrado_por, corretor_id
			)
			values (
				$1::uuid, $2, $3, 'Apartamento', 'Venda', 'active',
				$4::uuid, $5::uuid, $6, $7::uuid
			)
			returning id::text
		`,
			fixture.organizationID,
			fmt.Sprintf("LIFECYCLE-%d-%s", index+1, fixture.organizationID),
			fmt.Sprintf("Lifecycle property %d", index+1),
			input.responsibleUserID,
			input.createdByUserID,
			input.legacyUserID,
			input.brokerUserID,
		).Scan(&propertyID); err != nil {
			t.Fatalf("insert lifecycle property %d: %v", index+1, err)
		}
		resources.propertyIDs = append(resources.propertyIDs, propertyID)
	}

	if err := database.Pool().QueryRow(ctx, `
		insert into public.whatsapp_sessions (
			organization_id, owner_user_id, instance_name, status, is_active
		)
		values ($1::uuid, $2::uuid, $3, 'connected', true)
		returning id::text
	`, fixture.organizationID, fixture.sourceUserID, "lifecycle-"+fixture.organizationID).Scan(&resources.sessionID); err != nil {
		t.Fatalf("insert lifecycle WhatsApp session: %v", err)
	}

	return resources
}

func createConcurrentAssignmentResources(
	t *testing.T,
	ctx context.Context,
	database *dbpkg.Postgres,
	fixture userLifecycleFixture,
) userLifecycleResources {
	t.Helper()
	resources := userLifecycleResources{}
	var leadID string
	if err := database.Pool().QueryRow(ctx, `
		insert into public.leads (
			organization_id, assigned_user_id, name, source, deal_status, metadata
		)
		values ($1::uuid, $2::uuid, 'Concurrent lifecycle lead', 'manual', 'open', '{}'::jsonb)
		returning id::text
	`, fixture.organizationID, fixture.targetUserID).Scan(&leadID); err != nil {
		t.Fatalf("insert concurrent lead: %v", err)
	}
	resources.leadIDs = []string{leadID}

	var propertyID string
	if err := database.Pool().QueryRow(ctx, `
		insert into public.properties (
			organization_id, code, title, tipo_de_imovel, tipo_de_negocio,
			status, responsible_user_id, created_by, cadastrado_por, corretor_id
		)
		values (
			$1::uuid, $2, 'Concurrent lifecycle property', 'Apartamento', 'Venda',
			'active', $3::uuid, $3::uuid, $3, $3::uuid
		)
		returning id::text
	`, fixture.organizationID, "LIFECYCLE-CONCURRENT-"+fixture.organizationID, fixture.targetUserID).Scan(&propertyID); err != nil {
		t.Fatalf("insert concurrent property: %v", err)
	}
	resources.propertyIDs = []string{propertyID}
	return resources
}

func assertMembershipState(
	t *testing.T,
	ctx context.Context,
	database *dbpkg.Postgres,
	fixture userLifecycleFixture,
	wantActive bool,
	wantDeleted bool,
) {
	t.Helper()
	var active bool
	var deleted bool
	if err := database.Pool().QueryRow(ctx, `
		select is_active, deleted_at is not null
		from public.organization_members
		where organization_id = $1::uuid
		  and user_id = $2::uuid
	`, fixture.organizationID, fixture.sourceUserID).Scan(&active, &deleted); err != nil {
		t.Fatalf("read membership state: %v", err)
	}
	if active != wantActive || deleted != wantDeleted {
		t.Fatalf("membership active=%t deleted=%t, want active=%t deleted=%t", active, deleted, wantActive, wantDeleted)
	}
}

func assertUserListState(
	t *testing.T,
	ctx context.Context,
	repository Repository,
	actorContext tenant.Context,
	userID string,
	wantActiveList bool,
	wantManagementList bool,
) {
	t.Helper()
	activeUsers, err := repository.ListOrganizationUsers(ctx, actorContext, OrganizationUserListActive)
	if err != nil {
		t.Fatalf("list active users: %v", err)
	}
	managementUsers, err := repository.ListOrganizationUsers(ctx, actorContext, OrganizationUserListManagement)
	if err != nil {
		t.Fatalf("list management users: %v", err)
	}
	if containsLifecycleUser(activeUsers, userID) != wantActiveList {
		t.Fatalf("active list presence = %t, want %t", containsLifecycleUser(activeUsers, userID), wantActiveList)
	}
	if containsLifecycleUser(managementUsers, userID) != wantManagementList {
		t.Fatalf("management list presence = %t, want %t", containsLifecycleUser(managementUsers, userID), wantManagementList)
	}
}

func assertLifecycleResourcesUnchanged(
	t *testing.T,
	ctx context.Context,
	database *dbpkg.Postgres,
	fixture userLifecycleFixture,
	resources userLifecycleResources,
) {
	t.Helper()
	var mismatchedLeads int
	if err := database.Pool().QueryRow(ctx, `
		select count(*)
		from public.leads
		where organization_id = $1::uuid
		  and id::text = any($2::text[])
		  and assigned_user_id is distinct from $3::uuid
	`, fixture.organizationID, resources.leadIDs, fixture.sourceUserID).Scan(&mismatchedLeads); err != nil {
		t.Fatalf("read lifecycle lead assignments after rollback: %v", err)
	}
	if mismatchedLeads != 0 {
		t.Fatalf("%d lifecycle leads changed despite deletion rollback", mismatchedLeads)
	}

	var unchangedProperties int
	if err := database.Pool().QueryRow(ctx, `
		select count(*)
		from public.properties
		where organization_id = $1::uuid
		  and id::text = any($2::text[])
		  and (
		    responsible_user_id = $3::uuid
		    or corretor_id = $3::uuid
		    or nullif(btrim(cadastrado_por), '') = $3
		    or (responsible_user_id is null and created_by = $3::uuid)
		  )
	`, fixture.organizationID, resources.propertyIDs, fixture.sourceUserID).Scan(&unchangedProperties); err != nil {
		t.Fatalf("read lifecycle property assignments after rollback: %v", err)
	}
	if unchangedProperties != len(resources.propertyIDs) {
		t.Fatalf("properties retaining source references = %d, want %d after rollback", unchangedProperties, len(resources.propertyIDs))
	}
	assertLifecycleWhatsAppSession(t, ctx, database, resources.sessionID, "connected", true)
}

func assertLifecycleResourcesTransferred(
	t *testing.T,
	ctx context.Context,
	database *dbpkg.Postgres,
	fixture userLifecycleFixture,
	resources userLifecycleResources,
) {
	t.Helper()
	assertNoLifecycleAssignmentToUser(t, ctx, database, fixture, resources, fixture.sourceUserID)

	var targetResponsible int
	var targetLegacy int
	var targetBroker int
	if err := database.Pool().QueryRow(ctx, `
		select
			count(*) filter (where responsible_user_id = $3::uuid),
			count(*) filter (where nullif(btrim(cadastrado_por), '') = $3),
			count(*) filter (where corretor_id = $3::uuid)
		from public.properties
		where organization_id = $1::uuid
		  and id::text = any($2::text[])
	`, fixture.organizationID, resources.propertyIDs, fixture.targetUserID).Scan(
		&targetResponsible,
		&targetLegacy,
		&targetBroker,
	); err != nil {
		t.Fatalf("read transferred lifecycle properties: %v", err)
	}
	if targetResponsible != 4 || targetLegacy != 4 || targetBroker != 2 {
		t.Fatalf(
			"transferred property refs responsible=%d legacy=%d broker=%d, want 4/4/2",
			targetResponsible,
			targetLegacy,
			targetBroker,
		)
	}
	assertLifecycleWhatsAppSession(t, ctx, database, resources.sessionID, "disconnected", false)
}

func assertNoLifecycleAssignmentToUser(
	t *testing.T,
	ctx context.Context,
	database *dbpkg.Postgres,
	fixture userLifecycleFixture,
	resources userLifecycleResources,
	userID string,
) {
	t.Helper()
	var leadCount int
	if err := database.Pool().QueryRow(ctx, `
		select count(*)
		from public.leads
		where organization_id = $1::uuid
		  and id::text = any($2::text[])
		  and assigned_user_id = $3::uuid
	`, fixture.organizationID, resources.leadIDs, userID).Scan(&leadCount); err != nil {
		t.Fatalf("read lifecycle lead assignments: %v", err)
	}
	if leadCount != 0 {
		t.Fatalf("%d lifecycle leads remain assigned to %s", leadCount, userID)
	}

	var propertyCount int
	if err := database.Pool().QueryRow(ctx, `
		select count(*)
		from public.properties
		where organization_id = $1::uuid
		  and id::text = any($2::text[])
		  and (
		    responsible_user_id = $3::uuid
		    or corretor_id = $3::uuid
		    or nullif(btrim(cadastrado_por), '') = $3
		    or (responsible_user_id is null and created_by = $3::uuid)
		  )
	`, fixture.organizationID, resources.propertyIDs, userID).Scan(&propertyCount); err != nil {
		t.Fatalf("read lifecycle property assignments: %v", err)
	}
	if propertyCount != 0 {
		t.Fatalf("%d lifecycle properties retain mutable responsibility for %s", propertyCount, userID)
	}
}

func assertLifecycleWhatsAppSession(
	t *testing.T,
	ctx context.Context,
	database *dbpkg.Postgres,
	sessionID string,
	wantStatus string,
	wantActive bool,
) {
	t.Helper()
	if sessionID == "" {
		return
	}
	var status string
	var active bool
	if err := database.Pool().QueryRow(ctx, `
		select status, coalesce(is_active, false)
		from public.whatsapp_sessions
		where id = $1::uuid
	`, sessionID).Scan(&status, &active); err != nil {
		t.Fatalf("read lifecycle WhatsApp session: %v", err)
	}
	if status != wantStatus || active != wantActive {
		t.Fatalf("WhatsApp session status=%q active=%t, want %q/%t", status, active, wantStatus, wantActive)
	}
}

func containsLifecycleUser(users []User, userID string) bool {
	for _, user := range users {
		if user.ID == userID {
			return true
		}
	}
	return false
}

func lifecycleActorContext(fixture userLifecycleFixture) tenant.Context {
	return tenant.Context{
		OrganizationID: fixture.organizationID,
		UserID:         fixture.actorUserID,
		MemberRole:     "owner",
		Permissions: []string{
			permissions.UsersManage,
			permissions.PermissionsManage,
		},
	}
}

func cleanupUserLifecycleFixture(t *testing.T, database *dbpkg.Postgres, fixture userLifecycleFixture) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if _, err := database.Pool().Exec(ctx, `
		update public.users
		set organization_id = null
		where id::text = any($1::text[])
	`, fixture.userIDs); err != nil {
		t.Logf("clear lifecycle users' organization: %v", err)
	}
	if _, err := database.Pool().Exec(ctx, `
		delete from public.organizations
		where id = $1::uuid
	`, fixture.organizationID); err != nil {
		t.Logf("delete lifecycle organization: %v", err)
	}
	if _, err := database.Pool().Exec(ctx, `
		delete from public.users
		where id::text = any($1::text[])
	`, fixture.userIDs); err != nil {
		t.Logf("delete lifecycle public users: %v", err)
	}
	if _, err := database.Pool().Exec(ctx, `
		delete from auth.users
		where id::text = any($1::text[])
	`, fixture.userIDs); err != nil {
		t.Logf("delete lifecycle auth users: %v", err)
	}
}

func lifecycleUUID(t *testing.T) string {
	t.Helper()
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		t.Fatalf("generate lifecycle UUID: %v", err)
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf(
		"%08x-%04x-%04x-%04x-%012x",
		value[0:4],
		value[4:6],
		value[6:8],
		value[8:10],
		value[10:16],
	)
}
