package properties

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestUpsertPropertyOfferConcurrencyAndWorkspaceRedactionAgainstDatabase(t *testing.T) {
	if os.Getenv("VIMOB_RUN_DB_TESTS") != "1" {
		t.Skip("set VIMOB_RUN_DB_TESTS=1 to run database integration tests")
	}
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if databaseURL == "" {
		t.Fatal("DATABASE_URL is required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL: databaseURL, MaxConns: 3, MinConns: 0, HealthTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("NewPostgres() returned error: %v", err)
	}
	t.Cleanup(postgres.Close)

	var organizationID, userID string
	err = postgres.Pool().QueryRow(ctx, `
		select member.organization_id::text, member.user_id::text
		from public.organization_members as member
		join public.users as app_user on app_user.id = member.user_id
		where coalesce(member.is_active, true)
		  and coalesce(app_user.is_active, true)
		order by member.created_at, member.user_id
		limit 1
	`).Scan(&organizationID, &userID)
	if errors.Is(err, pgx.ErrNoRows) {
		t.Skip("no active organization member is available")
	}
	if err != nil {
		t.Fatalf("organization fixture lookup returned error: %v", err)
	}

	var propertyID string
	code := fmt.Sprintf("WS-%d", time.Now().UnixNano())
	err = postgres.Pool().QueryRow(ctx, `
		insert into public.properties (
			organization_id, code, title, tipo, tipo_de_imovel, status,
			created_by, responsible_user_id
		)
		values ($1::uuid, $2, 'Workspace integration fixture', 'Apartamento', 'Apartamento', 'active', $3::uuid, $3::uuid)
		returning id::text
	`, organizationID, code, userID).Scan(&propertyID)
	if err != nil {
		t.Fatalf("property fixture insert returned error: %v", err)
	}
	t.Cleanup(func() {
		cleanupContext, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		if _, cleanupErr := postgres.Pool().Exec(cleanupContext, `
			delete from public.schedule_events
			where organization_id = $1::uuid and property_id = $2::uuid
		`, organizationID, propertyID); cleanupErr != nil {
			t.Errorf("schedule fixture cleanup returned error: %v", cleanupErr)
			return
		}
		if _, cleanupErr := postgres.Pool().Exec(cleanupContext, `
			delete from public.property_key_movements
			where organization_id = $1::uuid
			  and property_key_id in (
				select id
				from public.property_keys
				where organization_id = $1::uuid and property_id = $2::uuid
			  )
		`, organizationID, propertyID); cleanupErr != nil {
			t.Errorf("property movement fixture cleanup returned error: %v", cleanupErr)
			return
		}
		if _, cleanupErr := postgres.Pool().Exec(cleanupContext, `
			delete from public.properties where organization_id = $1::uuid and id = $2::uuid
		`, organizationID, propertyID); cleanupErr != nil {
			t.Errorf("property fixture cleanup returned error: %v", cleanupErr)
		}
	})

	repository := NewRepository(postgres, StorageConfig{})
	manager := tenant.Context{
		OrganizationID: organizationID,
		UserID:         userID,
		MemberRole:     "admin",
	}
	var scheduleID string
	err = postgres.Pool().QueryRow(ctx, `
		insert into public.schedule_events (
			organization_id, user_id, property_id, title, description,
			event_type, start_time, end_time
		)
		values (
			$1::uuid, $2::uuid, $3::uuid,
			'Cliente privado: Maria', 'Telefone privado: 11999999999',
			'visit', now() + interval '1 day', now() + interval '1 day 1 hour'
		)
		returning id::text
	`, organizationID, userID, propertyID).Scan(&scheduleID)
	if err != nil {
		t.Fatalf("schedule fixture insert returned error: %v", err)
	}

	history, err := repository.ListHistory(ctx, manager, propertyID)
	if err != nil {
		t.Fatalf("property history returned error: %v", err)
	}
	var scheduleEvent *HistoryEvent
	for index := range history {
		if history[index].ID == scheduleID {
			scheduleEvent = &history[index]
			break
		}
	}
	if scheduleEvent == nil {
		t.Fatalf("property history omitted schedule fixture %s", scheduleID)
	}
	if scheduleEvent.Title != "Agendamento vinculado ao imovel" {
		t.Fatalf("schedule history title leaked private content: %q", scheduleEvent.Title)
	}
	for _, field := range []string{"title", "description", "user_id", "lead_id"} {
		if _, leaked := scheduleEvent.Metadata[field]; leaked {
			t.Fatalf("schedule history leaked %s: %#v", field, scheduleEvent.Metadata)
		}
	}
	_, err = repository.ListHistory(ctx, tenant.Context{
		OrganizationID: organizationID,
		UserID:         "00000000-0000-4000-8000-000000000099",
		MemberRole:     "user",
		Permissions:    []string{"property_view"},
	}, propertyID)
	if !errors.Is(err, ErrPropertyNotFound) {
		t.Fatalf("property history canonical scope error = %v, want property not found", err)
	}

	// Creating a canonical sale property also creates its compatibility offer.
	// Treat that generated row as the representation being replaced: a blind
	// write here must conflict just like it does for the product UI, which reads
	// the workspace offer version before editing it.
	var compatibilitySaleUpdatedAt time.Time
	var compatibilitySource string
	err = postgres.Pool().QueryRow(ctx, `
		select offer.updated_at, coalesce(offer.metadata ->> 'compatibility_source', '')
		from public.property_offers as offer
		where offer.organization_id = $1::uuid
		  and offer.property_id = $2::uuid
		  and offer.offer_type = 'sale'
	`, organizationID, propertyID).Scan(&compatibilitySaleUpdatedAt, &compatibilitySource)
	if err != nil {
		t.Fatalf("compatibility sale fixture lookup returned error: %v", err)
	}
	if compatibilitySource != "properties" {
		t.Fatalf("compatibility sale source = %q, want properties", compatibilitySource)
	}
	compatibilitySaleVersion := compatibilitySaleUpdatedAt.Format(time.RFC3339Nano)

	salePrice := 950000.0
	saleInput := UpsertPropertyOfferInput{
		Status:            "active",
		Price:             &salePrice,
		Currency:          "BRL",
		Terms:             map[string]any{"commission": 6.0},
		Metadata:          map[string]any{"internal_note": "manager only"},
		ExpectedUpdatedAt: &compatibilitySaleVersion,
	}
	createdSale, err := repository.UpsertPropertyOffer(ctx, manager, propertyID, "sale", saleInput)
	if err != nil {
		t.Fatalf("versioned compatibility sale update returned error: %v", err)
	}
	createdSaleUpdatedAt := workspaceString(createdSale, "updated_at")
	createdSaleID := workspaceString(createdSale, "id")
	if createdSaleUpdatedAt == "" || createdSaleID == "" {
		t.Fatalf("sale response omitted concurrency identity: %#v", createdSale)
	}
	if _, leaked := createdSale["created_by"]; leaked {
		t.Fatalf("offer response leaked a non-contract column: %#v", createdSale)
	}

	replayedSale, err := repository.UpsertPropertyOffer(ctx, manager, propertyID, "sale", saleInput)
	if err != nil {
		t.Fatalf("same-state PUT retry returned error: %v", err)
	}
	if workspaceString(replayedSale, "id") != createdSaleID || workspaceString(replayedSale, "updated_at") != createdSaleUpdatedAt {
		t.Fatalf("same-state retry was not idempotent: created=%#v replay=%#v", createdSale, replayedSale)
	}

	conflictingPrice := 975000.0
	_, err = repository.UpsertPropertyOffer(ctx, manager, propertyID, "sale", UpsertPropertyOfferInput{
		Status: "active", Price: &conflictingPrice, Currency: "BRL",
	})
	if !errors.Is(err, ErrPropertyWorkspaceConflict) {
		t.Fatalf("blind overwrite error = %v, want workspace conflict", err)
	}

	updatedSaleInput := UpsertPropertyOfferInput{
		Status: "active", Price: &conflictingPrice, Currency: "BRL",
		Terms: map[string]any{"commission": 5.5}, Metadata: map[string]any{},
		ExpectedUpdatedAt: &createdSaleUpdatedAt,
	}
	updatedSale, err := repository.UpsertPropertyOffer(ctx, manager, propertyID, "sale", updatedSaleInput)
	if err != nil {
		t.Fatalf("versioned sale update returned error: %v", err)
	}
	if workspaceString(updatedSale, "updated_at") == createdSaleUpdatedAt {
		t.Fatalf("versioned sale update did not advance updated_at: %#v", updatedSale)
	}

	stalePrice := 990000.0
	_, err = repository.UpsertPropertyOffer(ctx, manager, propertyID, "sale", UpsertPropertyOfferInput{
		Status: "active", Price: &stalePrice, Currency: "BRL", ExpectedUpdatedAt: &createdSaleUpdatedAt,
	})
	if !errors.Is(err, ErrPropertyWorkspaceConflict) {
		t.Fatalf("stale update error = %v, want workspace conflict", err)
	}

	_, err = repository.UpsertPropertyOffer(ctx, manager, propertyID, "rent", UpsertPropertyOfferInput{
		Status: "active", Price: &stalePrice, Currency: "BRL", ExpectedUpdatedAt: &createdSaleUpdatedAt,
	})
	if !errors.Is(err, ErrPropertyWorkspaceConflict) {
		t.Fatalf("create with a foreign version error = %v, want workspace conflict", err)
	}

	seasonalPrice := 650.0
	seasonal, err := repository.UpsertPropertyOffer(ctx, manager, propertyID, "seasonal", UpsertPropertyOfferInput{
		Status: "active", Price: &seasonalPrice, Currency: "BRL",
	})
	if err != nil {
		t.Fatalf("seasonal create returned error: %v", err)
	}
	var legacyRentalPrice float64
	if err := postgres.Pool().QueryRow(ctx, `
		select valor_locacao::float8 from public.properties where id = $1::uuid
	`, propertyID).Scan(&legacyRentalPrice); err != nil || legacyRentalPrice != seasonalPrice {
		t.Fatalf("seasonal legacy projection = %v, %v; want %.2f", legacyRentalPrice, err, seasonalPrice)
	}

	rentPrice := 4200.0
	_, err = repository.UpsertPropertyOffer(ctx, manager, propertyID, "rent", UpsertPropertyOfferInput{
		Status: "active", Price: &rentPrice, Currency: "BRL",
	})
	if err != nil {
		t.Fatalf("rent create returned error: %v", err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select valor_locacao::float8 from public.properties where id = $1::uuid
	`, propertyID).Scan(&legacyRentalPrice); err != nil || legacyRentalPrice != rentPrice {
		t.Fatalf("rent legacy projection = %v, %v; want %.2f", legacyRentalPrice, err, rentPrice)
	}

	seasonalUpdatedAt := workspaceString(seasonal, "updated_at")
	seasonalPrice = 700.0
	_, err = repository.UpsertPropertyOffer(ctx, manager, propertyID, "seasonal", UpsertPropertyOfferInput{
		Status: "active", Price: &seasonalPrice, Currency: "BRL", ExpectedUpdatedAt: &seasonalUpdatedAt,
	})
	if err != nil {
		t.Fatalf("seasonal update returned error: %v", err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select valor_locacao::float8 from public.properties where id = $1::uuid
	`, propertyID).Scan(&legacyRentalPrice); err != nil || legacyRentalPrice != rentPrice {
		t.Fatalf("seasonal update overwrote long-term rent projection: %v, %v", legacyRentalPrice, err)
	}

	key, err := repository.CreatePropertyKey(ctx, manager, propertyID, CreatePropertyKeyInput{
		Label: "Chave segura", Metadata: map[string]any{"locker": "secret"},
	})
	if err != nil {
		t.Fatalf("key create returned error: %v", err)
	}
	holder := "Corretora Teste"
	movementInput := PropertyKeyMovementInput{
		MovementType: "checkout", HolderName: &holder,
		IdempotencyKey: "workspace-integration-" + propertyID,
		Metadata:       map[string]any{"reason": "visit"},
	}
	firstMovement, err := repository.AppendPropertyKeyMovement(ctx, manager, propertyID, workspaceString(key, "id"), movementInput)
	if err != nil {
		t.Fatalf("key checkout returned error: %v", err)
	}
	replayedMovement, err := repository.AppendPropertyKeyMovement(ctx, manager, propertyID, workspaceString(key, "id"), movementInput)
	if err != nil {
		t.Fatalf("key movement retry returned error: %v", err)
	}
	if workspaceString(firstMovement.Movement, "id") != workspaceString(replayedMovement.Movement, "id") {
		t.Fatalf("key movement retry created another event: first=%#v replay=%#v", firstMovement, replayedMovement)
	}
	if firstMovement.Movement["idempotency_key"] != nil {
		t.Fatalf("movement response echoed its idempotency key: %#v", firstMovement.Movement)
	}

	viewerWorkspace, err := repository.GetWorkspace(ctx, tenant.Context{
		OrganizationID: organizationID,
		UserID:         userID,
		MemberRole:     "user",
		Permissions:    []string{"property_view"},
	}, propertyID)
	if err != nil {
		t.Fatalf("viewer workspace returned error: %v", err)
	}
	if viewerWorkspace.Meta.CanManage || len(viewerWorkspace.Data.Keys) != 0 || len(viewerWorkspace.Data.RecentKeyMovements) != 0 {
		t.Fatalf("viewer workspace exposed physical custody data: %#v", viewerWorkspace)
	}
	for _, offer := range viewerWorkspace.Data.Offers {
		if terms, ok := offer["terms"].(map[string]any); !ok || len(terms) != 0 {
			t.Fatalf("viewer offer terms were not redacted: %#v", offer)
		}
		if metadata, ok := offer["metadata"].(map[string]any); !ok || len(metadata) != 0 {
			t.Fatalf("viewer offer metadata was not redacted: %#v", offer)
		}
	}

	_, err = repository.GetWorkspace(ctx, tenant.Context{
		OrganizationID: organizationID,
		UserID:         "00000000-0000-4000-8000-000000000099",
		MemberRole:     "user",
		Permissions:    []string{"property_view"},
	}, propertyID)
	if !errors.Is(err, ErrPropertyNotFound) {
		t.Fatalf("workspace canonical scope error = %v, want property not found", err)
	}

	managerWorkspace, err := repository.GetWorkspace(ctx, manager, propertyID)
	if err != nil {
		t.Fatalf("manager workspace returned error: %v", err)
	}
	if !managerWorkspace.Meta.CanManage || len(managerWorkspace.Data.Keys) != 1 {
		t.Fatalf("manager workspace omitted operational custody data: %#v", managerWorkspace)
	}
}

func TestOwnershipPrimarySplitAndExternalAssetLifecycleAgainstDatabase(t *testing.T) {
	if os.Getenv("VIMOB_RUN_DB_TESTS") != "1" {
		t.Skip("set VIMOB_RUN_DB_TESTS=1 to run database integration tests")
	}
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if databaseURL == "" {
		t.Fatal("DATABASE_URL is required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL: databaseURL, MaxConns: 3, MinConns: 0, HealthTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("NewPostgres() returned error: %v", err)
	}
	t.Cleanup(postgres.Close)

	fixtureSuffix := fmt.Sprintf("%d", time.Now().UnixNano())
	var organizationID, userID, boundary string
	err = postgres.Pool().QueryRow(ctx, `
		select gen_random_uuid()::text, gen_random_uuid()::text, current_date::text
	`).Scan(&organizationID, &userID, &boundary)
	if err != nil {
		t.Fatalf("fixture identity generation returned error: %v", err)
	}
	email := "ownership-assets-" + fixtureSuffix + "@example.invalid"
	fixtureTx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatalf("begin fixture identity transaction returned error: %v", err)
	}
	defer fixtureTx.Rollback(ctx)
	if _, err := fixtureTx.Exec(ctx, `
		insert into public.organizations (id, name, slug, is_active)
		values ($1::uuid, $2, $3, true)
	`, organizationID, "Ownership Asset Integration", "ownership-assets-"+fixtureSuffix); err != nil {
		t.Fatalf("organization fixture insert returned error: %v", err)
	}
	if _, err := fixtureTx.Exec(ctx, `
		insert into auth.users (
			id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		)
		values (
			$1::uuid, 'authenticated', 'authenticated', $2, '', now(),
			'{}'::jsonb, '{}'::jsonb, now(), now()
		)
	`, userID, email); err != nil {
		t.Fatalf("auth user fixture insert returned error: %v", err)
	}
	if _, err := fixtureTx.Exec(ctx, `
		insert into public.users (id, organization_id, name, email, role, is_active)
		values ($1::uuid, $2::uuid, 'Ownership Asset Admin', $3, 'admin', true)
		on conflict (id) do update
		set organization_id = excluded.organization_id,
			name = excluded.name,
			email = excluded.email,
			role = excluded.role,
			is_active = excluded.is_active
	`, userID, organizationID, email); err != nil {
		t.Fatalf("public user fixture insert returned error: %v", err)
	}
	if _, err := fixtureTx.Exec(ctx, `
		insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($1::uuid, $2::uuid, 'admin', true)
		on conflict (user_id, organization_id) do update
		set role = excluded.role, is_active = excluded.is_active
	`, organizationID, userID); err != nil {
		t.Fatalf("organization membership fixture insert returned error: %v", err)
	}
	if err := fixtureTx.Commit(ctx); err != nil {
		t.Fatalf("fixture identity commit returned error: %v", err)
	}
	t.Cleanup(func() {
		cleanupContext, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		if _, cleanupErr := postgres.Pool().Exec(cleanupContext, `
			update public.users set organization_id = null
			where id = $1::uuid and organization_id = $2::uuid
		`, userID, organizationID); cleanupErr != nil {
			t.Errorf("public user fixture detach returned error: %v", cleanupErr)
		}
		if _, cleanupErr := postgres.Pool().Exec(cleanupContext, `
			delete from public.organizations where id = $1::uuid
		`, organizationID); cleanupErr != nil {
			t.Errorf("organization fixture cleanup returned error: %v", cleanupErr)
		}
		if _, cleanupErr := postgres.Pool().Exec(cleanupContext, `
			delete from public.users where id = $1::uuid
		`, userID); cleanupErr != nil {
			t.Errorf("public user fixture cleanup returned error: %v", cleanupErr)
		}
		if _, cleanupErr := postgres.Pool().Exec(cleanupContext, `
			delete from auth.users where id = $1::uuid
		`, userID); cleanupErr != nil {
			t.Errorf("auth user fixture cleanup returned error: %v", cleanupErr)
		}
	})
	boundaryDate, err := time.Parse("2006-01-02", boundary)
	if err != nil {
		t.Fatalf("database current_date is invalid: %v", err)
	}
	past := boundaryDate.AddDate(0, 0, -30).Format("2006-01-02")
	ownerNames := []string{"Ownership A " + fixtureSuffix, "Ownership B " + fixtureSuffix}

	var propertyID string
	err = postgres.Pool().QueryRow(ctx, `
		insert into public.properties (
			organization_id, code, title, tipo, tipo_de_imovel, status,
			created_by, responsible_user_id
		)
		values ($1::uuid, $2, 'Ownership and asset integration fixture', 'Apartamento', 'Apartamento', 'active', $3::uuid, $3::uuid)
		returning id::text
	`, organizationID, "OWA-"+fixtureSuffix, userID).Scan(&propertyID)
	if err != nil {
		t.Fatalf("property fixture insert returned error: %v", err)
	}
	t.Cleanup(func() {
		cleanupContext, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		for _, statement := range []string{
			`delete from public.property_assets where organization_id = $1::uuid and property_id = $2::uuid`,
			`delete from public.property_ownerships where organization_id = $1::uuid and property_id = $2::uuid`,
			`delete from public.properties where organization_id = $1::uuid and id = $2::uuid`,
		} {
			if _, cleanupErr := postgres.Pool().Exec(cleanupContext, statement, organizationID, propertyID); cleanupErr != nil {
				t.Errorf("ownership/asset fixture cleanup returned error: %v", cleanupErr)
				return
			}
		}
		if _, cleanupErr := postgres.Pool().Exec(cleanupContext, `
			delete from public.property_owners
			where organization_id = $1::uuid and name = any($2::text[])
		`, organizationID, ownerNames); cleanupErr != nil {
			t.Errorf("owner fixture cleanup returned error: %v", cleanupErr)
		}
	})

	repository := NewRepository(postgres, StorageConfig{})
	manager := tenant.Context{OrganizationID: organizationID, UserID: userID, MemberRole: "admin"}
	firstOwnership, err := repository.CreatePropertyOwnership(ctx, manager, propertyID, CreatePropertyOwnershipInput{
		NewOwner: &PropertyOwnerDetailsInput{Name: ownerNames[0]}, OwnershipPercentage: 60,
		IsPrimary: true, ValidFrom: past,
	})
	if err != nil {
		t.Fatalf("first ownership create returned error: %v", err)
	}
	firstOwner, ok := firstOwnership["owner"].(map[string]any)
	if !ok || workspaceString(firstOwner, "id") == "" {
		t.Fatalf("first ownership omitted owner identity: %#v", firstOwnership)
	}
	firstOwnerID := workspaceString(firstOwner, "id")

	secondOwnership, err := repository.CreatePropertyOwnership(ctx, manager, propertyID, CreatePropertyOwnershipInput{
		NewOwner: &PropertyOwnerDetailsInput{Name: ownerNames[1]}, OwnershipPercentage: 40,
		IsPrimary: true, ValidFrom: boundary,
	})
	if err != nil {
		t.Fatalf("new primary ownership create returned error: %v", err)
	}
	secondOwner, ok := secondOwnership["owner"].(map[string]any)
	if !ok || workspaceString(secondOwner, "id") == "" {
		t.Fatalf("second ownership omitted owner identity: %#v", secondOwnership)
	}
	secondOwnerID := workspaceString(secondOwner, "id")

	var historicalPrimary, continuingParticipation, currentPrimary int
	var currentAllocation float64
	err = postgres.Pool().QueryRow(ctx, `
		select
			count(*) filter (
				where owner_id = $3::uuid and is_primary and valid_from = $4::date and valid_to = $5::date
			)::int,
			count(*) filter (
				where owner_id = $3::uuid and not is_primary and valid_from = $5::date and valid_to is null
			)::int,
			count(*) filter (
				where owner_id = $6::uuid and is_primary and valid_from = $5::date and valid_to is null
			)::int,
			coalesce(sum(ownership_percentage) filter (
				where valid_from <= $5::date and (valid_to is null or valid_to > $5::date)
			), 0)::float8
		from public.property_ownerships
		where organization_id = $1::uuid and property_id = $2::uuid
	`, organizationID, propertyID, firstOwnerID, past, boundary, secondOwnerID).Scan(
		&historicalPrimary, &continuingParticipation, &currentPrimary, &currentAllocation,
	)
	if err != nil {
		t.Fatalf("ownership split verification returned error: %v", err)
	}
	if historicalPrimary != 1 || continuingParticipation != 1 || currentPrimary != 1 || currentAllocation != 100 {
		t.Fatalf(
			"primary split = historical:%d continuation:%d new:%d allocation:%.2f; want 1/1/1/100",
			historicalPrimary, continuingParticipation, currentPrimary, currentAllocation,
		)
	}
	var legacyOwnerID string
	if err := postgres.Pool().QueryRow(ctx, `
		select owner_id::text from public.properties
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, propertyID).Scan(&legacyOwnerID); err != nil || legacyOwnerID != secondOwnerID {
		t.Fatalf("legacy owner projection = %q, %v; want %s", legacyOwnerID, err, secondOwnerID)
	}

	firstURL := "https://cdn.example.test/properties/" + propertyID + "/front.jpg"
	secondURL := "https://cdn.example.test/properties/" + propertyID + "/living-room.jpg"
	seedLegacyPhotoReferences := func(locator string, primaryURL string, retainedURL string) {
		t.Helper()
		if _, seedErr := postgres.Pool().Exec(ctx, `
			update public.properties
			set imagem_principal = $3,
				image_urls = array[$4, $5, $4]::text[],
				fotos = jsonb_build_array(
					$4::text,
					jsonb_build_object('url', $5::text),
					jsonb_build_object('src', $4::text),
					jsonb_build_object('publicUrl', $4::text),
					jsonb_build_object('url', $5::text, 'src', $4::text),
					jsonb_build_object('src', $5::text),
					jsonb_build_object('publicUrl', $5::text),
					jsonb_build_object('caption', 'keep')
				),
				metadata = jsonb_set(
					coalesce(metadata, '{}'::jsonb),
					'{hidden_site_image_urls}',
					to_jsonb(array[$4, $4]::text[]),
					true
				)
			where organization_id = $1::uuid and id = $2::uuid
		`, organizationID, propertyID, primaryURL, locator, retainedURL); seedErr != nil {
			t.Fatalf("legacy photo reference fixture returned error: %v", seedErr)
		}
	}
	assertLegacyPhotoLocatorScrubbed := func(locator string, primaryURL string, retainedURL string) {
		t.Helper()
		var primaryMatches, galleryMatches, photosMatch, hiddenMatches, canonicalMissing bool
		if queryErr := postgres.Pool().QueryRow(ctx, `
			select
				coalesce(property.imagem_principal, '') = $4,
				coalesce(property.image_urls, '{}'::text[]) = array[$5]::text[],
				coalesce(property.fotos, '[]'::jsonb) = jsonb_build_array(
					jsonb_build_object('url', $5::text),
					jsonb_build_object('src', $5::text),
					jsonb_build_object('publicUrl', $5::text),
					jsonb_build_object('caption', 'keep')
				),
				coalesce(property.metadata->'hidden_site_image_urls', '[]'::jsonb) = '[]'::jsonb,
				not exists (
					select 1
					from public.property_assets as asset
					where asset.organization_id = property.organization_id
					  and asset.property_id = property.id
					  and asset.asset_type = 'photo'
					  and asset.external_url = $3
				)
			from public.properties as property
			where property.organization_id = $1::uuid and property.id = $2::uuid
		`, organizationID, propertyID, locator, primaryURL, retainedURL).Scan(
			&primaryMatches,
			&galleryMatches,
			&photosMatch,
			&hiddenMatches,
			&canonicalMissing,
		); queryErr != nil {
			t.Fatalf("legacy photo scrub verification returned error: %v", queryErr)
		}
		if !primaryMatches || !galleryMatches || !photosMatch || !hiddenMatches || !canonicalMissing {
			t.Fatalf(
				"legacy photo scrub mismatch for %q: primary=%t gallery=%t photos=%t hidden=%t canonical_missing=%t",
				locator,
				primaryMatches,
				galleryMatches,
				photosMatch,
				hiddenMatches,
				canonicalMissing,
			)
		}

		if _, replayErr := postgres.Pool().Exec(ctx, `
			update public.properties
			set metadata = coalesce(metadata, '{}'::jsonb) || '{"asset_scrub_replay_probe":true}'::jsonb
			where organization_id = $1::uuid and id = $2::uuid
		`, organizationID, propertyID); replayErr != nil {
			t.Fatalf("legacy mirror replay probe returned error: %v", replayErr)
		}
		var replayedCount int
		if replayErr := postgres.Pool().QueryRow(ctx, `
			select count(*)::integer
			from public.property_assets
			where organization_id = $1::uuid
			  and property_id = $2::uuid
			  and asset_type = 'photo'
			  and external_url = $3
		`, organizationID, propertyID, locator).Scan(&replayedCount); replayErr != nil || replayedCount != 0 {
			t.Fatalf("legacy mirror replayed scrubbed locator %q: count=%d error=%v", locator, replayedCount, replayErr)
		}
	}
	internalURL := "https://cdn.example.test/properties/" + propertyID + "/internal-first.jpg"
	internalAsset, err := repository.CreatePropertyAsset(ctx, manager, propertyID, CreatePropertyAssetInput{
		AssetType: "photo", Visibility: "internal", ExternalURL: &internalURL,
		SortOrder: 0, IsPrimary: false, Metadata: map[string]any{"source": "internal-first"},
	})
	if err != nil {
		t.Fatalf("internal first photo create returned error: %v", err)
	}
	if workspaceBool(internalAsset, "is_primary") {
		t.Fatalf("internal first photo cannot be primary: %#v", internalAsset)
	}

	firstAsset, err := repository.CreatePropertyAsset(ctx, manager, propertyID, CreatePropertyAssetInput{
		AssetType: "photo", Visibility: "public", ExternalURL: &firstURL,
		SortOrder: 1, IsPrimary: false, Metadata: map[string]any{"source": "integration"},
	})
	if err != nil {
		t.Fatalf("first public asset create returned error: %v", err)
	}
	if !workspaceBool(firstAsset, "is_primary") {
		t.Fatalf("first public photo was not promoted atomically: %#v", firstAsset)
	}
	if _, err := repository.DeletePropertyAsset(ctx, manager, propertyID, workspaceString(internalAsset, "id"), DeletePropertyAssetInput{
		ExpectedUpdatedAt: workspaceString(internalAsset, "updated_at"),
	}); err != nil {
		t.Fatalf("internal first photo cleanup returned error: %v", err)
	}
	secondAsset, err := repository.CreatePropertyAsset(ctx, manager, propertyID, CreatePropertyAssetInput{
		AssetType: "photo", Visibility: "public", ExternalURL: &secondURL,
		SortOrder: 2, Metadata: map[string]any{"source": "integration"},
	})
	if err != nil {
		t.Fatalf("second asset create returned error: %v", err)
	}
	firstAssetID, secondAssetID := workspaceString(firstAsset, "id"), workspaceString(secondAsset, "id")
	secondAssetInitialVersion := workspaceString(secondAsset, "updated_at")
	if firstAssetID == "" || secondAssetID == "" || secondAssetInitialVersion == "" {
		t.Fatalf("asset response omitted identity/version: first=%#v second=%#v", firstAsset, secondAsset)
	}

	primaryAssets, err := repository.SetPrimaryPropertyAsset(ctx, manager, propertyID, secondAssetID, SetPrimaryPropertyAssetInput{
		ExpectedUpdatedAt: secondAssetInitialVersion,
	})
	if err != nil {
		t.Fatalf("primary asset switch returned error: %v", err)
	}
	if len(primaryAssets) != 2 {
		t.Fatalf("primary switch returned %d assets, want complete collection of 2", len(primaryAssets))
	}
	primaryByID := workspaceItemsByID(primaryAssets)
	if workspaceBool(primaryByID[secondAssetID], "is_primary") != true || workspaceBool(primaryByID[firstAssetID], "is_primary") {
		t.Fatalf("primary asset state is inconsistent: %#v", primaryAssets)
	}
	_, err = repository.UpdatePropertyAsset(ctx, manager, propertyID, secondAssetID, UpdatePropertyAssetInput{
		AssetType: "photo", Visibility: "public", Metadata: map[string]any{"source": "stale"},
		ExpectedUpdatedAt: secondAssetInitialVersion,
	})
	if !errors.Is(err, ErrPropertyWorkspaceConflict) {
		t.Fatalf("stale asset update error = %v, want workspace conflict", err)
	}

	if _, err := repository.ReorderPropertyAssets(ctx, manager, propertyID, ReorderPropertyAssetsInput{
		Items: []PropertyAssetOrderItem{
			{ID: firstAssetID, SortOrder: 0, ExpectedUpdatedAt: workspaceString(primaryByID[firstAssetID], "updated_at")},
		},
	}); !errors.Is(err, ErrPropertyWorkspaceConflict) {
		t.Fatalf("partial asset reorder error = %v, want workspace conflict", err)
	}

	reordered, err := repository.ReorderPropertyAssets(ctx, manager, propertyID, ReorderPropertyAssetsInput{
		Items: []PropertyAssetOrderItem{
			{ID: firstAssetID, SortOrder: 1, ExpectedUpdatedAt: workspaceString(primaryByID[firstAssetID], "updated_at")},
			{ID: secondAssetID, SortOrder: 0, ExpectedUpdatedAt: workspaceString(primaryByID[secondAssetID], "updated_at")},
		},
	})
	if err != nil {
		t.Fatalf("asset reorder returned error: %v", err)
	}
	reorderedByID := workspaceItemsByID(reordered)
	if workspaceInt(reorderedByID[firstAssetID], "sort_order") != 1 || workspaceInt(reorderedByID[secondAssetID], "sort_order") != 0 {
		t.Fatalf("asset reorder returned unexpected positions: %#v", reordered)
	}
	if _, err := repository.DeletePropertyAsset(ctx, manager, propertyID, secondAssetID, DeletePropertyAssetInput{
		ExpectedUpdatedAt: secondAssetInitialVersion,
	}); !errors.Is(err, ErrPropertyWorkspaceConflict) {
		t.Fatalf("stale primary asset delete error = %v, want workspace conflict", err)
	}
	seedLegacyPhotoReferences(secondURL, secondURL, firstURL)
	deleted, err := repository.DeletePropertyAsset(ctx, manager, propertyID, secondAssetID, DeletePropertyAssetInput{
		ExpectedUpdatedAt: workspaceString(reorderedByID[secondAssetID], "updated_at"),
	})
	if err != nil {
		t.Fatalf("primary asset delete returned error: %v", err)
	}
	if deleted["id"] != secondAssetID {
		t.Fatalf("deleted asset id = %q, want %s", deleted["id"], secondAssetID)
	}
	var legacyPrimaryPhoto string
	if err := postgres.Pool().QueryRow(ctx, `
		select coalesce(imagem_principal, '') from public.properties
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, propertyID).Scan(&legacyPrimaryPhoto); err != nil || legacyPrimaryPhoto != firstURL {
		t.Fatalf("legacy photo fallback = %q, %v; want %s", legacyPrimaryPhoto, err, firstURL)
	}
	assertLegacyPhotoLocatorScrubbed(secondURL, firstURL, firstURL)
	var firstAssetPromoted bool
	if err := postgres.Pool().QueryRow(ctx, `
		select is_primary
		from public.property_assets
		where organization_id = $1::uuid and property_id = $2::uuid and id = $3::uuid
	`, organizationID, propertyID, firstAssetID).Scan(&firstAssetPromoted); err != nil || !firstAssetPromoted {
		t.Fatalf("replacement primary asset state = %t, %v; want true", firstAssetPromoted, err)
	}

	nonPrimaryURL := "https://cdn.example.test/properties/" + propertyID + "/non-primary.jpg"
	nonPrimaryAsset, err := repository.CreatePropertyAsset(ctx, manager, propertyID, CreatePropertyAssetInput{
		AssetType: "photo", Visibility: "public", ExternalURL: &nonPrimaryURL,
		SortOrder: 2, Metadata: map[string]any{"source": "delete-non-primary"},
	})
	if err != nil {
		t.Fatalf("non-primary asset create returned error: %v", err)
	}
	seedLegacyPhotoReferences(nonPrimaryURL, firstURL, firstURL)
	if _, err := repository.DeletePropertyAsset(ctx, manager, propertyID, workspaceString(nonPrimaryAsset, "id"), DeletePropertyAssetInput{
		ExpectedUpdatedAt: workspaceString(nonPrimaryAsset, "updated_at"),
	}); err != nil {
		t.Fatalf("non-primary asset delete returned error: %v", err)
	}
	assertLegacyPhotoLocatorScrubbed(nonPrimaryURL, firstURL, firstURL)

	oldURL := "https://cdn.example.test/properties/" + propertyID + "/before-update.jpg"
	newURL := "https://cdn.example.test/properties/" + propertyID + "/after-update.jpg"
	assetBeforeUpdate, err := repository.CreatePropertyAsset(ctx, manager, propertyID, CreatePropertyAssetInput{
		AssetType: "photo", Visibility: "public", ExternalURL: &oldURL,
		SortOrder: 3, Metadata: map[string]any{"source": "update-external-url"},
	})
	if err != nil {
		t.Fatalf("asset update fixture create returned error: %v", err)
	}
	seedLegacyPhotoReferences(oldURL, firstURL, firstURL)
	assetAfterUpdate, err := repository.UpdatePropertyAsset(ctx, manager, propertyID, workspaceString(assetBeforeUpdate, "id"), UpdatePropertyAssetInput{
		AssetType: "photo", Visibility: "public",
		ExternalURL:       workspaceOptionalString{Set: true, Value: &newURL},
		Metadata:          map[string]any{"source": "update-external-url"},
		ExpectedUpdatedAt: workspaceString(assetBeforeUpdate, "updated_at"),
	})
	if err != nil {
		t.Fatalf("external asset URL update returned error: %v", err)
	}
	if workspaceString(assetAfterUpdate, "external_url") != newURL {
		t.Fatalf("updated external URL = %q, want %s", workspaceString(assetAfterUpdate, "external_url"), newURL)
	}
	assertLegacyPhotoLocatorScrubbed(oldURL, firstURL, firstURL)
	if _, err := repository.DeletePropertyAsset(ctx, manager, propertyID, workspaceString(assetAfterUpdate, "id"), DeletePropertyAssetInput{
		ExpectedUpdatedAt: workspaceString(assetAfterUpdate, "updated_at"),
	}); err != nil {
		t.Fatalf("updated external asset cleanup returned error: %v", err)
	}

	// Keep 19 photos, then race two creators for the final slot. The property
	// row lock must serialize the capacity check so exactly one reaches 20.
	for index := 0; index < propertyAssetMaxPhotos-2; index++ {
		assetURL := fmt.Sprintf("https://cdn.example.test/properties/%s/capacity-%02d.jpg", propertyID, index)
		if _, err := repository.CreatePropertyAsset(ctx, manager, propertyID, CreatePropertyAssetInput{
			AssetType: "photo", Visibility: "public", ExternalURL: &assetURL,
			SortOrder: index + 2, Metadata: map[string]any{"source": "capacity-test"},
		}); err != nil {
			t.Fatalf("photo capacity fixture %d returned error: %v", index, err)
		}
	}

	startCapacityRace := make(chan struct{})
	capacityErrors := make(chan error, 2)
	for index := 0; index < 2; index++ {
		index := index
		go func() {
			<-startCapacityRace
			assetURL := fmt.Sprintf("https://cdn.example.test/properties/%s/race-%02d.jpg", propertyID, index)
			_, createErr := repository.CreatePropertyAsset(ctx, manager, propertyID, CreatePropertyAssetInput{
				AssetType: "photo", Visibility: "public", ExternalURL: &assetURL,
				SortOrder: propertyAssetMaxPhotos + index, Metadata: map[string]any{"source": "capacity-race"},
			})
			capacityErrors <- createErr
		}()
	}
	close(startCapacityRace)

	createdCount, rejectedCount := 0, 0
	for index := 0; index < 2; index++ {
		createErr := <-capacityErrors
		switch {
		case createErr == nil:
			createdCount++
		case errors.Is(createErr, ErrInvalidInput):
			rejectedCount++
		default:
			t.Fatalf("capacity race returned unexpected error: %v", createErr)
		}
	}
	if createdCount != 1 || rejectedCount != 1 {
		t.Fatalf("capacity race created=%d rejected=%d, want 1/1", createdCount, rejectedCount)
	}
	var photoCount int
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer
		from public.property_assets
		where organization_id = $1::uuid and property_id = $2::uuid and asset_type = 'photo'
	`, organizationID, propertyID).Scan(&photoCount); err != nil || photoCount != propertyAssetMaxPhotos {
		t.Fatalf("photo count after capacity race = %d, %v; want %d", photoCount, err, propertyAssetMaxPhotos)
	}
}

func workspaceItemsByID(items []map[string]any) map[string]map[string]any {
	indexed := make(map[string]map[string]any, len(items))
	for _, item := range items {
		indexed[workspaceString(item, "id")] = item
	}
	return indexed
}

func TestGetWorkspaceAgainstDatabase(t *testing.T) {
	if os.Getenv("VIMOB_RUN_DB_TESTS") != "1" {
		t.Skip("set VIMOB_RUN_DB_TESTS=1 to run database integration tests")
	}
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if databaseURL == "" {
		t.Fatal("DATABASE_URL is required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL: databaseURL, MaxConns: 2, MinConns: 0, HealthTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("NewPostgres() returned error: %v", err)
	}
	defer postgres.Close()

	var organizationID, propertyID, userID string
	err = postgres.Pool().QueryRow(ctx, `
		select p.organization_id::text, p.id::text, actor.user_id::text
		from public.properties p
		join lateral (
			select coalesce(
				p.created_by,
				p.responsible_user_id,
				(
					select member.user_id
					from public.organization_members member
					where member.organization_id = p.organization_id
					  and coalesce(member.is_active, true)
					limit 1
				)
			) as user_id
		) actor on actor.user_id is not null
		limit 1
	`).Scan(&organizationID, &propertyID, &userID)
	if errors.Is(err, pgx.ErrNoRows) {
		t.Skip("no property with an organization user is available")
	}
	if err != nil {
		t.Fatalf("workspace fixture lookup returned error: %v", err)
	}

	repository := NewRepository(postgres, StorageConfig{})
	response, err := repository.GetWorkspace(ctx, tenant.Context{
		OrganizationID: organizationID,
		UserID:         userID,
		MemberRole:     "admin",
	}, propertyID)
	if err != nil {
		t.Fatalf("GetWorkspace() returned error: %v", err)
	}
	if response.Data.Property["id"] != propertyID {
		t.Fatalf("workspace property id = %v, want %s", response.Data.Property["id"], propertyID)
	}
	if response.Data.Offers == nil || response.Data.Assets == nil || response.Data.Keys == nil {
		t.Fatal("workspace collections must be normalized to empty arrays")
	}
}
