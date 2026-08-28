package site

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestPublicSnapshotQueriesCompileAgainstDatabase(t *testing.T) {
	if os.Getenv("VIMOB_RUN_DB_TESTS") != "1" {
		t.Skip("set VIMOB_RUN_DB_TESTS=1 to run database integration tests")
	}
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if databaseURL == "" {
		t.Fatal("DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL: databaseURL, MaxConns: 2, HealthTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("connect database: %v", err)
	}
	t.Cleanup(postgres.Close)
	repo := NewRepository(postgres, StorageConfig{})
	organizationID := "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"

	properties, total, err := repo.listPublicProperties(ctx, organizationID, url.Values{}, "", 1, 20)
	if err != nil {
		t.Fatalf("list public properties: %v", err)
	}
	if total != 0 || len(properties) != 0 {
		t.Fatalf("empty organization returned total=%d properties=%d", total, len(properties))
	}
	filters := url.Values{
		"search":               {"central"},
		"tipo":                 {"apartamento"},
		"finalidade":           {"venda"},
		"cidade":               {"sao paulo"},
		"bairro":               {"centro"},
		"min_price":            {"100"},
		"max_price":            {"1000000"},
		"area_util_min":        {"20"},
		"area_util_max":        {"500"},
		"area_total_min":       {"20"},
		"area_total_max":       {"1000"},
		"quartos":              {"1"},
		"suites":               {"1"},
		"banheiros":            {"1"},
		"vagas":                {"1"},
		"aceita_financiamento": {"true"},
		"aceita_permuta":       {"false"},
		"mobilia":              {"mobiliado"},
	}
	if _, _, err := repo.listPublicProperties(ctx, organizationID, filters, "featured", 1, 20); err != nil {
		t.Fatalf("list filtered snapshot properties: %v", err)
	}
	if _, _, err := repo.listPublicProperties(ctx, organizationID, url.Values{}, "exclusive", 1, 20); err != nil {
		t.Fatalf("list exclusive snapshot properties: %v", err)
	}
	if _, err := repo.listPublicPropertyFilterOptions(ctx, organizationID, "", ""); err != nil {
		t.Fatalf("list public filter options: %v", err)
	}
	if property, err := repo.getPublicProperty(ctx, organizationID, "missing"); err != nil || property != nil {
		t.Fatalf("missing public property = %#v, error=%v", property, err)
	}
}
