package leads

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const defaultLeadHistoryPageSize = 100
const maxLeadHistoryPageSize = 200

type leadHistoryPageCursor struct {
	Version        int       `json:"v"`
	OrganizationID string    `json:"organizationId"`
	LeadID         string    `json:"leadId"`
	SnapshotAt     time.Time `json:"snapshotAt"`
	OccurredAt     time.Time `json:"occurredAt"`
	ID             string    `json:"id"`
	SourceRank     int       `json:"sourceRank"`
}

type LeadHistoryPageFilter struct {
	PageSize int
	cursor   *leadHistoryPageCursor
}

type LeadHistoryPagePagination struct {
	NextCursor *string `json:"nextCursor"`
	HasOlder   bool    `json:"hasOlder"`
	SnapshotAt string  `json:"snapshotAt"`
}

type LeadHistoryPageResponse struct {
	Data       map[string]any            `json:"data"`
	Pagination LeadHistoryPagePagination `json:"pagination"`
}

type leadHistoryCanonicalPresence struct {
	LeadCreated   bool `json:"leadCreated"`
	FirstResponse bool `json:"firstResponse"`
	Assignment    bool `json:"assignment"`
}

type leadHistoryPageRow struct {
	SourceRank int            `json:"sourceRank"`
	OccurredAt time.Time      `json:"occurredAt"`
	ID         string         `json:"id"`
	Data       map[string]any `json:"data"`
}

type leadHistoryPageResult struct {
	Events            []leadHistoryPageRow         `json:"events"`
	HasOlder          bool                         `json:"hasOlder"`
	Lead              map[string]any               `json:"lead"`
	LeadMeta          map[string]any               `json:"leadMeta"`
	Users             []map[string]any             `json:"users"`
	CanonicalPresence leadHistoryCanonicalPresence `json:"canonicalPresence"`
}

// No pagination parameters keeps the legacy envelope and unlimited read intact.
func ParseLeadHistoryPageFilter(values url.Values) (LeadHistoryPageFilter, bool, error) {
	_, hasSize := values["pageSize"]
	_, hasCursor := values["cursor"]
	if !hasSize && !hasCursor {
		return LeadHistoryPageFilter{}, false, nil
	}
	filter := LeadHistoryPageFilter{PageSize: defaultLeadHistoryPageSize}
	if hasSize {
		if len(values["pageSize"]) != 1 {
			return filter, true, fmtInvalidInput("pageSize is invalid")
		}
		size, err := strconv.Atoi(values.Get("pageSize"))
		if err != nil || size < 1 || size > maxLeadHistoryPageSize {
			return filter, true, fmtInvalidInput("pageSize must be between 1 and 200")
		}
		filter.PageSize = size
	}
	if hasCursor {
		if len(values["cursor"]) != 1 || strings.TrimSpace(values.Get("cursor")) == "" {
			return filter, true, fmtInvalidInput("cursor is invalid")
		}
		cursor, err := decodeLeadHistoryPageCursor(values.Get("cursor"))
		if err != nil {
			return filter, true, err
		}
		filter.cursor = &cursor
	}
	return filter, true, nil
}

func decodeLeadHistoryPageCursor(encoded string) (leadHistoryPageCursor, error) {
	var cursor leadHistoryPageCursor
	if len(encoded) > 2048 {
		return cursor, fmtInvalidInput("cursor is invalid")
	}
	raw, err := base64.RawURLEncoding.Strict().DecodeString(encoded)
	if err != nil {
		return cursor, fmtInvalidInput("cursor is invalid")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&cursor); err != nil {
		return cursor, fmtInvalidInput("cursor is invalid")
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		return cursor, fmtInvalidInput("cursor is invalid")
	}
	orgID, validOrg := normalizeUUID(cursor.OrganizationID)
	leadID, validLead := normalizeUUID(cursor.LeadID)
	id, validID := normalizeUUID(cursor.ID)
	if cursor.Version != 1 || !validOrg || !validLead || !validID ||
		cursor.SourceRank < 1 || cursor.SourceRank > len(leadHistoryPageSources) || cursor.SnapshotAt.IsZero() || cursor.OccurredAt.IsZero() {
		return cursor, fmtInvalidInput("cursor is invalid")
	}
	cursor.OrganizationID, cursor.LeadID, cursor.ID = orgID, leadID, id
	return cursor, nil
}

func encodeLeadHistoryPageCursor(cursor leadHistoryPageCursor) (string, error) {
	raw, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func validateLeadHistoryPageScope(filter LeadHistoryPageFilter, organizationID, leadID string) error {
	if filter.PageSize < 1 || filter.PageSize > maxLeadHistoryPageSize {
		return fmtInvalidInput("pageSize is invalid")
	}
	if filter.cursor != nil && (filter.cursor.OrganizationID != organizationID || filter.cursor.LeadID != leadID) {
		return fmtInvalidInput("cursor does not match this lead")
	}
	return nil
}

func (repo Repository) LeadHistoryPage(ctx context.Context, tenantContext tenant.Context, leadID string, filter LeadHistoryPageFilter) (LeadHistoryPageResponse, error) {
	leadID, validLead := normalizeUUID(leadID)
	organizationID, validOrg := normalizeUUID(tenantContext.OrganizationID)
	if !validLead || !validOrg {
		return LeadHistoryPageResponse{}, ErrInvalidInput
	}
	if err := validateLeadHistoryPageScope(filter, organizationID, leadID); err != nil {
		return LeadHistoryPageResponse{}, err
	}
	return readLeadHistorySnapshot(ctx, repo.db.Pool(), tenantContext, leadID, func(tx pgx.Tx) (LeadHistoryPageResponse, error) {
		return readLeadHistoryPageInSnapshot(ctx, tx, organizationID, leadID, filter, tenantContext)
	})
}

func readLeadHistoryPageInSnapshot(ctx context.Context, tx pgx.Tx, organizationID, leadID string, filter LeadHistoryPageFilter, actors ...tenant.Context) (LeadHistoryPageResponse, error) {
	var now time.Time
	if err := tx.QueryRow(ctx, "select clock_timestamp()").Scan(&now); err != nil {
		return LeadHistoryPageResponse{}, err
	}
	snapshotAt := now.UTC()
	var occurredAt, rowID any
	rank := 0
	if filter.cursor != nil {
		snapshotAt = filter.cursor.SnapshotAt.UTC()
		if snapshotAt.After(now) {
			return LeadHistoryPageResponse{}, fmtInvalidInput("cursor snapshot is invalid")
		}
		occurredAt, rowID, rank = filter.cursor.OccurredAt.UTC(), filter.cursor.ID, filter.cursor.SourceRank
	}
	var raw []byte
	var actor tenant.Context
	if len(actors) > 0 {
		actor = actors[0]
	}
	_, args := leadHistoryScheduleQueryScope(actor, []any{organizationID, leadID,
		snapshotAt, occurredAt, rowID, rank, filter.PageSize, filter.PageSize + 1})
	err := tx.QueryRow(ctx, leadHistoryPageSQL(actor), args...).Scan(&raw)
	if err != nil {
		return LeadHistoryPageResponse{}, err
	}
	var result leadHistoryPageResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return LeadHistoryPageResponse{}, err
	}
	return reconstructLeadHistoryPage(result, organizationID, leadID, snapshotAt, filter.PageSize)
}

func reconstructLeadHistoryPage(result leadHistoryPageResult, organizationID, leadID string, snapshotAt time.Time, pageSize int) (LeadHistoryPageResponse, error) {
	if len(result.Lead) == 0 {
		return LeadHistoryPageResponse{}, ErrLeadNotFound
	}
	if result.Lead["id"] != leadID {
		return LeadHistoryPageResponse{}, fmt.Errorf("invalid lead history context")
	}
	if len(result.Events) > pageSize || (result.HasOlder && len(result.Events) != pageSize) {
		return LeadHistoryPageResponse{}, fmt.Errorf("invalid lead history page boundary")
	}
	keys := []string{"timelineEvents", "activityEvents", "entryEvents", "distributionLogs", "assignmentLogs", "auditLogs", "queueRuntimeEvents"}
	data := map[string]any{"lead": result.Lead, "leadMeta": result.LeadMeta, "users": result.Users,
		"historyCoverage": map[string]any{"complete": false, "canonicalPresence": result.CanonicalPresence}}
	for _, key := range keys {
		data[key] = []map[string]any{}
	}
	for index, row := range result.Events {
		id, validID := normalizeUUID(row.ID)
		if !validID || row.SourceRank < 1 || row.SourceRank > len(keys) || row.OccurredAt.IsZero() || row.Data["id"] != id {
			return LeadHistoryPageResponse{}, fmt.Errorf("invalid lead history page row")
		}
		if row.Data["organization_id"] != organizationID ||
			(row.SourceRank != 6 && row.Data["lead_id"] != leadID) ||
			(row.SourceRank == 6 && (row.Data["entity_type"] != "lead" || row.Data["entity_id"] != leadID)) {
			return LeadHistoryPageResponse{}, fmt.Errorf("invalid lead history row scope")
		}
		if index > 0 && !leadHistoryPageRowOlder(row, result.Events[index-1]) {
			return LeadHistoryPageResponse{}, fmt.Errorf("invalid lead history page order")
		}
		key := keys[row.SourceRank-1]
		data[key] = append(data[key].([]map[string]any), row.Data)
	}
	redactLeadHistoryAuditLogs(data["auditLogs"].([]map[string]any))
	redactLeadHistoryAttachmentURLs(data)
	if result.LeadMeta == nil {
		data["leadMeta"] = map[string]any{}
	}
	if result.Users == nil {
		data["users"] = []map[string]any{}
	}
	pagination := LeadHistoryPagePagination{HasOlder: result.HasOlder, SnapshotAt: snapshotAt.UTC().Format(time.RFC3339Nano)}
	if result.HasOlder {
		last := result.Events[len(result.Events)-1]
		cursor, err := encodeLeadHistoryPageCursor(leadHistoryPageCursor{Version: 1, OrganizationID: organizationID,
			LeadID: leadID, SnapshotAt: snapshotAt.UTC(), OccurredAt: last.OccurredAt.UTC(), ID: last.ID, SourceRank: last.SourceRank})
		if err != nil {
			return LeadHistoryPageResponse{}, err
		}
		pagination.NextCursor = &cursor
	}
	return LeadHistoryPageResponse{Data: data, Pagination: pagination}, nil
}

// UUID's canonical hexadecimal string has the same ordering as PostgreSQL uuid.
func leadHistoryPageRowOlder(row, boundary leadHistoryPageRow) bool {
	if !row.OccurredAt.Equal(boundary.OccurredAt) {
		return row.OccurredAt.Before(boundary.OccurredAt)
	}
	if row.ID != boundary.ID {
		return row.ID < boundary.ID
	}
	return row.SourceRank < boundary.SourceRank
}
