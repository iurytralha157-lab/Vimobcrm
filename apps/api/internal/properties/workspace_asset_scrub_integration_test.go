package properties

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestScrubLegacyPropertyPhotoLocatorAgainstDatabase(t *testing.T) {
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
	t.Cleanup(postgres.Close)

	tx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatalf("begin scrub rollback transaction returned error: %v", err)
	}
	defer tx.Rollback(ctx)

	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	var organizationID, propertyID string
	if err := tx.QueryRow(ctx, `
		insert into public.organizations (name, slug, is_active)
		values ('Asset scrub rollback integration', $1, true)
		returning id::text
	`, "asset-scrub-"+suffix).Scan(&organizationID); err != nil {
		t.Fatalf("organization fixture insert returned error: %v", err)
	}
	if err := tx.QueryRow(ctx, `
		insert into public.properties (
			organization_id, code, title, tipo, tipo_de_imovel, status
		)
		values (
			$1::uuid, $2, 'Asset scrub rollback fixture',
			'Apartamento', 'Apartamento', 'active'
		)
		returning id::text
	`, organizationID, "ASR-"+suffix).Scan(&propertyID); err != nil {
		t.Fatalf("property fixture insert returned error: %v", err)
	}

	removedURL := "https://cdn.example.test/properties/" + propertyID + "/removed.jpg"
	retainedURL := "https://cdn.example.test/properties/" + propertyID + "/retained.jpg"
	if _, err := tx.Exec(ctx, `
		insert into public.property_assets (
			organization_id, property_id, asset_type, visibility,
			external_url, sort_order, is_primary, metadata
		)
		values
			($1::uuid, $2::uuid, 'photo', 'public', $3, 0, true, '{}'::jsonb),
			($1::uuid, $2::uuid, 'photo', 'public', $4, 1, false, '{}'::jsonb)
	`, organizationID, propertyID, removedURL, retainedURL); err != nil {
		t.Fatalf("canonical asset fixtures insert returned error: %v", err)
	}
	if _, err := tx.Exec(ctx, `
		update public.properties
		set imagem_principal = $3,
			image_urls = array[$3, $4, $3]::text[],
			fotos = jsonb_build_array(
				$3::text,
				jsonb_build_object('url', $4::text),
				jsonb_build_object('src', $3::text),
				jsonb_build_object('publicUrl', $3::text),
				jsonb_build_object('src', $4::text)
			),
			metadata = jsonb_build_object(
				'hidden_site_image_urls', jsonb_build_array($3::text, $3::text)
			)
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, propertyID, removedURL, retainedURL); err != nil {
		t.Fatalf("legacy compatibility fixture update returned error: %v", err)
	}

	if err := scrubLegacyPropertyPhotoLocator(ctx, tx, organizationID, propertyID, removedURL); err != nil {
		t.Fatalf("legacy locator scrub returned error: %v", err)
	}
	if _, err := tx.Exec(ctx, `
		delete from public.property_assets
		where organization_id = $1::uuid
		  and property_id = $2::uuid
		  and asset_type = 'photo'
		  and external_url = $3
	`, organizationID, propertyID, removedURL); err != nil {
		t.Fatalf("canonical asset delete returned error: %v", err)
	}
	if err := syncLegacyPropertyPrimaryPhoto(ctx, tx, organizationID, propertyID, removedURL, true); err != nil {
		t.Fatalf("legacy primary replacement returned error: %v", err)
	}
	if _, err := tx.Exec(ctx, `
		update public.properties
		set metadata = metadata || '{"asset_scrub_replay_probe":true}'::jsonb
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, propertyID); err != nil {
		t.Fatalf("legacy mirror replay probe returned error: %v", err)
	}

	var stateMatches bool
	if err := tx.QueryRow(ctx, `
		select
			property.imagem_principal = $4
			and property.image_urls = array[$4]::text[]
			and property.fotos = jsonb_build_array(
				jsonb_build_object('url', $4::text),
				jsonb_build_object('src', $4::text)
			)
			and property.metadata->'hidden_site_image_urls' = '[]'::jsonb
			and not exists (
				select 1
				from public.property_assets as removed
				where removed.organization_id = property.organization_id
				  and removed.property_id = property.id
				  and removed.external_url = $3
			)
			and exists (
				select 1
				from public.property_assets as retained
				where retained.organization_id = property.organization_id
				  and retained.property_id = property.id
				  and retained.external_url = $4
				  and retained.is_primary
			)
		from public.properties as property
		where property.organization_id = $1::uuid and property.id = $2::uuid
	`, organizationID, propertyID, removedURL, retainedURL).Scan(&stateMatches); err != nil {
		t.Fatalf("scrubbed state verification returned error: %v", err)
	}
	if !stateMatches {
		t.Fatal("legacy locator survived, replayed, changed order, or primary replacement was lost")
	}

	if err := tx.Rollback(ctx); err != nil {
		t.Fatalf("scrub verification rollback returned error: %v", err)
	}
	var fixtureExists bool
	if err := postgres.Pool().QueryRow(ctx, `
		select exists (select 1 from public.organizations where id = $1::uuid)
	`, organizationID).Scan(&fixtureExists); err != nil {
		t.Fatalf("rollback verification returned error: %v", err)
	}
	if fixtureExists {
		t.Fatal("scrub integration fixture survived rollback")
	}
}
