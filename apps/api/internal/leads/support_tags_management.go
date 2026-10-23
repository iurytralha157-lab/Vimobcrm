package leads

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

var (
	ErrInvalidTagInput      = fmt.Errorf("%w: invalid tag input", ErrInvalidInput)
	ErrTagNameAlreadyExists = errors.New("tag name already exists")
	ErrTagChanged           = errors.New("tag changed")
	ErrTagInUse             = errors.New("tag in use")
)

type TagUsageItem struct {
	Kind  string `json:"kind"`
	Count int64  `json:"count"`
}

type TagUsage struct {
	UpdatedAt time.Time      `json:"updated_at"`
	LeadCount int64          `json:"lead_count"`
	Usages    []TagUsageItem `json:"usages"`
}

type tagMutationQueryer interface {
	notificationRowsQueryer
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

func deleteTagWithQueryer(ctx context.Context, q tagMutationQueryer, organizationID, tagID string, expectedUpdatedAt time.Time) error {
	if err := lockTagRevision(ctx, q, organizationID, tagID, expectedUpdatedAt); err != nil {
		return err
	}
	usage, err := listTagUsage(ctx, q, organizationID, tagID)
	if err != nil {
		return err
	}
	if len(usage.Usages) > 0 {
		return ErrTagInUse
	}
	if _, err := q.Exec(ctx, `delete from public.lead_tags where tag_id = $1::uuid
		and organization_id = $2::uuid
		and lead_id in (select id from public.leads where organization_id = $2::uuid)`, tagID, organizationID); err != nil {
		return err
	}
	result, err := q.Exec(ctx, `delete from public.tags where id = $1::uuid and organization_id = $2::uuid`, tagID, organizationID)
	if err != nil {
		return normalizeTagMutationError(err)
	}
	if result.RowsAffected() == 0 {
		return ErrInvalidReference
	}
	return nil
}

// Counts configuration references, including disabled configurations: deleting a
// tag must not leave a dormant rule that breaks when its owner enables it again.
// Historical published versions count only while an execution can still use them.
const tagUsageReferencesQuery = `select kind, count from private.management_tag_usages($1::uuid, $2::uuid)`

func parseTagRevision(value string) (time.Time, error) {
	// Both body revisions and a single quoted HTTP If-Match value use RFC3339.
	value = strings.TrimSpace(value)
	if len(value) >= 2 && value[0] == '"' && value[len(value)-1] == '"' {
		value = value[1 : len(value)-1]
	}
	revision, err := time.Parse(time.RFC3339Nano, value)
	if err != nil || revision.IsZero() {
		return time.Time{}, fmt.Errorf("%w: a valid tag revision is required", ErrInvalidTagInput)
	}
	return revision, nil
}

func normalizeTagMutationError(err error) error {
	var databaseError *pgconn.PgError
	if errors.As(err, &databaseError) {
		if databaseError.Code == "23505" && databaseError.ConstraintName == "tags_org_normalized_name_key" {
			return ErrTagNameAlreadyExists
		}
		if databaseError.Code == "23503" && databaseError.ConstraintName == "tags_management_dependency_guard" {
			return ErrTagInUse
		}
	}
	return err
}

func lockTagRevision(ctx context.Context, q leadTeamQueryer, organizationID, tagID string, expected time.Time) error {
	var actual time.Time
	err := q.QueryRow(ctx, `select updated_at from public.tags where organization_id = $1::uuid and id = $2::uuid for update`, organizationID, tagID).Scan(&actual)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrInvalidReference
	}
	if err != nil {
		return err
	}
	if !actual.Equal(expected) {
		return ErrTagChanged
	}
	return nil
}

func (repo Repository) TagUsage(ctx context.Context, tenantContext tenant.Context, tagID string) (TagUsage, error) {
	if !tenantContext.HasPermission(permissions.TagManage) {
		return TagUsage{}, tenant.ErrOrganizationAccessDenied
	}
	tagID, ok := normalizeUUID(tagID)
	if !ok {
		return TagUsage{}, ErrInvalidTagInput
	}
	return listTagUsage(ctx, repo.db.Pool(), tenantContext.OrganizationID, tagID)
}

func listTagUsage(ctx context.Context, q notificationRowsQueryer, organizationID, tagID string) (TagUsage, error) {
	usage := TagUsage{Usages: []TagUsageItem{}}
	err := q.QueryRow(ctx, `select t.updated_at, (select count(*) from public.lead_tags lt where lt.tag_id = t.id and lt.organization_id = t.organization_id)
		from public.tags t where t.organization_id = $1::uuid and t.id = $2::uuid`, organizationID, tagID).Scan(&usage.UpdatedAt, &usage.LeadCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return TagUsage{}, ErrInvalidReference
	}
	if err != nil {
		return TagUsage{}, err
	}
	rows, err := q.Query(ctx, tagUsageReferencesQuery, organizationID, tagID)
	if err != nil {
		return TagUsage{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var item TagUsageItem
		if err := rows.Scan(&item.Kind, &item.Count); err != nil {
			return TagUsage{}, err
		}
		usage.Usages = append(usage.Usages, item)
	}
	return usage, rows.Err()
}
