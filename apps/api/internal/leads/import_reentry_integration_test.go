package leads

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestImportReentryLocalPostgres(t *testing.T) {
	if os.Getenv("VIMOB_RUN_CONTACTS_P1_DB_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("set VIMOB_RUN_CONTACTS_P1_DB_TESTS=LOCAL_WRITE_TEST for the disposable local Postgres regression")
	}
	connectionString := os.Getenv("CONTACTS_P1_TEST_DATABASE_URL")
	target, err := url.Parse(connectionString)
	if err != nil || (target.Scheme != "postgres" && target.Scheme != "postgresql") ||
		(target.Hostname() != "127.0.0.1" && target.Hostname() != "localhost") ||
		!strings.HasPrefix(strings.TrimPrefix(target.Path, "/"), "vimob_contacts_p1_") {
		t.Fatal("contacts P1 test requires loopback PostgreSQL and a disposable vimob_contacts_p1_ database")
	}
	connectionConfig, err := pgx.ParseConfig(connectionString)
	if err != nil || (connectionConfig.Host != "127.0.0.1" && connectionConfig.Host != "localhost") ||
		!strings.HasPrefix(connectionConfig.Database, "vimob_contacts_p1_") {
		t.Fatal("resolved contacts P1 connection must stay on loopback and use a disposable database")
	}
	for _, fallback := range connectionConfig.Fallbacks {
		if fallback.Host != "127.0.0.1" && fallback.Host != "localhost" {
			t.Fatal("contacts P1 connection cannot fall back to a remote PostgreSQL host")
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	connection, err := pgx.ConnectConfig(ctx, connectionConfig)
	if err != nil {
		t.Fatalf("connect disposable local database: %v", err)
	}
	defer connection.Close(context.Background())
	tx, err := connection.Begin(ctx)
	if err != nil {
		t.Fatalf("begin isolated import regression: %v", err)
	}
	defer tx.Rollback(context.Background())

	var empty bool
	if err := tx.QueryRow(ctx, `select to_regclass('public.leads') is null and to_regclass('public.properties') is null`).Scan(&empty); err != nil {
		t.Fatalf("check empty disposable fixtures: %v", err)
	}
	if !empty {
		t.Fatal("contacts P1 regression only creates fixtures in a database without leads/properties tables")
	}
	if _, err := tx.Exec(ctx, `
		create table public.properties (
			id uuid primary key,
			organization_id uuid not null,
			status text not null,
			published_on_site boolean not null,
			metadata jsonb not null
		);
		create table public.leads (
			id uuid primary key,
			organization_id uuid not null,
			name text not null,
			email text,
			message text,
			source text,
			phone text,
			pipeline_id uuid,
			stage_id uuid,
			stage_entered_at timestamptz,
			board_order_at timestamptz,
			deal_status text not null,
			lost_reason text,
			lost_at timestamptz,
			won_at timestamptz,
			property_id uuid,
			interest_property_id uuid,
			property_code text,
			valor_interesse numeric,
			commission_percentage numeric,
			assigned_user_id uuid,
			assigned_at timestamptz,
			team_id uuid,
			feedback text,
			metadata jsonb,
			intake_scope_key text,
			origin_round_robin_id uuid,
			last_entry_at timestamptz,
			reentry_count integer,
			updated_at timestamptz
		)
	`); err != nil {
		t.Fatalf("create transactional synthetic fixtures: %v", err)
	}

	const leadID = "88888888-8888-4888-8888-888888888888"
	const propertyID = "55555555-5555-4555-8555-555555555555"
	if _, err := tx.Exec(ctx, `
		insert into public.properties (id, organization_id, status, published_on_site, metadata)
		values ($1::uuid, $2::uuid, 'reserved', false,
			jsonb_build_object('reserved_by_lead_id', $3::text, 'reservation_event_id', 'synthetic-reservation'))
	`, propertyID, importDistributionOrganizationID, leadID); err != nil {
		t.Fatalf("create synthetic property reservation: %v", err)
	}
	propertyBefore := importReentryReadJSON(t, ctx, tx, "properties", propertyID)

	for _, status := range []string{"open", "won", "lost"} {
		for _, explicitFields := range []bool{false, true} {
			name := status + "/missing-contact-fields"
			if explicitFields {
				name = status + "/explicit-contact-fields"
			}
			t.Run(name, func(t *testing.T) {
				if _, err := tx.Exec(ctx, `delete from public.leads where id = $1::uuid`, leadID); err != nil {
					t.Fatalf("reset synthetic contact: %v", err)
				}
				if _, err := tx.Exec(ctx, `
					insert into public.leads (
						id, organization_id, name, email, message, source, phone,
						pipeline_id, stage_id, stage_entered_at, board_order_at,
						deal_status, lost_reason, lost_at, won_at, property_id,
						interest_property_id, property_code, valor_interesse, commission_percentage,
						assigned_user_id, assigned_at, team_id, feedback, metadata,
						intake_scope_key, origin_round_robin_id, last_entry_at, reentry_count, updated_at
					) values (
						$1::uuid, $2::uuid, 'Original contact', 'original@example.test', 'Original message', 'manual', '5511987654321',
						'11111111-1111-4111-8111-111111111112', '11111111-1111-4111-8111-111111111113',
						'2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z',
						$3, case when $3 = 'lost' then 'Original lost reason' else null end,
						case when $3 = 'lost' then '2026-01-03T00:00:00Z'::timestamptz else null end,
						case when $3 = 'won' then '2026-01-04T00:00:00Z'::timestamptz else null end,
						$4::uuid, $4::uuid, 'SYNTHETIC-PROPERTY', 750000, 5,
						'22222222-2222-4222-8222-222222222223', '2026-01-05T00:00:00Z',
						'22222222-2222-4222-8222-222222222224', 'Original feedback',
						'{"profile":{"cpf":"synthetic-profile"},"reservation_event_id":"synthetic-reservation"}'::jsonb,
						'synthetic-queue-scope', '33333333-3333-4333-8333-333333333334',
						'2026-01-06T00:00:00Z', 2, '2026-01-07T00:00:00Z'
					)
				`, leadID, importDistributionOrganizationID, status, propertyID); err != nil {
					t.Fatalf("insert synthetic %s contact: %v", status, err)
				}
				before := importReentryReadJSON(t, ctx, tx, "leads", leadID)
				input := createInput{
					ImportMode:     true,
					Name:           "Imported contact",
					Source:         "spreadsheet",
					DealStatus:     "open",
					LostReason:     stringPointer("Imported replacement reason"),
					PipelineID:     stringPointer("99999999-9999-4999-8999-999999999991"),
					StageID:        stringPointer("99999999-9999-4999-8999-999999999992"),
					PropertyID:     stringPointer("99999999-9999-4999-8999-999999999993"),
					InterestValue:  stringPointer("1"),
					AssignedUserID: stringPointer("99999999-9999-4999-8999-999999999994"),
					TeamID:         stringPointer("99999999-9999-4999-8999-999999999995"),
					AutoDistribute: boolPointer(true),
					RoundRobinID:   stringPointer(importDistributionQueueID),
					Metadata:       LeadMetadata{"profile": map[string]any{"cpf": "imported-replacement"}},
				}
				if explicitFields {
					input.Email = stringPointer("imported@example.test")
					input.Message = stringPointer("Imported message")
				}
				if err := applyImportReentry(ctx, tx, importDistributionOrganizationID, leadID, input); err != nil {
					t.Fatalf("apply real %s import reentry: %v", status, err)
				}
				after := importReentryReadJSON(t, ctx, tx, "leads", leadID)
				if after["name"] != input.Name || after["reentry_count"] != float64(3) || after["last_entry_at"] == before["last_entry_at"] || after["updated_at"] == before["updated_at"] {
					t.Fatal("import did not update explicit name and reentry bookkeeping")
				}
				if explicitFields {
					if after["email"] != *input.Email || after["message"] != *input.Message {
						t.Fatal("explicit imported email/message was not applied")
					}
				} else if after["email"] != before["email"] || after["message"] != before["message"] {
					t.Fatal("missing imported email/message erased stored values")
				}
				for _, allowed := range []string{"name", "email", "message", "last_entry_at", "reentry_count", "updated_at"} {
					delete(before, allowed)
					delete(after, allowed)
				}
				if !reflect.DeepEqual(before, after) {
					t.Fatal("import changed business, assignee, property, profile, origin or Kanban values")
				}
				propertyAfter := importReentryReadJSON(t, ctx, tx, "properties", propertyID)
				if !reflect.DeepEqual(propertyBefore, propertyAfter) {
					t.Fatal("import changed the synthetic property reservation")
				}
			})
		}
	}

	t.Run("foreign-organization-cannot-write", func(t *testing.T) {
		before := importReentryReadJSON(t, ctx, tx, "leads", leadID)
		err := applyImportReentry(ctx, tx, "99999999-9999-4999-8999-999999999999", leadID, createInput{ImportMode: true, Name: "Foreign contact"})
		if !errors.Is(err, ErrLeadNotFound) {
			t.Fatalf("foreign organization result = %v, want lead not found", err)
		}
		after := importReentryReadJSON(t, ctx, tx, "leads", leadID)
		if !reflect.DeepEqual(before, after) {
			t.Fatal("foreign organization changed the contact")
		}
	})
}

func importReentryReadJSON(t *testing.T, ctx context.Context, tx pgx.Tx, table, id string) map[string]any {
	t.Helper()
	query := `select to_jsonb(l) from public.leads l where id = $1::uuid`
	if table == "properties" {
		query = `select to_jsonb(p) from public.properties p where id = $1::uuid`
	}
	var raw []byte
	if err := tx.QueryRow(ctx, query, id).Scan(&raw); err != nil {
		t.Fatalf("read synthetic %s snapshot: %v", table, err)
	}
	var snapshot map[string]any
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		t.Fatalf("decode synthetic %s snapshot: %v", table, err)
	}
	return snapshot
}
