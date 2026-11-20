package leads

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
)

const slaCheckBatchSize = 100
const slaCheckBatchLimit = 10

type SLACheckResult struct {
	Success   bool      `json:"success"`
	Processed int       `json:"processed"`
	Warnings  int       `json:"warnings_created"`
	Overdues  int       `json:"overdues_created"`
	Busy      bool      `json:"busy,omitempty"`
	More      bool      `json:"more,omitempty"`
	Timestamp time.Time `json:"timestamp"`
}

type slaCandidate struct {
	leadID, organizationID, name, status, startKey string
	assignee                                       *string
	start                                          time.Time
	warnAfter, overdueAfter                        int
	notifyAssignee, notifyManager                  bool
	warned, overdue                                bool
}

// The lock is held only while committing one bounded batch. Oldest unchecked
// leads move to the back on commit. Cutover must disable the old Edge invoker.
func (repo Repository) RunSLACheck(ctx context.Context) (SLACheckResult, error) {
	result := SLACheckResult{Timestamp: time.Now().UTC()}
	for range slaCheckBatchLimit {
		batch, err := repo.runSLACheckBatch(ctx, result.Timestamp)
		if err != nil {
			return result, err
		}
		result.Processed += batch.Processed
		result.Warnings += batch.Warnings
		result.Overdues += batch.Overdues
		if batch.Busy || batch.Processed < slaCheckBatchSize {
			result.Success = !batch.Busy
			result.Busy = batch.Busy
			return result, nil
		}
	}
	result.Success = true
	result.More = true
	return result, nil
}

func (repo Repository) runSLACheckBatch(ctx context.Context, now time.Time) (SLACheckResult, error) {
	var result SLACheckResult
	err := pgx.BeginFunc(ctx, repo.db.Pool(), func(tx pgx.Tx) error {
		var acquired bool
		if err := tx.QueryRow(ctx, `select pg_try_advisory_xact_lock(hashtextextended('vimob.leads.sla_check', 0))`).Scan(&acquired); err != nil {
			return err
		}
		if !acquired {
			result.Busy = true
			return nil
		}
		if _, err := tx.Exec(ctx, "set local time zone 'UTC'"); err != nil {
			return err
		}
		candidates, err := loadSLACandidates(ctx, tx, now)
		if err != nil {
			return err
		}
		for _, candidate := range candidates {
			event, err := repo.applySLACheck(ctx, tx, candidate, now)
			if err != nil {
				return err
			}
			result.Processed++
			switch event {
			case "sla_warning":
				result.Warnings++
			case "sla_overdue":
				result.Overdues++
			}
		}
		return nil
	})
	return result, err
}

func loadSLACandidates(ctx context.Context, tx pgx.Tx, checkedAt time.Time) ([]slaCandidate, error) {
	rows, err := tx.Query(ctx, `
		select l.id::text, l.organization_id::text, coalesce(l.name, ''),
		       coalesce(l.sla_status, 'ok'), to_json(c.sla_start_at) #>> '{}',
		       l.assigned_user_id::text, c.sla_start_at,
		       c.warn_after_seconds, c.overdue_after_seconds,
		       c.notify_assignee, c.notify_manager,
		       l.sla_notified_warning_at is not null, l.sla_notified_overdue_at is not null
		from public.get_sla_pending_leads() c
		join public.leads l on l.id = c.lead_id
			and l.organization_id = c.organization_id and l.pipeline_id = c.pipeline_id
		where l.operational_effects_suppressed = false and l.first_response_at is null
			and coalesce(l.deal_status, 'open') not in ('won', 'lost')
			and (l.sla_last_checked_at is null or l.sla_last_checked_at < $1::timestamptz - interval '1 minute')
			and c.sla_start_at = public.get_sla_start_at(l.id)
		order by l.sla_last_checked_at asc nulls first, l.id
		limit $2
		for update of l skip locked
	`, checkedAt, slaCheckBatchSize)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (slaCandidate, error) {
		var c slaCandidate
		err := row.Scan(&c.leadID, &c.organizationID, &c.name, &c.status, &c.startKey,
			&c.assignee, &c.start, &c.warnAfter, &c.overdueAfter,
			&c.notifyAssignee, &c.notifyManager, &c.warned, &c.overdue)
		return c, err
	})
}

func slaStatusAndEvent(c slaCandidate, elapsed int) (status, event string) {
	switch {
	case elapsed >= c.overdueAfter:
		if c.status != "overdue" && !c.overdue {
			return "overdue", "sla_overdue"
		}
		return "overdue", ""
	case elapsed >= c.warnAfter:
		if c.status != "warning" && !c.warned {
			return "warning", "sla_warning"
		}
		return "warning", ""
	default:
		return "ok", ""
	}
}

func (repo Repository) applySLACheck(ctx context.Context, tx pgx.Tx, c slaCandidate, now time.Time) (string, error) {
	elapsed := min(math.MaxInt32, max(math.MinInt32, int(math.Floor(now.Sub(c.start).Seconds()))))
	status, event := slaStatusAndEvent(c, elapsed)
	if _, err := tx.Exec(ctx, `
		update public.leads
		set sla_status = $3, sla_seconds_elapsed = $4, sla_last_checked_at = $5,
		    sla_notified_warning_at = case when $6 = 'sla_warning' then $5 else sla_notified_warning_at end,
		    sla_notified_overdue_at = case when $6 = 'sla_overdue' then $5 else sla_notified_overdue_at end
		where id = $1 and organization_id = $2
	`, c.leadID, c.organizationID, status, elapsed, now, event); err != nil {
		return "", err
	}
	if event == "" {
		return "", nil
	}

	minutes := elapsed / 60
	title, threshold, thresholdKey := "SLA em alerta", c.warnAfter, "warn_threshold"
	if event == "sla_overdue" {
		title, threshold, thresholdKey = "SLA estourado", c.overdueAfter, "overdue_threshold"
	}
	description := fmt.Sprintf("%s: %d minutos sem resposta", title, minutes)
	if _, err := tx.Exec(ctx, `
		insert into public.activities (organization_id, lead_id, type, content, metadata, created_at)
		values ($1, $2, $3, $4, $5, $6)
	`, c.organizationID, c.leadID, event, description, map[string]int{
		"elapsed_seconds": elapsed, "warn_threshold": c.warnAfter, "overdue_threshold": c.overdueAfter,
	}, now); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `
		insert into public.lead_timeline_events (organization_id, lead_id, event_type, title, description, metadata, event_at)
		values ($1, $2, $3, $4, $5, $6, $7)
	`, c.organizationID, c.leadID, event, title, description, map[string]int{
		"elapsed_seconds": elapsed, thresholdKey: threshold,
	}, now); err != nil {
		return "", err
	}
	return event, repo.enqueueSLANotifications(ctx, tx, c, event, title, description, minutes)
}

func (repo Repository) enqueueSLANotifications(ctx context.Context, tx pgx.Tx, c slaCandidate, event, title, description string, minutes int) error {
	managerEvent := event == "sla_overdue" && c.notifyManager
	if !managerEvent && (!c.notifyAssignee || c.assignee == nil) {
		return nil
	}
	rows, err := tx.Query(ctx, `
		select u.id::text
		from public.users u
		join public.organization_members om on om.user_id = u.id and om.organization_id = $1
		where u.is_active = true and om.is_active = true and om.deleted_at is null
			and (($3 and u.id = $2) or
			     ($4 and u.organization_id = $1 and u.role in ('admin', 'manager') and u.id is distinct from $2::uuid))
		order by u.id
		for share of u, om
	`, c.organizationID, c.assignee, c.notifyAssignee, managerEvent)
	if err != nil {
		return err
	}
	recipients, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	for _, recipient := range recipients {
		eventKey, dedupePrefix := event, event+":"+c.leadID
		if c.assignee == nil || recipient != *c.assignee {
			eventKey = "sla_overdue_manager"
			dedupePrefix = eventKey + ":" + c.leadID + ":" + recipient
		}
		if _, err := repo.enqueueDispatchNotificationWithQueryer(ctx, tx, c.organizationID, recipient, DispatchNotificationRequest{
			EventKey: eventKey, LeadID: &c.leadID, Title: title, Content: description,
			Variables: map[string]any{"lead_name": c.name, "minutes": minutes},
			DedupeKey: dedupePrefix + ":" + c.startKey,
		}); err != nil {
			return err
		}
	}
	return nil
}
