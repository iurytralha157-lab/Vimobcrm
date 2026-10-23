package whatsapp

import (
	"context"
	"fmt"
	"testing"
	"time"
)

// The shared harness verifies the dedicated native cluster/container identity,
// exact loopback endpoint and database before this fixture performs any write.
func TestSessionGrantRejectsPreviousMembershipGeneration(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	postgres := openLocalOutboundDatabase(t, ctx)
	tx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	var organizationID, leaderID, recipientID, teamID, sessionID string
	if err := tx.QueryRow(ctx, `select gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text`).Scan(
		&organizationID, &leaderID, &recipientID, &teamID, &sessionID,
	); err != nil {
		t.Fatal(err)
	}
	suffix := fmt.Sprintf("membership-generation-%d", time.Now().UnixNano())
	mustExec := func(query string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	mustExec(`insert into public.organizations (id, name, slug) values ($1::uuid, $2, $2)`, organizationID, suffix)
	for _, actor := range []struct{ id, name string }{{leaderID, "Leader"}, {recipientID, "Recipient"}} {
		email := suffix + "-" + actor.name + "@example.invalid"
		mustExec(`insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
			values ($1::uuid, 'authenticated', 'authenticated', $2, '', now(), '{}'::jsonb, '{}'::jsonb, now(), now())`, actor.id, email)
		mustExec(`insert into public.users (id, organization_id, name, email, role, is_active)
			values ($1::uuid, $2::uuid, $3, $4, 'user', true)
			on conflict (id) do update set organization_id = excluded.organization_id,
			name = excluded.name, email = excluded.email, role = excluded.role, is_active = excluded.is_active`,
			actor.id, organizationID, actor.name, email)
		role := "user"
		if actor.id == leaderID {
			role = "admin"
		}
		mustExec(`insert into public.organization_members (organization_id, user_id, role, is_active)
			values ($1::uuid, $2::uuid, $3, true)
			on conflict (user_id, organization_id) do update set role = excluded.role,
			is_active = excluded.is_active, deleted_at = null`, organizationID, actor.id, role)
	}
	mustExec(`insert into public.teams (id, organization_id, name, is_active) values ($1::uuid, $2::uuid, $3, true)`, teamID, organizationID, suffix)
	mustExec(`insert into public.team_members (team_id, organization_id, user_id, is_leader, is_active)
		values ($1::uuid, $2::uuid, $3::uuid, true, true), ($1::uuid, $2::uuid, $4::uuid, false, true)`,
		teamID, organizationID, leaderID, recipientID)
	mustExec(`insert into public.whatsapp_sessions (id, organization_id, instance_name, instance_id,
		owner_user_id, provider, status, is_active, advanced_settings)
		values ($1::uuid, $2::uuid, $3, $3, $4::uuid, 'evolution_go', 'connected', true, '{}'::jsonb)`,
		sessionID, organizationID, suffix, leaderID)
	grant := func(scope string) string {
		t.Helper()
		var grantID string
		err := tx.QueryRow(ctx, `insert into public.whatsapp_session_access (organization_id, session_id, user_id,
			can_view, can_read, can_send, only_leads_access, access_mode, granted_by, grant_scope, grant_team_id)
			values ($1::uuid, $2::uuid, $3::uuid, true, true, true, true, 'assigned_leads_only',
			$4::uuid, $6, case when $6='team' then $5::uuid else null end)
			on conflict (session_id, user_id) do update set granted_by = excluded.granted_by,
			grant_scope = excluded.grant_scope, grant_team_id = excluded.grant_team_id returning id::text`,
			organizationID, sessionID, recipientID, leaderID, teamID, scope).Scan(&grantID)
		if err != nil {
			t.Fatal(err)
		}
		return grantID
	}
	assertGrant := func(want bool) {
		t.Helper()
		var valid bool
		err := tx.QueryRow(ctx, `select `+sessionGrantExistsSQL("ws", "$2::uuid", true)+`
			from public.whatsapp_sessions ws where ws.id = $1::uuid and ws.organization_id = $3::uuid`,
			sessionID, recipientID, organizationID).Scan(&valid)
		if err != nil || valid != want {
			t.Fatalf("session grant valid = %v, want %v: %v", valid, want, err)
		}
	}
	// A retained legacy team grant must stay denied under the current admin-only
	// organization contract, even while its team participants remain active.
	grant("team")
	assertGrant(false)
	currentGrantID := grant("organization")
	assertGrant(true)
	for _, userID := range []string{recipientID, leaderID} {
		mustExec(`update public.organization_members set deleted_at = now() where organization_id = $1::uuid and user_id = $2::uuid`, organizationID, userID)
		assertGrant(false)
		mustExec(`update public.organization_members set deleted_at = null where organization_id = $1::uuid and user_id = $2::uuid`, organizationID, userID)
		// Restoring membership does not restore the grant issued in its old term.
		assertGrant(false)
		var retained int
		if err := tx.QueryRow(ctx, `select count(*) from public.whatsapp_session_access where id=$1::uuid`, currentGrantID).Scan(&retained); err != nil || retained != 0 {
			t.Fatalf("previous membership grant survived removal/restoration: count=%d error=%v", retained, err)
		}
		newGrantID := grant("organization")
		if newGrantID == currentGrantID {
			t.Fatal("explicit regrant reused the previous immutable grant identity")
		}
		currentGrantID = newGrantID
		assertGrant(true)
	}
}
