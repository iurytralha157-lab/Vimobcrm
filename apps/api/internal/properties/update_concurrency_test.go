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

func TestExtractExpectedPropertyUpdatedAt(t *testing.T) {
	request := propertyRequest{
		"title":               "Imovel atualizado",
		"expected_updated_at": "2026-09-08T03:04:05.123456Z",
	}

	withoutVersion, expected, supplied, err := extractExpectedPropertyUpdatedAt(request)
	if err != nil {
		t.Fatalf("extractExpectedPropertyUpdatedAt() error = %v", err)
	}
	if !supplied {
		t.Fatal("expected timestamp should be marked as supplied")
	}
	if expected.Format(time.RFC3339Nano) != "2026-09-08T03:04:05.123456Z" {
		t.Fatalf("unexpected parsed timestamp: %s", expected.Format(time.RFC3339Nano))
	}
	if _, found := withoutVersion[expectedPropertyUpdatedAtField]; found {
		t.Fatal("transport-only version field must not reach property sanitization")
	}
	if request[expectedPropertyUpdatedAtField] == nil {
		t.Fatal("extracting the version must not mutate the decoded request")
	}
}

func TestExtractExpectedPropertyUpdatedAtRejectsInvalidValues(t *testing.T) {
	for _, value := range []any{nil, "", "not-a-timestamp", 42} {
		_, _, _, err := extractExpectedPropertyUpdatedAt(propertyRequest{
			"title":               "Imovel atualizado",
			"expected_updated_at": value,
		})
		if !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("value %v: error = %v, want ErrInvalidInput", value, err)
		}
	}
}

func TestExtractExpectedPropertyUpdatedAtRequiresVersion(t *testing.T) {
	_, _, _, err := extractExpectedPropertyUpdatedAt(propertyRequest{
		"title": "Imovel atualizado",
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("missing version error = %v, want ErrInvalidInput", err)
	}
}

func TestPropertyVersionMatchesSameInstantAcrossOffsets(t *testing.T) {
	current := time.Date(2026, 9, 8, 3, 4, 5, 123456000, time.UTC)
	expected, err := time.Parse(time.RFC3339Nano, "2026-09-08T00:04:05.123456-03:00")
	if err != nil {
		t.Fatal(err)
	}
	if !propertyVersionMatches(current, expected) {
		t.Fatal("the same instant represented in another offset should match")
	}
	if propertyVersionMatches(current, expected.Add(time.Microsecond)) {
		t.Fatal("a different persisted version must conflict")
	}
}

func TestValidateUpdateCarriesVersionOutsideWritableColumns(t *testing.T) {
	input, err := (propertyRequest{
		"title":               "Imovel atualizado",
		"expected_updated_at": "2026-09-08T03:04:05.123456Z",
	}).ValidateUpdate()
	if err != nil {
		t.Fatalf("ValidateUpdate() error = %v", err)
	}
	if input["title"] != "Imovel atualizado" {
		t.Fatalf("title = %#v", input["title"])
	}
	if _, found := input[expectedPropertyUpdatedAtField]; found {
		t.Fatal("transport-only version field reached writable payload")
	}
	if _, found := input[internalPropertyVersionField].(time.Time); !found {
		t.Fatalf("internal version = %#v, want time.Time", input[internalPropertyVersionField])
	}
}

func TestValidateUpdateRejectsVersionWithoutAChange(t *testing.T) {
	_, err := (propertyRequest{
		"expected_updated_at": "2026-09-08T03:04:05.123456Z",
	}).ValidateUpdate()
	if !errors.Is(err, ErrNoChanges) {
		t.Fatalf("ValidateUpdate() error = %v, want ErrNoChanges", err)
	}
}

func TestPopExpectedPropertyUpdatedAtRemovesInternalField(t *testing.T) {
	expected := time.Date(2026, 9, 8, 3, 4, 5, 0, time.UTC)
	input := propertyRequest{
		"title":                      "Imovel atualizado",
		internalPropertyVersionField: expected,
	}

	got, supplied, err := popExpectedPropertyUpdatedAt(input)
	if err != nil {
		t.Fatalf("popExpectedPropertyUpdatedAt() error = %v", err)
	}
	if !supplied || !got.Equal(expected) {
		t.Fatalf("popExpectedPropertyUpdatedAt() = (%v, %v)", got, supplied)
	}
	if _, found := input[internalPropertyVersionField]; found {
		t.Fatal("internal version field must not reach SQL mutation or history")
	}
}

func TestPopExpectedPropertyUpdatedAtRequiresInternalVersion(t *testing.T) {
	_, _, err := popExpectedPropertyUpdatedAt(propertyRequest{"title": "Imovel atualizado"})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("missing internal version error = %v, want ErrInvalidInput", err)
	}
}

func TestPropertyUpdateRejectsAStaleVersionAgainstDatabase(t *testing.T) {
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
		URL: databaseURL, MaxConns: 2, MinConns: 0, HealthTimeout: 5 * time.Second,
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
	var originalUpdatedAt time.Time
	code := fmt.Sprintf("CAS-%d", time.Now().UnixNano())
	err = postgres.Pool().QueryRow(ctx, `
		insert into public.properties (
			organization_id, code, title, tipo, tipo_de_imovel, finalidade,
			tipo_de_negocio, status, created_by, responsible_user_id
		)
		values (
			$1::uuid, $2, 'CAS original', 'Apartamento', 'Apartamento', 'venda',
			'Venda', 'active', $3::uuid, $3::uuid
		)
		returning id::text, updated_at
	`, organizationID, code, userID).Scan(&propertyID, &originalUpdatedAt)
	if err != nil {
		t.Fatalf("property fixture insert returned error: %v", err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select updated_at
		from public.properties
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, propertyID).Scan(&originalUpdatedAt); err != nil {
		t.Fatalf("property fixture version readback returned error: %v", err)
	}
	t.Cleanup(func() {
		cleanupContext, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		if _, cleanupErr := postgres.Pool().Exec(cleanupContext, `
			delete from public.properties
			where organization_id = $1::uuid and id = $2::uuid
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

	createTx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatalf("create response transaction returned error: %v", err)
	}
	createInput, err := (propertyRequest{
		"title":               "CAS create response",
		"tipo_de_imovel":      "Apartamento",
		"tipo_de_negocio":     "Venda",
		"responsible_user_id": userID,
	}).ValidateCreate()
	if err != nil {
		_ = createTx.Rollback(ctx)
		t.Fatalf("create ValidateCreate() error = %v", err)
	}
	created, err := repository.createPropertyTx(ctx, createTx, manager, createInput)
	if err != nil {
		_ = createTx.Rollback(ctx)
		t.Fatalf("createPropertyTx() error = %v", err)
	}
	createdID := anyString(created["id"])
	returnedVersion, err := time.Parse(time.RFC3339Nano, anyString(created["updated_at"]))
	if err != nil {
		_ = createTx.Rollback(ctx)
		t.Fatalf("created updated_at is invalid: %v", err)
	}
	var persistedCreateVersion time.Time
	if err := createTx.QueryRow(ctx, `
		select updated_at
		from public.properties
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, createdID).Scan(&persistedCreateVersion); err != nil {
		_ = createTx.Rollback(ctx)
		t.Fatalf("created property version readback returned error: %v", err)
	}
	if !returnedVersion.Equal(persistedCreateVersion) {
		_ = createTx.Rollback(ctx)
		t.Fatalf("create response version = %s, persisted = %s", returnedVersion, persistedCreateVersion)
	}
	if err := createTx.Rollback(ctx); err != nil {
		t.Fatalf("create response transaction rollback returned error: %v", err)
	}

	version := originalUpdatedAt.Format(time.RFC3339Nano)
	firstInput, err := (propertyRequest{
		"title":               "CAS primeiro editor",
		"expected_updated_at": version,
	}).ValidateUpdate()
	if err != nil {
		t.Fatalf("first ValidateUpdate() error = %v", err)
	}
	if _, err := repository.Update(ctx, manager, propertyID, firstInput); err != nil {
		t.Fatalf("first Update() error = %v", err)
	}

	staleInput, err := (propertyRequest{
		"title":               "CAS editor atrasado",
		"expected_updated_at": version,
	}).ValidateUpdate()
	if err != nil {
		t.Fatalf("stale ValidateUpdate() error = %v", err)
	}
	if _, err := repository.Update(ctx, manager, propertyID, staleInput); !errors.Is(err, ErrPropertyWorkspaceConflict) {
		t.Fatalf("stale Update() error = %v, want ErrPropertyWorkspaceConflict", err)
	}

	var persistedTitle string
	if err := postgres.Pool().QueryRow(ctx, `
		select title
		from public.properties
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, propertyID).Scan(&persistedTitle); err != nil {
		t.Fatalf("property readback returned error: %v", err)
	}
	if persistedTitle != "CAS primeiro editor" {
		t.Fatalf("persisted title = %q, want first editor value", persistedTitle)
	}

	var beforePriceVersion time.Time
	if err := postgres.Pool().QueryRow(ctx, `
		select updated_at
		from public.properties
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, propertyID).Scan(&beforePriceVersion); err != nil {
		t.Fatalf("pre-price property version readback returned error: %v", err)
	}
	priceInput, err := (propertyRequest{
		"preco":               975000.0,
		"expected_updated_at": beforePriceVersion.Format(time.RFC3339Nano),
	}).ValidateUpdate()
	if err != nil {
		t.Fatalf("price ValidateUpdate() error = %v", err)
	}
	priceUpdated, err := repository.Update(ctx, manager, propertyID, priceInput)
	if err != nil {
		t.Fatalf("price Update() error = %v", err)
	}
	priceResponseVersion, err := time.Parse(time.RFC3339Nano, anyString(priceUpdated["updated_at"]))
	if err != nil {
		t.Fatalf("price response updated_at is invalid: %v", err)
	}
	var persistedPriceVersion time.Time
	if err := postgres.Pool().QueryRow(ctx, `
		select updated_at
		from public.properties
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, propertyID).Scan(&persistedPriceVersion); err != nil {
		t.Fatalf("price version readback returned error: %v", err)
	}
	if !priceResponseVersion.Equal(persistedPriceVersion) {
		t.Fatalf("price response version = %s, persisted = %s", priceResponseVersion, persistedPriceVersion)
	}

	var beforeMediaVersion time.Time
	if err := postgres.Pool().QueryRow(ctx, `
		select updated_at
		from public.properties
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, propertyID).Scan(&beforeMediaVersion); err != nil {
		t.Fatalf("pre-media property version readback returned error: %v", err)
	}
	legacyPhotoURL := fmt.Sprintf("https://legacy.example.test/%s/revision.jpg", propertyID)
	mediaInput, err := (propertyRequest{
		"image_urls":          []any{legacyPhotoURL},
		"expected_updated_at": beforeMediaVersion.Format(time.RFC3339Nano),
	}).ValidateUpdate()
	if err != nil {
		t.Fatalf("media ValidateUpdate() error = %v", err)
	}
	mediaUpdated, err := repository.Update(ctx, manager, propertyID, mediaInput)
	if err != nil {
		t.Fatalf("legacy media Update() error = %v", err)
	}
	mediaResponseVersion, err := time.Parse(time.RFC3339Nano, anyString(mediaUpdated["updated_at"]))
	if err != nil {
		t.Fatalf("legacy media response updated_at is invalid: %v", err)
	}
	var persistedMediaVersion time.Time
	if err := postgres.Pool().QueryRow(ctx, `
		select updated_at
		from public.properties
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, propertyID).Scan(&persistedMediaVersion); err != nil {
		t.Fatalf("legacy media version readback returned error: %v", err)
	}
	if !mediaResponseVersion.Equal(persistedMediaVersion) {
		t.Fatalf("legacy media response version = %s, persisted = %s", mediaResponseVersion, persistedMediaVersion)
	}

	nextInput, err := (propertyRequest{
		"title":               "CAS depois da mídia",
		"expected_updated_at": anyString(mediaUpdated["updated_at"]),
	}).ValidateUpdate()
	if err != nil {
		t.Fatalf("post-media ValidateUpdate() error = %v", err)
	}
	if _, err := repository.Update(ctx, manager, propertyID, nextInput); err != nil {
		t.Fatalf("post-media Update() rejected the response CAS: %v", err)
	}
}
