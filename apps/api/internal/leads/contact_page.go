package leads

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

var ErrContactsExportChanged = errors.New("contacts export set changed")

type contactReadQueryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

type contactPageTransaction interface {
	contactReadQueryer
	Commit(context.Context) error
}

type contactListReadContext struct {
	queryer contactReadQueryer
	total   int64
}

type ContactPageResponse struct {
	Data          []Contact `json:"data"`
	Total         int64     `json:"total"`
	Page          int       `json:"page"`
	Limit         int       `json:"limit"`
	ExportVersion string    `json:"exportVersion,omitempty"`
}

func (repo Repository) ListContactsPage(ctx context.Context, tenantContext tenant.Context, filter ContactListFilter) (ContactPageResponse, error) {
	tx, err := repo.db.Pool().BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return ContactPageResponse{}, err
	}
	defer tx.Rollback(ctx)
	page, err := repo.readContactsPageInSnapshot(ctx, tx, tenantContext, filter)
	if err != nil {
		return ContactPageResponse{}, err
	}
	repo.hydrateContactAvatars(ctx, tenantContext.OrganizationID, page.Data)
	return page, nil
}

func (repo Repository) readContactsPageInSnapshot(ctx context.Context, tx contactPageTransaction, tenantContext tenant.Context, filter ContactListFilter) (ContactPageResponse, error) {
	total, version, err := contactExportSetState(ctx, tx, tenantContext, filter)
	if err != nil {
		return ContactPageResponse{}, err
	}
	if filter.ExpectedExportVersion != "" && filter.ExpectedExportVersion != version {
		return ContactPageResponse{}, ErrContactsExportChanged
	}
	readContext := contactListReadContext{queryer: tx, total: total}
	var contacts []Contact
	if filter.Mode == "compact" {
		contacts, err = repo.listContactsCompact(ctx, tenantContext, filter, readContext)
	} else {
		contacts, err = repo.listContactsFull(ctx, tenantContext, filter, readContext)
	}
	if err != nil {
		return ContactPageResponse{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ContactPageResponse{}, err
	}
	return ContactPageResponse{Data: contacts, Total: total, Page: filter.Page, Limit: filter.Limit, ExportVersion: version}, nil
}

// Each export page verifies the entire filtered set. The hash covers the raw
// source fields and reference labels used by full export, rather than relying
// on counts or updated_at alone. Pagination and this calculation share a
// repeatable-read transaction; a later request detects drift and aborts.
// This is not a server-held snapshot spanning the browser's whole export.
func contactExportSetState(ctx context.Context, queryer contactReadQueryer, tenantContext tenant.Context, filter ContactListFilter) (int64, string, error) {
	where, args, err := buildContactWhere(tenantContext, filter)
	if err != nil {
		return 0, "", err
	}
	if filter.Mode == "compact" {
		var count int64
		err := queryer.QueryRow(ctx, `select count(*)::bigint from public.leads l where `+strings.Join(where, " and "), args...).Scan(&count)
		return count, "", err
	}
	args, propertyVisibility := appendCanonicalPropertyVisibility(args, tenantContext, "visible_property")
	var total int64
	var version string
	err = queryer.QueryRow(ctx, contactExportSetQuery(where, propertyVisibility), args...).Scan(&total, &version)
	if err != nil {
		return 0, "", err
	}
	if !validContactExportVersion(version) {
		return 0, "", fmt.Errorf("contacts export version was not computed")
	}
	// Bind the digest to scope, filters and ordering without binding pagination.
	filter.Page, filter.Limit, filter.ExpectedExportVersion, filter.ResponseMode = 0, 0, "", ""
	filter.TagIDs = append([]string(nil), filter.TagIDs...)
	filter.CampaignIDs = append([]string(nil), filter.CampaignIDs...)
	slices.Sort(filter.TagIDs)
	slices.Sort(filter.CampaignIDs)
	for index, value := range args {
		if list, ok := value.([]string); ok {
			canonical := append([]string(nil), list...)
			slices.Sort(canonical)
			args[index] = canonical
		}
	}
	contextBytes, err := json.Marshal(struct {
		Filter ContactListFilter
		Scope  []any
	}{Filter: filter, Scope: args})
	if err != nil {
		return 0, "", err
	}
	digest := sha256.Sum256(append(contextBytes, []byte(version)...))
	version = hex.EncodeToString(digest[:])
	return total, version, nil
}

func contactExportSetQuery(where []string, propertyVisibilityOptions ...string) string {
	propertyVisibility := "false"
	if len(propertyVisibilityOptions) > 0 {
		propertyVisibility = propertyVisibilityOptions[0]
	}
	return `
		select count(*)::bigint,
		       encode(sha256(convert_to(coalesce(string_agg(
		         encode(sha256(convert_to(jsonb_build_object(
		           'lead', to_jsonb(l), 'pipeline_name', p.name, 'stage_name', s.name,
		           'assignee_name', u.name, 'meta', to_jsonb(lm),
		           'visible_property_id', ` + pipelineBoardVisiblePropertyIDSQL("property_id", propertyVisibility) + `,
		           'visible_interest_property_id', ` + pipelineBoardVisiblePropertyIDSQL("interest_property_id", propertyVisibility) + `,
		           'visible_property_metadata', ` + contactPropertyMetadataSQL(propertyVisibility) + `,
		           'campaign_name', mci.campaign_name, 'tags', coalesce(tags.tags, '[]'::jsonb)
		         )::text, 'UTF8')), 'hex'), '' order by l.created_at desc, l.id desc
		       ), ''), 'UTF8')), 'hex')
		from public.leads l
		left join public.pipelines p on p.id = l.pipeline_id and p.organization_id = l.organization_id
		left join public.stages s on s.id = l.stage_id and s.organization_id = l.organization_id
		left join public.users u on u.id = l.assigned_user_id
		left join lateral (
			select lm.* from public.lead_meta lm
			where lm.organization_id = l.organization_id and lm.lead_id = l.id
			order by lm.updated_at desc nulls last, lm.created_at desc nulls last, lm.id desc
			limit 1
		) lm on true
		left join lateral (
			select max(nullif(mi.campaign_name, '')) as campaign_name
			from public.meta_campaign_insights mi
			where mi.organization_id = l.organization_id
			  and mi.campaign_id = coalesce(nullif(lm.campaign_id, ''), nullif(l.meta_campaign_id, ''))
		) mci on true
		left join lateral (
			select jsonb_agg(jsonb_build_object('id', t.id::text, 'name', t.name) order by t.name, t.id) as tags
			from public.lead_tags lt join public.tags t on t.id = lt.tag_id
			where lt.lead_id = l.id and t.organization_id = l.organization_id
		) tags on true
		where ` + strings.Join(where, " and ")
}

func validContactExportVersion(version string) bool {
	if len(version) != 64 {
		return false
	}
	for _, character := range version {
		if !(character >= '0' && character <= '9') && !(character >= 'a' && character <= 'f') {
			return false
		}
	}
	return true
}
