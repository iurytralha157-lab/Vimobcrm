package site

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type getSiteTestRow struct {
	err error
}

func (row getSiteTestRow) Scan(_ ...any) error {
	return row.err
}

type getSiteTestQueryer struct {
	rows    []pgx.Row
	queries []string
}

func (queryer *getSiteTestQueryer) QueryRow(_ context.Context, query string, _ ...any) pgx.Row {
	queryer.queries = append(queryer.queries, query)
	if len(queryer.rows) == 0 {
		return getSiteTestRow{err: errors.New("unexpected site query")}
	}
	row := queryer.rows[0]
	queryer.rows = queryer.rows[1:]
	return row
}

func TestGetSiteFallsBackWhenSearchConsoleColumnIsMissing(t *testing.T) {
	t.Parallel()

	queryer := &getSiteTestQueryer{rows: []pgx.Row{
		getSiteTestRow{err: &pgconn.PgError{
			Code:    "42703",
			Message: `column "google_search_console_verification" does not exist`,
		}},
		getSiteTestRow{},
	}}

	site, err := getSite(context.Background(), queryer, "7b8f9b9f-0000-4000-8000-000000000001")
	if err != nil {
		t.Fatalf("getSite() returned error: %v", err)
	}
	if site == nil {
		t.Fatal("getSite() returned no site after the compatibility fallback")
	}
	if len(queryer.queries) != 2 {
		t.Fatalf("getSite() executed %d queries, want canonical read plus one fallback", len(queryer.queries))
	}
	if !strings.Contains(queryer.queries[0], "\n\t\tgoogle_search_console_verification,") {
		t.Fatal("canonical site read must continue selecting the stored Search Console value")
	}
	if !strings.Contains(queryer.queries[1], "\n\t\tnull::text as google_search_console_verification,") {
		t.Fatal("compatibility site read must preserve the Search Console response field as SQL NULL")
	}

	payload, err := json.Marshal(Envelope[OrganizationSite]{Data: *site})
	if err != nil {
		t.Fatalf("marshal site envelope: %v", err)
	}
	if !strings.Contains(string(payload), `"google_search_console_verification":null`) {
		t.Fatalf("site response must preserve a null Search Console field, got %s", payload)
	}
}

func TestGetSiteDoesNotFallbackForUnrelatedDatabaseErrors(t *testing.T) {
	t.Parallel()

	databaseError := &pgconn.PgError{
		Code:    "42703",
		Message: `column "maintenance_mode" does not exist`,
	}
	queryer := &getSiteTestQueryer{rows: []pgx.Row{getSiteTestRow{err: databaseError}}}

	site, err := getSite(context.Background(), queryer, "7b8f9b9f-0000-4000-8000-000000000001")
	if site != nil {
		t.Fatalf("getSite() returned an unexpected site: %#v", site)
	}
	if !errors.Is(err, databaseError) {
		t.Fatalf("getSite() error = %v, want original database error", err)
	}
	if len(queryer.queries) != 1 {
		t.Fatalf("getSite() executed %d queries for an unrelated error, want 1", len(queryer.queries))
	}
}

func TestSearchConsoleColumnMissingDetectionIsNarrow(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		err  error
		want bool
	}{
		{
			name: "column name",
			err: &pgconn.PgError{
				Code:       "42703",
				ColumnName: "google_search_console_verification",
			},
			want: true,
		},
		{
			name: "wrapped postgres message",
			err: errors.Join(errors.New("read site"), &pgconn.PgError{
				Code:    "42703",
				Message: `column "google_search_console_verification" does not exist`,
			}),
			want: true,
		},
		{
			name: "unrelated missing column",
			err: &pgconn.PgError{
				Code:       "42703",
				ColumnName: "maintenance_mode",
			},
		},
		{
			name: "similarly named missing column",
			err: &pgconn.PgError{
				Code:    "42703",
				Message: `column "legacy_google_search_console_verification" does not exist`,
			},
		},
		{
			name: "wrong sqlstate",
			err: &pgconn.PgError{
				Code:       "42501",
				ColumnName: "google_search_console_verification",
			},
		},
		{name: "non postgres error", err: errors.New("boom")},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := isGoogleSearchConsoleVerificationColumnMissing(test.err); got != test.want {
				t.Fatalf("isGoogleSearchConsoleVerificationColumnMissing() = %v, want %v", got, test.want)
			}
		})
	}
}
