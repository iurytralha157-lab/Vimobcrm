package searchtext

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// SELECT-only checks; the caller must select an isolated UTF8 PostgreSQL fixture.
func TestPipelineSearchUnicodePostgres(t *testing.T) {
	dsn := os.Getenv("SEARCHTEXT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set SEARCHTEXT_TEST_DATABASE_URL to an explicitly selected UTF8 PostgreSQL fixture")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	connection, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close(ctx)
	for _, collation := range []string{`"C"`, `pg_catalog."und-x-icu"`} {
		t.Run(collation, func(t *testing.T) {
			for _, item := range []struct {
				value, query string
				want         bool
			}{
				{"Åsa", "Asa", true}, {"Asa", "Åsa", true},
				{"Černý", "Cerny", true}, {"Cerny", "Černý", true},
				{"João", "Joao", true}, {"Jose\u0301", "José", true},
				{"𝓜𝓪𝓻𝓲𝓵𝓲𝓪", "Marilia", true}, {"Ｍárcia", "Marcia", true},
				{"ΟΣ", "ος", true}, {"ος", "ΟΣ", true}, {"ΟΣ", "Σ", false},
				{"ΟΣΑ", "οσα", true}, {"Ана", "ана", true},
				{"👩🏽‍💻 Ana", "👩🏽‍💻", true}, {"李明", "李", true},
				{"Łukasz", "Lukasz", false}, {"Straße", "Strasse", false},
				{"Casa 100%", "%", true}, {"Casa sem percentual", "%", false},
				{"Ana_1", "_", true}, {"AnaX1", "_", false},
				{`C:\folder`, `C:\`, true}, {`C:folder`, `C:\`, false},
				{"Outro", "%' OR 1=1 --", false}, {"Asa", "\ufeffAsa\ufeff", true},
				{"Asa", "\u0085Asa\u0085", false},
			} {
				t.Run(item.value+"/"+item.query, func(t *testing.T) {
					var matches bool
					var original string
					expression := "($1::text collate " + collation + ")"
					err := connection.QueryRow(ctx, "select "+PipelineSQL(expression)+" like $2, $1::text", item.value, PipelinePattern(item.query)).Scan(&matches, &original)
					if err != nil {
						t.Fatal(err)
					}
					if matches != item.want || original != item.value {
						t.Fatalf("SQL match=%t want=%t; original changed=%t", matches, item.want, original != item.value)
					}
				})
			}
			for _, item := range []struct {
				phone, query string
				want         bool
			}{
				{"+5511999998888", "（１１）９９９９９－８８８８", true},
				{"＋５５（１１）９９９９９－８８８８", "11999998888", true},
				{"＋５５（１１）９９９９９－８８８８", "(11) 99999-8888", true},
				{"+5511999998888", "\ufeff（１１）９９９９９－８８８８\ufeff", true},
				{"+5511999998888", "7777", false},
				{"+551112349999", "Lote １２３４", false},
				{"+551112349999", "１２_３４", false},
				{"+551112349999", "１２%３４", false},
				{"+551112349999", "１２３", false},
				{"+551112349999", "١٢٣٤", false},
			} {
				t.Run("phone/"+item.phone+"/"+item.query, func(t *testing.T) {
					digits := PipelinePhoneDigits(item.query)
					var matches bool
					expression := "($1::text collate " + collation + ")"
					err := connection.QueryRow(ctx, "select $3::boolean and ("+PipelinePhoneSQL(expression, "$2")+")", item.phone, "%"+digits+"%", digits != "").Scan(&matches)
					if err != nil {
						t.Fatal(err)
					}
					if matches != item.want {
						t.Fatalf("SQL phone match=%t want=%t digits=%q", matches, item.want, digits)
					}
				})
			}
		})
	}
}
