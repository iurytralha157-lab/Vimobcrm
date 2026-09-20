package leads

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// TestDeleteLeadWhatsAppLockOrder exercises the three lock interleavings that
// matter for lead deletion. The database must be disposable and have the
// queue-scoped identity migration plus the strict binding cutover applied.
func TestDeleteLeadWhatsAppLockOrder(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("LEADS_DELETE_LOCK_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set LEADS_DELETE_LOCK_TEST_DATABASE_URL to run the local lead deletion lock contract")
	}
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse LEADS_DELETE_LOCK_TEST_DATABASE_URL: %v", err)
	}
	if hostname := strings.ToLower(target.Hostname()); hostname != "localhost" && hostname != "127.0.0.1" && hostname != "::1" {
		t.Fatalf("LEADS_DELETE_LOCK_TEST_DATABASE_URL must point to loopback, got %q", target.Hostname())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)

	suffix := fmt.Sprintf("lead-delete-lock-%d", time.Now().UnixNano())
	organizationID, userID, sessionID := createLeadDeleteLockTenant(t, ctx, postgres.Pool(), suffix)
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from public.organizations where id = $1::uuid`, organizationID)
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from public.users where id = $1::uuid`, userID)
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from auth.users where id = $1::uuid`, userID)
	})

	repository := NewRepository(postgres, nil)
	tenantContext := tenant.Context{
		OrganizationID: organizationID,
		UserID:         userID,
		UserRole:       "admin",
		MemberRole:     "admin",
	}

	t.Run("conversation owner can finish before delete takes lead lock", func(t *testing.T) {
		leadID, conversationID := createLeadDeleteLockFixture(t, ctx, postgres.Pool(), organizationID, userID, sessionID, suffix+"-owner-first", true)

		holder, err := postgres.Pool().Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer holder.Rollback(ctx)
		if _, err := holder.Exec(ctx, `set local lock_timeout = '3s'`); err != nil {
			t.Fatal(err)
		}
		if _, err := holder.Exec(ctx, `
			select id
			from public.whatsapp_conversations
			where id = $1::uuid
			for no key update
		`, conversationID); err != nil {
			t.Fatal(err)
		}

		deleteDone := runLeadDelete(repository, tenantContext, leadID)
		waitForLeadDeleteBlockedQuery(t, ctx, postgres.Pool(), "for no key update of wc")

		// This is the row-lock used by the real binding authorization path. If
		// deletion had taken the lead first, the two transactions would cycle.
		if _, err := holder.Exec(ctx, `
			select id
			from public.leads
			where id = $1::uuid
			for share
		`, leadID); err != nil {
			t.Fatalf("conversation owner could not finish its lead validation: %v", err)
		}
		if err := holder.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		if err := awaitLeadDelete(deleteDone); err != nil {
			t.Fatalf("delete after conversation owner: %v", err)
		}
		assertLeadDeletedAndConversationDetached(t, ctx, postgres.Pool(), leadID, conversationID)
	})

	t.Run("delete holds conversation while waiting for lead", func(t *testing.T) {
		leadID, conversationID := createLeadDeleteLockFixture(t, ctx, postgres.Pool(), organizationID, userID, sessionID, suffix+"-delete-first", true)

		leadBlocker, err := postgres.Pool().Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer leadBlocker.Rollback(ctx)
		if _, err := leadBlocker.Exec(ctx, `
			select id
			from public.leads
			where id = $1::uuid
			for update
		`, leadID); err != nil {
			t.Fatal(err)
		}

		deleteDone := runLeadDelete(repository, tenantContext, leadID)
		waitForLeadDeleteBlockedQuery(t, ctx, postgres.Pool(), "for update of l")

		conversationContender, err := postgres.Pool().Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer conversationContender.Rollback(ctx)
		contenderDone := make(chan error, 1)
		go func() {
			_, lockErr := conversationContender.Exec(ctx, `
				/* lead-delete-conversation-contender */
				select id
				from public.whatsapp_conversations
				where id = $1::uuid
				for no key update
			`, conversationID)
			contenderDone <- lockErr
		}()
		waitForLeadDeleteBlockedQuery(t, ctx, postgres.Pool(), "lead-delete-conversation-contender")

		if err := leadBlocker.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		if err := awaitLeadDelete(deleteDone); err != nil {
			t.Fatalf("delete after lead blocker: %v", err)
		}
		if err := awaitLeadDelete(contenderDone); err != nil {
			t.Fatalf("conversation contender after delete: %v", err)
		}
		if err := conversationContender.Rollback(ctx); err != nil && err != pgx.ErrTxClosed {
			t.Fatal(err)
		}
		assertLeadDeletedAndConversationDetached(t, ctx, postgres.Pool(), leadID, conversationID)
	})

	t.Run("rescan catches a conversation linked in the visibility window", func(t *testing.T) {
		leadID, conversationID := createLeadDeleteLockFixture(t, ctx, postgres.Pool(), organizationID, userID, sessionID, suffix+"-rescan", false)

		linker, err := postgres.Pool().Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer linker.Rollback(ctx)
		var bindingResult []byte
		if err := linker.QueryRow(ctx, `
			select public.activate_whatsapp_conversation_lead_binding(
				p_organization_id => $1::uuid,
				p_conversation_id => $2::uuid,
				p_lead_id => $3::uuid,
				p_provider_message_id => null,
				p_expected_previous_lead_id => 'unlinked'
			)
		`, organizationID, conversationID, leadID).Scan(&bindingResult); err != nil {
			t.Fatal(err)
		}

		deleteDone := runLeadDelete(repository, tenantContext, leadID)
		waitForLeadDeleteBlockedQuery(t, ctx, postgres.Pool(), "for update of l")
		if err := linker.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		if err := awaitLeadDelete(deleteDone); err != nil {
			t.Fatalf("delete after concurrent link commit: %v", err)
		}
		assertLeadDeletedAndConversationDetached(t, ctx, postgres.Pool(), leadID, conversationID)
	})
}

func createLeadDeleteLockTenant(t *testing.T, ctx context.Context, pool *pgxpool.Pool, suffix string) (string, string, string) {
	t.Helper()
	var organizationID, userID, sessionID string
	if err := pool.QueryRow(ctx, `
		insert into public.organizations (name, slug)
		values ($1, $1)
		returning id::text
	`, suffix).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
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
	if _, err := pool.Exec(ctx, `
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
	if _, err := pool.Exec(ctx, `
		insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($1::uuid, $2::uuid, 'admin', true)
		on conflict (user_id, organization_id) do update
		set role = excluded.role,
		    is_active = excluded.is_active
	`, organizationID, userID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `
		insert into public.whatsapp_sessions (
			organization_id, instance_name, instance_id, owner_user_id,
			provider, status, is_active, advanced_settings
		) values ($1::uuid, $2, $2, $3::uuid, 'evolution_go', 'connected', true, '{}'::jsonb)
		returning id::text
	`, organizationID, suffix+"-session", userID).Scan(&sessionID); err != nil {
		t.Fatal(err)
	}
	return organizationID, userID, sessionID
}

func createLeadDeleteLockFixture(
	t *testing.T,
	ctx context.Context,
	pool *pgxpool.Pool,
	organizationID string,
	userID string,
	sessionID string,
	suffix string,
	linked bool,
) (string, string) {
	t.Helper()
	phone := fmt.Sprintf("55119%08d", time.Now().UnixNano()%100_000_000)
	var leadID, conversationID string
	if err := pool.QueryRow(ctx, `
		insert into public.leads (organization_id, assigned_user_id, name, phone, source)
		values ($1::uuid, $2::uuid, $3, $4, 'whatsapp')
		returning id::text
	`, organizationID, userID, suffix+"-lead", phone).Scan(&leadID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `
		insert into public.whatsapp_conversations (
			organization_id, session_id, remote_jid, contact_phone, contact_name
		) values ($1::uuid, $2::uuid, $3, $4, $5)
		returning id::text
	`, organizationID, sessionID, phone+"@s.whatsapp.net", phone, suffix+"-contact").Scan(&conversationID); err != nil {
		t.Fatal(err)
	}
	if linked {
		var bindingResult []byte
		if err := pool.QueryRow(ctx, `
			select public.activate_whatsapp_conversation_lead_binding(
				p_organization_id => $1::uuid,
				p_conversation_id => $2::uuid,
				p_lead_id => $3::uuid,
				p_provider_message_id => null,
				p_expected_previous_lead_id => 'unlinked'
			)
		`, organizationID, conversationID, leadID).Scan(&bindingResult); err != nil {
			t.Fatal(err)
		}
	}
	return leadID, conversationID
}

func runLeadDelete(repository Repository, tenantContext tenant.Context, leadID string) <-chan error {
	done := make(chan error, 1)
	go func() {
		deleteCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		done <- repository.Delete(deleteCtx, tenantContext, leadID)
	}()
	return done
}

func awaitLeadDelete(done <-chan error) error {
	select {
	case err := <-done:
		return err
	case <-time.After(10 * time.Second):
		return context.DeadlineExceeded
	}
}

func waitForLeadDeleteBlockedQuery(t *testing.T, ctx context.Context, pool *pgxpool.Pool, fragment string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		var waiting bool
		err := pool.QueryRow(ctx, `
			select exists (
				select 1
				from pg_catalog.pg_stat_activity
				where datname = current_database()
				  and pid <> pg_backend_pid()
				  and wait_event_type = 'Lock'
				  and position(lower($1) in lower(query)) > 0
			)
		`, fragment).Scan(&waiting)
		if err != nil {
			t.Fatal(err)
		}
		if waiting {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for blocked query containing %q", fragment)
}

func assertLeadDeletedAndConversationDetached(t *testing.T, ctx context.Context, pool *pgxpool.Pool, leadID string, conversationID string) {
	t.Helper()
	var leadExists, conversationDetached, activeBindingExists bool
	if err := pool.QueryRow(ctx, `select exists (select 1 from public.leads where id = $1::uuid)`, leadID).Scan(&leadExists); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `
		select lead_id is null
		from public.whatsapp_conversations
		where id = $1::uuid
	`, conversationID).Scan(&conversationDetached); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `
		select exists (
			select 1
			from public.whatsapp_conversation_lead_bindings
			where conversation_id = $1::uuid
			  and active_to is null
		)
	`, conversationID).Scan(&activeBindingExists); err != nil {
		t.Fatal(err)
	}
	if leadExists || !conversationDetached || activeBindingExists {
		t.Fatalf("unsafe final state: lead_exists=%v conversation_detached=%v active_binding_exists=%v", leadExists, conversationDetached, activeBindingExists)
	}
}
