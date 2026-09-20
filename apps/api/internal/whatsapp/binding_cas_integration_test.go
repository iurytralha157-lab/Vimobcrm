package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestWhatsAppManualBindingCompareAndSwap(t *testing.T) {
	databaseURL := os.Getenv("WHATSAPP_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)

	suffix := fmt.Sprintf("wa-binding-cas-%d", time.Now().UnixNano())
	phone := fmt.Sprintf("55119%08d", time.Now().UnixNano()%100_000_000)
	var organizationID, userID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.organizations (name, slug)
		values ($1, $1)
		returning id::text
	`, suffix).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from public.organizations where id = $1::uuid`, organizationID)
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from public.users where id = $1::uuid`, userID)
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from auth.users where id = $1::uuid`, userID)
	})

	if _, err := postgres.Pool().Exec(ctx, `
		insert into auth.users (
			id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		) values (
			$1::uuid, 'authenticated', 'authenticated', $2, '', now(),
			'{}'::jsonb, '{}'::jsonb, now(), now()
		)
	`, userID, suffix+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.users (id, organization_id, name, email, role, is_active)
		values ($1::uuid, $2::uuid, $3, $4, 'admin', true)
		on conflict (id) do update
		set organization_id = excluded.organization_id,
		    name = excluded.name,
		    email = excluded.email,
		    role = excluded.role,
		    is_active = excluded.is_active
	`, userID, organizationID, suffix, suffix+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($2::uuid, $1::uuid, 'admin', true)
		on conflict (user_id, organization_id) do update
		set role = excluded.role,
		    is_active = excluded.is_active
	`, userID, organizationID); err != nil {
		t.Fatal(err)
	}

	queueIDs := make([]string, 3)
	for index := range queueIDs {
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.round_robins (organization_id, name, is_active)
			values ($1::uuid, $2, true)
			returning id::text
		`, organizationID, fmt.Sprintf("%s-queue-%d", suffix, index)).Scan(&queueIDs[index]); err != nil {
			t.Fatal(err)
		}
	}

	leadIDs := make([]string, 3)
	for index := range leadIDs {
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.leads (
				organization_id, origin_round_robin_id, assigned_user_id,
				name, phone, source
			) values ($1::uuid, $2::uuid, $3::uuid, $4, $5, 'whatsapp')
			returning id::text
		`, organizationID, queueIDs[index], userID, fmt.Sprintf("%s-lead-%d", suffix, index), phone).Scan(&leadIDs[index]); err != nil {
			t.Fatal(err)
		}
	}

	sessionIDs := make([]string, 4)
	conversationIDs := make([]string, 4)
	for index := range sessionIDs {
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.whatsapp_sessions (
				organization_id, instance_name, instance_id, owner_user_id,
				provider, status, is_active, advanced_settings
			) values (
				$1::uuid, $2, $2, $3::uuid,
				'evolution_go', 'connected', true, '{}'::jsonb
			)
			returning id::text
		`, organizationID, fmt.Sprintf("%s-session-%d", suffix, index), userID).Scan(&sessionIDs[index]); err != nil {
			t.Fatal(err)
		}
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.whatsapp_conversations (
				organization_id, session_id, remote_jid, contact_phone, contact_name
			) values ($1::uuid, $2::uuid, $3, $4, $5)
			returning id::text
		`, organizationID, sessionIDs[index], phone+"@s.whatsapp.net", phone, fmt.Sprintf("%s-contact-%d", suffix, index)).Scan(&conversationIDs[index]); err != nil {
			t.Fatal(err)
		}
	}

	repo := NewRepository(postgres, nil, StorageConfig{})
	tenantContext := tenant.Context{
		OrganizationID: organizationID,
		UserID:         userID,
		UserRole:       "admin",
		MemberRole:     "admin",
	}

	t.Run("stale unlinked to B loses after unlinked to C", func(t *testing.T) {
		if err := repo.LinkConversationToLead(
			ctx, tenantContext, conversationIDs[0], leadIDs[2], unlinkedConversationLeadSnapshot,
		); err != nil {
			t.Fatalf("unlinked -> C: %v", err)
		}
		if err := repo.LinkConversationToLead(
			ctx, tenantContext, conversationIDs[0], leadIDs[1], unlinkedConversationLeadSnapshot,
		); !errors.Is(err, ErrConversationBindingChanged) {
			t.Fatalf("stale unlinked -> B error = %v, want ErrConversationBindingChanged", err)
		}
		assertConversationLead(t, ctx, postgres, conversationIDs[0], leadIDs[2])
	})

	t.Run("stale A to B loses after A to C", func(t *testing.T) {
		if err := repo.LinkConversationToLead(
			ctx, tenantContext, conversationIDs[1], leadIDs[0], unlinkedConversationLeadSnapshot,
		); err != nil {
			t.Fatalf("unlinked -> A: %v", err)
		}
		if err := repo.LinkConversationToLead(
			ctx, tenantContext, conversationIDs[1], leadIDs[2], leadIDs[0],
		); err != nil {
			t.Fatalf("A -> C: %v", err)
		}
		if err := repo.LinkConversationToLead(
			ctx, tenantContext, conversationIDs[1], leadIDs[1], leadIDs[0],
		); !errors.Is(err, ErrConversationBindingChanged) {
			t.Fatalf("stale A -> B error = %v, want ErrConversationBindingChanged", err)
		}
		assertConversationLead(t, ctx, postgres, conversationIDs[1], leadIDs[2])
	})

	t.Run("concurrent link has exactly one winner", func(t *testing.T) {
		results := runConcurrentBindingAttempts(func(targetLeadID string) error {
			return repo.LinkConversationToLead(
				ctx, tenantContext, conversationIDs[2], targetLeadID, unlinkedConversationLeadSnapshot,
			)
		}, leadIDs[1], leadIDs[2])
		assertSingleBindingCASWinner(t, results)
		assertConversationLeadOneOf(t, ctx, postgres, conversationIDs[2], leadIDs[1], leadIDs[2])
	})

	t.Run("StartConversation has exactly one winner", func(t *testing.T) {
		results := runConcurrentBindingAttempts(func(targetLeadID string) error {
			_, err := repo.StartConversation(ctx, tenantContext, StartConversationRequest{
				Phone:                  phone,
				SessionID:              sessionIDs[3],
				LeadID:                 targetLeadID,
				ExpectedPreviousLeadID: unlinkedConversationLeadSnapshot,
			})
			return err
		}, leadIDs[1], leadIDs[2])
		assertSingleBindingCASWinner(t, results)
		assertConversationLeadOneOf(t, ctx, postgres, conversationIDs[3], leadIDs[1], leadIDs[2])
	})
}

func runConcurrentBindingAttempts(attempt func(string) error, targets ...string) []error {
	start := make(chan struct{})
	results := make([]error, len(targets))
	var waitGroup sync.WaitGroup
	for index, target := range targets {
		waitGroup.Add(1)
		go func(index int, target string) {
			defer waitGroup.Done()
			<-start
			results[index] = attempt(target)
		}(index, target)
	}
	close(start)
	waitGroup.Wait()
	return results
}

func assertSingleBindingCASWinner(t *testing.T, results []error) {
	t.Helper()
	winners := 0
	conflicts := 0
	for _, err := range results {
		switch {
		case err == nil:
			winners++
		case errors.Is(err, ErrConversationBindingChanged):
			conflicts++
		default:
			t.Fatalf("unexpected binding CAS result: %v", err)
		}
	}
	if winners != 1 || conflicts != len(results)-1 {
		t.Fatalf("binding CAS results = %#v, want one winner and the rest conflicts", results)
	}
}

func assertConversationLead(t *testing.T, ctx context.Context, postgres *dbpkg.Postgres, conversationID string, expectedLeadID string) {
	t.Helper()
	var actualLeadID string
	if err := postgres.Pool().QueryRow(ctx, `
		select coalesce(lead_id::text, '')
		from public.whatsapp_conversations
		where id = $1::uuid
	`, conversationID).Scan(&actualLeadID); err != nil {
		t.Fatal(err)
	}
	if actualLeadID != expectedLeadID {
		t.Fatalf("conversation %s lead = %s, want %s", conversationID, actualLeadID, expectedLeadID)
	}
}

func assertConversationLeadOneOf(t *testing.T, ctx context.Context, postgres *dbpkg.Postgres, conversationID string, expectedLeadIDs ...string) {
	t.Helper()
	var actualLeadID string
	if err := postgres.Pool().QueryRow(ctx, `
		select coalesce(lead_id::text, '')
		from public.whatsapp_conversations
		where id = $1::uuid
	`, conversationID).Scan(&actualLeadID); err != nil {
		t.Fatal(err)
	}
	for _, expectedLeadID := range expectedLeadIDs {
		if actualLeadID == expectedLeadID {
			return
		}
	}
	t.Fatalf("conversation %s lead = %s, want one of %v", conversationID, actualLeadID, expectedLeadIDs)
}
