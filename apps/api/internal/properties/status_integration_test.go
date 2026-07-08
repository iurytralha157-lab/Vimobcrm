package properties

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestDatabaseAllowsReservedPropertyStatus(t *testing.T) {
	if os.Getenv("VIMOB_RUN_DB_TESTS") != "1" {
		t.Skip("set VIMOB_RUN_DB_TESTS=1 to run database integration tests")
	}

	databaseURL := os.Getenv("DATABASE_URL")
	if strings.TrimSpace(databaseURL) == "" {
		t.Fatal("DATABASE_URL is required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:           databaseURL,
		MaxConns:      1,
		MinConns:      0,
		HealthTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("NewPostgres() returned error: %v", err)
	}
	defer postgres.Close()

	tx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatalf("Begin() returned error: %v", err)
	}
	defer tx.Rollback(ctx)

	var propertyID string
	err = tx.QueryRow(ctx, `
		select id::text
		from public.properties
		limit 1
	`).Scan(&propertyID)
	if errors.Is(err, pgx.ErrNoRows) {
		t.Skip("no properties available to validate status update")
	}
	if err != nil {
		t.Fatalf("property lookup returned error: %v", err)
	}

	if _, err := tx.Exec(ctx, `
		update public.properties
		set status = 'active'
		where id = $1::uuid
	`, propertyID); err != nil {
		t.Fatalf("preparing property status returned error: %v", err)
	}

	if _, err := tx.Exec(ctx, `
		update public.properties
		set status = 'reserved'
		where id = $1::uuid
	`, propertyID); err != nil {
		t.Fatalf("updating property status to reserved returned error: %v", err)
	}

	var status string
	if err := tx.QueryRow(ctx, `
		select status
		from public.properties
		where id = $1::uuid
	`, propertyID).Scan(&status); err != nil {
		t.Fatalf("reserved status lookup returned error: %v", err)
	}
	if status != "reserved" {
		t.Fatalf("property status = %q, want reserved", status)
	}

	var definition string
	err = tx.QueryRow(ctx, `
		select pg_get_constraintdef(c.oid)
		from pg_constraint c
		join pg_class r
		  on r.oid = c.conrelid
		join pg_namespace n
		  on n.oid = r.relnamespace
		where n.nspname = 'public'
		  and r.relname = 'properties'
		  and c.conname = 'properties_status_check'
	`).Scan(&definition)
	if errors.Is(err, pgx.ErrNoRows) {
		return
	}
	if err != nil {
		t.Fatalf("properties_status_check lookup returned error: %v", err)
	}
	if !strings.Contains(definition, "'reserved'") {
		t.Fatalf("properties_status_check = %s, want reserved status allowed", definition)
	}
}
