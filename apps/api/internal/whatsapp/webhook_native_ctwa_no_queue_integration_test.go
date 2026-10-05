package whatsapp

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestNativeCTWAWithoutCanonicalQueueCreatesLeadForOwner(t *testing.T) {
	databaseURL := os.Getenv("WHATSAPP_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}
	parsedURL, err := url.Parse(databaseURL)
	if err != nil || (parsedURL.Hostname() != "127.0.0.1" && parsedURL.Hostname() != "localhost") || os.Getenv("WHATSAPP_TEST_ISOLATED") != "1" {
		t.Fatal("CTWA integration test requires an isolated loopback database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer postgres.Close()
	tx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())

	fixtureName := fmt.Sprintf("ctwa-no-queue-%d", time.Now().UnixNano())
	var organizationID, userID, sessionID string
	if err := tx.QueryRow(ctx, `
		insert into public.organizations (name, slug) values ($1, $1) returning id::text
	`, fixtureName).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `
		insert into auth.users (
			id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		) values ($1::uuid, 'authenticated', 'authenticated', $2, '', now(), '{}'::jsonb, '{}'::jsonb, now(), now())
	`, userID, fixtureName+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `
		insert into public.users (id, organization_id, name, email, role, is_active)
		values ($1::uuid, $2::uuid, $3, $4, 'user', true)
		on conflict (id) do update
		set organization_id = excluded.organization_id,
		    name = excluded.name, email = excluded.email,
		    role = excluded.role, is_active = excluded.is_active
	`, userID, organizationID, fixtureName, fixtureName+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `
		insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($1::uuid, $2::uuid, 'user', true)
		on conflict (user_id, organization_id) do update
		set role = excluded.role, is_active = excluded.is_active, deleted_at = null
	`, organizationID, userID); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `
		insert into public.whatsapp_sessions (
			organization_id, instance_name, instance_id, owner_user_id,
			provider, status, is_active, advanced_settings
		) values ($1::uuid, $2, $2, $3::uuid, 'evolution_go', 'connected', true, '{}'::jsonb)
		returning id::text
	`, organizationID, fixtureName, userID).Scan(&sessionID); err != nil {
		t.Fatal(err)
	}

	messages := extractNativeEvolutionMessages(decodeNativeFixture(t, "meta_ctwa_instagram.json"))
	if len(messages) != 1 || !messages[0].IsCTWAAd {
		t.Fatalf("expected one confirmed CTWA message, got %#v", messages)
	}
	conversation, err := ensureNativeEvolutionConversation(
		ctx, tx,
		nativeEvolutionSession{ID: sessionID, OrganizationID: organizationID, OwnerUserID: userID},
		messages[0], nativeInboundRule{CanonicalIntakeResolved: true},
		nativeEvolutionStoredMessageIdentity{}, nil,
	)
	if err != nil {
		t.Fatalf("confirmed CTWA without canonical queue: %v", err)
	}
	if conversation.ID == "" || conversation.LeadID == "" {
		t.Fatalf("confirmed CTWA did not create a lead and conversation: %#v", conversation)
	}
	var assignedUserID string
	if err := tx.QueryRow(ctx, `
		select coalesce(assigned_user_id::text, '')
		from public.leads where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, conversation.LeadID).Scan(&assignedUserID); err != nil {
		t.Fatal(err)
	}
	if assignedUserID != userID {
		t.Fatalf("confirmed CTWA assigned to %q, want session owner %q", assignedUserID, userID)
	}
}
