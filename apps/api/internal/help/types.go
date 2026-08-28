package help

import (
	"encoding/json"
	"errors"
	"html"
	"math"
	"net/url"
	"path"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	defaultSearchLimit = 6
	maxSearchLimit     = 12
	maxArticleList     = 200
)

var (
	ErrInvalidInput       = errors.New("invalid help input")
	ErrNotFound           = errors.New("help article not found")
	ErrInvalidArticleData = errors.New("invalid stored help article")

	slugPattern        = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
	scriptTagPattern   = regexp.MustCompile(`(?is)<script\b[^>]*>.*?</script\s*>`)
	styleTagPattern    = regexp.MustCompile(`(?is)<style\b[^>]*>.*?</style\s*>`)
	htmlTagPattern     = regexp.MustCompile(`(?s)<[^>]*>`)
	repeatedLineBreaks = regexp.MustCompile(`\n{3,}`)
)

type Audience string

const (
	AudienceAuthenticated Audience = "authenticated"
	AudiencePublic        Audience = "public"
)

type Envelope[T any] struct {
	Data T `json:"data"`
}

type ArticleSummary struct {
	ID               string    `json:"id"`
	Slug             string    `json:"slug"`
	Category         string    `json:"category"`
	ModuleKey        string    `json:"moduleKey"`
	Title            string    `json:"title"`
	Summary          string    `json:"summary"`
	RouteHref        *string   `json:"routeHref,omitempty"`
	ActionLabel      *string   `json:"actionLabel,omitempty"`
	EstimatedMinutes int       `json:"estimatedMinutes"`
	DisplayOrder     int       `json:"displayOrder"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type ArticleDetail struct {
	ArticleSummary
	Content        string     `json:"content"`
	SearchKeywords []string   `json:"searchKeywords"`
	Steps          []Step     `json:"steps"`
	RelatedSlugs   []string   `json:"relatedSlugs"`
	ImageURL       *string    `json:"imageUrl,omitempty"`
	VideoURL       *string    `json:"videoUrl,omitempty"`
	LastReviewedAt *time.Time `json:"lastReviewedAt,omitempty"`
}

type Step struct {
	ID           string       `json:"id"`
	Title        string       `json:"title"`
	Body         string       `json:"body"`
	ImageURL     *string      `json:"imageUrl,omitempty"`
	ImageAlt     *string      `json:"imageAlt,omitempty"`
	ImageCaption *string      `json:"imageCaption,omitempty"`
	ActionLabel  *string      `json:"actionLabel,omitempty"`
	ActionHref   *string      `json:"actionHref,omitempty"`
	Annotations  []Annotation `json:"annotations"`
}

type Annotation struct {
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	Label string  `json:"label"`
	Title *string `json:"title,omitempty"`
}

type SearchRequest struct {
	Query string `json:"query"`
	Limit *int   `json:"limit,omitempty"`
}

func (request SearchRequest) normalized() (string, int, error) {
	query := sanitizePlainText(request.Query, false, 0)
	if utf8.RuneCountInString(query) < 2 || utf8.RuneCountInString(query) > 500 {
		return "", 0, ErrInvalidInput
	}

	limit := defaultSearchLimit
	if request.Limit != nil {
		limit = *request.Limit
	}
	if limit < 1 || limit > maxSearchLimit {
		return "", 0, ErrInvalidInput
	}
	return query, limit, nil
}

func normalizeSlug(value string) (string, bool) {
	value = strings.ToLower(strings.TrimSpace(value))
	if utf8.RuneCountInString(value) < 1 || utf8.RuneCountInString(value) > 180 {
		return "", false
	}
	return value, slugPattern.MatchString(value)
}

func normalizeArticleSummary(summary ArticleSummary) (ArticleSummary, error) {
	summary.ID = strings.TrimSpace(summary.ID)
	slug, slugOK := normalizeSlug(summary.Slug)
	moduleKey, moduleOK := normalizeSlug(summary.ModuleKey)
	summary.Slug = slug
	summary.ModuleKey = moduleKey
	summary.Category = sanitizePlainText(summary.Category, false, 80)
	summary.Title = sanitizePlainText(summary.Title, false, 180)
	summary.Summary = sanitizePlainText(summary.Summary, false, 320)
	summary.RouteHref = normalizeInternalPathPointer(summary.RouteHref)
	summary.ActionLabel = normalizeOptionalText(summary.ActionLabel, 80)

	if summary.ID == "" || !slugOK || !moduleOK ||
		summary.Category == "" || summary.Title == "" || summary.Summary == "" ||
		summary.EstimatedMinutes < 1 || summary.EstimatedMinutes > 60 ||
		summary.UpdatedAt.IsZero() {
		return ArticleSummary{}, ErrInvalidArticleData
	}
	return summary, nil
}

func normalizeArticleDetail(detail ArticleDetail, rawSteps json.RawMessage) (ArticleDetail, error) {
	summary, err := normalizeArticleSummary(detail.ArticleSummary)
	if err != nil {
		return ArticleDetail{}, err
	}
	detail.ArticleSummary = summary
	detail.Content = sanitizePlainText(detail.Content, true, 20_000)
	if detail.Content == "" {
		return ArticleDetail{}, ErrInvalidArticleData
	}
	detail.SearchKeywords = normalizeKeywords(detail.SearchKeywords)
	detail.RelatedSlugs = normalizeRelatedSlugs(detail.Slug, detail.RelatedSlugs)
	detail.ImageURL = normalizeHelpMediaPointer(detail.ImageURL)
	detail.VideoURL = normalizeHelpMediaPointer(detail.VideoURL)

	steps, err := normalizeSteps(rawSteps)
	if err != nil {
		return ArticleDetail{}, err
	}
	detail.Steps = steps
	return detail, nil
}

func normalizeSteps(raw json.RawMessage) ([]Step, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return []Step{}, nil
	}

	var candidates []Step
	if err := json.Unmarshal(raw, &candidates); err != nil {
		return nil, ErrInvalidArticleData
	}
	if len(candidates) > 40 {
		candidates = candidates[:40]
	}

	steps := make([]Step, 0, len(candidates))
	for _, candidate := range candidates {
		candidate.ID = sanitizePlainText(candidate.ID, false, 80)
		candidate.Title = sanitizePlainText(candidate.Title, false, 180)
		candidate.Body = sanitizePlainText(candidate.Body, true, 5_000)
		if candidate.ID == "" || candidate.Title == "" || candidate.Body == "" {
			continue
		}
		candidate.ImageURL = normalizeHelpMediaPointer(candidate.ImageURL)
		candidate.ImageAlt = normalizeOptionalText(candidate.ImageAlt, 300)
		candidate.ImageCaption = normalizeOptionalText(candidate.ImageCaption, 500)
		candidate.ActionLabel = normalizeOptionalText(candidate.ActionLabel, 80)
		candidate.ActionHref = normalizeInternalPathPointer(candidate.ActionHref)

		annotations := make([]Annotation, 0, len(candidate.Annotations))
		for _, annotation := range candidate.Annotations {
			annotation.Label = sanitizePlainText(annotation.Label, false, 80)
			annotation.Title = normalizeOptionalText(annotation.Title, 180)
			if annotation.Label == "" ||
				math.IsNaN(annotation.X) || math.IsInf(annotation.X, 0) ||
				math.IsNaN(annotation.Y) || math.IsInf(annotation.Y, 0) ||
				annotation.X < 0 || annotation.X > 100 ||
				annotation.Y < 0 || annotation.Y > 100 {
				continue
			}
			annotations = append(annotations, annotation)
		}
		candidate.Annotations = annotations
		steps = append(steps, candidate)
	}
	return steps, nil
}

func normalizeKeywords(values []string) []string {
	result := make([]string, 0, min(len(values), 40))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = sanitizePlainText(value, false, 80)
		key := strings.ToLower(value)
		if value == "" {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, value)
		if len(result) == 40 {
			break
		}
	}
	return result
}

func normalizeRelatedSlugs(articleSlug string, values []string) []string {
	result := make([]string, 0, min(len(values), 20))
	seen := map[string]struct{}{articleSlug: {}}
	for _, value := range values {
		slug, ok := normalizeSlug(value)
		if !ok {
			continue
		}
		if _, exists := seen[slug]; exists {
			continue
		}
		seen[slug] = struct{}{}
		result = append(result, slug)
		if len(result) == 20 {
			break
		}
	}
	return result
}

func normalizeOptionalText(value *string, maxRunes int) *string {
	if value == nil {
		return nil
	}
	normalized := sanitizePlainText(*value, false, maxRunes)
	if normalized == "" {
		return nil
	}
	return &normalized
}

func normalizeInternalPathPointer(value *string) *string {
	if value == nil {
		return nil
	}
	normalized, ok := normalizeInternalPath(*value)
	if !ok {
		return nil
	}
	return &normalized
}

func normalizeInternalPath(value string) (string, bool) {
	value = strings.TrimSpace(value)
	if value == "" || !strings.HasPrefix(value, "/") || strings.HasPrefix(value, "//") ||
		strings.ContainsAny(value, "\\#\x00\r\n\t") {
		return "", false
	}

	parsed, err := url.ParseRequestURI(value)
	if err != nil || parsed.IsAbs() || parsed.Host != "" || parsed.Fragment != "" {
		return "", false
	}
	decodedPath, err := url.PathUnescape(parsed.EscapedPath())
	if err != nil || decodedPath == "" || !strings.HasPrefix(decodedPath, "/") ||
		strings.HasPrefix(decodedPath, "//") || strings.Contains(decodedPath, "\\") {
		return "", false
	}
	for _, segment := range strings.Split(decodedPath, "/") {
		if segment == "." || segment == ".." {
			return "", false
		}
	}
	if cleaned := path.Clean(decodedPath); cleaned != decodedPath {
		return "", false
	}

	normalized := parsed.EscapedPath()
	if parsed.RawQuery != "" {
		normalized += "?" + parsed.RawQuery
	}
	return normalized, true
}

func normalizeHelpMediaPointer(value *string) *string {
	if value == nil {
		return nil
	}
	normalized, ok := normalizeInternalPath(*value)
	if !ok {
		return nil
	}
	parsed, err := url.ParseRequestURI(normalized)
	if err != nil {
		return nil
	}
	if !strings.HasPrefix(parsed.Path, "/help/") &&
		!strings.HasPrefix(parsed.Path, "/images/help/") {
		return nil
	}
	return &normalized
}

func sanitizePlainText(value string, multiline bool, maxRunes int) string {
	value = scriptTagPattern.ReplaceAllString(value, " ")
	value = styleTagPattern.ReplaceAllString(value, " ")
	value = htmlTagPattern.ReplaceAllString(value, " ")
	value = html.UnescapeString(value)
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")

	var builder strings.Builder
	builder.Grow(len(value))
	for _, character := range value {
		if character == '\n' && multiline {
			builder.WriteRune(character)
			continue
		}
		if character == '\t' {
			builder.WriteRune(' ')
			continue
		}
		if unicode.IsControl(character) {
			continue
		}
		builder.WriteRune(character)
	}

	if multiline {
		lines := strings.Split(builder.String(), "\n")
		for index := range lines {
			lines[index] = normalizePlainTextPunctuation(
				strings.Join(strings.Fields(lines[index]), " "),
			)
		}
		value = strings.TrimSpace(repeatedLineBreaks.ReplaceAllString(strings.Join(lines, "\n"), "\n\n"))
	} else {
		value = normalizePlainTextPunctuation(strings.Join(strings.Fields(builder.String()), " "))
	}

	if maxRunes > 0 && utf8.RuneCountInString(value) > maxRunes {
		runes := []rune(value)
		value = strings.TrimSpace(string(runes[:maxRunes-1])) + "…"
	}
	return value
}

func normalizePlainTextPunctuation(value string) string {
	return strings.NewReplacer(
		" .", ".",
		" ,", ",",
		" !", "!",
		" ?", "?",
		" :", ":",
		" ;", ";",
	).Replace(value)
}
