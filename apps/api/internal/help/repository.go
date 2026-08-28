package help

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Store interface {
	ListArticles(context.Context, Audience) ([]ArticleSummary, error)
	ShowArticle(context.Context, Audience, string) (ArticleDetail, error)
	SearchArticles(context.Context, Audience, string, int) ([]ArticleSummary, error)
}

type Repository struct {
	db *dbpkg.Postgres
}

type rowScanner interface {
	Scan(...any) error
}

func NewRepository(db *dbpkg.Postgres) Repository {
	return Repository{db: db}
}

const articleSummaryColumns = `
	article.id::text,
	article.slug,
	article.category,
	article.module_key,
	article.title,
	article.summary,
	article.route_href,
	article.action_label,
	article.estimated_minutes,
	article.display_order,
	article.updated_at
`

const articleResultColumns = `
	result.id,
	result.slug,
	result.category,
	result.module_key,
	result.title,
	result.summary,
	result.route_href,
	result.action_label,
	result.estimated_minutes,
	result.display_order,
	result.updated_at
`

const searchArticlesSQL = `
	with search_input as (
	  select
	    websearch_to_tsquery('portuguese', $2) as query,
	    websearch_to_tsquery(
	      'portuguese',
	      translate(
	        lower($2),
	        'áàâãäéèêëíìîïóòôõöúùûüçñ',
	        'aaaaaeeeeiiiiooooouuuucn'
	      )
	    ) as normalized_query,
	    translate(
	      lower($2),
	      'áàâãäéèêëíìîïóòôõöúùûüçñ',
	      'aaaaaeeeeiiiiooooouuuucn'
	    ) as literal
	),
	fts as (
	  select
	    ` + articleSummaryColumns + `,
	    (
	      translate(
	        lower(article.title),
	        'áàâãäéèêëíìîïóòôõöúùûüçñ',
	        'aaaaaeeeeiiiiooooouuuucn'
	      ) = search_input.literal
	    ) as exact_match,
	    greatest(
	      ts_rank_cd(article.search_vector, search_input.query),
	      ts_rank_cd(article.search_vector, search_input.normalized_query)
	    ) as rank,
	    0 as source
	  from public.help_articles article
	  cross join search_input
	  where article.is_active = true
	    and article.visibility = any($1::text[])
	    and (
	      article.search_vector @@ search_input.query
	      or article.search_vector @@ search_input.normalized_query
	    )
	  order by exact_match desc, rank desc, article.display_order, article.updated_at desc, article.id
	  limit $3
	),
	fallback as (
	  select
	    ` + articleSummaryColumns + `,
	    (
	      translate(
	        lower(article.title),
	        'áàâãäéèêëíìîïóòôõöúùûüçñ',
	        'aaaaaeeeeiiiiooooouuuucn'
	      ) = search_input.literal
	    ) as exact_match,
	    0::real as rank,
	    1 as source
	  from public.help_articles article
	  cross join search_input
	  where article.is_active = true
	    and article.visibility = any($1::text[])
	    and not exists (select 1 from fts where fts.id = article.id::text)
	    and (
	      strpos(
	        translate(lower(article.title), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
	        search_input.literal
	      ) > 0
	      or strpos(
	        translate(lower(article.summary), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
	        search_input.literal
	      ) > 0
	      or strpos(
	        translate(lower(article.category), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
	        search_input.literal
	      ) > 0
	      or strpos(
	        translate(lower(article.content), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
	        search_input.literal
	      ) > 0
	      or strpos(
	        translate(lower(article.steps::text), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
	        search_input.literal
	      ) > 0
	      or strpos(
	        translate(
	          lower(coalesce(array_to_string(article.search_keywords, ' '), '')),
	          'áàâãäéèêëíìîïóòôõöúùûüçñ',
	          'aaaaaeeeeiiiiooooouuuucn'
	        ),
	        search_input.literal
	      ) > 0
	    )
	  order by exact_match desc, article.display_order, article.updated_at desc, article.id
	  limit $3
	)
	select ` + articleResultColumns + `
	from (
	  select * from fts
	  union all
	  select * from fallback
	) result
	order by
	  result.source,
	  result.exact_match desc,
	  result.rank desc,
	  result.display_order,
	  result.updated_at desc,
	  result.id
	limit $3
`

func (repo Repository) ListArticles(ctx context.Context, audience Audience) ([]ArticleSummary, error) {
	visibilities, err := audienceVisibilities(audience)
	if err != nil {
		return nil, err
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select `+articleSummaryColumns+`
		from public.help_articles article
		where article.is_active = true
		  and article.visibility = any($1::text[])
		order by article.category, article.display_order, article.title, article.id
		limit $2
	`, visibilities, maxArticleList)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	articles := make([]ArticleSummary, 0)
	for rows.Next() {
		article, scanErr := scanArticleSummary(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		articles = append(articles, article)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return articles, nil
}

func (repo Repository) ShowArticle(
	ctx context.Context,
	audience Audience,
	rawSlug string,
) (ArticleDetail, error) {
	visibilities, err := audienceVisibilities(audience)
	if err != nil {
		return ArticleDetail{}, err
	}
	slug, ok := normalizeSlug(rawSlug)
	if !ok {
		return ArticleDetail{}, ErrInvalidInput
	}

	article, err := scanArticleDetail(repo.db.Pool().QueryRow(ctx, `
		select
		  `+articleSummaryColumns+`,
		  article.content,
		  article.search_keywords,
		  article.steps,
		  article.related_slugs,
		  article.image_url,
		  article.video_url,
		  article.last_reviewed_at
		from public.help_articles article
		where article.is_active = true
		  and article.visibility = any($1::text[])
		  and lower(article.slug) = $2
		limit 1
	`, visibilities, slug))
	if errors.Is(err, pgx.ErrNoRows) {
		return ArticleDetail{}, ErrNotFound
	}
	return article, err
}

func (repo Repository) SearchArticles(
	ctx context.Context,
	audience Audience,
	rawQuery string,
	rawLimit int,
) ([]ArticleSummary, error) {
	visibilities, err := audienceVisibilities(audience)
	if err != nil {
		return nil, err
	}
	query, limit, err := (SearchRequest{Query: rawQuery, Limit: &rawLimit}).normalized()
	if err != nil {
		return nil, err
	}

	rows, err := repo.db.Pool().Query(ctx, searchArticlesSQL, visibilities, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	articles := make([]ArticleSummary, 0, limit)
	for rows.Next() {
		article, scanErr := scanArticleSummary(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		articles = append(articles, article)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return articles, nil
}

func scanArticleSummary(scanner rowScanner) (ArticleSummary, error) {
	var article ArticleSummary
	var routeHref pgtype.Text
	var actionLabel pgtype.Text
	if err := scanner.Scan(
		&article.ID,
		&article.Slug,
		&article.Category,
		&article.ModuleKey,
		&article.Title,
		&article.Summary,
		&routeHref,
		&actionLabel,
		&article.EstimatedMinutes,
		&article.DisplayOrder,
		&article.UpdatedAt,
	); err != nil {
		return ArticleSummary{}, err
	}
	article.RouteHref = textPointer(routeHref)
	article.ActionLabel = textPointer(actionLabel)
	return normalizeArticleSummary(article)
}

func scanArticleDetail(scanner rowScanner) (ArticleDetail, error) {
	var article ArticleDetail
	var routeHref pgtype.Text
	var actionLabel pgtype.Text
	var imageURL pgtype.Text
	var videoURL pgtype.Text
	var lastReviewedAt pgtype.Timestamptz
	var rawSteps []byte

	if err := scanner.Scan(
		&article.ID,
		&article.Slug,
		&article.Category,
		&article.ModuleKey,
		&article.Title,
		&article.Summary,
		&routeHref,
		&actionLabel,
		&article.EstimatedMinutes,
		&article.DisplayOrder,
		&article.UpdatedAt,
		&article.Content,
		&article.SearchKeywords,
		&rawSteps,
		&article.RelatedSlugs,
		&imageURL,
		&videoURL,
		&lastReviewedAt,
	); err != nil {
		return ArticleDetail{}, err
	}
	article.RouteHref = textPointer(routeHref)
	article.ActionLabel = textPointer(actionLabel)
	article.ImageURL = textPointer(imageURL)
	article.VideoURL = textPointer(videoURL)
	article.LastReviewedAt = timestampPointer(lastReviewedAt)
	return normalizeArticleDetail(article, json.RawMessage(rawSteps))
}

func audienceVisibilities(audience Audience) ([]string, error) {
	switch audience {
	case AudienceAuthenticated:
		return []string{"authenticated", "all"}, nil
	case AudiencePublic:
		return []string{"public", "all"}, nil
	default:
		return nil, fmt.Errorf("%w: unsupported help audience", ErrInvalidInput)
	}
}

func textPointer(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	result := value.String
	return &result
}

func timestampPointer(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	result := value.Time
	return &result
}
