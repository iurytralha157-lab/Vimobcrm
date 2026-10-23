package searchtext

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/text/unicode/norm"
)

// Literal SELECTs only: no schema, stored names, migrations or production data.
func TestSearchNormalizationPostgres(t *testing.T) {
	dsn := os.Getenv("SEARCHTEXT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set SEARCHTEXT_TEST_DATABASE_URL to an explicitly selected UTF8 PostgreSQL fixture")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	connection, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close(ctx)
	for _, item := range []struct {
		value, query string
		matches      bool
	}{
		{"𝓐𝓷𝓪 𝓢𝓲𝓵𝓿𝓪", "Ana Silva", true}, {"Ana Silva", "𝓐𝓷𝓪", true},
		{"Márcia", "marcia", true}, {"Jose\u0301", "José", true}, {"Ｍárcia", "Marcia", true},
		{"👩🏽‍💻 Ana", "👩🏽‍💻", true}, {"أحمد علي", "أحمد", true}, {"李明", "李", true},
		// Non-Latin case folding depends on the fixture/database collation.
		{"ана иванова", "ана", true}, {"Ана Иванова", "Ana", false},
		{"𝓐𝓷𝓪_100%", "Ana_100%", true}, {"AnaX100Y", "Ana_100%", false},
	} {
		t.Run(item.value+"/"+item.query, func(t *testing.T) {
			var matches bool
			var display string
			err := connection.QueryRow(ctx, "select "+SQL("$1::text")+" like $2, normalize($1::text, NFKC)", item.value, Pattern(item.query)).Scan(&matches, &display)
			if err != nil {
				t.Fatal(err)
			}
			if matches != item.matches || Contains(item.value, item.query) != item.matches {
				t.Fatalf("SQL/Go parity differs: SQL=%t Go=%t expected=%t", matches, Contains(item.value, item.query), item.matches)
			}
			if display != norm.NFKC.String(item.value) {
				t.Fatalf("unexpected display normalization: %q", display)
			}
		})
	}
}
