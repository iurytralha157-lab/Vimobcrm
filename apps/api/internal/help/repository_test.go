package help

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

type scannerFunc func(...any) error

func (scanner scannerFunc) Scan(destinations ...any) error {
	return scanner(destinations...)
}

func TestAudienceVisibilitiesAreMutuallyScoped(t *testing.T) {
	authenticated, err := audienceVisibilities(AudienceAuthenticated)
	if err != nil {
		t.Fatalf("authenticated visibility: %v", err)
	}
	if strings.Join(authenticated, ",") != "authenticated,all" {
		t.Fatalf("authenticated visibility = %#v", authenticated)
	}

	public, err := audienceVisibilities(AudiencePublic)
	if err != nil {
		t.Fatalf("public visibility: %v", err)
	}
	if strings.Join(public, ",") != "public,all" {
		t.Fatalf("public visibility = %#v", public)
	}

	if _, err := audienceVisibilities(Audience("unknown")); err == nil {
		t.Fatal("unknown audience was accepted")
	}
}

func TestSearchQueryUsesIndexedFTSAndLiteralFallbackWithoutWildcards(t *testing.T) {
	query := strings.ToLower(searchArticlesSQL)
	for _, required := range []string{
		"article.is_active = true",
		"article.visibility = any($1::text[])",
		"article.search_vector @@ search_input.query",
		"article.search_vector @@ search_input.normalized_query",
		"ts_rank_cd(",
		"translate(lower(article.title)",
		"search_input.literal",
		"not exists (select 1 from fts",
		"limit $3",
	} {
		if !strings.Contains(query, required) {
			t.Errorf("search query is missing %q", required)
		}
	}
	for _, forbidden := range []string{" ilike ", " like ", "'%' ||"} {
		if strings.Contains(query, forbidden) {
			t.Errorf("search query contains wildcard fallback %q", forbidden)
		}
	}
}

func TestScanArticleSummaryReturnsSanitizedProjection(t *testing.T) {
	updatedAt := time.Date(2026, time.July, 29, 12, 0, 0, 0, time.UTC)
	scanner := scannerFunc(func(destinations ...any) error {
		*destinations[0].(*string) = "10000000-0000-4000-8000-000000000001"
		*destinations[1].(*string) = "criar-um-lead"
		*destinations[2].(*string) = "<b>Leads</b>"
		*destinations[3].(*string) = "pipeline"
		*destinations[4].(*string) = "<h1>Como criar um lead?</h1>"
		*destinations[5].(*string) = "Cadastre um <strong>novo lead</strong>."
		*destinations[6].(*pgtype.Text) = pgtype.Text{
			String: "/crm/pipelines",
			Valid:  true,
		}
		*destinations[7].(*pgtype.Text) = pgtype.Text{
			String: "Abrir Pipeline",
			Valid:  true,
		}
		*destinations[8].(*int) = 3
		*destinations[9].(*int) = 10
		*destinations[10].(*time.Time) = updatedAt
		return nil
	})

	article, err := scanArticleSummary(scanner)
	if err != nil {
		t.Fatalf("scan summary: %v", err)
	}
	if article.Category != "Leads" ||
		article.Title != "Como criar um lead?" ||
		article.Summary != "Cadastre um novo lead." ||
		article.RouteHref == nil || *article.RouteHref != "/crm/pipelines" ||
		article.ActionLabel == nil || *article.ActionLabel != "Abrir Pipeline" {
		t.Fatalf("unexpected summary: %#v", article)
	}
}

func TestScanArticleDetailOmitsUnsafeLinksAndMedia(t *testing.T) {
	updatedAt := time.Date(2026, time.July, 29, 12, 0, 0, 0, time.UTC)
	reviewedAt := time.Date(2026, time.July, 28, 10, 0, 0, 0, time.UTC)
	rawSteps, err := json.Marshal([]Step{{
		ID:         "step-1",
		Title:      "Abra o Pipeline",
		Body:       "Clique em Novo Lead.",
		ImageURL:   stringPointer("/images/help/new-lead.webp"),
		ActionHref: stringPointer("//attacker.invalid"),
	}})
	if err != nil {
		t.Fatalf("marshal steps: %v", err)
	}

	scanner := scannerFunc(func(destinations ...any) error {
		*destinations[0].(*string) = "10000000-0000-4000-8000-000000000001"
		*destinations[1].(*string) = "criar-um-lead"
		*destinations[2].(*string) = "Leads"
		*destinations[3].(*string) = "pipeline"
		*destinations[4].(*string) = "Como criar um lead?"
		*destinations[5].(*string) = "Cadastre um novo lead."
		*destinations[6].(*pgtype.Text) = pgtype.Text{
			String: "https://attacker.invalid",
			Valid:  true,
		}
		*destinations[7].(*pgtype.Text) = pgtype.Text{}
		*destinations[8].(*int) = 3
		*destinations[9].(*int) = 10
		*destinations[10].(*time.Time) = updatedAt
		*destinations[11].(*string) = "<p>Abra o Pipeline.</p>"
		*destinations[12].(*[]string) = []string{"lead", "Lead"}
		*destinations[13].(*[]byte) = rawSteps
		*destinations[14].(*[]string) = []string{"pipeline", "../secret"}
		*destinations[15].(*pgtype.Text) = pgtype.Text{
			String: "/images/help/article.webp",
			Valid:  true,
		}
		*destinations[16].(*pgtype.Text) = pgtype.Text{
			String: "https://video.invalid",
			Valid:  true,
		}
		*destinations[17].(*pgtype.Timestamptz) = pgtype.Timestamptz{
			Time:  reviewedAt,
			Valid: true,
		}
		return nil
	})

	article, err := scanArticleDetail(scanner)
	if err != nil {
		t.Fatalf("scan detail: %v", err)
	}
	if article.RouteHref != nil || article.VideoURL != nil {
		t.Fatalf("unsafe URLs were exposed: %#v", article)
	}
	if article.ImageURL == nil || *article.ImageURL != "/images/help/article.webp" {
		t.Fatalf("valid image was omitted: %#v", article.ImageURL)
	}
	if article.LastReviewedAt == nil || !article.LastReviewedAt.Equal(reviewedAt) {
		t.Fatalf("last reviewed timestamp = %#v", article.LastReviewedAt)
	}
	if len(article.Steps) != 1 || article.Steps[0].ActionHref != nil {
		t.Fatalf("step was not normalized: %#v", article.Steps)
	}
	if len(article.SearchKeywords) != 1 || len(article.RelatedSlugs) != 1 {
		t.Fatalf(
			"keywords/related slugs were not normalized: %#v / %#v",
			article.SearchKeywords,
			article.RelatedSlugs,
		)
	}
}

func stringPointer(value string) *string {
	return &value
}
