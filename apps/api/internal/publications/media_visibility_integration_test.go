package publications

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// Every fixture row lives in session-local temporary relations. No public data,
// queue or storage object is updated; the database and host are opt-in fenced.
func TestPublicMediaLiveVetoInIsolatedTemporaryRelations(t *testing.T) {
	if os.Getenv("VIMOB_PROPERTY_HARDENING_WRITE_TEST") != "LOCAL_WRITE_TEST" {
		t.Skip("requires isolated synthetic property database")
	}
	connection := os.Getenv("VIMOB_PROPERTY_HARDENING_TEST_DATABASE_URL")
	parsed, err := url.Parse(connection)
	if err != nil || parsed.Path != "/vimob_properties_fixes_20261012_fb58fe98" || (parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") {
		t.Fatal("media tests refuse any database except the explicitly named loopback fixture")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: connection, MaxConns: 1, HealthTimeout: 5 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	var name string
	if err := database.Pool().QueryRow(ctx, `select current_database()`).Scan(&name); err != nil || name != "vimob_properties_fixes_20261012_fb58fe98" {
		t.Fatal("database identity did not match fixture")
	}
	tx, err := database.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	for _, table := range []string{"organizations", "organization_sites", "properties", "property_assets", "property_channel_publications", "property_channel_publication_versions", "property_channel_publication_jobs", "property_development_units", "property_developments", "property_development_buildings", "property_development_phases", "property_development_floor_plans"} {
		if _, err := tx.Exec(ctx, "create temporary table "+table+" on commit drop as select * from public."+table+" with no data"); err != nil {
			t.Fatal(err)
		}
	}
	const organizationID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	const propertyID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	const versionID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
	const mediaURL = "https://fixture.example/public.jpg"
	payload, err := json.Marshal(map[string]any{"media": []map[string]any{{"asset_id": testAssetID, "source_hash": assetSourceHash("", "", mediaURL)}}})
	if err != nil {
		t.Fatal(err)
	}
	statements := []struct {
		sql  string
		args []any
	}{
		{`insert into pg_temp.organizations(id,is_active) values($1::uuid,true)`, []any{organizationID}},
		{`insert into pg_temp.organization_sites(organization_id,is_active) values($1::uuid,true)`, []any{organizationID}},
		{`insert into pg_temp.properties(id,organization_id,status,autorizado_comercializacao) values($1::uuid,$2::uuid,'active',true)`, []any{propertyID, organizationID}},
		{`insert into pg_temp.property_channel_publications(id,organization_id,property_id,channel,channel_account_key,desired_state,published_version) values($1::uuid,$2::uuid,$3::uuid,'site','default','published',1)`, []any{testPublicationID, organizationID, propertyID}},
		{`insert into pg_temp.property_channel_publication_versions(id,publication_id,organization_id,property_id,channel,channel_account_key,version,payload) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'site','default',1,$5::jsonb)`, []any{versionID, testPublicationID, organizationID, propertyID, string(payload)}},
		{`insert into pg_temp.property_assets(id,organization_id,property_id,visibility,external_url) values($1::uuid,$2::uuid,$3::uuid,'public',$4)`, []any{testAssetID, organizationID, propertyID, mediaURL}},
	}
	for _, statement := range statements {
		if _, err := tx.Exec(ctx, statement.sql, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
	query := strings.ReplaceAll(publicMediaQuerySQL(), "public.", "pg_temp.")
	assertVisible := func(want bool) {
		t.Helper()
		var storage, external string
		err := tx.QueryRow(ctx, query, testPublicationID, 1, testAssetID).Scan(&storage, &external)
		if want && (err != nil || external != mediaURL) {
			t.Fatalf("expected visible media: %s %v", external, err)
		}
		if !want && !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("expected live media veto: %v", err)
		}
	}
	assertVisible(true)
	for _, change := range []struct{ deny, restore string }{
		{`update pg_temp.properties set autorizado_comercializacao=false`, `update pg_temp.properties set autorizado_comercializacao=null`},
		{`update pg_temp.properties set status='reserved'`, `update pg_temp.properties set status=' Disponível '`},
		{`update pg_temp.organizations set is_active=false`, `update pg_temp.organizations set is_active=true`},
		{`update pg_temp.organization_sites set is_active=false`, `update pg_temp.organization_sites set is_active=true`},
		{`update pg_temp.property_assets set visibility='private'`, `update pg_temp.property_assets set visibility='public'`},
		{`update pg_temp.property_channel_publications set desired_state='unpublished'`, `update pg_temp.property_channel_publications set desired_state='published'`},
		{`update pg_temp.property_channel_publications set desired_state='paused'`, `update pg_temp.property_channel_publications set desired_state='published'`},
	} {
		if _, err := tx.Exec(ctx, change.deny); err != nil {
			t.Fatal(err)
		}
		assertVisible(false)
		if _, err := tx.Exec(ctx, change.restore); err != nil {
			t.Fatal(err)
		}
		assertVisible(true)
	}
	if _, err := tx.Exec(ctx, `update pg_temp.property_channel_publications set channel='grupo_olx'; update pg_temp.property_channel_publication_versions set channel='grupo_olx'; delete from pg_temp.organization_sites`); err != nil {
		t.Fatal(err)
	}
	assertVisible(true) // OLX media does not require an organization's Site.
	if _, err := tx.Exec(ctx, `update pg_temp.organizations set is_active=false`); err != nil {
		t.Fatal(err)
	}
	assertVisible(false)
}
