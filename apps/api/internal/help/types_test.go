package help

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func TestSearchRequestNormalizedEnforcesQueryAndLimit(t *testing.T) {
	query, limit, err := (SearchRequest{Query: "  Como criar um lead?  "}).normalized()
	if err != nil {
		t.Fatalf("normalize valid search: %v", err)
	}
	if query != "Como criar um lead?" || limit != defaultSearchLimit {
		t.Fatalf("normalized search = %q, %d", query, limit)
	}

	for _, request := range []SearchRequest{
		{Query: "a"},
		{Query: strings.Repeat("a", 501)},
		{Query: "pipeline", Limit: intPointer(0)},
		{Query: "pipeline", Limit: intPointer(maxSearchLimit + 1)},
	} {
		if _, _, err := request.normalized(); err == nil {
			t.Fatalf("expected invalid request: %#v", request)
		}
	}
}

func TestNormalizeInternalPathRejectsExternalAndAmbiguousPaths(t *testing.T) {
	valid := map[string]string{
		"/crm/pipelines":                  "/crm/pipelines",
		"/automations?tab=templates":      "/automations?tab=templates",
		"/help/conectar-o-whatsapp":       "/help/conectar-o-whatsapp",
		"/images/help/whatsapp.webp":      "/images/help/whatsapp.webp",
		"/crm/contacts?search=Andr%C3%A9": "/crm/contacts?search=Andr%C3%A9",
	}
	for input, expected := range valid {
		got, ok := normalizeInternalPath(input)
		if !ok || got != expected {
			t.Errorf("normalizeInternalPath(%q) = %q, %v; want %q", input, got, ok, expected)
		}
	}

	for _, input := range []string{
		"https://attacker.invalid",
		"//attacker.invalid",
		"/\\attacker.invalid",
		"/help/../secret",
		"/help/%2e%2e/secret",
		"/help/%2F%2Fattacker.invalid",
		"/help//article",
		"/help/article#fragment",
	} {
		if got, ok := normalizeInternalPath(input); ok {
			t.Errorf("unsafe path %q was accepted as %q", input, got)
		}
	}
}

func TestNormalizeHelpMediaAcceptsOnlyHelpPrefixes(t *testing.T) {
	for _, value := range []string{
		"/help/screenshots/pipeline.webp",
		"/images/help/pipeline.png",
	} {
		if got := normalizeHelpMediaPointer(&value); got == nil || *got != value {
			t.Errorf("valid help media %q was rejected", value)
		}
	}

	for _, value := range []string{
		"/images/logo.png",
		"/crm/pipelines",
		"https://cdn.invalid/help/image.png",
		"/images/help/../private.png",
	} {
		if got := normalizeHelpMediaPointer(&value); got != nil {
			t.Errorf("invalid help media %q was accepted as %q", value, *got)
		}
	}
}

func TestNormalizeArticleDetailReturnsPlainSafeContract(t *testing.T) {
	route := "/crm/pipelines"
	badVideo := "https://video.invalid/watch"
	detail := ArticleDetail{
		ArticleSummary: ArticleSummary{
			ID:               "10000000-0000-4000-8000-000000000001",
			Slug:             "criar-um-lead",
			Category:         "<strong>Leads</strong>",
			ModuleKey:        "pipeline",
			Title:            "<h1>Como criar um lead?</h1>",
			Summary:          "Cadastre um <b>novo lead</b>.",
			RouteHref:        &route,
			EstimatedMinutes: 3,
			DisplayOrder:     10,
			UpdatedAt:        time.Date(2026, time.July, 29, 12, 0, 0, 0, time.UTC),
		},
		Content:        `<script>alert("x")</script><p>Abra o Pipeline.</p>`,
		SearchKeywords: []string{"Lead", " lead ", "<b>Cadastro</b>"},
		RelatedSlugs:   []string{"pipeline", "PIPELINE", "../secret", "criar-um-lead"},
		VideoURL:       &badVideo,
	}
	rawSteps := json.RawMessage(`[
		{
			"id":"step-1",
			"title":"<b>Novo Lead</b>",
			"body":"Clique em <strong>Novo Lead</strong>.",
			"imageUrl":"/images/help/new-lead.webp",
			"actionHref":"javascript:alert(1)",
			"annotations":[
				{"x":25,"y":40,"label":"Botão"},
				{"x":101,"y":40,"label":"Fora"}
			]
		},
		{"id":"","title":"Inválido","body":"Sem identificador"}
	]`)

	normalized, err := normalizeArticleDetail(detail, rawSteps)
	if err != nil {
		t.Fatalf("normalize article detail: %v", err)
	}
	if normalized.Category != "Leads" ||
		normalized.Title != "Como criar um lead?" ||
		normalized.Summary != "Cadastre um novo lead." ||
		normalized.Content != "Abra o Pipeline." {
		t.Fatalf("text was not normalized: %#v", normalized)
	}
	if normalized.VideoURL != nil {
		t.Fatalf("external video URL was not omitted: %q", *normalized.VideoURL)
	}
	if len(normalized.SearchKeywords) != 2 ||
		normalized.SearchKeywords[0] != "Lead" ||
		normalized.SearchKeywords[1] != "Cadastro" {
		t.Fatalf("unexpected keywords: %#v", normalized.SearchKeywords)
	}
	if len(normalized.RelatedSlugs) != 1 || normalized.RelatedSlugs[0] != "pipeline" {
		t.Fatalf("unexpected related slugs: %#v", normalized.RelatedSlugs)
	}
	if len(normalized.Steps) != 1 {
		t.Fatalf("steps = %#v", normalized.Steps)
	}
	step := normalized.Steps[0]
	if step.Title != "Novo Lead" || step.Body != "Clique em Novo Lead." ||
		step.ImageURL == nil || *step.ImageURL != "/images/help/new-lead.webp" ||
		step.ActionHref != nil || len(step.Annotations) != 1 {
		t.Fatalf("unsafe step was not normalized: %#v", step)
	}
}

func TestSanitizePlainTextRemovesExecutableMarkup(t *testing.T) {
	got := sanitizePlainText(
		`<style>body{display:none}</style><h1>Ajuda &amp; suporte</h1><script>alert("x")</script>`,
		false,
		200,
	)
	if got != "Ajuda & suporte" {
		t.Fatalf("unexpected plain text: %q", got)
	}
}

func TestSanitizePlainTextKeepsEllipsisInsideRuneLimit(t *testing.T) {
	got := sanitizePlainText("abcdef", false, 5)
	if got != "abcd…" {
		t.Fatalf("unexpected truncated text: %q", got)
	}
	if utf8.RuneCountInString(got) != 5 {
		t.Fatalf("truncated text has %d runes, want 5", utf8.RuneCountInString(got))
	}
}

func intPointer(value int) *int {
	return &value
}
