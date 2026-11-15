package site

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestGoogleSiteResponseProjectionPostgres(t *testing.T) {
	if os.Getenv("VIMOB_RUN_DB_TESTS") != "1" {
		t.Skip("set VIMOB_RUN_DB_TESTS=1 with a disposable local DATABASE_URL")
	}
	if strings.TrimSpace(os.Getenv("DATABASE_URL")) == "" {
		t.Fatal("DATABASE_URL is required")
	}
	config, err := pgx.ParseConfig(os.Getenv("DATABASE_URL"))
	if err != nil {
		t.Fatal("invalid disposable database configuration")
	}
	if config.Host != "127.0.0.1" && config.Host != "localhost" && config.Host != "::1" {
		t.Fatal("Google projection test requires a loopback database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	connection, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		t.Fatal("connect disposable PostgreSQL")
	}
	defer connection.Close(ctx)

	fields := []string{"google_analytics_id", "google_search_console_verification", "gtm_id"}
	var projection []string
	for _, field := range fields {
		for _, line := range strings.Split(siteReturningColumns(), "\n") {
			if strings.HasSuffix(strings.TrimSpace(line), " as "+field+",") {
				projection = append(projection, strings.TrimSuffix(strings.TrimSpace(line), ","))
			}
		}
	}
	if len(projection) != len(fields) {
		t.Fatal("site response must project all three Google integration fields")
	}
	query := "select " + strings.Join(projection, ", ") + `
		from (values ($1::text, $2::text, $3::text))
		as fixture (google_analytics_id, google_search_console_verification, gtm_id)`
	for _, scenario := range []struct {
		name   string
		values [3]any
		want   [3]string
		valid  bool
	}{
		{name: "null"},
		{name: "empty", values: [3]any{"", "", ""}},
		{name: "spaces", values: [3]any{"   ", "   ", "   "}},
		{name: "configured", values: [3]any{"  G-ABC12345  ", "  abcDEF_1234567890-token  ", "  GTM-ABCD1234  "}, want: [3]string{"G-ABC12345", "abcDEF_1234567890-token", "GTM-ABCD1234"}, valid: true},
		{name: "invalid values remain visible to validation", values: [3]any{"invalid", "invalid", "invalid"}, want: [3]string{"invalid", "invalid", "invalid"}, valid: true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			var result [3]pgtype.Text
			if err := connection.QueryRow(ctx, query, scenario.values[:]...).Scan(&result[0], &result[1], &result[2]); err != nil {
				t.Fatalf("project Google fields: %v", err)
			}
			for i, value := range result {
				if value.Valid != scenario.valid || value.String != scenario.want[i] {
					t.Fatalf("%s = %#v, want valid=%v value=%q", fields[i], value, scenario.valid, scenario.want[i])
				}
			}
		})
	}
}
