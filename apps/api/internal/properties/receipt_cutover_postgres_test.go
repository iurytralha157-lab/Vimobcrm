package properties

import "testing"

func TestPropertyReceiptCutoverFromPartialSchemaPostgres(t *testing.T) {
	for _, standaloneIndex := range []bool{false, true} {
		name := "missing composite index"
		if standaloneIndex {
			name = "standalone composite index already exists"
		}
		t.Run(name, func(t *testing.T) {
			ctx, conn := propertyRemediationPostgres(t)
			if _, err := conn.Exec(ctx, `alter table public.properties drop constraint properties_organization_id_id_key;
				insert into public.properties (id, organization_id, metadata)
				values ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '{"marker":"untouched"}')`); err != nil {
				t.Fatal(err)
			}
			if standaloneIndex {
				if _, err := conn.Exec(ctx, `create unique index existing_composite_identity on public.properties(id, organization_id)`); err != nil {
					t.Fatal(err)
				}
			}
			var before, auxiliaryBefore string
			if err := conn.QueryRow(ctx, `select to_jsonb(p)::text from public.properties p`).Scan(&before); err != nil {
				t.Fatal(err)
			}
			auxiliarySQL := `select jsonb_agg(jsonb_build_object('name',relname,'acl',relacl,'rls',relrowsecurity) order by relname)::text
				from pg_class where oid in ('public.property_sequences'::regclass, 'public.property_features'::regclass,
				'public.property_proximities'::regclass,'public.property_feature_catalog'::regclass,'public.property_proximity_catalog'::regclass)`
			if err := conn.QueryRow(ctx, auxiliarySQL).Scan(&auxiliaryBefore); err != nil {
				t.Fatal(err)
			}
			for _, sql := range []string{
				propertyRemediationSQL(t, "cutovers", "20261115_prepare_property_creation_receipts.sql"),
				propertyRemediationSQL(t, "migrations", "20261012223804_persist_property_creation_receipts.sql"),
				propertyRemediationSQL(t, "cutovers/tests", "20261115_property_creation_receipt_preconditions.sql"),
				propertyRemediationSQL(t, "tests", "property_creation_receipts.sql"),
			} {
				if _, err := conn.Exec(ctx, sql); err != nil {
					t.Fatal(err)
				}
			}
			var after, auxiliaryAfter string
			if err := conn.QueryRow(ctx, `select to_jsonb(p)::text from public.properties p`).Scan(&after); err != nil || before != after {
				t.Fatalf("cutover changed the existing property: %v", err)
			}
			if err := conn.QueryRow(ctx, auxiliarySQL).Scan(&auxiliaryAfter); err != nil || auxiliaryBefore != auxiliaryAfter {
				t.Fatalf("cutover changed auxiliary access: %v", err)
			}
			if standaloneIndex {
				var redundant bool
				if err := conn.QueryRow(ctx, `select to_regclass('public.properties_organization_id_id_uidx') is not null`).Scan(&redundant); err != nil || redundant {
					t.Fatalf("cutover failed to reuse the standalone unique index: %v", err)
				}
			}
			if _, err := conn.Exec(ctx, `insert into public.properties (id, organization_id, metadata)
				values ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
				jsonb_build_object('_creation_idempotency', jsonb_build_object('actor_id','30000000-0000-4000-8000-000000000001',
				'key_hash',repeat('a',64),'request_hash',repeat('b',64))))`); err != nil {
				t.Fatal(err)
			}
			if _, err := conn.Exec(ctx, `update public.properties set metadata='{}' where id='20000000-0000-4000-8000-000000000002'`); err != nil {
				t.Fatal(err)
			}
			var preserved bool
			if err := conn.QueryRow(ctx, `select metadata ? '_creation_idempotency' from public.properties where id='20000000-0000-4000-8000-000000000002'`).Scan(&preserved); err != nil || !preserved {
				t.Fatalf("reservation did not survive a legacy metadata replacement: %v", err)
			}
			if _, err := conn.Exec(ctx, `delete from public.properties where id='20000000-0000-4000-8000-000000000002'`); err != nil {
				t.Fatal(err)
			}
			var removed bool
			if err := conn.QueryRow(ctx, `select state='removed' and property_id is null from public.property_creation_receipts`).Scan(&removed); err != nil || !removed {
				t.Fatalf("receipt did not become a durable tombstone: %v", err)
			}
		})
	}
}

func TestPropertyReceiptCutoverRejectsUnreviewedReservationsPostgres(t *testing.T) {
	ctx, conn := propertyRemediationPostgres(t)
	if _, err := conn.Exec(ctx, `alter table public.properties drop constraint properties_organization_id_id_key;
		insert into public.properties(id,organization_id,metadata)
		values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','{"_creation_idempotency":{}}')`); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(ctx, propertyRemediationSQL(t, "cutovers", "20261115_prepare_property_creation_receipts.sql")); err == nil {
		t.Fatal("unreviewed nonzero reservations must stop before installing any contract")
	}
	if _, err := conn.Exec(ctx, "rollback"); err != nil {
		t.Fatal(err)
	}
	var absent bool
	if err := conn.QueryRow(ctx, `select to_regclass('public.properties_creation_request_uidx') is null
		and to_regclass('public.properties_organization_id_id_uidx') is null
		and to_regprocedure('private.guard_property_creation_ledger()') is null`).Scan(&absent); err != nil || !absent {
		t.Fatalf("failed cutover left a partial contract: %v", err)
	}
}

func TestPropertyReceiptCutoverPreservesUnexpectedFunctionPostgres(t *testing.T) {
	ctx, conn := propertyRemediationPostgres(t)
	if _, err := conn.Exec(ctx, `alter table public.properties drop constraint properties_organization_id_id_key;
		create function private.guard_property_creation_ledger() returns trigger language plpgsql as 'begin return new; end;'`); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(ctx, propertyRemediationSQL(t, "cutovers", "20261115_prepare_property_creation_receipts.sql")); err == nil {
		t.Fatal("unexpected existing function must stop the cutover instead of being replaced")
	}
	if _, err := conn.Exec(ctx, "rollback"); err != nil {
		t.Fatal(err)
	}
	var preserved bool
	if err := conn.QueryRow(ctx, `select prosrc='begin return new; end;'
		and to_regclass('public.properties_creation_request_uidx') is null
		from pg_proc where oid='private.guard_property_creation_ledger()'::regprocedure`).Scan(&preserved); err != nil || !preserved {
		t.Fatalf("cutover modified an unreviewed function: %v", err)
	}
}
