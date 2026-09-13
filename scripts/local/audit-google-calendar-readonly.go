package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type calendarAudit struct {
	readOnly                string
	migrationsTable         bool
	vaultSecretsTable       bool
	cronJobsTable           bool
	bidirectionalMigration  bool
	foreignKeysMigration    bool
	reliabilityMigration    bool
	tokensTable             bool
	eventLinksTable         bool
	channelsTable           bool
	syncJobsTable           bool
	oauthStatesTable        bool
	reconcileCronFunction   bool
	claimJobsFunction       bool
	vaultTokenContract      bool
	plaintextTokenColumns   bool
	durableDeleteForeignKey bool
	cronSecret              bool
	syncBaseURLSecret       bool
	activeCronJobs          int64
	activeConnections       int64
	syncEnabledConnections  int64
	connectionsWithError    int64
	pendingOrProcessingJobs int64
	latestErrorCategory     string
}

func classifyCalendarError(message string) string {
	normalized := strings.ToLower(strings.TrimSpace(message))
	switch {
	case normalized == "":
		return "none"
	case strings.Contains(normalized, "invalid_grant"):
		return "oauth_invalid_grant"
	case strings.Contains(normalized, "redirect_uri_mismatch"):
		return "oauth_redirect_mismatch"
	case strings.Contains(normalized, "google_client_") || strings.Contains(normalized, "webhook_url"):
		return "missing_or_invalid_configuration"
	case strings.Contains(normalized, "401") || strings.Contains(normalized, "unauthorized"):
		return "google_unauthorized"
	case strings.Contains(normalized, "403") || strings.Contains(normalized, "forbidden") || strings.Contains(normalized, "permission"):
		return "google_permission_denied"
	case strings.Contains(normalized, "404") || strings.Contains(normalized, "not found"):
		return "google_resource_not_found"
	case strings.Contains(normalized, "sync token") || strings.Contains(normalized, "synctoken"):
		return "sync_token_invalid"
	case strings.Contains(normalized, "relation") || strings.Contains(normalized, "column") || strings.Contains(normalized, "constraint"):
		return "database_contract_error"
	case strings.Contains(normalized, "fetch") || strings.Contains(normalized, "network") || strings.Contains(normalized, "timeout"):
		return "network_error"
	default:
		return "other"
	}
}

// This command inspects only schema state and aggregate Google Calendar
// readiness. It uses the same forced read-only guard as the real-data runner
// and never prints credentials, tenant identifiers, users or calendar data.
func main() {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		fmt.Fprintln(os.Stderr, "DATABASE_URL não foi informada para a auditoria somente leitura.")
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:           databaseURL,
		MaxConns:      1,
		MinConns:      0,
		ForceReadOnly: true,
		HealthTimeout: 10 * time.Second,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "Não foi possível preparar a auditoria somente leitura do Google Agenda.")
		os.Exit(1)
	}
	defer postgres.Close()

	var audit calendarAudit
	if err := postgres.Pool().QueryRow(ctx, "show default_transaction_read_only").Scan(&audit.readOnly); err != nil || audit.readOnly != "on" {
		fmt.Fprintln(os.Stderr, "A auditoria recusou uma conexão que não está em modo somente leitura.")
		os.Exit(1)
	}

	err = postgres.Pool().QueryRow(ctx, `
		select
			to_regclass('supabase_migrations.schema_migrations') is not null,
			to_regclass('vault.secrets') is not null,
			to_regclass('cron.job') is not null,
			to_regclass('public.google_calendar_tokens') is not null,
			to_regclass('public.google_calendar_event_links') is not null,
			to_regclass('public.google_calendar_channels') is not null,
			to_regclass('public.google_calendar_sync_jobs') is not null,
			to_regclass('public.google_calendar_oauth_states') is not null,
			to_regprocedure('private.reconcile_google_calendar_cron_jobs()') is not null,
			to_regprocedure('public.google_calendar_claim_sync_jobs(integer,text)') is not null,
			(
				select count(*) = 4
				from information_schema.columns
				where table_schema = 'public'
					and table_name = 'google_calendar_tokens'
					and column_name in ('organization_id', 'token_secret_ref', 'sync_status', 'sync_enabled')
			),
			exists (
				select 1
				from information_schema.columns
				where table_schema = 'public'
					and table_name = 'google_calendar_tokens'
					and column_name in ('access_token', 'refresh_token')
			),
			exists (
				select 1
				from pg_constraint
				where conrelid = to_regclass('public.google_calendar_event_links')
					and conname = 'google_calendar_event_links_schedule_event_id_fkey'
					and confdeltype = 'n'
			)
	`).Scan(
		&audit.migrationsTable,
		&audit.vaultSecretsTable,
		&audit.cronJobsTable,
		&audit.tokensTable,
		&audit.eventLinksTable,
		&audit.channelsTable,
		&audit.syncJobsTable,
		&audit.oauthStatesTable,
		&audit.reconcileCronFunction,
		&audit.claimJobsFunction,
		&audit.vaultTokenContract,
		&audit.plaintextTokenColumns,
		&audit.durableDeleteForeignKey,
	)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Não foi possível consultar o estado estrutural do Google Agenda.")
		os.Exit(1)
	}

	if audit.migrationsTable {
		err = postgres.Pool().QueryRow(ctx, `
			select
				coalesce(bool_or(version = '20260726235820'), false),
				coalesce(bool_or(version = '20260727001955'), false),
				coalesce(bool_or(version = '20260907230953'), false)
			from supabase_migrations.schema_migrations
		`).Scan(
			&audit.bidirectionalMigration,
			&audit.foreignKeysMigration,
			&audit.reliabilityMigration,
		)
		if err != nil {
			fmt.Fprintln(os.Stderr, "Não foi possível consultar as migrations do Google Agenda.")
			os.Exit(1)
		}
	}

	if audit.vaultSecretsTable {
		err = postgres.Pool().QueryRow(ctx, `
			select
				coalesce(bool_or(name = 'google_calendar_cron_secret'), false),
				coalesce(bool_or(name = 'google_calendar_sync_base_url'), false)
			from vault.secrets
		`).Scan(&audit.cronSecret, &audit.syncBaseURLSecret)
		if err != nil {
			fmt.Fprintln(os.Stderr, "Não foi possível confirmar os nomes dos segredos do Google Agenda.")
			os.Exit(1)
		}
	}

	if audit.cronJobsTable {
		err = postgres.Pool().QueryRow(ctx, `
			select count(*)
			from cron.job
			where active and jobname in (
				'google-calendar-enqueue-due-pulls',
				'google-calendar-sync-jobs',
				'google-calendar-renew-watches'
			)
		`).Scan(&audit.activeCronJobs)
		if err != nil {
			fmt.Fprintln(os.Stderr, "Não foi possível consultar os jobs do Google Agenda.")
			os.Exit(1)
		}
	}

	if audit.tokensTable && audit.syncJobsTable {
		var latestError string
		err = postgres.Pool().QueryRow(ctx, `
			select
				count(*) filter (where disconnected_at is null),
				count(*) filter (where disconnected_at is null and sync_enabled),
				count(*) filter (where disconnected_at is null and sync_status = 'error'),
				(select count(*) from public.google_calendar_sync_jobs where status in ('queued', 'running')),
				coalesce((
					select last_error
					from public.google_calendar_tokens
					where disconnected_at is null and nullif(last_error, '') is not null
					order by updated_at desc
					limit 1
				), '')
			from public.google_calendar_tokens
		`).Scan(
			&audit.activeConnections,
			&audit.syncEnabledConnections,
			&audit.connectionsWithError,
			&audit.pendingOrProcessingJobs,
			&latestError,
		)
		if err != nil {
			fmt.Fprintln(os.Stderr, "Não foi possível consultar os agregados do Google Agenda.")
			os.Exit(1)
		}
		audit.latestErrorCategory = classifyCalendarError(latestError)
	}

	fmt.Printf(
		"somente_leitura=%s migrations=%t/%t/%t tabelas=%t/%t/%t/%t/%t contrato_vault=%t colunas_token_texto=%t claim_jobs=%t fk_delete_duravel=%t reconciliador_cron=%t segredos=%t/%t cron_ativos=%d/3 conexoes_ativas=%d sync_ativo=%d conexoes_com_erro=%d erro_recente=%s jobs_na_fila=%d\n",
		audit.readOnly,
		audit.bidirectionalMigration,
		audit.foreignKeysMigration,
		audit.reliabilityMigration,
		audit.tokensTable,
		audit.eventLinksTable,
		audit.channelsTable,
		audit.syncJobsTable,
		audit.oauthStatesTable,
		audit.vaultTokenContract,
		audit.plaintextTokenColumns,
		audit.claimJobsFunction,
		audit.durableDeleteForeignKey,
		audit.reconcileCronFunction,
		audit.cronSecret,
		audit.syncBaseURLSecret,
		audit.activeCronJobs,
		audit.activeConnections,
		audit.syncEnabledConnections,
		audit.connectionsWithError,
		audit.latestErrorCategory,
		audit.pendingOrProcessingJobs,
	)
}
