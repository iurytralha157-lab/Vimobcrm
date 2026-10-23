package admin

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// ADMIN_INVITATION_TEST_DATABASE_URL must point to a loopback PostgreSQL
// server with CREATE DATABASE privilege. This test creates and drops its own
// isolated database; it never modifies the database named in the URL.
func TestInvitationActivationPreservesSuspensionAcrossOrganizations(t *testing.T) {
	serverURL := strings.TrimSpace(os.Getenv("ADMIN_INVITATION_TEST_DATABASE_URL"))
	if serverURL == "" {
		t.Skip("set ADMIN_INVITATION_TEST_DATABASE_URL to run the disposable PostgreSQL activation contract")
	}
	parsedURL, err := url.Parse(serverURL)
	if err != nil {
		t.Fatalf("parse PostgreSQL URL: %v", err)
	}
	if parsedURL.Scheme != "postgres" && parsedURL.Scheme != "postgresql" {
		t.Fatal("invitation activation test requires a PostgreSQL URL")
	}
	switch parsedURL.Hostname() {
	case "127.0.0.1", "localhost", "::1":
	default:
		t.Fatal("invitation activation test requires a loopback PostgreSQL server")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	adminConnection, err := pgx.Connect(ctx, serverURL)
	if err != nil {
		t.Fatalf("connect disposable PostgreSQL server: %v", err)
	}
	var suffix [6]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		adminConnection.Close(ctx)
		t.Fatalf("generate test database name: %v", err)
	}
	databaseName := "vimob_invitation_test_" + hex.EncodeToString(suffix[:])
	quotedName := pgx.Identifier{databaseName}.Sanitize()
	if _, err := adminConnection.Exec(ctx, "create database "+quotedName); err != nil {
		adminConnection.Close(ctx)
		t.Fatalf("create isolated invitation test database: %v", err)
	}
	parsedURL.Path = "/" + databaseName
	var database *dbpkg.Postgres
	t.Cleanup(func() {
		if database != nil {
			database.Close()
		}
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		if _, dropErr := adminConnection.Exec(cleanupCtx, "drop database "+quotedName); dropErr != nil {
			t.Errorf("drop isolated invitation test database: %v", dropErr)
		}
		if closeErr := adminConnection.Close(cleanupCtx); closeErr != nil {
			t.Errorf("close PostgreSQL admin connection: %v", closeErr)
		}
	})

	database, err = dbpkg.NewPostgres(ctx, dbpkg.Config{URL: parsedURL.String(), MaxConns: 4, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatalf("connect isolated invitation test database: %v", err)
	}
	for _, statement := range []string{
		"create schema auth",
		`create table auth.users (
			id uuid primary key,
			email text not null,
			deleted_at timestamptz,
			raw_app_meta_data jsonb not null default '{}'::jsonb
		)`,
		`create table public.users (
			id uuid primary key,
			organization_id uuid,
			name text,
			email text,
			role text,
			whatsapp text,
			is_active boolean,
			updated_at timestamptz not null default now()
		)`,
		`create table public.invitations (
			id uuid primary key,
			token_hash text not null,
			role text,
			used_at timestamptz,
			expires_at timestamptz not null
		)`,
		`create table public.organization_members (
			organization_id uuid not null,
			user_id uuid not null,
			role text not null,
			is_active boolean not null,
			deleted_at timestamptz,
			updated_at timestamptz not null default now(),
			primary key (organization_id, user_id)
		)`,
		`create table public.user_organization_roles (
			organization_id uuid not null,
			user_id uuid not null references public.users(id) on delete cascade,
			is_active boolean not null default true,
			updated_at timestamptz not null default now()
		)`,
		`create table public.user_permission_overrides (
			organization_id uuid not null,
			user_id uuid not null,
			permission_key text not null,
			allowed boolean not null,
			primary key (organization_id, user_id, permission_key),
			foreign key (organization_id, user_id)
				references public.organization_members(organization_id, user_id) on delete cascade
		)`,
		`create table public.legal_consents (
			user_id uuid not null,
			organization_id uuid not null,
			terms_version text not null,
			privacy_version text not null,
			ip_address text,
			user_agent text,
			source text not null,
			metadata jsonb not null
		)`,
		`create function public.ensure_organization_membership() returns trigger
		language plpgsql as $$
		begin
			if new.organization_id is not null then
				insert into public.organization_members (user_id, organization_id, role, is_active)
				values (new.id, new.organization_id, coalesce(new.role, 'user'), true)
				on conflict (user_id, organization_id) do nothing;
			end if;
			return new;
		end;
		$$`,
		`create trigger trg_users_ensure_membership
		after insert or update of organization_id on public.users
		for each row execute function public.ensure_organization_membership()`,
	} {
		if _, err := database.Pool().Exec(ctx, statement); err != nil {
			t.Fatalf("prepare isolated invitation test schema: %v", err)
		}
	}

	const organizationA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
	const organizationB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
	const existingUser = "11111111-1111-1111-1111-111111111111"
	const unknownActivityUser = "77777777-7777-7777-7777-777777777777"
	const hardDeletedUser = "99999999-9999-9999-9999-999999999999"
	const provisionalUser = "22222222-2222-2222-2222-222222222222"
	const unownedUser = "55555555-5555-5555-5555-555555555555"
	const existingInvitationID = "33333333-3333-3333-3333-333333333333"
	const provisionalInvitationID = "44444444-4444-4444-4444-444444444444"
	const unownedInvitationID = "66666666-6666-6666-6666-666666666666"
	const activeMemberInvitationID = "88888888-8888-8888-8888-888888888888"
	const hardDeletedInvitationID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

	mustExec := func(query string, args ...any) {
		t.Helper()
		if _, err := database.Pool().Exec(ctx, query, args...); err != nil {
			t.Fatalf("prepare isolated invitation test data: %v", err)
		}
	}
	mustExec(`insert into public.users (id, organization_id, name, email, role, is_active)
		values ($1::uuid, $2::uuid, 'Existing', 'existing@example.com', 'admin', false)`, existingUser, organizationA)
	mustExec(`insert into public.users (id, organization_id, name, email, role, is_active)
		values ($1::uuid, $2::uuid, 'Unknown', 'unknown@example.com', 'user', null)`, unknownActivityUser, organizationA)
	mustExec(`insert into public.organization_members (organization_id, user_id, role, is_active, deleted_at)
		values ($1::uuid, $2::uuid, 'user', false, now())`, organizationB, existingUser)
	mustExec(`insert into public.user_organization_roles (organization_id, user_id)
		values ($1::uuid, $3::uuid), ($2::uuid, $3::uuid)`, organizationA, organizationB, existingUser)
	mustExec(`insert into public.user_permission_overrides (organization_id, user_id, permission_key, allowed)
		values ($1::uuid, $3::uuid, 'a.permission', true), ($2::uuid, $3::uuid, 'b.permission', true)`, organizationA, organizationB, existingUser)
	mustExec(`insert into public.invitations (id, token_hash, role, expires_at)
		values ($1::uuid, 'existing-token-hash', 'manager', now() + interval '1 day')`, existingInvitationID)

	repo := Repository{db: database}
	inactive, err := repo.invitationAccountInactive(ctx, invitationIdentity{
		UserID: unknownActivityUser,
		State:  invitationIdentityRequiresLogin,
	})
	if err != nil || !inactive {
		t.Fatalf("NULL activity invitation check = (%t, %v), want inactive without error", inactive, err)
	}
	consent := invitationLegalConsent{
		TermsVersion:    currentTermsVersion,
		PrivacyVersion:  currentPrivacyVersion,
		TermsAccepted:   true,
		PrivacyAccepted: true,
	}
	existingInvitation := invitationRecord{
		ID:             existingInvitationID,
		TokenHash:      "existing-token-hash",
		Email:          "existing@example.com",
		OrganizationID: organizationB,
	}
	err = repo.activateInvitationForUser(ctx, existingInvitation, existingUser, "Existing", nil, &consent, false)
	if !errors.Is(err, ErrInvitationAccountInactive) {
		t.Fatalf("suspended account invitation activation = %v, want ErrInvitationAccountInactive", err)
	}
	var active, invitationUsed, existingMembership, newMembership bool
	var profileOrganization string
	if err := database.Pool().QueryRow(ctx, `
		select is_active, organization_id::text
		from public.users where id = $1::uuid
	`, existingUser).Scan(&active, &profileOrganization); err != nil {
		t.Fatalf("read suspended profile: %v", err)
	}
	if active || profileOrganization != organizationA {
		t.Fatalf("suspended profile changed: active=%t organization=%s", active, profileOrganization)
	}
	if err := database.Pool().QueryRow(ctx, `
		select
			(select used_at is not null from public.invitations where id = $1::uuid),
			exists (select 1 from public.organization_members where organization_id = $2::uuid and user_id = $4::uuid and is_active),
			exists (select 1 from public.organization_members where organization_id = $3::uuid and user_id = $4::uuid and is_active)
	`, existingInvitationID, organizationA, organizationB, existingUser).Scan(&invitationUsed, &existingMembership, &newMembership); err != nil {
		t.Fatalf("read invitation and memberships after rejection: %v", err)
	}
	if invitationUsed || !existingMembership || newMembership {
		t.Fatalf("suspended acceptance changed invitation or memberships: used=%t memberA=%t memberB=%t", invitationUsed, existingMembership, newMembership)
	}
	assertGrants := func(orgID, userID string, wantRoleActive, wantOverride bool) {
		t.Helper()
		var roleActive, overrideExists bool
		if err := database.Pool().QueryRow(ctx, `
			select
			  exists (select 1 from public.user_organization_roles
			          where organization_id = $1::uuid and user_id = $2::uuid and is_active),
			  exists (select 1 from public.user_permission_overrides
			          where organization_id = $1::uuid and user_id = $2::uuid)
		`, orgID, userID).Scan(&roleActive, &overrideExists); err != nil {
			t.Fatalf("read legacy grants: %v", err)
		}
		if roleActive != wantRoleActive || overrideExists != wantOverride {
			t.Fatalf("legacy grants in %s for %s: role=%t override=%t; want role=%t override=%t",
				orgID, userID, roleActive, overrideExists, wantRoleActive, wantOverride)
		}
	}
	assertGrants(organizationB, existingUser, true, true) // rejection rolled back

	// Explicit reactivation permits a later acceptance, without moving the
	// user's existing organization or invalidating the prior membership.
	mustExec(`update public.users set is_active = true where id = $1::uuid`, existingUser)
	if err := repo.activateInvitationForUser(ctx, existingInvitation, existingUser, "Existing", nil, &consent, false); err != nil {
		t.Fatalf("active existing account acceptance: %v", err)
	}
	if err := database.Pool().QueryRow(ctx, `
		select
			(select used_at is not null from public.invitations where id = $1::uuid),
			exists (select 1 from public.organization_members where organization_id = $2::uuid and user_id = $4::uuid and is_active),
			exists (select 1 from public.organization_members where organization_id = $3::uuid and user_id = $4::uuid and is_active)
	`, existingInvitationID, organizationA, organizationB, existingUser).Scan(&invitationUsed, &existingMembership, &newMembership); err != nil {
		t.Fatalf("read memberships after valid acceptance: %v", err)
	}
	if !invitationUsed || !existingMembership || !newMembership {
		t.Fatalf("valid acceptance did not retain A and add B: used=%t memberA=%t memberB=%t", invitationUsed, existingMembership, newMembership)
	}
	var memberRole string
	var profileRole string
	if err := database.Pool().QueryRow(ctx, `select role from public.users where id = $1::uuid`, existingUser).Scan(&profileRole); err != nil || profileRole != "admin" {
		t.Fatalf("cross-tenant profile role = %q, error = %v, want preserved admin", profileRole, err)
	}
	var removedAt *time.Time
	if err := database.Pool().QueryRow(ctx, `
		select role, deleted_at from public.organization_members
		where organization_id = $1::uuid and user_id = $2::uuid
	`, organizationB, existingUser).Scan(&memberRole, &removedAt); err != nil {
		t.Fatalf("read restored member role: %v", err)
	}
	if memberRole != "manager" || removedAt != nil {
		t.Fatalf("restored member role = %q deleted_at = %v, want manager and no tombstone", memberRole, removedAt)
	}
	assertGrants(organizationB, existingUser, false, false)
	assertGrants(organizationA, existingUser, true, true)

	// Accepting a later token must not silently promote an already active member.
	mustExec(`update public.user_organization_roles set is_active = true
		where organization_id = $1::uuid and user_id = $2::uuid`, organizationB, existingUser)
	mustExec(`insert into public.user_permission_overrides (organization_id, user_id, permission_key, allowed)
		values ($1::uuid, $2::uuid, 'b.active-member', true)`, organizationB, existingUser)
	mustExec(`insert into public.invitations (id, token_hash, role, expires_at)
		values ($1::uuid, 'active-member-token-hash', 'admin', now() + interval '1 day')`, activeMemberInvitationID)
	if err := repo.activateInvitationForUser(ctx, invitationRecord{
		ID: activeMemberInvitationID, TokenHash: "active-member-token-hash",
		Email: "existing@example.com", OrganizationID: organizationB,
	}, existingUser, "Existing", nil, &consent, false); err != nil {
		t.Fatalf("active member acceptance: %v", err)
	}
	if err := database.Pool().QueryRow(ctx, `
		select role from public.organization_members
		where organization_id = $1::uuid and user_id = $2::uuid
	`, organizationB, existingUser).Scan(&memberRole); err != nil || memberRole != "manager" {
		t.Fatalf("active member role = %q, error = %v, want preserved manager", memberRole, err)
	}
	assertGrants(organizationB, existingUser, true, true)

	// A hard-deleted membership cascades its overrides in the current schema,
	// but the custom role has no membership FK and survives until acceptance.
	mustExec(`insert into public.users (id, organization_id, name, email, role, is_active)
		values ($1::uuid, $2::uuid, 'Hard Deleted', 'hard-deleted@example.com', 'user', true)`, hardDeletedUser, organizationA)
	mustExec(`insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($1::uuid, $2::uuid, 'user', true)`, organizationB, hardDeletedUser)
	mustExec(`insert into public.user_organization_roles (organization_id, user_id)
		values ($1::uuid, $2::uuid)`, organizationB, hardDeletedUser)
	mustExec(`insert into public.user_permission_overrides (organization_id, user_id, permission_key, allowed)
		values ($1::uuid, $2::uuid, 'b.deleted-member', true)`, organizationB, hardDeletedUser)
	mustExec(`delete from public.organization_members
		where organization_id = $1::uuid and user_id = $2::uuid`, organizationB, hardDeletedUser)
	assertGrants(organizationB, hardDeletedUser, true, false)
	mustExec(`insert into public.invitations (id, token_hash, role, expires_at)
		values ($1::uuid, 'hard-deleted-token-hash', 'manager', now() + interval '1 day')`, hardDeletedInvitationID)
	if err := repo.activateInvitationForUser(ctx, invitationRecord{
		ID: hardDeletedInvitationID, TokenHash: "hard-deleted-token-hash",
		Email: "hard-deleted@example.com", OrganizationID: organizationB,
	}, hardDeletedUser, "Hard Deleted", nil, &consent, false); err != nil {
		t.Fatalf("hard-deleted member acceptance: %v", err)
	}
	assertGrants(organizationB, hardDeletedUser, false, false)

	mustExec(`insert into auth.users (id, email, raw_app_meta_data)
		values ($1::uuid, 'new@example.com', jsonb_build_object('provisioning_source', 'admin_invitation', 'invitation_id', $2))`, provisionalUser, provisionalInvitationID)
	mustExec(`insert into public.users (id, name, email, role, is_active)
		values ($1::uuid, 'New', 'new@example.com', 'user', false)`, provisionalUser)
	mustExec(`insert into public.invitations (id, token_hash, role, expires_at)
		values ($1::uuid, 'provisional-token-hash', 'admin', now() + interval '1 day')`, provisionalInvitationID)
	provisionalInvitation := invitationRecord{
		ID:             provisionalInvitationID,
		TokenHash:      "provisional-token-hash",
		Email:          "new@example.com",
		OrganizationID: organizationB,
	}
	if err := repo.activateInvitationForUser(ctx, provisionalInvitation, provisionalUser, "New", nil, &consent, true); err != nil {
		t.Fatalf("invitation-owned provisional account acceptance: %v", err)
	}
	if err := database.Pool().QueryRow(ctx, `select is_active, organization_id::text, role from public.users where id = $1::uuid`, provisionalUser).Scan(&active, &profileOrganization, &profileRole); err != nil {
		t.Fatalf("read activated provisional profile: %v", err)
	}
	if !active || profileOrganization != organizationB || profileRole != "admin" {
		t.Fatalf("provisional profile did not activate as admin in B: active=%t organization=%s role=%s", active, profileOrganization, profileRole)
	}
	if err := database.Pool().QueryRow(ctx, `
		select role from public.organization_members
		where organization_id = $1::uuid and user_id = $2::uuid
	`, organizationB, provisionalUser).Scan(&memberRole); err != nil || memberRole != "admin" {
		t.Fatalf("new invited member role = %q, error = %v, want admin despite profile trigger", memberRole, err)
	}

	// The provisional exception is limited to the Auth identity marked for
	// this exact invitation. A caller cannot bypass the inactive guard by
	// merely asking for the invitation-owned activation path.
	mustExec(`insert into auth.users (id, email, raw_app_meta_data)
		values ($1::uuid, 'unowned@example.com', '{}'::jsonb)`, unownedUser)
	mustExec(`insert into public.users (id, name, email, role, is_active)
		values ($1::uuid, 'Unowned', 'unowned@example.com', 'user', false)`, unownedUser)
	mustExec(`insert into public.invitations (id, token_hash, role, expires_at)
		values ($1::uuid, 'unowned-token-hash', 'user', now() + interval '1 day')`, unownedInvitationID)
	unownedInvitation := invitationRecord{
		ID:             unownedInvitationID,
		TokenHash:      "unowned-token-hash",
		Email:          "unowned@example.com",
		OrganizationID: organizationB,
	}
	if err := repo.activateInvitationForUser(ctx, unownedInvitation, unownedUser, "Unowned", nil, &consent, true); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("unowned provisional activation error = %v, want ErrInvalidInput", err)
	}
	if err := database.Pool().QueryRow(ctx, `select is_active from public.users where id = $1::uuid`, unownedUser).Scan(&active); err != nil {
		t.Fatalf("read unowned profile: %v", err)
	}
	if active {
		t.Fatal("unowned provisional profile was activated")
	}
}
