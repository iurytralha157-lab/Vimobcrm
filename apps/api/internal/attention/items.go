package attention

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) ListItems(ctx context.Context, tenantContext tenant.Context, filter ListFilter) (ItemPage, error) {
	where, args, err := itemVisibilitySQL(tenantContext, filter.Scope)
	if err != nil {
		return ItemPage{}, err
	}
	where += " and l.attention_eligible = true"

	if len(filter.Status) > 0 {
		for _, status := range filter.Status {
			if !validItemStatus(status) {
				return ItemPage{}, fmt.Errorf("%w: status is invalid", ErrInvalidInput)
			}
		}
		args = append(args, filter.Status)
		where += fmt.Sprintf(" and i.status = any($%d::text[])", len(args))
	} else {
		where += " and i.status not in ('resolved', 'redistributed', 'cancelled')"
	}

	cursor, err := decodeCursor(filter.Cursor)
	if err != nil {
		return ItemPage{}, err
	}
	if !cursor.UpdatedAt.IsZero() {
		args = append(args, cursor.UpdatedAt, cursor.ID)
		where += fmt.Sprintf(" and (i.updated_at, i.id) < ($%d::timestamptz, $%d::uuid)", len(args)-1, len(args))
	}
	limit := filter.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	args = append(args, limit+1)

	rows, err := repo.db.Pool().Query(ctx, itemSelectSQL()+`
		where `+where+`
		order by i.updated_at desc, i.id desc
		limit $`+fmt.Sprint(len(args))+`
	`, args...)
	if err != nil {
		return ItemPage{}, err
	}
	defer rows.Close()

	items := []Item{}
	for rows.Next() {
		item, err := scanItem(rows)
		if err != nil {
			return ItemPage{}, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return ItemPage{}, err
	}

	page := ItemPage{Items: items}
	if len(items) > limit {
		last := items[limit-1]
		cursor := encodeCursor(last.UpdatedAt, last.ID)
		page.NextCursor = &cursor
		page.Items = items[:limit]
	}
	return page, nil
}

func (repo Repository) Summary(ctx context.Context, tenantContext tenant.Context, scope string) (Summary, error) {
	where, args, err := itemVisibilitySQL(tenantContext, scope)
	if err != nil {
		return Summary{}, err
	}
	where += " and l.attention_eligible = true and i.status not in ('resolved', 'redistributed', 'cancelled')"

	var summary Summary
	err = repo.db.Pool().QueryRow(ctx, `
		select
			count(*)::int,
			count(*) filter (where i.status = 'monitoring')::int,
			count(*) filter (where i.status = 'warning')::int,
			count(*) filter (where i.status = 'breached')::int,
			count(*) filter (where i.status = 'escalated')::int,
			count(*) filter (where i.status = 'acknowledged')::int,
			count(*) filter (
				where (i.due_at at time zone coalesce(os.timezone, 'America/Sao_Paulo'))::date =
				      (now() at time zone coalesce(os.timezone, 'America/Sao_Paulo'))::date
			)::int,
			count(*) filter (where i.due_at <= now())::int,
			count(*) filter (where p.policy_type = 'unassigned')::int,
			count(*) filter (where p.policy_type = 'first_contact')::int,
			count(*) filter (where p.policy_type = 'stage_inactivity')::int,
			count(*) filter (where p.policy_type = 'stage_age')::int
		from public.lead_attention_instances i
		join public.lead_attention_policies p
		  on p.organization_id = i.organization_id and p.id = i.policy_id
		join public.leads l
		  on l.organization_id = i.organization_id and l.id = i.lead_id
		left join public.organization_attention_settings os
		  on os.organization_id = i.organization_id
		where `+where,
		args...,
	).Scan(
		&summary.Total, &summary.Monitoring, &summary.Warning, &summary.Breached,
		&summary.Escalated, &summary.Acknowledged, &summary.DueToday, &summary.Overdue,
		&summary.Unassigned, &summary.FirstContact, &summary.StageInactivity, &summary.StageAge,
	)
	return summary, err
}

func (repo Repository) AcknowledgeItem(ctx context.Context, tenantContext tenant.Context, itemID string, request AcknowledgeRequest) (Item, error) {
	return repo.mutateItem(ctx, tenantContext, itemID, func(ctx context.Context, tx pgx.Tx, current Item) error {
		if terminalStatus(current.Status) {
			return fmt.Errorf("%w: terminal items cannot be acknowledged", ErrInvalidInput)
		}
		metadata := cloneMap(current.Metadata)
		metadata["acknowledged_from_status"] = acknowledgedSeverity(current)
		if note := cleanOptionalString(request.Note); note != nil {
			metadata["acknowledgement_note"] = *note
		}
		_, err := tx.Exec(ctx, `
			update public.lead_attention_instances
			set status = 'acknowledged',
			    acknowledged_at = now(), acknowledged_by = $3::uuid,
			    metadata = $4::jsonb, updated_at = now()
			where organization_id = $1::uuid and id = $2::uuid
		`, tenantContext.OrganizationID, current.ID, tenantContext.UserID, jsonValue(metadata))
		if err != nil {
			return err
		}
		return insertAttentionEvent(ctx, tx, current.OrganizationID, current.ID, current.LeadID, "acknowledged", tenantContext.UserID, map[string]any{"note": request.Note})
	})
}

func (repo Repository) SnoozeItem(ctx context.Context, tenantContext tenant.Context, itemID string, request SnoozeRequest) (Item, error) {
	if request.Minutes < 5 || request.Minutes > 30*24*60 {
		return Item{}, fmt.Errorf("%w: minutes must be between 5 and 43200", ErrInvalidInput)
	}
	return repo.mutateItem(ctx, tenantContext, itemID, func(ctx context.Context, tx pgx.Tx, current Item) error {
		if terminalStatus(current.Status) {
			return fmt.Errorf("%w: terminal items cannot be snoozed", ErrInvalidInput)
		}
		until := time.Now().UTC().Add(time.Duration(request.Minutes) * time.Minute)
		metadata := cloneMap(current.Metadata)
		if note := cleanOptionalString(request.Note); note != nil {
			metadata["snooze_note"] = *note
		}
		_, err := tx.Exec(ctx, `
			update public.lead_attention_instances
			set snoozed_until = $3, next_evaluation_at = $3,
			    metadata = $4::jsonb, updated_at = now()
			where organization_id = $1::uuid and id = $2::uuid
		`, tenantContext.OrganizationID, current.ID, until, jsonValue(metadata))
		if err != nil {
			return err
		}
		return insertAttentionEvent(ctx, tx, current.OrganizationID, current.ID, current.LeadID, "snoozed", tenantContext.UserID, map[string]any{
			"minutes": request.Minutes,
			"until":   until,
			"note":    request.Note,
		})
	})
}

func (repo Repository) ResolveItem(ctx context.Context, tenantContext tenant.Context, itemID string, request ResolveRequest) (Item, error) {
	request.Reason = strings.TrimSpace(request.Reason)
	if request.Reason == "" || len(request.Reason) > 160 {
		return Item{}, fmt.Errorf("%w: reason is required and must have at most 160 characters", ErrInvalidInput)
	}
	return repo.mutateItem(ctx, tenantContext, itemID, func(ctx context.Context, tx pgx.Tx, current Item) error {
		if terminalStatus(current.Status) {
			return fmt.Errorf("%w: item is already terminal", ErrInvalidInput)
		}
		metadata := cloneMap(current.Metadata)
		if note := cleanOptionalString(request.Note); note != nil {
			metadata["resolution_note"] = *note
		}
		_, err := tx.Exec(ctx, `
			update public.lead_attention_instances
			set status = 'resolved', resolved_at = now(), resolved_by = $3::uuid,
			    resolved_reason = $4, next_evaluation_at = now(),
			    metadata = $5::jsonb, updated_at = now()
			where organization_id = $1::uuid and id = $2::uuid
		`, tenantContext.OrganizationID, current.ID, tenantContext.UserID, request.Reason, jsonValue(metadata))
		if err != nil {
			return err
		}
		return insertAttentionEvent(ctx, tx, current.OrganizationID, current.ID, current.LeadID, "resolved", tenantContext.UserID, map[string]any{
			"reason": request.Reason,
			"note":   request.Note,
		})
	})
}

func (repo Repository) mutateItem(ctx context.Context, tenantContext tenant.Context, itemID string, mutation func(context.Context, pgx.Tx, Item) error) (Item, error) {
	if !validUUID(itemID) {
		return Item{}, ErrInvalidInput
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Item{}, err
	}
	defer tx.Rollback(ctx)

	current, err := repo.showItemTx(ctx, tx, tenantContext.OrganizationID, itemID, true)
	if err != nil {
		return Item{}, err
	}
	assignedUserID := ""
	if current.AssignedUserID != nil {
		assignedUserID = *current.AssignedUserID
	}
	if !canActOnItem(tenantContext, assignedUserID) {
		return Item{}, ErrForbidden
	}
	if err := mutation(ctx, tx, current); err != nil {
		return Item{}, err
	}
	updated, err := repo.showItemTx(ctx, tx, tenantContext.OrganizationID, itemID, false)
	if err != nil {
		return Item{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Item{}, err
	}
	return updated, nil
}

func (repo Repository) showItemTx(ctx context.Context, tx pgx.Tx, organizationID, itemID string, lock bool) (Item, error) {
	lockClause := ""
	if lock {
		lockClause = " for update of i"
	}
	item, err := scanItem(tx.QueryRow(ctx, itemSelectSQL()+`
		where i.organization_id = $1::uuid and i.id = $2::uuid
		  and l.attention_eligible = true`+lockClause,
		organizationID, itemID,
	))
	if errors.Is(err, pgx.ErrNoRows) {
		return Item{}, ErrNotFound
	}
	return item, err
}

func itemVisibilitySQL(context tenant.Context, requestedScope string) (string, []any, error) {
	scope := strings.ToLower(strings.TrimSpace(requestedScope))
	if scope == "" {
		scope = "mine"
	}
	args := []any{context.OrganizationID}
	where := "i.organization_id = $1::uuid"
	switch scope {
	case "mine":
		args = append(args, context.UserID)
		where += " and i.assigned_user_id = $2::uuid"
	case "team":
		if canViewOrganizationAttention(context) && len(context.LedUserIDs) == 0 {
			return where, args, nil
		}
		if !context.IsTeamLeader || len(context.LedUserIDs) == 0 {
			return "", nil, ErrForbidden
		}
		userIDs := append([]string{context.UserID}, context.LedUserIDs...)
		args = append(args, userIDs)
		where += " and i.assigned_user_id = any($2::uuid[])"
	case "organization", "all":
		if !canViewOrganizationAttention(context) {
			return "", nil, ErrForbidden
		}
	default:
		return "", nil, fmt.Errorf("%w: scope is invalid", ErrInvalidInput)
	}
	return where, args, nil
}

func itemSelectSQL() string {
	return `
		select
			i.id::text, i.organization_id::text, i.lead_id::text, l.name,
			i.policy_id::text, p.name, p.policy_type, p.status, i.policy_version,
			i.status, i.shadow,
			i.assigned_user_id::text, u.name,
			i.pipeline_id::text, pi.name,
			i.stage_id::text, s.name,
			i.cycle_key, i.baseline_at, i.last_qualifying_action_at,
			i.warning_at, i.due_at, i.next_evaluation_at,
			i.warning_sent_at, i.breach_sent_at, i.escalated_at,
			i.last_reminder_at, i.reminder_count,
			i.acknowledged_at, i.acknowledged_by::text, i.snoozed_until,
			i.resolved_at, i.resolved_by::text, i.resolved_reason,
			i.redistributed_at, i.redistribution_attempts,
			i.metadata, i.created_at, i.updated_at
		from public.lead_attention_instances i
		join public.lead_attention_policies p
		  on p.organization_id = i.organization_id and p.id = i.policy_id
		join public.leads l
		  on l.organization_id = i.organization_id and l.id = i.lead_id
		left join public.users u on u.id = i.assigned_user_id
		left join public.pipelines pi
		  on pi.organization_id = i.organization_id and pi.id = i.pipeline_id
		left join public.stages s
		  on s.organization_id = i.organization_id and s.id = i.stage_id
	`
}

func scanItem(row scanner) (Item, error) {
	var item Item
	var assignedUserID, assignedUserName, pipelineID, pipelineName, stageID, stageName pgtype.Text
	var acknowledgedBy, resolvedBy, resolutionReason pgtype.Text
	var lastActionAt, warningAt, nextEvaluationAt, warningSentAt, breachSentAt pgtype.Timestamptz
	var escalatedAt, lastReminderAt, acknowledgedAt, snoozedUntil, resolvedAt, redistributedAt pgtype.Timestamptz
	var metadata []byte
	err := row.Scan(
		&item.ID, &item.OrganizationID, &item.LeadID, &item.LeadName,
		&item.PolicyID, &item.PolicyName, &item.PolicyType, &item.PolicyStatus, &item.PolicyVersion,
		&item.Status, &item.Shadow,
		&assignedUserID, &assignedUserName, &pipelineID, &pipelineName, &stageID, &stageName,
		&item.CycleKey, &item.BaselineAt, &lastActionAt,
		&warningAt, &item.DueAt, &nextEvaluationAt,
		&warningSentAt, &breachSentAt, &escalatedAt,
		&lastReminderAt, &item.ReminderCount,
		&acknowledgedAt, &acknowledgedBy, &snoozedUntil,
		&resolvedAt, &resolvedBy, &resolutionReason,
		&redistributedAt, &item.RedistributionAttempts,
		&metadata, &item.CreatedAt, &item.UpdatedAt,
	)
	if err != nil {
		return Item{}, err
	}
	item.AssignedUserID = textPointer(assignedUserID)
	item.AssignedUserName = textPointer(assignedUserName)
	item.PipelineID = textPointer(pipelineID)
	item.PipelineName = textPointer(pipelineName)
	item.StageID = textPointer(stageID)
	item.StageName = textPointer(stageName)
	item.LastValidActionAt = timePointer(lastActionAt)
	item.WarningAt = timePointer(warningAt)
	item.NextEvaluationAt = timePointer(nextEvaluationAt)
	item.WarningSentAt = timePointer(warningSentAt)
	item.BreachedAt = timePointer(breachSentAt)
	item.EscalatedAt = timePointer(escalatedAt)
	item.LastReminderAt = timePointer(lastReminderAt)
	item.AcknowledgedAt = timePointer(acknowledgedAt)
	item.AcknowledgedBy = textPointer(acknowledgedBy)
	item.SnoozedUntil = timePointer(snoozedUntil)
	item.ResolvedAt = timePointer(resolvedAt)
	item.ResolvedBy = textPointer(resolvedBy)
	item.ResolutionReason = textPointer(resolutionReason)
	item.RedistributedAt = timePointer(redistributedAt)
	item.Metadata = decodeMap(metadata)
	return item, nil
}

func terminalStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "resolved", "redistributed", "cancelled":
		return true
	default:
		return false
	}
}

func acknowledgedSeverity(item Item) string {
	if validSeverity(item.Status) {
		return item.Status
	}
	if item.DueAt.Before(time.Now()) {
		if item.EscalatedAt != nil && !item.EscalatedAt.After(time.Now()) {
			return "escalated"
		}
		return "breached"
	}
	return "warning"
}

func insertAttentionEvent(ctx context.Context, tx pgx.Tx, organizationID, instanceID, leadID, eventType, actorUserID string, metadata map[string]any) error {
	_, err := tx.Exec(ctx, `
		insert into public.lead_attention_events (
			organization_id, instance_id, lead_id, event_type, actor_user_id, metadata
		) values ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6::jsonb)
	`, organizationID, instanceID, leadID, eventType, emptyStringNil(actorUserID), jsonValue(metadata))
	return err
}

func emptyStringNil(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return strings.TrimSpace(value)
}
