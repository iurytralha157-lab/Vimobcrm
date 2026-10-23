package properties

import (
	"context"
	"errors"
	"net/url"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func propertyHardeningFixture(t *testing.T) (*dbpkg.Postgres, []tenant.Context) {
	t.Helper()
	if os.Getenv("VIMOB_PROPERTY_HARDENING_WRITE_TEST") != "LOCAL_WRITE_TEST" {
		t.Skip("requires the isolated synthetic property database")
	}
	connection := os.Getenv("VIMOB_PROPERTY_HARDENING_TEST_DATABASE_URL")
	parsed, err := url.Parse(connection)
	if err != nil || parsed.Path != "/vimob_properties_fixes_20261012_fb58fe98" || (parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") {
		t.Fatal("property tests refuse any database except the explicitly named loopback fixture")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: connection, MaxConns: 6, MinConns: 0, HealthTimeout: 5 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(database.Close)
	var actualDatabase string
	if err := database.Pool().QueryRow(ctx, `select current_database()`).Scan(&actualDatabase); err != nil || actualDatabase != "vimob_properties_fixes_20261012_fb58fe98" {
		t.Fatal("database identity did not match fixture")
	}
	rows, err := database.Pool().Query(ctx, `select organization_id::text, user_id::text from public.organization_members where is_active and deleted_at is null order by organization_id, user_id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	actors := []tenant.Context{}
	for rows.Next() {
		actor := tenant.Context{MemberRole: "admin"}
		if err := rows.Scan(&actor.OrganizationID, &actor.UserID); err != nil {
			t.Fatal(err)
		}
		actors = append(actors, actor)
	}
	if len(actors) < 3 {
		t.Fatal("fixture needs two organizations, two actors and three memberships")
	}
	return database, actors
}

func TestPropertyCreationDurableReplayAndTenantActorIsolation(t *testing.T) {
	database, actors := propertyHardeningFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	repo := NewRepository(database, StorageConfig{})
	actor := actors[0]
	var sameOrganization, otherOrganization tenant.Context
	for _, candidate := range actors[1:] {
		if candidate.OrganizationID == actor.OrganizationID && candidate.UserID != actor.UserID {
			sameOrganization = candidate
		}
		if candidate.OrganizationID != actor.OrganizationID {
			otherOrganization = candidate
		}
	}
	if sameOrganization.UserID == "" || otherOrganization.UserID == "" {
		t.Fatal("missing cross-organization and second-actor fixture")
	}
	key, err := randomPropertyAssetUUID()
	if err != nil {
		t.Fatal(err)
	}
	input := func(title string) propertyRequest {
		value, err := (propertyRequest{"title": title, "tipo_de_imovel": "Apartamento", "tipo_de_negocio": "Venda", "status": "ativo"}).ValidateCreate()
		if err != nil {
			t.Fatal(err)
		}
		return value
	}
	const title = "Imóvel sintético de idempotência"
	var wait sync.WaitGroup
	results := make(chan Property, 4)
	failures := make(chan error, 4)
	for attempt := 0; attempt < 4; attempt++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			property, _, err := repo.CreateIdempotent(ctx, actor, input(title), key)
			if err != nil {
				failures <- err
				return
			}
			results <- property
		}()
	}
	wait.Wait()
	close(results)
	close(failures)
	for err := range failures {
		t.Fatal(err)
	}
	propertyID := ""
	for property := range results {
		if propertyID == "" {
			propertyID = anyString(property["id"])
		}
		if propertyID == "" || anyString(property["id"]) != propertyID {
			t.Fatal("concurrent request created another property")
		}
		if _, exposed := propertyMetadataMap(property["metadata"])[propertyCreationLedgerKey]; exposed {
			t.Fatal("creation ledger exposed in response")
		}
	}
	_, _, err = repo.CreateIdempotent(ctx, actor, input("Outro conteúdo"), key)
	if !errors.Is(err, ErrPropertyCreationKeyConflict) {
		t.Fatalf("key reused with changed body: %v", err)
	}
	for _, candidate := range []tenant.Context{sameOrganization, otherOrganization} {
		property, created, err := repo.CreateIdempotent(ctx, candidate, input(title), key)
		if err != nil || !created || anyString(property["id"]) == propertyID {
			t.Fatalf("actor/tenant key was shared: %v", err)
		}
	}
	_, err = database.Pool().Exec(ctx, `update public.properties set metadata = '{"unrelated":true}'::jsonb where organization_id = $1::uuid and id = $2::uuid`, actor.OrganizationID, propertyID)
	if err != nil {
		t.Fatal(err)
	}
	property, created, err := repo.CreateIdempotent(ctx, actor, input(title), key)
	if err != nil || created || anyString(property["id"]) != propertyID {
		t.Fatalf("metadata replacement lost durable retry: %v", err)
	}
	_, err = database.Pool().Exec(ctx, `update public.properties set metadata = metadata || '{"_creation_idempotency":{"actor_id":"forged"}}'::jsonb where id = $1::uuid`, propertyID)
	if err == nil {
		t.Fatal("explicit mutation of creation reservation was accepted")
	}
	// Restarting the Repository has no effect: the reservation lives in Postgres.
	restarted := NewRepository(database, StorageConfig{})
	property, created, err = restarted.CreateIdempotent(ctx, actor, input(title), key)
	if err != nil || created || anyString(property["id"]) != propertyID {
		t.Fatalf("restart lost retry: %v", err)
	}
	// Another manager's deletion must survive the original caller's lost POST
	// response and a restart. The old intent cannot create another property.
	if err := repo.Delete(ctx, sameOrganization, propertyID, DeletePropertyInput{ExpectedUpdatedAt: anyString(property["updated_at"])}); err != nil {
		t.Fatalf("manager deletion failed: %v", err)
	}
	property, created, err = NewRepository(database, StorageConfig{}).CreateIdempotent(ctx, actor, input(title), key)
	if !errors.Is(err, ErrPropertyCreationResourceRemoved) || created || property != nil {
		t.Fatalf("retry resurrected deleted property: %#v created=%v err=%v", property, created, err)
	}
	var state string
	var receiptPropertyID *string
	if err := database.Pool().QueryRow(ctx, `select state, property_id::text from public.property_creation_receipts
		where organization_id = $1::uuid and actor_id = $2::uuid and key_hash = $3`, actor.OrganizationID, actor.UserID, propertyCreationHash(key)).Scan(&state, &receiptPropertyID); err != nil || state != "removed" || receiptPropertyID != nil {
		t.Fatalf("delete did not preserve tombstone: state=%s property=%v err=%v", state, receiptPropertyID, err)
	}
	if _, _, err := restarted.CreateIdempotent(ctx, actor, input("Novo conteúdo depois da exclusão"), key); !errors.Is(err, ErrPropertyCreationKeyConflict) {
		t.Fatalf("changed removed request lost hash conflict: %v", err)
	}
	var exists bool
	if err := database.Pool().QueryRow(ctx, `select exists(select 1 from public.properties where id = $1::uuid)`, propertyID).Scan(&exists); err != nil || exists {
		t.Fatalf("removed property reappeared: exists=%v err=%v", exists, err)
	}
}

func TestOptionalPropertySQLFailureDoesNotAbortPrimaryCommit(t *testing.T) {
	database, _ := propertyHardeningFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	tx, err := database.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	err = optionalPropertyTransaction(ctx, tx, func(optional pgx.Tx) error { _, err := optional.Exec(ctx, `select 1 / 0`); return err })
	if err == nil || errors.Is(err, errPropertySavepointFailed) {
		t.Fatalf("savepoint did not isolate SQL failure: %v", err)
	}
	var value int
	if err := tx.QueryRow(ctx, `select 42`).Scan(&value); err != nil || value != 42 {
		t.Fatalf("primary transaction remains aborted: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("primary commit failed after recovered optional work: %v", err)
	}
}

func TestPropertyCreationLegacyInsertCapturesImmutableDeletionReceipt(t *testing.T) {
	database, actors := propertyHardeningFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	actor := actors[0]
	repo := NewRepository(database, StorageConfig{})
	key, err := randomPropertyAssetUUID()
	if err != nil {
		t.Fatal(err)
	}
	input, err := (propertyRequest{"title": "Cadastro legado sintético", "tipo_de_imovel": "Apartamento", "tipo_de_negocio": "Venda", "status": "ativo"}).ValidateCreate()
	if err != nil {
		t.Fatal(err)
	}
	fingerprint, err := propertyCreationFingerprint(input)
	if err != nil {
		t.Fatal(err)
	}
	legacy := propertyRequest{}
	for field, value := range input {
		legacy[field] = value
	}
	legacy["metadata"] = jsonb(map[string]any{propertyCreationLedgerKey: map[string]string{
		"actor_id": actor.UserID, "key_hash": propertyCreationHash(key), "request_hash": fingerprint,
	}})
	tx, err := database.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	property, err := repo.createPropertyTx(ctx, tx, actor, legacy)
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	propertyID := anyString(property["id"])
	var captured string
	if err := database.Pool().QueryRow(ctx, `select property_id::text from public.property_creation_receipts
		where organization_id = $1::uuid and actor_id = $2::uuid and key_hash = $3`, actor.OrganizationID, actor.UserID, propertyCreationHash(key)).Scan(&captured); err != nil || captured != propertyID {
		t.Fatalf("older replica did not capture receipt: id=%s err=%v", captured, err)
	}
	if _, err := database.Pool().Exec(ctx, `update public.property_creation_receipts set request_hash = repeat('b', 64)
		where organization_id = $1::uuid and property_id = $2::uuid`, actor.OrganizationID, propertyID); err == nil {
		t.Fatal("receipt hash was reassigned")
	}
	if _, err := database.Pool().Exec(ctx, `update public.property_creation_receipts set property_id = null
		where organization_id = $1::uuid and property_id = $2::uuid`, actor.OrganizationID, propertyID); err == nil {
		t.Fatal("receipt was detached from a live property")
	}
	if err := repo.Delete(ctx, actor, propertyID, DeletePropertyInput{ExpectedUpdatedAt: anyString(property["updated_at"])}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.CreateIdempotent(ctx, actor, input, key); !errors.Is(err, ErrPropertyCreationResourceRemoved) {
		t.Fatalf("legacy retry recreated deleted resource: %v", err)
	}
	if _, err := database.Pool().Exec(ctx, `update public.property_creation_receipts set property_id = $1::uuid, state = 'created'
		where organization_id = $2::uuid and actor_id = $3::uuid and key_hash = $4`, propertyID, actor.OrganizationID, actor.UserID, propertyCreationHash(key)); err == nil {
		t.Fatal("removed receipt was revived")
	}
}
