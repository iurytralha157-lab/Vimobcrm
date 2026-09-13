package main

import (
	"context"
	"fmt"
	"os"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func main() {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		fmt.Fprintln(os.Stderr, "DATABASE_URL nao foi informada.")
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL: databaseURL, MaxConns: 1, MinConns: 0, ForceReadOnly: true, HealthTimeout: 10 * time.Second,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "Falha ao abrir a conexao somente leitura.")
		os.Exit(1)
	}
	defer postgres.Close()

	var readOnly string
	if err := postgres.Pool().QueryRow(ctx, "show default_transaction_read_only").Scan(&readOnly); err != nil || readOnly != "on" {
		fmt.Fprintln(os.Stderr, "A conexao nao confirmou default_transaction_read_only=on.")
		os.Exit(1)
	}
	fmt.Println("default_transaction_read_only=on")

	rows, err := postgres.Pool().Query(ctx, `
		select portal, status, is_active, count(*)::bigint,
		       max(last_feed_accessed_at)::text
		from public.portal_integrations
		group by portal, status, is_active
		order by portal, status, is_active
	`)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Falha ao consultar o resumo de integracoes de portal.")
		os.Exit(1)
	}
	defer rows.Close()
	integrationGroups := 0
	for rows.Next() {
		integrationGroups++
		var portal, status string
		var active bool
		var count int64
		var lastFeed *string
		if err := rows.Scan(&portal, &status, &active, &count, &lastFeed); err != nil {
			fmt.Fprintln(os.Stderr, "Falha ao ler o resumo de integracoes de portal.")
			os.Exit(1)
		}
		lastFeedText := "never"
		if lastFeed != nil {
			lastFeedText = *lastFeed
		}
		fmt.Printf("integration portal=%s status=%s active=%t count=%d last_feed_max=%s\n", portal, status, active, count, lastFeedText)
	}
	if err := rows.Err(); err != nil {
		fmt.Fprintln(os.Stderr, "Falha durante a leitura do resumo de integracoes de portal.")
		os.Exit(1)
	}
	if integrationGroups == 0 {
		fmt.Println("integration_groups=0")
	}

	constraintRows, err := postgres.Pool().Query(ctx, `
		select relation.relname, constraint_row.conname,
		       constraint_row.convalidated,
		       pg_get_constraintdef(constraint_row.oid)
		from pg_constraint constraint_row
		join pg_class relation on relation.oid = constraint_row.conrelid
		join pg_namespace namespace on namespace.oid = relation.relnamespace
		where namespace.nspname = 'public'
		  and relation.relname in (
		    'portal_integrations', 'portal_listing_publications',
		    'portal_import_reports', 'portal_webhook_events'
		  )
		  and constraint_row.conname like '%portal_check'
		order by relation.relname, constraint_row.conname
	`)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Falha ao consultar os CHECKs de portal.")
		os.Exit(1)
	}
	defer constraintRows.Close()
	for constraintRows.Next() {
		var tableName, constraintName, definition string
		var validated bool
		if err := constraintRows.Scan(&tableName, &constraintName, &validated, &definition); err != nil {
			fmt.Fprintln(os.Stderr, "Falha ao ler os CHECKs de portal.")
			os.Exit(1)
		}
		fmt.Printf("constraint table=%s name=%s validated=%t definition=%s\n", tableName, constraintName, validated, definition)
	}
	if err := constraintRows.Err(); err != nil {
		fmt.Fprintln(os.Stderr, "Falha durante a leitura dos CHECKs de portal.")
		os.Exit(1)
	}
}
