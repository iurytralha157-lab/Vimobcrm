package leads

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	dashboardEntryDetailDefaultLimit = 25
	dashboardEntryDetailMaxLimit     = 50
	dashboardEntryCursorMaxLength    = 512
)

// DashboardLeadEntryDetail is one arrival, not one card. The URL is a local
// pipeline deep link; opening it performs the usual lead authorization again.
type DashboardLeadEntryDetail struct {
	EntryID      string  `json:"entryId"`
	LeadID       string  `json:"leadId"`
	Name         string  `json:"name"`
	OccurredAt   string  `json:"occurredAt"`
	Source       *string `json:"source"`
	CampaignName *string `json:"campaignName"`
	PipelineID   *string `json:"pipelineId"`
	PipelineName *string `json:"pipelineName"`
	EntryType    string  `json:"entryType"`
	LeadURL      string  `json:"leadUrl"`
}

type DashboardLeadEntryDetailPage struct {
	Total      int64                      `json:"total"`
	Items      []DashboardLeadEntryDetail `json:"items"`
	HasMore    bool                       `json:"hasMore"`
	NextCursor *string                    `json:"nextCursor"`
}

type dashboardEntryCursor struct {
	OccurredAt time.Time `json:"occurredAt"`
	IsReentry  bool      `json:"isReentry"`
	EntryID    string    `json:"entryId"`
}

func parseDashboardEntryCursor(raw string) (*dashboardEntryCursor, error) {
	if raw == "" {
		return nil, nil
	}
	if len(raw) > dashboardEntryCursorMaxLength {
		return nil, ErrInvalidInput
	}
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return nil, ErrInvalidInput
	}
	var cursor dashboardEntryCursor
	if err := json.Unmarshal(decoded, &cursor); err != nil || cursor.OccurredAt.IsZero() {
		return nil, ErrInvalidInput
	}
	entryID := strings.TrimPrefix(cursor.EntryID, "initial:")
	if _, ok := normalizeUUID(entryID); !ok {
		return nil, ErrInvalidInput
	}
	return &cursor, nil
}

func encodeDashboardEntryCursor(cursor dashboardEntryCursor) string {
	encoded, _ := json.Marshal(cursor)
	return base64.RawURLEncoding.EncodeToString(encoded)
}

func (handler Handler) ListDashboardLeadEntries(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := dashboardTenantContext(w, r)
	if !ok {
		return
	}
	filter, err := ParseDashboardFilter(r.URL.Query())
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	if strings.TrimSpace(r.URL.Query().Get("limit")) == "" {
		filter.Limit = dashboardEntryDetailDefaultLimit
	}
	cursor, err := parseDashboardEntryCursor(strings.TrimSpace(r.URL.Query().Get("cursor")))
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	page, err := handler.repo.ListDashboardLeadEntries(r.Context(), tenantContext, filter, cursor)
	if err != nil {
		writeLeadError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	httpserver.WriteJSON(w, http.StatusOK, map[string]DashboardLeadEntryDetailPage{"data": page})
}

func (repo Repository) ListDashboardLeadEntries(ctx context.Context, tenantContext tenant.Context, filter DashboardFilter, cursor *dashboardEntryCursor) (DashboardLeadEntryDetailPage, error) {
	if filter.Limit < 1 || filter.Limit > dashboardEntryDetailMaxLimit {
		return DashboardLeadEntryDetailPage{}, ErrInvalidInput
	}
	page := DashboardLeadEntryDetailPage{Items: []DashboardLeadEntryDetail{}}
	tx, err := repo.db.Pool().BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return DashboardLeadEntryDetailPage{}, err
	}
	defer tx.Rollback(ctx)

	counts, err := repo.dashboardEntryCounts(ctx, tx, tenantContext, filter)
	if err != nil {
		return DashboardLeadEntryDetailPage{}, err
	}
	page.Total = counts.TotalEntries
	query, args, err := repo.buildDashboardLeadEntryDetailsQuery(tenantContext, filter, cursor)
	if err != nil {
		return DashboardLeadEntryDetailPage{}, err
	}
	rows, err := tx.Query(ctx, query, args...)
	if err != nil {
		return DashboardLeadEntryDetailPage{}, err
	}
	for rows.Next() {
		var entry DashboardLeadEntryDetail
		var happenedAt time.Time
		var isReentry bool
		var source, campaignName, pipelineID, pipelineName pgtype.Text
		if err := rows.Scan(&entry.EntryID, &entry.LeadID, &entry.Name, &happenedAt, &source, &campaignName, &pipelineID, &pipelineName, &isReentry); err != nil {
			rows.Close()
			return DashboardLeadEntryDetailPage{}, err
		}
		entry.OccurredAt = happenedAt.UTC().Format(time.RFC3339Nano)
		entry.Source = pipelineTextPtr(source)
		entry.CampaignName = pipelineTextPtr(campaignName)
		entry.PipelineID = pipelineTextPtr(pipelineID)
		entry.PipelineName = pipelineTextPtr(pipelineName)
		entry.EntryType = "initial"
		if isReentry {
			entry.EntryType = "reentry"
		}
		entry.LeadURL = "/crm/pipelines?lead=" + url.QueryEscape(entry.LeadID)
		page.Items = append(page.Items, entry)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return DashboardLeadEntryDetailPage{}, err
	}
	rows.Close()
	if err := tx.Commit(ctx); err != nil {
		return DashboardLeadEntryDetailPage{}, err
	}

	if len(page.Items) > filter.Limit {
		page.HasMore = true
		page.Items = page.Items[:filter.Limit]
		last := page.Items[len(page.Items)-1]
		at, _ := time.Parse(time.RFC3339Nano, last.OccurredAt)
		encoded := encodeDashboardEntryCursor(dashboardEntryCursor{
			OccurredAt: at,
			IsReentry:  last.EntryType == "reentry",
			EntryID:    last.EntryID,
		})
		page.NextCursor = &encoded
	}
	return page, nil
}

func (repo Repository) buildDashboardLeadEntryDetailsQuery(tenantContext tenant.Context, filter DashboardFilter, cursor *dashboardEntryCursor) (string, []any, error) {
	cte, entryWhere, args, err := repo.buildDashboardEntriesCTE(tenantContext, filter)
	if err != nil {
		return "", nil, err
	}
	var cursorAt any
	var cursorIsReentry any
	var cursorEntryID any
	if cursor != nil {
		cursorAt = cursor.OccurredAt
		cursorIsReentry = cursor.IsReentry
		cursorEntryID = cursor.EntryID
	}
	args = append(args, cursorAt, cursorIsReentry, cursorEntryID, filter.Limit+1)
	cursorAtArg := len(args) - 3
	cursorReentryArg := len(args) - 2
	cursorIDArg := len(args) - 1
	limitArg := len(args)
	query := cte + fmt.Sprintf(`
		select entry.entry_id, entry.lead_id::text, l.name, entry.occurred_at,
			nullif(entry.source, ''),
			coalesce(nullif(entry.campaign_name, ''), nullif(entry.utm_campaign, ''), nullif(entry.campaign_id, '')),
			l.pipeline_id::text, p.name, entry.is_reentry
		from entries entry
		join public.leads l on l.id = entry.lead_id and l.organization_id = $1::uuid
		left join public.pipelines p on p.organization_id = l.organization_id and p.id = l.pipeline_id
		where %s
		  and ($%d::timestamptz is null or
		    (entry.occurred_at, entry.is_reentry, entry.entry_id)
		      < ($%d::timestamptz, $%d::boolean, $%d::text))
		order by entry.occurred_at desc, entry.is_reentry desc, entry.entry_id desc
		limit $%d`, entryWhere, cursorAtArg, cursorAtArg, cursorReentryArg, cursorIDArg, limitArg)
	return query, args, nil
}
