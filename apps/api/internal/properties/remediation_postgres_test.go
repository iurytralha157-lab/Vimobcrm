package properties

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// This fixture owns a new database; it never borrows a tenant or application DB.
func propertyRemediationPostgres(t *testing.T) (context.Context, *pgx.Conn) {
	t.Helper()
	if os.Getenv("VIMOB_PROPERTY_REMEDIATION_WRITE_TEST") != "LOCAL_WRITE_TEST" {
		t.Skip("requires an explicitly authorized disposable loopback PostgreSQL")
	}
	config, err := propertyRemediationTestConfig(os.Getenv("VIMOB_PROPERTY_REMEDIATION_ADMIN_URL"))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	t.Cleanup(cancel)
	admin, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	var suffix [8]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		admin.Close(ctx)
		t.Fatal(err)
	}
	name := "vimob_properties_remediation_" + hex.EncodeToString(suffix[:])
	identifier := pgx.Identifier{name}.Sanitize()
	if _, err := admin.Exec(ctx, "create database "+identifier); err != nil {
		admin.Close(ctx)
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, done := context.WithTimeout(context.Background(), 30*time.Second)
		defer done()
		if _, err := admin.Exec(cleanup, "drop database "+identifier); err != nil {
			t.Errorf("drop owned property fixture: %v", err)
		}
		admin.Close(cleanup)
	})
	config.Database = name
	conn, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close(context.Background()) })
	_, err = conn.Exec(ctx, `
		create schema private;
		create table public.organizations (id uuid primary key);
		create table public.users (id uuid primary key, name text, email text);
		create table public.properties (
			id uuid primary key, organization_id uuid not null references public.organizations,
			metadata jsonb not null default '{}', created_at timestamptz default now(), updated_at timestamptz default now(),
			portfolio_type text default 'primary', third_party_kind text, partner_name text, partner_contact text,
			commission_split_percent numeric, third_party_authorized_until timestamptz,
			created_by uuid, responsible_user_id uuid, tipo text, tipo_de_imovel text, title text, code text,
			status text, preco numeric, valor_locacao numeric, published_on_site boolean,
			owner_id uuid, owner_name text, owner_phone_residential text, owner_phone_commercial text,
			owner_cellphone text, owner_email text, owner_media_source text, origin_media text,
			owner_notify_email boolean, finalidade text, tipo_de_negocio text, aceita_financiamento boolean,
			condominio numeric, iptu numeric, unique (organization_id, id)
		);
		create table public.events (organization_id uuid, event_type text, entity_type text, entity_id uuid, payload jsonb, status text);
		create table public.property_sequences (organization_id uuid);
		create table public.property_feature_catalog (organization_id uuid);
		create table public.property_proximity_catalog (organization_id uuid);
		create table public.property_features (organization_id uuid);
		create table public.property_proximities (organization_id uuid);
		create function private.has_permission(uuid, text) returns boolean language sql as 'select false';
		insert into public.organizations values ('10000000-0000-4000-8000-000000000001'), ('10000000-0000-4000-8000-000000000002');
	`)
	if err != nil {
		t.Fatal(err)
	}
	return ctx, conn
}

func propertyRemediationTestConfig(dsn string) (*pgx.ConnConfig, error) {
	invalid := errors.New("property remediation fixture requires a loopback postgres administration database")
	config, err := pgx.ParseConfig(dsn)
	if err != nil || config.Database != "postgres" || (config.Host != "127.0.0.1" && config.Host != "localhost") {
		return nil, invalid
	}
	for _, fallback := range config.Fallbacks {
		if fallback.Host != "127.0.0.1" && fallback.Host != "localhost" {
			return nil, invalid
		}
	}
	return config, nil
}

func TestPropertyRemediationConfigRejectsUnsafeTargetsBeforeConnecting(t *testing.T) {
	for _, dsn := range []string{
		"postgresql://postgres@remote.example/postgres?sslmode=disable",
		"postgresql://postgres@127.0.0.1/application_database?sslmode=disable",
		"postgresql://postgres@127.0.0.1/postgres?host=127.0.0.1,remote.example&sslmode=disable",
		"postgresql://postgres@localhost/postgres?host=localhost,remote.example&sslmode=prefer",
	} {
		if _, err := propertyRemediationTestConfig(dsn); err == nil {
			t.Fatal("unsafe primary or fallback target was accepted")
		}
	}
	if _, err := propertyRemediationTestConfig("postgresql://postgres@127.0.0.1/postgres?host=127.0.0.1,localhost&sslmode=prefer"); err != nil {
		t.Fatalf("all-loopback fallback should remain valid: %v", err)
	}
}

func propertyRemediationSQL(t *testing.T, directory, name string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "supabase", directory, name))
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestPropertyReceiptCanonicalMigrationAndTombstonesPostgres(t *testing.T) {
	ctx, conn := propertyRemediationPostgres(t)
	if _, err := conn.Exec(ctx, propertyRemediationSQL(t, "migrations", "20261012212534_harden_property_creation_and_auxiliary_access.sql")); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(ctx, `insert into public.properties (id, organization_id, metadata)
		select ('20000000-0000-4000-8000-00000000000' || suffix)::uuid,
		('10000000-0000-4000-8000-00000000000' || suffix)::uuid,
		jsonb_build_object('_creation_idempotency', jsonb_build_object(
		'actor_id', '30000000-0000-4000-8000-000000000001', 'key_hash', repeat('a',64), 'request_hash', repeat('b',64)))
		from unnest(array['1','2']) suffix`); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(ctx, propertyRemediationSQL(t, "migrations", "20261012223804_persist_property_creation_receipts.sql")); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(ctx, propertyRemediationSQL(t, "tests", "property_creation_receipts.sql")); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := conn.QueryRow(ctx, `select count(*) from public.property_creation_receipts`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("cross-organization backfill count = %d, error %v", count, err)
	}
	// Old replicas' metadata-ledger writes must also produce an independent receipt.
	if _, err := conn.Exec(ctx, `insert into public.properties (id, organization_id, metadata) values (
		'20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001',
		jsonb_build_object('_creation_idempotency', jsonb_build_object(
		'actor_id', '30000000-0000-4000-8000-000000000002', 'key_hash', repeat('a',64), 'request_hash', repeat('b',64))))`); err != nil {
		t.Fatal(err)
	}
	if err := conn.QueryRow(ctx, `select count(*) from public.property_creation_receipts`).Scan(&count); err != nil || count != 3 {
		t.Fatalf("legacy capture count = %d, error %v", count, err)
	}
	if _, err := conn.Exec(ctx, `delete from public.properties where id = '20000000-0000-4000-8000-000000000001'`); err != nil {
		t.Fatal(err)
	}
	var tombstones int
	if err := conn.QueryRow(ctx, `select count(*) from public.property_creation_receipts where state = 'removed' and property_id is null`).Scan(&tombstones); err != nil || tombstones != 1 {
		t.Fatalf("durable tombstone count = %d, error %v", tombstones, err)
	}
	for _, sql := range []string{
		`update public.property_creation_receipts set request_hash = repeat('c',64)`,
		`update public.property_creation_receipts set property_id = '20000000-0000-4000-8000-000000000003', state = 'created' where state = 'removed'`,
	} {
		_, err := conn.Exec(ctx, sql)
		var databaseError *pgconn.PgError
		if !errors.As(err, &databaseError) || databaseError.Code != "23514" {
			t.Fatalf("receipt mutation must be rejected with 23514: %v", err)
		}
	}
}

func TestPropertyReceiptInvalidBackfillRollsBackPostgres(t *testing.T) {
	ctx, conn := propertyRemediationPostgres(t)
	if _, err := conn.Exec(ctx, propertyRemediationSQL(t, "migrations", "20261012212534_harden_property_creation_and_auxiliary_access.sql")); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(ctx, `insert into public.properties (id, organization_id, metadata) values (
		'20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
		'{"_creation_idempotency":{"actor_id":"invalid","key_hash":"invalid"}}')`); err != nil {
		t.Fatal(err)
	}
	_, err := conn.Exec(ctx, propertyRemediationSQL(t, "migrations", "20261012223804_persist_property_creation_receipts.sql"))
	var databaseError *pgconn.PgError
	if !errors.As(err, &databaseError) || databaseError.Code != "23514" {
		t.Fatalf("invalid legacy receipt must abort the canonical migration: %v", err)
	}
	if _, err := conn.Exec(ctx, "rollback"); err != nil {
		t.Fatal(err)
	}
	var exists bool
	if err := conn.QueryRow(ctx, `select to_regclass('public.property_creation_receipts') is not null`).Scan(&exists); err != nil || exists {
		t.Fatalf("failed migration left a partial receipt schema: exists %v, error %v", exists, err)
	}
}

func TestPropertyHistorySnapshotAndEventPostgres(t *testing.T) {
	ctx, conn := propertyRemediationPostgres(t)
	if _, err := conn.Exec(ctx, `insert into public.properties (id, organization_id, title, status, preco, valor_locacao)
		values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Imóvel sintético', 'active', 250000, 0)`); err != nil {
		t.Fatal(err)
	}
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	actor := tenant.Context{OrganizationID: "10000000-0000-4000-8000-000000000001", UserID: "30000000-0000-4000-8000-000000000001"}
	repo := Repository{}
	current, err := repo.getSnapshotForUpdate(ctx, tx, actor.OrganizationID, "20000000-0000-4000-8000-000000000001")
	if err != nil {
		t.Fatal(err)
	}
	if current.Price == nil || *current.Price != 250000 || current.RentalPrice == nil || *current.RentalPrice != 0 {
		t.Fatalf("snapshot did not preserve numeric values: %#v", current)
	}
	input := propertyRequest{"status": "ativo", "preco": 250000.0, "valor_locacao": 0.0, "comentarios_internos": "Comentário sintético"}
	if err := repo.insertPropertyUpdatedActivity(ctx, tx, actor, current, input, Property{"id": current.ID}); err != nil {
		t.Fatal(err)
	}
	var eventType, payload string
	if err := tx.QueryRow(ctx, `select event_type, payload::text from public.events`).Scan(&eventType, &payload); err != nil {
		t.Fatal(err)
	}
	var event map[string]any
	if err := json.Unmarshal([]byte(payload), &event); err != nil {
		t.Fatal(err)
	}
	if eventType != "property_updated" || len(event["changes"].(map[string]any)) != 0 {
		t.Fatalf("full form invented a status or price transition: %s %s", eventType, payload)
	}
}
