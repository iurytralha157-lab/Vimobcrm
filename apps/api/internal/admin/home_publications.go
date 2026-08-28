package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	homePublicationListLimit   = 12
	homePublicationImageLimit  = 5 << 20
	homePublicationImageBucket = "site-images"
	homeAssistantAnswerLimit   = 1500
)

var (
	errHomePublicationStorageNotConfigured = errors.New("home publication storage is not configured")
	errHomePublicationStorageOperation     = errors.New("home publication storage operation failed")

	homePublicationCardSizes = map[string]struct{}{
		"wide":    {},
		"half":    {},
		"compact": {},
	}
	homePublicationAccents = map[string]struct{}{
		"orange":  {},
		"violet":  {},
		"blue":    {},
		"emerald": {},
		"amber":   {},
		"slate":   {},
	}
	homePublicationTargetTypes = map[string]struct{}{
		"all":           {},
		"organizations": {},
		"users":         {},
		"roles":         {},
	}
	homePublicationTargetRoles = map[string]struct{}{
		"admin": {},
		"user":  {},
	}
	homePublicationCTAPaths = map[string]struct{}{
		"/dashboard":                   {},
		"/crm/pipelines":               {},
		"/crm/contacts":                {},
		"/crm/conversas":               {},
		"/agenda":                      {},
		"/automations":                 {},
		"/automations?tab=automations": {},
		"/automations?tab=templates":   {},
		"/automations?tab=history":     {},
		"/properties":                  {},
		"/gamificacao":                 {},
		"/notifications":               {},
		"/settings":                    {},
		"/suporte":                     {},
	}
	homeAssistantScriptPattern = regexp.MustCompile(`(?is)<script\b[^>]*>.*?</script\s*>`)
	homeAssistantStylePattern  = regexp.MustCompile(`(?is)<style\b[^>]*>.*?</style\s*>`)
	homeAssistantTagPattern    = regexp.MustCompile(`(?s)<[^>]*>`)
)

type HomePublication struct {
	ID                    string     `json:"id"`
	Title                 string     `json:"title"`
	Body                  string     `json:"body"`
	CTALabel              string     `json:"ctaLabel"`
	CTAHref               string     `json:"ctaHref"`
	ImageURL              *string    `json:"imageUrl"`
	CardSize              string     `json:"cardSize"`
	Accent                string     `json:"accent"`
	DisplayOrder          int        `json:"displayOrder"`
	IsActive              bool       `json:"isActive"`
	StartsAt              *time.Time `json:"startsAt"`
	EndsAt                *time.Time `json:"endsAt"`
	TargetType            string     `json:"targetType"`
	TargetOrganizationIDs []string   `json:"targetOrganizationIds"`
	TargetUserIDs         []string   `json:"targetUserIds"`
	TargetRoles           []string   `json:"targetRoles"`
	CreatedAt             time.Time  `json:"createdAt"`
	UpdatedAt             time.Time  `json:"updatedAt"`
}

// HomePublicationCard is the deliberately minimal user-facing projection.
// Audience configuration stays private to superadministrators.
type HomePublicationCard struct {
	ID           string  `json:"id"`
	Title        string  `json:"title"`
	Body         string  `json:"body"`
	CTALabel     string  `json:"ctaLabel"`
	CTAHref      string  `json:"ctaHref"`
	ImageURL     *string `json:"imageUrl"`
	CardSize     string  `json:"cardSize"`
	Accent       string  `json:"accent"`
	DisplayOrder int     `json:"displayOrder"`
}

type homePublicationRecord struct {
	HomePublication
	ImageStoragePath string
}

type homePublicationCreateRequest struct {
	Title                 string     `json:"title"`
	Body                  string     `json:"body"`
	CTALabel              string     `json:"ctaLabel"`
	CTAHref               string     `json:"ctaHref"`
	CardSize              string     `json:"cardSize"`
	Accent                string     `json:"accent"`
	DisplayOrder          *int       `json:"displayOrder"`
	IsActive              *bool      `json:"isActive"`
	StartsAt              *time.Time `json:"startsAt"`
	EndsAt                *time.Time `json:"endsAt"`
	TargetType            string     `json:"targetType"`
	TargetOrganizationIDs []string   `json:"targetOrganizationIds"`
	TargetUserIDs         []string   `json:"targetUserIds"`
	TargetRoles           []string   `json:"targetRoles"`
}

type optionalHomeValue[T any] struct {
	Set   bool
	Null  bool
	Value T
}

func (value *optionalHomeValue[T]) UnmarshalJSON(payload []byte) error {
	value.Set = true
	if bytes.Equal(bytes.TrimSpace(payload), []byte("null")) {
		value.Null = true
		return nil
	}
	return json.Unmarshal(payload, &value.Value)
}

type homePublicationUpdateRequest struct {
	Title                 optionalHomeValue[string]    `json:"title"`
	Body                  optionalHomeValue[string]    `json:"body"`
	CTALabel              optionalHomeValue[string]    `json:"ctaLabel"`
	CTAHref               optionalHomeValue[string]    `json:"ctaHref"`
	CardSize              optionalHomeValue[string]    `json:"cardSize"`
	Accent                optionalHomeValue[string]    `json:"accent"`
	DisplayOrder          optionalHomeValue[int]       `json:"displayOrder"`
	IsActive              optionalHomeValue[bool]      `json:"isActive"`
	StartsAt              optionalHomeValue[time.Time] `json:"startsAt"`
	EndsAt                optionalHomeValue[time.Time] `json:"endsAt"`
	TargetType            optionalHomeValue[string]    `json:"targetType"`
	TargetOrganizationIDs optionalHomeValue[[]string]  `json:"targetOrganizationIds"`
	TargetUserIDs         optionalHomeValue[[]string]  `json:"targetUserIds"`
	TargetRoles           optionalHomeValue[[]string]  `json:"targetRoles"`
}

type homePublicationOrderRequest struct {
	Items []homePublicationOrderItem `json:"items"`
}

type homePublicationOrderItem struct {
	ID           string `json:"id"`
	DisplayOrder int    `json:"displayOrder"`
}

type homeAssistantRequest struct {
	Question string `json:"question"`
}

type HomeAssistantAnswer struct {
	Answer    string `json:"answer"`
	Title     string `json:"title"`
	ArticleID string `json:"articleId"`
}

type homePublicationScanner interface {
	Scan(dest ...any) error
}

func (handler Handler) ListHomePublications(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.UserID == "" {
		httpserver.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "Missing authenticated user.")
		return
	}

	items, err := handler.repo.ListVisibleHomePublications(r.Context(), tenantContext)
	if err != nil {
		writeHomePublicationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]HomePublicationCard]{Data: items})
}

func (handler Handler) AnswerHomeAssistant(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.UserID == "" {
		httpserver.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "Missing authenticated user.")
		return
	}

	defer r.Body.Close()
	var request homeAssistantRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}

	question := strings.TrimSpace(request.Question)
	if runeCount(question) < 2 || runeCount(question) > 500 {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_home_question", "Question must contain between 2 and 500 characters.")
		return
	}

	answer, err := handler.repo.FindHomeAssistantAnswer(r.Context(), question)
	if err != nil {
		writeHomePublicationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[*HomeAssistantAnswer]{Data: answer})
}

func (handler Handler) ListHomePublicationsAdmin(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}

	items, err := handler.repo.ListHomePublicationsAdmin(r.Context(), tenantContext)
	if err != nil {
		writeHomePublicationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]HomePublication]{Data: items})
}

func (handler Handler) CreateHomePublicationAdmin(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}

	defer r.Body.Close()
	var request homePublicationCreateRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}

	record, err := homePublicationFromCreate(request)
	if err != nil {
		writeHomePublicationError(w, r, err)
		return
	}
	created, err := handler.repo.CreateHomePublication(r.Context(), tenantContext, record)
	if err != nil {
		writeHomePublicationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, Envelope[HomePublication]{Data: created.HomePublication})
}

func (handler Handler) UpdateHomePublicationAdmin(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}

	id, valid := normalizeUUID(r.PathValue("id"))
	if !valid {
		writeHomePublicationError(w, r, ErrInvalidInput)
		return
	}
	defer r.Body.Close()
	var request homePublicationUpdateRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}

	current, err := handler.repo.GetHomePublicationAdmin(r.Context(), tenantContext, id)
	if err != nil {
		writeHomePublicationError(w, r, err)
		return
	}
	updatedInput, err := applyHomePublicationUpdate(current, request)
	if err != nil {
		writeHomePublicationError(w, r, err)
		return
	}
	updated, err := handler.repo.UpdateHomePublication(r.Context(), tenantContext, id, updatedInput)
	if err != nil {
		writeHomePublicationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[HomePublication]{Data: updated.HomePublication})
}

func (handler Handler) DeleteHomePublicationAdmin(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}

	id, valid := normalizeUUID(r.PathValue("id"))
	if !valid {
		writeHomePublicationError(w, r, ErrInvalidInput)
		return
	}
	storagePath, err := handler.repo.DeleteHomePublication(r.Context(), tenantContext, id)
	if err != nil {
		writeHomePublicationError(w, r, err)
		return
	}

	response := map[string]any{"ok": true}
	if storagePath != "" {
		cleanupContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if cleanupErr := handler.repo.deleteHomePublicationObject(cleanupContext, storagePath); cleanupErr != nil {
			response["cleanupWarning"] = "Publication was deleted, but its previous image could not be removed."
		}
	}
	httpserver.WriteJSON(w, http.StatusOK, response)
}

func (handler Handler) ReorderHomePublicationsAdmin(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}

	defer r.Body.Close()
	var request homePublicationOrderRequest
	if err := decodeJSON(w, r, &request); err != nil {
		return
	}
	items, err := handler.repo.ReorderHomePublications(r.Context(), tenantContext, request.Items)
	if err != nil {
		writeHomePublicationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]HomePublication]{Data: items})
}

func (handler Handler) UploadHomePublicationImageAdmin(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	id, valid := normalizeUUID(r.PathValue("id"))
	if !valid {
		writeHomePublicationError(w, r, ErrInvalidInput)
		return
	}

	contentType, body, cleanup, err := parseHomePublicationImage(w, r)
	if cleanup != nil {
		defer cleanup()
	}
	if err != nil {
		writeHomePublicationError(w, r, err)
		return
	}

	updated, previousPath, err := handler.repo.UploadHomePublicationImage(r.Context(), tenantContext, id, contentType, body)
	if err != nil {
		writeHomePublicationError(w, r, err)
		return
	}
	response := struct {
		Data           HomePublication `json:"data"`
		CleanupWarning string          `json:"cleanupWarning,omitempty"`
	}{
		Data: updated.HomePublication,
	}
	if previousPath != "" && previousPath != updated.ImageStoragePath {
		cleanupContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if cleanupErr := handler.repo.deleteHomePublicationObject(cleanupContext, previousPath); cleanupErr != nil {
			response.CleanupWarning = "Image was replaced, but the previous object could not be removed."
		}
	}
	httpserver.WriteJSON(w, http.StatusCreated, response)
}

func (handler Handler) DeleteHomePublicationImageAdmin(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	id, valid := normalizeUUID(r.PathValue("id"))
	if !valid {
		writeHomePublicationError(w, r, ErrInvalidInput)
		return
	}

	updated, previousPath, err := handler.repo.ClearHomePublicationImage(r.Context(), tenantContext, id)
	if err != nil {
		writeHomePublicationError(w, r, err)
		return
	}
	response := struct {
		Data           HomePublication `json:"data"`
		CleanupWarning string          `json:"cleanupWarning,omitempty"`
	}{
		Data: updated.HomePublication,
	}
	if previousPath != "" {
		cleanupContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if cleanupErr := handler.repo.deleteHomePublicationObject(cleanupContext, previousPath); cleanupErr != nil {
			response.CleanupWarning = "Image was detached, but the previous object could not be removed."
		}
	}
	httpserver.WriteJSON(w, http.StatusOK, response)
}

func (repo Repository) ListVisibleHomePublications(ctx context.Context, tenantContext tenant.Context) ([]HomePublicationCard, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select `+homePublicationCardSelectColumns+`
		from public.home_publications hp
		where hp.is_active = true
		  and (hp.starts_at is null or hp.starts_at <= now())
		  and (hp.ends_at is null or hp.ends_at >= now())
		  and (
		    $4::boolean
		    or hp.target_type = 'all'
		    or (
		      hp.target_type = 'organizations'
		      and nullif($2::text, '') is not null
		      and hp.target_organization_ids @> array[nullif($2::text, '')::uuid]
		    )
		    or (
		      hp.target_type = 'users'
		      and hp.target_user_ids @> array[$1::uuid]
		    )
		    or (
		      hp.target_type = 'roles'
		      and hp.target_roles @> array[lower($3::text)]
		    )
		  )
		order by hp.display_order asc, hp.created_at asc, hp.id asc
		limit $5
	`, tenantContext.UserID, tenantContext.OrganizationID, normalizeHomeMemberRole(tenantContext.MemberRole), tenantContext.IsSuperAdmin, homePublicationListLimit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items, err := scanHomePublicationCardRows(rows)
	if err != nil {
		return nil, err
	}
	return items, nil
}

func (repo Repository) ListHomePublicationsAdmin(ctx context.Context, tenantContext tenant.Context) ([]HomePublication, error) {
	if !tenantContext.IsSuperAdmin {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	records, err := repo.listHomePublicationRecords(ctx)
	if err != nil {
		return nil, err
	}
	return publicHomePublications(records), nil
}

func (repo Repository) listHomePublicationRecords(ctx context.Context) ([]homePublicationRecord, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select `+homePublicationSelectColumns+`
		from public.home_publications hp
		order by hp.display_order asc, hp.created_at asc, hp.id asc
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanHomePublicationRows(rows)
}

func (repo Repository) GetHomePublicationAdmin(ctx context.Context, tenantContext tenant.Context, id string) (homePublicationRecord, error) {
	if !tenantContext.IsSuperAdmin {
		return homePublicationRecord{}, tenant.ErrOrganizationAccessDenied
	}
	record, err := scanHomePublication(repo.db.Pool().QueryRow(ctx, `
		select `+homePublicationSelectColumns+`
		from public.home_publications hp
		where hp.id = $1::uuid
	`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return homePublicationRecord{}, ErrNotFound
	}
	return record, err
}

func (repo Repository) CreateHomePublication(ctx context.Context, tenantContext tenant.Context, input homePublicationRecord) (homePublicationRecord, error) {
	if !tenantContext.IsSuperAdmin {
		return homePublicationRecord{}, tenant.ErrOrganizationAccessDenied
	}
	return scanHomePublication(repo.db.Pool().QueryRow(ctx, `
		insert into public.home_publications (
		  title, body, cta_label, cta_href, card_size, accent, display_order,
		  is_active, starts_at, ends_at, target_type, target_organization_ids,
		  target_user_ids, target_roles, created_by, updated_by
		)
		values (
		  $1, $2, $3, $4, $5, $6, $7,
		  $8, $9, $10, $11, $12::uuid[],
		  $13::uuid[], $14::text[], $15::uuid, $15::uuid
		)
		returning `+homePublicationSelectColumnsWithoutAlias+`
	`,
		input.Title,
		input.Body,
		input.CTALabel,
		input.CTAHref,
		input.CardSize,
		input.Accent,
		input.DisplayOrder,
		input.IsActive,
		input.StartsAt,
		input.EndsAt,
		input.TargetType,
		homeUUIDArray(input.TargetOrganizationIDs),
		homeUUIDArray(input.TargetUserIDs),
		input.TargetRoles,
		tenantContext.UserID,
	))
}

func (repo Repository) UpdateHomePublication(ctx context.Context, tenantContext tenant.Context, id string, input homePublicationRecord) (homePublicationRecord, error) {
	if !tenantContext.IsSuperAdmin {
		return homePublicationRecord{}, tenant.ErrOrganizationAccessDenied
	}
	record, err := scanHomePublication(repo.db.Pool().QueryRow(ctx, `
		update public.home_publications
		set title = $2,
		    body = $3,
		    cta_label = $4,
		    cta_href = $5,
		    card_size = $6,
		    accent = $7,
		    display_order = $8,
		    is_active = $9,
		    starts_at = $10,
		    ends_at = $11,
		    target_type = $12,
		    target_organization_ids = $13::uuid[],
		    target_user_ids = $14::uuid[],
		    target_roles = $15::text[],
		    updated_by = $16::uuid
		where id = $1::uuid
		returning `+homePublicationSelectColumnsWithoutAlias+`
	`,
		id,
		input.Title,
		input.Body,
		input.CTALabel,
		input.CTAHref,
		input.CardSize,
		input.Accent,
		input.DisplayOrder,
		input.IsActive,
		input.StartsAt,
		input.EndsAt,
		input.TargetType,
		homeUUIDArray(input.TargetOrganizationIDs),
		homeUUIDArray(input.TargetUserIDs),
		input.TargetRoles,
		tenantContext.UserID,
	))
	if errors.Is(err, pgx.ErrNoRows) {
		return homePublicationRecord{}, ErrNotFound
	}
	return record, err
}

func (repo Repository) DeleteHomePublication(ctx context.Context, tenantContext tenant.Context, id string) (string, error) {
	if !tenantContext.IsSuperAdmin {
		return "", tenant.ErrOrganizationAccessDenied
	}
	var storagePath pgtype.Text
	err := repo.db.Pool().QueryRow(ctx, `
		delete from public.home_publications
		where id = $1::uuid
		returning image_storage_path
	`, id).Scan(&storagePath)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return textValueOrEmpty(storagePath), nil
}

func (repo Repository) ReorderHomePublications(ctx context.Context, tenantContext tenant.Context, items []homePublicationOrderItem) ([]HomePublication, error) {
	if !tenantContext.IsSuperAdmin {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	if len(items) == 0 || len(items) > 100 {
		return nil, ErrInvalidInput
	}

	seenIDs := make(map[string]struct{}, len(items))
	for index := range items {
		normalizedID, ok := normalizeUUID(items[index].ID)
		if !ok || items[index].DisplayOrder < 0 || items[index].DisplayOrder > 10000 {
			return nil, ErrInvalidInput
		}
		if _, duplicated := seenIDs[normalizedID]; duplicated {
			return nil, ErrInvalidInput
		}
		seenIDs[normalizedID] = struct{}{}
		items[index].ID = normalizedID
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	for _, item := range items {
		tag, updateErr := tx.Exec(ctx, `
			update public.home_publications
			set display_order = $2,
			    updated_by = $3::uuid
			where id = $1::uuid
		`, item.ID, item.DisplayOrder, tenantContext.UserID)
		if updateErr != nil {
			return nil, updateErr
		}
		if tag.RowsAffected() != 1 {
			return nil, ErrNotFound
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return repo.ListHomePublicationsAdmin(ctx, tenantContext)
}

func (repo Repository) UploadHomePublicationImage(
	ctx context.Context,
	tenantContext tenant.Context,
	id string,
	contentType string,
	body io.Reader,
) (homePublicationRecord, string, error) {
	if !tenantContext.IsSuperAdmin {
		return homePublicationRecord{}, "", tenant.ErrOrganizationAccessDenied
	}

	current, err := repo.GetHomePublicationAdmin(ctx, tenantContext, id)
	if err != nil {
		return homePublicationRecord{}, "", err
	}
	token, err := randomInvitationToken()
	if err != nil {
		return homePublicationRecord{}, "", err
	}
	objectPath := fmt.Sprintf(
		"platform/home/%s/%d-%s%s",
		id,
		time.Now().UTC().UnixMilli(),
		token[:16],
		homeImageExtension(contentType),
	)
	if err := repo.uploadHomePublicationObject(ctx, objectPath, contentType, body); err != nil {
		return homePublicationRecord{}, "", err
	}
	imageURL := repo.homePublicationPublicURL(objectPath)
	updated, err := scanHomePublication(repo.db.Pool().QueryRow(ctx, `
		update public.home_publications
		set image_url = $2,
		    image_storage_path = $3,
		    updated_by = $4::uuid
		where id = $1::uuid
		returning `+homePublicationSelectColumnsWithoutAlias+`
	`, id, imageURL, objectPath, tenantContext.UserID))
	if err != nil {
		cleanupContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = repo.deleteHomePublicationObject(cleanupContext, objectPath)
		if errors.Is(err, pgx.ErrNoRows) {
			return homePublicationRecord{}, "", ErrNotFound
		}
		return homePublicationRecord{}, "", err
	}
	return updated, current.ImageStoragePath, nil
}

func (repo Repository) ClearHomePublicationImage(
	ctx context.Context,
	tenantContext tenant.Context,
	id string,
) (homePublicationRecord, string, error) {
	if !tenantContext.IsSuperAdmin {
		return homePublicationRecord{}, "", tenant.ErrOrganizationAccessDenied
	}
	current, err := repo.GetHomePublicationAdmin(ctx, tenantContext, id)
	if err != nil {
		return homePublicationRecord{}, "", err
	}
	updated, err := scanHomePublication(repo.db.Pool().QueryRow(ctx, `
		update public.home_publications
		set image_url = null,
		    image_storage_path = null,
		    updated_by = $2::uuid
		where id = $1::uuid
		returning `+homePublicationSelectColumnsWithoutAlias+`
	`, id, tenantContext.UserID))
	if errors.Is(err, pgx.ErrNoRows) {
		return homePublicationRecord{}, "", ErrNotFound
	}
	if err != nil {
		return homePublicationRecord{}, "", err
	}
	return updated, current.ImageStoragePath, nil
}

func (repo Repository) FindHomeAssistantAnswer(ctx context.Context, question string) (*HomeAssistantAnswer, error) {
	var answer HomeAssistantAnswer
	var rawContent string
	err := repo.db.Pool().QueryRow(ctx, `
		with search_query as (
		  select websearch_to_tsquery('portuguese', $1) as query
		)
		select article.id::text,
		       article.title,
		       article.content
		from public.help_articles article
		cross join search_query
		where coalesce(article.is_active, false) = true
		  and (
		    to_tsvector(
		      'portuguese',
		      coalesce(article.title, '') || ' ' || coalesce(article.content, '')
		    ) @@ search_query.query
		    or article.title ilike '%' || $1 || '%'
		    or article.content ilike '%' || $1 || '%'
		  )
		order by
		  (lower(article.title) = lower($1)) desc,
		  ts_rank_cd(
		    to_tsvector(
		      'portuguese',
		      coalesce(article.title, '') || ' ' || coalesce(article.content, '')
		    ),
		    search_query.query
		  ) desc,
		  coalesce(article.display_order, 0) asc,
		  article.updated_at desc,
		  article.id asc
		limit 1
	`, question).Scan(&answer.ArticleID, &answer.Title, &rawContent)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	answer.Title = sanitizeHomeAssistantText(answer.Title, 180)
	answer.Answer = sanitizeHomeAssistantText(rawContent, homeAssistantAnswerLimit)
	if answer.Title == "" || answer.Answer == "" {
		return nil, nil
	}
	return &answer, nil
}

const homePublicationSelectColumns = `
	hp.id::text,
	hp.title,
	hp.body,
	hp.cta_label,
	hp.cta_href,
	hp.image_url,
	hp.image_storage_path,
	hp.card_size,
	hp.accent,
	hp.display_order,
	hp.is_active,
	hp.starts_at,
	hp.ends_at,
	hp.target_type,
	coalesce(to_json(hp.target_organization_ids), '[]'::json),
	coalesce(to_json(hp.target_user_ids), '[]'::json),
	coalesce(to_json(hp.target_roles), '[]'::json),
	hp.created_at,
	hp.updated_at
`

const homePublicationSelectColumnsWithoutAlias = `
	id::text,
	title,
	body,
	cta_label,
	cta_href,
	image_url,
	image_storage_path,
	card_size,
	accent,
	display_order,
	is_active,
	starts_at,
	ends_at,
	target_type,
	coalesce(to_json(target_organization_ids), '[]'::json),
	coalesce(to_json(target_user_ids), '[]'::json),
	coalesce(to_json(target_roles), '[]'::json),
	created_at,
	updated_at
`

const homePublicationCardSelectColumns = `
	hp.id::text,
	hp.title,
	hp.body,
	hp.cta_label,
	hp.cta_href,
	hp.image_url,
	hp.card_size,
	hp.accent,
	hp.display_order
`

func scanHomePublicationCard(scanner homePublicationScanner) (HomePublicationCard, error) {
	var card HomePublicationCard
	var imageURL pgtype.Text
	err := scanner.Scan(
		&card.ID,
		&card.Title,
		&card.Body,
		&card.CTALabel,
		&card.CTAHref,
		&imageURL,
		&card.CardSize,
		&card.Accent,
		&card.DisplayOrder,
	)
	if err != nil {
		return HomePublicationCard{}, err
	}
	card.ImageURL = homeTextPointer(imageURL)
	return card, nil
}

func scanHomePublicationCardRows(rows pgx.Rows) ([]HomePublicationCard, error) {
	items := []HomePublicationCard{}
	for rows.Next() {
		item, err := scanHomePublicationCard(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func scanHomePublication(scanner homePublicationScanner) (homePublicationRecord, error) {
	var record homePublicationRecord
	var imageURL pgtype.Text
	var imageStoragePath pgtype.Text
	var startsAt pgtype.Timestamptz
	var endsAt pgtype.Timestamptz
	err := scanner.Scan(
		&record.ID,
		&record.Title,
		&record.Body,
		&record.CTALabel,
		&record.CTAHref,
		&imageURL,
		&imageStoragePath,
		&record.CardSize,
		&record.Accent,
		&record.DisplayOrder,
		&record.IsActive,
		&startsAt,
		&endsAt,
		&record.TargetType,
		&record.TargetOrganizationIDs,
		&record.TargetUserIDs,
		&record.TargetRoles,
		&record.CreatedAt,
		&record.UpdatedAt,
	)
	if err != nil {
		return homePublicationRecord{}, err
	}
	record.ImageURL = homeTextPointer(imageURL)
	record.ImageStoragePath = textValueOrEmpty(imageStoragePath)
	record.StartsAt = timestamptzPointer(startsAt)
	record.EndsAt = timestamptzPointer(endsAt)
	record.TargetOrganizationIDs = nonNilStrings(record.TargetOrganizationIDs)
	record.TargetUserIDs = nonNilStrings(record.TargetUserIDs)
	record.TargetRoles = nonNilStrings(record.TargetRoles)
	return record, nil
}

func scanHomePublicationRows(rows pgx.Rows) ([]homePublicationRecord, error) {
	records := []homePublicationRecord{}
	for rows.Next() {
		record, err := scanHomePublication(rows)
		if err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	return records, rows.Err()
}

func publicHomePublications(records []homePublicationRecord) []HomePublication {
	items := make([]HomePublication, 0, len(records))
	for _, record := range records {
		items = append(items, record.HomePublication)
	}
	return items
}

func homePublicationFromCreate(request homePublicationCreateRequest) (homePublicationRecord, error) {
	displayOrder := 0
	if request.DisplayOrder != nil {
		displayOrder = *request.DisplayOrder
	}
	isActive := true
	if request.IsActive != nil {
		isActive = *request.IsActive
	}
	input := homePublicationRecord{
		HomePublication: HomePublication{
			Title:                 request.Title,
			Body:                  request.Body,
			CTALabel:              request.CTALabel,
			CTAHref:               request.CTAHref,
			CardSize:              firstNonEmpty(request.CardSize, "half"),
			Accent:                firstNonEmpty(request.Accent, "orange"),
			DisplayOrder:          displayOrder,
			IsActive:              isActive,
			StartsAt:              request.StartsAt,
			EndsAt:                request.EndsAt,
			TargetType:            firstNonEmpty(request.TargetType, "all"),
			TargetOrganizationIDs: request.TargetOrganizationIDs,
			TargetUserIDs:         request.TargetUserIDs,
			TargetRoles:           request.TargetRoles,
		},
	}
	if err := validateHomePublication(&input); err != nil {
		return homePublicationRecord{}, err
	}
	return input, nil
}

func applyHomePublicationUpdate(current homePublicationRecord, request homePublicationUpdateRequest) (homePublicationRecord, error) {
	if request.Title.Set {
		if request.Title.Null {
			return homePublicationRecord{}, ErrInvalidInput
		}
		current.Title = request.Title.Value
	}
	if request.Body.Set {
		if request.Body.Null {
			return homePublicationRecord{}, ErrInvalidInput
		}
		current.Body = request.Body.Value
	}
	if request.CTALabel.Set {
		if request.CTALabel.Null {
			return homePublicationRecord{}, ErrInvalidInput
		}
		current.CTALabel = request.CTALabel.Value
	}
	if request.CTAHref.Set {
		if request.CTAHref.Null {
			return homePublicationRecord{}, ErrInvalidInput
		}
		current.CTAHref = request.CTAHref.Value
	}
	if request.CardSize.Set {
		if request.CardSize.Null {
			return homePublicationRecord{}, ErrInvalidInput
		}
		current.CardSize = request.CardSize.Value
	}
	if request.Accent.Set {
		if request.Accent.Null {
			return homePublicationRecord{}, ErrInvalidInput
		}
		current.Accent = request.Accent.Value
	}
	if request.DisplayOrder.Set {
		if request.DisplayOrder.Null {
			return homePublicationRecord{}, ErrInvalidInput
		}
		current.DisplayOrder = request.DisplayOrder.Value
	}
	if request.IsActive.Set {
		if request.IsActive.Null {
			return homePublicationRecord{}, ErrInvalidInput
		}
		current.IsActive = request.IsActive.Value
	}
	if request.StartsAt.Set {
		if request.StartsAt.Null {
			current.StartsAt = nil
		} else {
			value := request.StartsAt.Value
			current.StartsAt = &value
		}
	}
	if request.EndsAt.Set {
		if request.EndsAt.Null {
			current.EndsAt = nil
		} else {
			value := request.EndsAt.Value
			current.EndsAt = &value
		}
	}
	if request.TargetType.Set {
		if request.TargetType.Null {
			return homePublicationRecord{}, ErrInvalidInput
		}
		current.TargetType = request.TargetType.Value
	}
	if request.TargetOrganizationIDs.Set {
		if request.TargetOrganizationIDs.Null {
			return homePublicationRecord{}, ErrInvalidInput
		}
		current.TargetOrganizationIDs = request.TargetOrganizationIDs.Value
	}
	if request.TargetUserIDs.Set {
		if request.TargetUserIDs.Null {
			return homePublicationRecord{}, ErrInvalidInput
		}
		current.TargetUserIDs = request.TargetUserIDs.Value
	}
	if request.TargetRoles.Set {
		if request.TargetRoles.Null {
			return homePublicationRecord{}, ErrInvalidInput
		}
		current.TargetRoles = request.TargetRoles.Value
	}

	if err := validateHomePublication(&current); err != nil {
		return homePublicationRecord{}, err
	}
	return current, nil
}

func validateHomePublication(input *homePublicationRecord) error {
	input.Title = strings.TrimSpace(input.Title)
	input.Body = strings.TrimSpace(input.Body)
	input.CTALabel = strings.TrimSpace(input.CTALabel)
	input.CTAHref = strings.TrimSpace(input.CTAHref)
	input.CardSize = strings.ToLower(strings.TrimSpace(input.CardSize))
	input.Accent = strings.ToLower(strings.TrimSpace(input.Accent))
	input.TargetType = strings.ToLower(strings.TrimSpace(input.TargetType))

	if runeCount(input.Title) < 2 || runeCount(input.Title) > 120 ||
		runeCount(input.Body) < 2 || runeCount(input.Body) > 1000 ||
		runeCount(input.CTALabel) < 2 || runeCount(input.CTALabel) > 40 {
		return ErrInvalidInput
	}
	if _, ok := homePublicationCTAPaths[input.CTAHref]; !ok {
		return ErrInvalidInput
	}
	if _, ok := homePublicationCardSizes[input.CardSize]; !ok {
		return ErrInvalidInput
	}
	if _, ok := homePublicationAccents[input.Accent]; !ok {
		return ErrInvalidInput
	}
	if input.DisplayOrder < 0 || input.DisplayOrder > 10000 {
		return ErrInvalidInput
	}
	if input.StartsAt != nil && input.EndsAt != nil && !input.EndsAt.After(*input.StartsAt) {
		return ErrInvalidInput
	}
	if _, ok := homePublicationTargetTypes[input.TargetType]; !ok {
		return ErrInvalidInput
	}

	var err error
	input.TargetOrganizationIDs, err = normalizeHomeUUIDs(input.TargetOrganizationIDs)
	if err != nil {
		return err
	}
	input.TargetUserIDs, err = normalizeHomeUUIDs(input.TargetUserIDs)
	if err != nil {
		return err
	}
	input.TargetRoles, err = normalizeHomeRoles(input.TargetRoles)
	if err != nil {
		return err
	}

	switch input.TargetType {
	case "all":
		if len(input.TargetOrganizationIDs) != 0 || len(input.TargetUserIDs) != 0 || len(input.TargetRoles) != 0 {
			return ErrInvalidInput
		}
	case "organizations":
		if len(input.TargetOrganizationIDs) == 0 || len(input.TargetUserIDs) != 0 || len(input.TargetRoles) != 0 {
			return ErrInvalidInput
		}
	case "users":
		if len(input.TargetUserIDs) == 0 || len(input.TargetOrganizationIDs) != 0 || len(input.TargetRoles) != 0 {
			return ErrInvalidInput
		}
	case "roles":
		if len(input.TargetRoles) == 0 || len(input.TargetOrganizationIDs) != 0 || len(input.TargetUserIDs) != 0 {
			return ErrInvalidInput
		}
	default:
		return ErrInvalidInput
	}
	return nil
}

func normalizeHomeUUIDs(values []string) ([]string, error) {
	normalized := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		id, ok := normalizeUUID(value)
		if !ok {
			return nil, ErrInvalidInput
		}
		if _, duplicate := seen[id]; duplicate {
			continue
		}
		seen[id] = struct{}{}
		normalized = append(normalized, id)
	}
	sort.Strings(normalized)
	return normalized, nil
}

func normalizeHomeRoles(values []string) ([]string, error) {
	normalized := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		role := normalizeHomeMemberRole(value)
		if _, ok := homePublicationTargetRoles[role]; !ok {
			return nil, ErrInvalidInput
		}
		if _, duplicate := seen[role]; duplicate {
			continue
		}
		seen[role] = struct{}{}
		normalized = append(normalized, role)
	}
	sort.Strings(normalized)
	return normalized, nil
}

func normalizeHomeMemberRole(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "admin", "administrator", "administrador":
		return "admin"
	case "user", "member", "membro", "usuario", "usuário", "corretor", "broker", "agent":
		return "user"
	default:
		return strings.ToLower(strings.TrimSpace(value))
	}
}

func parseHomePublicationImage(w http.ResponseWriter, r *http.Request) (string, io.Reader, func(), error) {
	r.Body = http.MaxBytesReader(w, r.Body, homePublicationImageLimit+(1<<20))
	if err := r.ParseMultipartForm(homePublicationImageLimit + (1 << 20)); err != nil {
		return "", nil, nil, fmt.Errorf("%w: invalid multipart form", ErrInvalidInput)
	}
	cleanup := func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}

	file, fileHeader, err := r.FormFile("file")
	if err != nil {
		cleanup()
		return "", nil, nil, fmt.Errorf("%w: file is required", ErrInvalidInput)
	}
	if fileHeader.Size <= 0 || fileHeader.Size > homePublicationImageLimit {
		file.Close()
		cleanup()
		return "", nil, nil, fmt.Errorf("%w: invalid file size", ErrInvalidInput)
	}

	buffer := make([]byte, 512)
	readBytes, err := file.Read(buffer)
	if err != nil && !errors.Is(err, io.EOF) {
		file.Close()
		cleanup()
		return "", nil, nil, fmt.Errorf("%w: could not read file", ErrInvalidInput)
	}
	buffer = buffer[:readBytes]
	contentType := strings.ToLower(strings.TrimSpace(http.DetectContentType(buffer)))
	if !isHomePublicationImageType(contentType) {
		file.Close()
		cleanup()
		return "", nil, nil, fmt.Errorf("%w: unsupported image type", ErrInvalidInput)
	}

	return contentType, io.MultiReader(bytes.NewReader(buffer), file), func() {
		file.Close()
		cleanup()
	}, nil
}

func isHomePublicationImageType(contentType string) bool {
	switch contentType {
	case "image/jpeg", "image/png", "image/webp":
		return true
	default:
		return false
	}
}

func homeImageExtension(contentType string) string {
	switch contentType {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	default:
		return ""
	}
}

func (repo Repository) uploadHomePublicationObject(ctx context.Context, objectPath string, contentType string, body io.Reader) error {
	if repo.projectURL == "" || repo.apiKey == "" {
		return errHomePublicationStorageNotConfigured
	}
	endpoint := fmt.Sprintf(
		"%s/storage/v1/object/%s/%s",
		repo.projectURL,
		url.PathEscape(homePublicationImageBucket),
		escapeHomePublicationObjectPath(objectPath),
	)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, body)
	if err != nil {
		return err
	}
	setHomePublicationStorageAuth(request, repo.apiKey)
	request.Header.Set("Content-Type", contentType)
	request.Header.Set("Cache-Control", "31536000, immutable")
	request.Header.Set("x-upsert", "false")

	response, err := repo.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("%w: %v", errHomePublicationStorageOperation, err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		payload, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		message := strings.TrimSpace(string(payload))
		if message == "" {
			message = response.Status
		}
		return fmt.Errorf("%w: %s", errHomePublicationStorageOperation, message)
	}
	return nil
}

func (repo Repository) deleteHomePublicationObject(ctx context.Context, objectPath string) error {
	if strings.TrimSpace(objectPath) == "" {
		return nil
	}
	if repo.projectURL == "" || repo.apiKey == "" {
		return errHomePublicationStorageNotConfigured
	}
	if !strings.HasPrefix(objectPath, "platform/home/") {
		return ErrInvalidInput
	}
	endpoint := fmt.Sprintf(
		"%s/storage/v1/object/%s/%s",
		repo.projectURL,
		url.PathEscape(homePublicationImageBucket),
		escapeHomePublicationObjectPath(objectPath),
	)
	request, err := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, nil)
	if err != nil {
		return err
	}
	setHomePublicationStorageAuth(request, repo.apiKey)

	response, err := repo.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("%w: %v", errHomePublicationStorageOperation, err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return nil
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		payload, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return fmt.Errorf("%w: %s", errHomePublicationStorageOperation, strings.TrimSpace(string(payload)))
	}
	return nil
}

func (repo Repository) homePublicationPublicURL(objectPath string) string {
	return fmt.Sprintf(
		"%s/storage/v1/object/public/%s/%s",
		repo.projectURL,
		url.PathEscape(homePublicationImageBucket),
		escapeHomePublicationObjectPath(objectPath),
	)
}

func setHomePublicationStorageAuth(request *http.Request, apiKey string) {
	request.Header.Set("apikey", apiKey)
	request.Header.Del("Authorization")
	segments := strings.Split(apiKey, ".")
	if len(segments) == 3 && segments[0] != "" && segments[1] != "" && segments[2] != "" {
		request.Header.Set("Authorization", "Bearer "+apiKey)
	}
}

func escapeHomePublicationObjectPath(value string) string {
	parts := strings.Split(strings.Trim(value, "/"), "/")
	for index, part := range parts {
		parts[index] = url.PathEscape(part)
	}
	return strings.Join(parts, "/")
}

func sanitizeHomeAssistantText(value string, maxRunes int) string {
	value = homeAssistantScriptPattern.ReplaceAllString(value, " ")
	value = homeAssistantStylePattern.ReplaceAllString(value, " ")
	value = homeAssistantTagPattern.ReplaceAllString(value, " ")
	value = html.UnescapeString(value)
	value = strings.NewReplacer("<", " ", ">", " ", "\x00", " ").Replace(value)
	value = strings.Join(strings.Fields(value), " ")
	value = strings.NewReplacer(
		" .", ".",
		" ,", ",",
		" !", "!",
		" ?", "?",
		" :", ":",
		" ;", ";",
	).Replace(value)
	if maxRunes > 0 && runeCount(value) > maxRunes {
		runes := []rune(value)
		value = strings.TrimSpace(string(runes[:maxRunes])) + "…"
	}
	return value
}

func writeHomePublicationError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_home_publication_input", "Home publication input is invalid.")
	case errors.Is(err, ErrNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "home_publication_not_found", "Home publication was not found.")
	case errors.Is(err, tenant.ErrOrganizationAccessDenied):
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
	case errors.Is(err, errHomePublicationStorageNotConfigured):
		httpserver.WriteError(w, r, http.StatusInternalServerError, "home_publication_storage_not_configured", "Home publication storage is not configured.")
	case errors.Is(err, errHomePublicationStorageOperation):
		httpserver.WriteError(w, r, http.StatusBadGateway, "home_publication_storage_failed", "Home publication image storage failed.")
	default:
		httpserver.WriteError(w, r, http.StatusInternalServerError, "home_publication_failed", "Unable to process the home publication request.")
	}
}

func homeUUIDArray(values []string) []pgtype.UUID {
	items := make([]pgtype.UUID, 0, len(values))
	for _, value := range values {
		var id pgtype.UUID
		if err := id.Scan(value); err == nil {
			items = append(items, id)
		}
	}
	return items
}

func homeTextPointer(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	item := value.String
	return &item
}

func textValueOrEmpty(value pgtype.Text) string {
	if !value.Valid {
		return ""
	}
	return value.String
}

func timestamptzPointer(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	item := value.Time
	return &item
}

func nonNilStrings(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}

func runeCount(value string) int {
	return utf8.RuneCountInString(value)
}
