package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type migrationSpec struct {
	File   string
	SHA256 string
}

var approvedMigrations = []migrationSpec{
	{
		File:   "20260907230410_google_search_console_verification.sql",
		SHA256: "2d1d7e9c2b0f035444a70f03f6db4920aef939bb9c5834a6800d52c4953c3479",
	},
	{
		File:   "20260907230630_add_durable_outgoing_webhook_delivery.sql",
		SHA256: "98a15e630a998b4ee2916ab7e6a045dc94b9e0a3b87ac29988657b5d05819190",
	},
	{
		File:   "20260908064750_enable_chaves_na_mao_portal.sql",
		SHA256: "0b56c33f87f61c780f494bf925818832412a09bf28b6701f340cfb7a1f090070",
	},
}

type queryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

type preflightSummary struct {
	OrganizationSitesRows int64
	OrganizationSitesSize int64
	APIKeyDuplicateGroups int64
	InvalidOutgoingRows   int64
	PortalIntegrationRows int64
	PortalPublicationRows int64
	InvalidPortalRows     int64
	ConflictingLocks      int64
	LongOrWaitingSessions int64
	MigrationLedgerExists bool
}

func main() {
	mode := flag.String("mode", "preflight", "preflight, verify, dry-run, or apply")
	repositoryRoot := flag.String("repo-root", ".", "repository root")
	flag.Parse()

	if *mode != "preflight" && *mode != "verify" && *mode != "dry-run" && *mode != "apply" {
		fatal(errors.New("mode must be preflight, verify, dry-run, or apply"))
	}
	if *mode == "apply" && os.Getenv("VIMOB_INTEGRATION_MIGRATIONS_CONFIRM") != "APPLY" {
		fatal(errors.New("apply requires VIMOB_INTEGRATION_MIGRATIONS_CONFIRM=APPLY"))
	}

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		fatal(errors.New("DATABASE_URL was not provided"))
	}

	sources, err := loadApprovedMigrationSources(*repositoryRoot)
	if err != nil {
		fatal(err)
	}
	fmt.Printf("source_verified=%d google_calendar_excluded=true\n", len(sources))

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	if err := readonlyPreflight(ctx, databaseURL); err != nil {
		fatal(err)
	}
	if *mode == "preflight" {
		fmt.Println("result=preflight_ok database_changed=false")
		return
	}
	if *mode == "verify" {
		if err := readonlyPostcheck(ctx, databaseURL); err != nil {
			fatal(err)
		}
		return
	}

	if err := executeTransaction(ctx, databaseURL, *mode, sources); err != nil {
		fatal(err)
	}
}

func readonlyPostcheck(ctx context.Context, databaseURL string) error {
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:             databaseURL,
		MaxConns:        1,
		MinConns:        0,
		ForceReadOnly:   true,
		HealthTimeout:   10 * time.Second,
		MaxConnIdleTime: 30 * time.Second,
	})
	if err != nil {
		return fmt.Errorf("open read-only postcheck connection: %w", err)
	}
	defer postgres.Close()

	var readOnly string
	if err := postgres.Pool().QueryRow(ctx, "show default_transaction_read_only").Scan(&readOnly); err != nil {
		return fmt.Errorf("read postcheck transaction mode: %w", err)
	}
	if readOnly != "on" {
		return fmt.Errorf("postcheck connection is not read-only: %s", readOnly)
	}
	if err := verifyPostconditions(ctx, postgres.Pool()); err != nil {
		return fmt.Errorf("verify committed postconditions: %w", err)
	}

	var outboxRows, outgoingWebhooks, gscConfigured, chavesIntegrations, chavesPublications int64
	if err := postgres.Pool().QueryRow(ctx, `
		select
		  (select count(*) from private.webhook_delivery_outbox)::bigint,
		  (select count(*) from public.webhooks_integrations where type = 'outgoing')::bigint,
		  (select count(*) from public.organization_sites
		   where google_search_console_verification is not null)::bigint,
		  (select count(*) from public.portal_integrations where portal = 'chaves_na_mao')::bigint,
		  (select count(*) from public.portal_listing_publications where portal = 'chaves_na_mao')::bigint
	`).Scan(
		&outboxRows,
		&outgoingWebhooks,
		&gscConfigured,
		&chavesIntegrations,
		&chavesPublications,
	); err != nil {
		return fmt.Errorf("read committed integration aggregates: %w", err)
	}

	fmt.Printf(
		"postcheck_ok=true default_transaction_read_only=on outbox_rows=%d outgoing_webhooks=%d gsc_configured_sites=%d chaves_integrations=%d chaves_publications=%d\n",
		outboxRows,
		outgoingWebhooks,
		gscConfigured,
		chavesIntegrations,
		chavesPublications,
	)
	fmt.Println("result=verify_ok database_changed=false")
	return nil
}

func loadApprovedMigrationSources(repositoryRoot string) ([]string, error) {
	absoluteRoot, err := filepath.Abs(repositoryRoot)
	if err != nil {
		return nil, fmt.Errorf("resolve repository root: %w", err)
	}

	sources := make([]string, 0, len(approvedMigrations))
	for _, migration := range approvedMigrations {
		path := filepath.Join(absoluteRoot, "supabase", "migrations", migration.File)
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read approved migration %s: %w", migration.File, err)
		}
		normalized := strings.TrimPrefix(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\ufeff")
		digest := sha256.Sum256([]byte(normalized))
		actualHash := hex.EncodeToString(digest[:])
		if actualHash != migration.SHA256 {
			return nil, fmt.Errorf(
				"approved migration %s changed: expected %s, got %s",
				migration.File,
				migration.SHA256,
				actualHash,
			)
		}
		if strings.TrimSpace(normalized) == "" {
			return nil, fmt.Errorf("approved migration %s is empty", migration.File)
		}
		sources = append(sources, normalized)
	}
	return sources, nil
}

func readonlyPreflight(ctx context.Context, databaseURL string) error {
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:             databaseURL,
		MaxConns:        1,
		MinConns:        0,
		ForceReadOnly:   true,
		HealthTimeout:   10 * time.Second,
		MaxConnIdleTime: 30 * time.Second,
	})
	if err != nil {
		return fmt.Errorf("open read-only preflight connection: %w", err)
	}
	defer postgres.Close()

	var readOnly string
	if err := postgres.Pool().QueryRow(ctx, "show default_transaction_read_only").Scan(&readOnly); err != nil {
		return fmt.Errorf("read preflight transaction mode: %w", err)
	}
	if readOnly != "on" {
		return fmt.Errorf("preflight connection is not read-only: %s", readOnly)
	}

	summary, err := collectPreflight(ctx, postgres.Pool())
	if err != nil {
		return err
	}
	if err := validatePreflight(summary); err != nil {
		return err
	}
	printPreflight(summary)
	return nil
}

func collectPreflight(ctx context.Context, q queryer) (preflightSummary, error) {
	var summary preflightSummary
	if err := q.QueryRow(ctx, "select to_regclass('supabase_migrations.schema_migrations') is not null").Scan(&summary.MigrationLedgerExists); err != nil {
		return summary, fmt.Errorf("check Supabase migration ledger: %w", err)
	}

	for _, relation := range []string{
		"public.organization_sites",
		"public.organization_api_keys",
		"public.webhooks_integrations",
		"public.organizations",
		"public.leads",
		"public.lead_entry_events",
		"public.organization_modules",
		"public.portal_integrations",
		"public.portal_listing_publications",
	} {
		var exists bool
		if err := q.QueryRow(ctx, "select to_regclass($1) is not null", relation).Scan(&exists); err != nil {
			return summary, fmt.Errorf("check relation %s: %w", relation, err)
		}
		if !exists {
			return summary, fmt.Errorf("required relation is missing: %s", relation)
		}
	}

	for _, procedure := range []string{
		"private.get_user_organization_id()",
		"private.is_admin()",
		"public.is_super_admin()",
		"gen_random_uuid()",
	} {
		var exists bool
		if err := q.QueryRow(ctx, "select to_regprocedure($1) is not null", procedure).Scan(&exists); err != nil {
			return summary, fmt.Errorf("check procedure %s: %w", procedure, err)
		}
		if !exists {
			return summary, fmt.Errorf("required procedure is missing: %s", procedure)
		}
	}

	if err := q.QueryRow(ctx, `
		select count(*)::bigint, pg_total_relation_size('public.organization_sites'::regclass)::bigint
		from public.organization_sites
	`).Scan(&summary.OrganizationSitesRows, &summary.OrganizationSitesSize); err != nil {
		return summary, fmt.Errorf("summarize organization_sites: %w", err)
	}

	if err := q.QueryRow(ctx, `
		select count(*)::bigint
		from (
			select key_hash
			from public.organization_api_keys
			where key_hash is not null
			group by key_hash
			having count(*) > 1
		) duplicate_groups
	`).Scan(&summary.APIKeyDuplicateGroups); err != nil {
		return summary, fmt.Errorf("check duplicate API key hashes: %w", err)
	}

	if err := q.QueryRow(ctx, `
		select count(*)::bigint
		from public.webhooks_integrations
		where type = 'outgoing'
		  and (
			webhook_url is null
			or webhook_url !~ '^https://[^[:space:]]+$'
			or trigger_events is null
			or cardinality(trigger_events) not between 1 and 2
			or not (trigger_events <@ array['lead.created', 'lead.reentered']::text[])
		  )
	`).Scan(&summary.InvalidOutgoingRows); err != nil {
		return summary, fmt.Errorf("check outgoing webhook rows: %w", err)
	}

	if err := q.QueryRow(ctx, "select count(*)::bigint from public.portal_integrations").Scan(&summary.PortalIntegrationRows); err != nil {
		return summary, fmt.Errorf("count portal integrations: %w", err)
	}
	if err := q.QueryRow(ctx, "select count(*)::bigint from public.portal_listing_publications").Scan(&summary.PortalPublicationRows); err != nil {
		return summary, fmt.Errorf("count portal publications: %w", err)
	}
	if err := q.QueryRow(ctx, `
		select
		  (select count(*) from public.portal_integrations
		   where portal is not null and portal not in ('grupo_olx', 'chaves_na_mao'))
		+ (select count(*) from public.portal_listing_publications
		   where portal is not null and portal not in ('grupo_olx', 'chaves_na_mao'))
	`).Scan(&summary.InvalidPortalRows); err != nil {
		return summary, fmt.Errorf("check portal identifiers: %w", err)
	}

	if err := q.QueryRow(ctx, `
		select count(*)::bigint
		from pg_locks lock_row
		join pg_class relation on relation.oid = lock_row.relation
		join pg_namespace namespace on namespace.oid = relation.relnamespace
		where lock_row.pid <> pg_backend_pid()
		  and lock_row.granted
		  and namespace.nspname = 'public'
		  and relation.relname in (
			'organization_sites',
			'organization_api_keys',
			'webhooks_integrations',
			'organizations',
			'leads',
			'lead_entry_events',
			'portal_integrations',
			'portal_listing_publications'
		  )
	`).Scan(&summary.ConflictingLocks); err != nil {
		return summary, fmt.Errorf("check target relation locks: %w", err)
	}

	if err := q.QueryRow(ctx, `
		select count(*)::bigint
		from pg_stat_activity
		where datname = current_database()
		  and pid <> pg_backend_pid()
		  and backend_type = 'client backend'
		  and (
			wait_event_type = 'Lock'
			or (xact_start is not null and xact_start < clock_timestamp() - interval '30 seconds')
		  )
	`).Scan(&summary.LongOrWaitingSessions); err != nil {
		return summary, fmt.Errorf("check long or lock-waiting sessions: %w", err)
	}

	return summary, nil
}

func validatePreflight(summary preflightSummary) error {
	problems := make([]string, 0, 4)
	if summary.APIKeyDuplicateGroups != 0 {
		problems = append(problems, fmt.Sprintf("duplicate_api_key_hash_groups=%d", summary.APIKeyDuplicateGroups))
	}
	if summary.InvalidOutgoingRows != 0 {
		problems = append(problems, fmt.Sprintf("invalid_outgoing_webhook_rows=%d", summary.InvalidOutgoingRows))
	}
	if summary.InvalidPortalRows != 0 {
		problems = append(problems, fmt.Sprintf("invalid_portal_rows=%d", summary.InvalidPortalRows))
	}
	if summary.LongOrWaitingSessions != 0 {
		problems = append(problems, fmt.Sprintf("long_or_lock_waiting_sessions=%d", summary.LongOrWaitingSessions))
	}
	if len(problems) > 0 {
		return fmt.Errorf("preflight rejected: %s", strings.Join(problems, ", "))
	}
	return nil
}

func printPreflight(summary preflightSummary) {
	fmt.Printf(
		"preflight_ok=true organization_sites_rows=%d organization_sites_bytes=%d api_key_duplicate_groups=%d invalid_outgoing_rows=%d portal_integrations_rows=%d portal_publications_rows=%d invalid_portal_rows=%d conflicting_locks=%d long_or_waiting_sessions=%d migration_ledger_exists=%t\n",
		summary.OrganizationSitesRows,
		summary.OrganizationSitesSize,
		summary.APIKeyDuplicateGroups,
		summary.InvalidOutgoingRows,
		summary.PortalIntegrationRows,
		summary.PortalPublicationRows,
		summary.InvalidPortalRows,
		summary.ConflictingLocks,
		summary.LongOrWaitingSessions,
		summary.MigrationLedgerExists,
	)
}

func executeTransaction(ctx context.Context, databaseURL, mode string, sources []string) error {
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:             databaseURL,
		MaxConns:        1,
		MinConns:        0,
		ForceReadOnly:   false,
		HealthTimeout:   10 * time.Second,
		MaxConnIdleTime: 30 * time.Second,
	})
	if err != nil {
		return fmt.Errorf("open migration connection: %w", err)
	}
	defer postgres.Close()

	var defaultReadOnly string
	if err := postgres.Pool().QueryRow(ctx, "show default_transaction_read_only").Scan(&defaultReadOnly); err != nil {
		return fmt.Errorf("read migration connection mode: %w", err)
	}
	if defaultReadOnly != "off" {
		return fmt.Errorf("migration connection default_transaction_read_only is %s, expected off", defaultReadOnly)
	}

	tx, err := postgres.Pool().BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadWrite})
	if err != nil {
		return fmt.Errorf("begin migration transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()

	for _, statement := range []string{
		"set local lock_timeout = '3s'",
		"set local statement_timeout = '30s'",
		"set local idle_in_transaction_session_timeout = '60s'",
	} {
		if _, err := tx.Exec(ctx, statement); err != nil {
			return fmt.Errorf("configure migration transaction: %w", err)
		}
	}

	var locked bool
	if err := tx.QueryRow(ctx, "select pg_try_advisory_xact_lock(hashtextextended('vimob:integration-migrations:20260908', 0))").Scan(&locked); err != nil {
		return fmt.Errorf("acquire migration advisory lock: %w", err)
	}
	if !locked {
		return errors.New("another integration migration transaction is active")
	}

	if err := lockMigrationRelations(ctx, tx); err != nil {
		return err
	}
	if err := validateLockedData(ctx, tx); err != nil {
		return err
	}
	fmt.Println("transaction_locks=acquired locked_data_preflight=ok")

	for index, source := range sources {
		migration := approvedMigrations[index]
		if _, err := tx.Exec(ctx, source); err != nil {
			return fmt.Errorf("execute %s: %w", migration.File, err)
		}
		fmt.Printf("migration_executed=%s transaction_pending=true\n", migration.File)
	}

	if err := verifyPostconditions(ctx, tx); err != nil {
		return fmt.Errorf("verify in-transaction postconditions: %w", err)
	}
	fmt.Println("postconditions_in_transaction=ok")

	if mode == "dry-run" {
		if err := tx.Rollback(ctx); err != nil {
			return fmt.Errorf("rollback dry-run: %w", err)
		}
		fmt.Println("result=dry_run_ok database_changed=false")
		return nil
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit integration migrations: %w", err)
	}
	fmt.Println("transaction_commit=ok")

	readback, err := postgres.Pool().BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return fmt.Errorf("begin read-only readback: %w", err)
	}
	defer func() { _ = readback.Rollback(context.Background()) }()
	var transactionReadOnly string
	if err := readback.QueryRow(ctx, "show transaction_read_only").Scan(&transactionReadOnly); err != nil {
		return fmt.Errorf("read readback transaction mode: %w", err)
	}
	if transactionReadOnly != "on" {
		return fmt.Errorf("readback transaction is not read-only: %s", transactionReadOnly)
	}
	if err := verifyPostconditions(ctx, readback); err != nil {
		return fmt.Errorf("verify committed postconditions: %w", err)
	}
	if err := readback.Commit(ctx); err != nil {
		return fmt.Errorf("finish read-only readback: %w", err)
	}
	fmt.Println("readback_transaction_read_only=on postconditions_committed=ok")
	fmt.Println("result=apply_ok database_changed=true")
	return nil
}

func lockMigrationRelations(ctx context.Context, tx pgx.Tx) error {
	statements := []string{
		`lock table
			public.organization_sites,
			public.webhooks_integrations,
			public.portal_integrations,
			public.portal_listing_publications
		 in access exclusive mode`,
		`lock table public.organization_api_keys in share mode`,
		`lock table
			public.organizations,
			public.leads,
			public.lead_entry_events
		 in share row exclusive mode`,
	}
	for _, statement := range statements {
		if _, err := tx.Exec(ctx, statement); err != nil {
			return fmt.Errorf("acquire deterministic migration locks: %w", err)
		}
	}
	return nil
}

func validateLockedData(ctx context.Context, q queryer) error {
	var duplicateGroups, invalidOutgoingRows, invalidPortalRows int64
	err := q.QueryRow(ctx, `
		select
		  (
			select count(*)
			from (
			  select key_hash
			  from public.organization_api_keys
			  where key_hash is not null
			  group by key_hash
			  having count(*) > 1
			) duplicate_groups
		  )::bigint,
		  (
			select count(*)
			from public.webhooks_integrations
			where type = 'outgoing'
			  and (
				webhook_url is null
				or webhook_url !~ '^https://[^[:space:]]+$'
				or trigger_events is null
				or cardinality(trigger_events) not between 1 and 2
				or not (trigger_events <@ array['lead.created', 'lead.reentered']::text[])
			  )
		  )::bigint,
		  (
			(select count(*) from public.portal_integrations
			 where portal is not null and portal not in ('grupo_olx', 'chaves_na_mao'))
			+
			(select count(*) from public.portal_listing_publications
			 where portal is not null and portal not in ('grupo_olx', 'chaves_na_mao'))
		  )::bigint
	`).Scan(&duplicateGroups, &invalidOutgoingRows, &invalidPortalRows)
	if err != nil {
		return fmt.Errorf("validate data while migration locks are held: %w", err)
	}
	if duplicateGroups != 0 || invalidOutgoingRows != 0 || invalidPortalRows != 0 {
		return fmt.Errorf(
			"locked data preflight rejected: duplicate_api_key_hash_groups=%d, invalid_outgoing_webhook_rows=%d, invalid_portal_rows=%d",
			duplicateGroups,
			invalidOutgoingRows,
			invalidPortalRows,
		)
	}
	return nil
}

func verifyPostconditions(ctx context.Context, q queryer) error {
	checks := []struct {
		Name  string
		Query string
	}{
		{
			Name: "google_search_console_column",
			Query: `select exists (
				select 1 from information_schema.columns
				where table_schema = 'public'
				  and table_name = 'organization_sites'
				  and column_name = 'google_search_console_verification'
			)`,
		},
		{
			Name: "google_search_console_constraint_validated",
			Query: `select exists (
				select 1 from pg_constraint
				where conrelid = 'public.organization_sites'::regclass
				  and conname = 'organization_sites_google_search_console_verification_check'
				  and convalidated
			)`,
		},
		{
			Name: "api_key_hash_unique_index",
			Query: `select exists (
				select 1 from pg_index index_row
				join pg_class index_relation on index_relation.oid = index_row.indexrelid
				where index_relation.relname = 'organization_api_keys_key_hash_uidx'
				  and index_row.indrelid = 'public.organization_api_keys'::regclass
				  and index_row.indisunique
				  and index_row.indisvalid
			)`,
		},
		{
			Name: "outgoing_contract_validated",
			Query: `select exists (
				select 1 from pg_constraint
				where conrelid = 'public.webhooks_integrations'::regclass
				  and conname = 'webhooks_integrations_outgoing_contract_check'
				  and convalidated
				  and pg_get_constraintdef(oid) like '%webhook_url IS NOT NULL%'
				  and pg_get_constraintdef(oid) like '%trigger_events IS NOT NULL%'
			)`,
		},
		{
			Name: "webhook_manager_policy",
			Query: `select exists (
				select 1 from pg_policy
				where polrelid = 'public.webhooks_integrations'::regclass
				  and polname = 'webhooks_integrations_managers_select'
			)`,
		},
		{
			Name: "api_token_not_selectable_by_authenticated",
			Query: `select not has_column_privilege(
				'authenticated', 'public.webhooks_integrations', 'api_token', 'SELECT'
			)`,
		},
		{
			Name: "webhook_outbox_rls_forced",
			Query: `select coalesce((
				select relrowsecurity and relforcerowsecurity
				from pg_class
				where oid = to_regclass('private.webhook_delivery_outbox')
			), false)`,
		},
		{
			Name: "webhook_outbox_lead_index",
			Query: `select exists (
				select 1 from pg_index index_row
				join pg_class index_relation on index_relation.oid = index_row.indexrelid
				where index_relation.relname = 'webhook_delivery_outbox_lead_id_idx'
				  and index_row.indrelid = 'private.webhook_delivery_outbox'::regclass
				  and index_row.indisvalid
			)`,
		},
		{
			Name: "webhook_outbox_trigger",
			Query: `select exists (
				select 1 from pg_trigger
				where tgrelid = 'public.lead_entry_events'::regclass
				  and tgname = 'zz_enqueue_outgoing_lead_webhooks'
				  and not tgisinternal
				  and tgenabled in ('O', 'A')
			)`,
		},
		{
			Name: "webhook_enqueue_function_hardened",
			Query: `select coalesce((
				select prosecdef
				  and not has_function_privilege('authenticated', oid, 'EXECUTE')
				  and not has_function_privilege('service_role', oid, 'EXECUTE')
				from pg_proc
				where oid = to_regprocedure('private.enqueue_outgoing_lead_webhooks()')
			), false)`,
		},
		{
			Name: "migration_role_bypasses_forced_rls",
			Query: `select coalesce((
				select rolsuper or rolbypassrls
				from pg_roles
				where rolname = current_user
			), false)`,
		},
		{
			Name:  "migration_role_has_private_schema_usage",
			Query: `select has_schema_privilege(current_user, 'private', 'USAGE')`,
		},
		{
			Name: "migration_role_can_consume_outbox",
			Query: `select
				has_table_privilege(current_user, 'private.webhook_delivery_outbox', 'SELECT')
				and has_table_privilege(current_user, 'private.webhook_delivery_outbox', 'INSERT')
				and has_table_privilege(current_user, 'private.webhook_delivery_outbox', 'UPDATE')
				and has_table_privilege(current_user, 'private.webhook_delivery_outbox', 'DELETE')`,
		},
		{
			Name: "migration_role_can_read_webhook_secret",
			Query: `select has_column_privilege(
				current_user, 'public.webhooks_integrations', 'api_token', 'SELECT'
			)`,
		},
		{
			Name: "frontend_roles_cannot_read_outbox",
			Query: `select
				not has_table_privilege('anon', 'private.webhook_delivery_outbox', 'SELECT')
				and not has_table_privilege('authenticated', 'private.webhook_delivery_outbox', 'SELECT')
				and not has_table_privilege('service_role', 'private.webhook_delivery_outbox', 'SELECT')`,
		},
		{
			Name: "portal_integrations_constraint",
			Query: `select exists (
				select 1 from pg_constraint
				where conrelid = 'public.portal_integrations'::regclass
				  and conname = 'portal_integrations_portal_check'
				  and convalidated
				  and pg_get_constraintdef(oid) like '%chaves_na_mao%'
			)`,
		},
		{
			Name: "portal_publications_constraint",
			Query: `select exists (
				select 1 from pg_constraint
				where conrelid = 'public.portal_listing_publications'::regclass
				  and conname = 'portal_listing_publications_portal_check'
				  and convalidated
				  and pg_get_constraintdef(oid) like '%chaves_na_mao%'
			)`,
		},
		{
			Name: "portal_import_and_webhook_scope_unchanged",
			Query: `select
				exists (
				  select 1 from pg_constraint
				  where conrelid = 'public.portal_import_reports'::regclass
				    and conname = 'portal_import_reports_portal_check'
				    and convalidated
				    and pg_get_constraintdef(oid) not like '%chaves_na_mao%'
				)
				and exists (
				  select 1 from pg_constraint
				  where conrelid = 'public.portal_webhook_events'::regclass
				    and conname = 'portal_webhook_events_portal_check'
				    and convalidated
				    and pg_get_constraintdef(oid) not like '%chaves_na_mao%'
				)`,
		},
	}

	queries := make([]string, 0, len(checks))
	for _, check := range checks {
		name := strings.ReplaceAll(check.Name, "'", "''")
		queries = append(queries, fmt.Sprintf(
			"select '%s'::text as name, (%s)::boolean as ok",
			name,
			check.Query,
		))
	}
	combined := fmt.Sprintf(
		"select coalesce(string_agg(name, ', ' order by name) filter (where not ok), '') from (%s) postcondition_rows",
		strings.Join(queries, " union all "),
	)
	var failed string
	if err := q.QueryRow(ctx, combined).Scan(&failed); err != nil {
		return fmt.Errorf("postcondition query failed: %w", err)
	}
	if failed != "" {
		return fmt.Errorf("postconditions failed: %s", failed)
	}
	return nil
}

func fatal(err error) {
	fmt.Fprintf(os.Stderr, "integration migration runner failed: %v\n", err)
	os.Exit(1)
}
