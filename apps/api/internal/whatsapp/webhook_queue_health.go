package whatsapp

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
)

const webhookQueueHealthQuery = `
	select
	  case when processing_lane in ('live', 'backlog')
	    then processing_lane else 'other' end as lane,
	  case
	    when lower(event_type) like '%message%' then 'message'
	    when lower(event_type) like '%receipt%'
	      or lower(event_type) like '%ack%'
	      or lower(event_type) like '%status%' then 'receipt_status'
	    when lower(event_type) in ('connected', 'disconnected', 'loggedout')
	      then 'session_control'
	    else 'other'
	  end as event_class,
	  status,
	  count(*)::bigint as active_count,
	  greatest(0, floor(extract(epoch from now() - min(created_at))))::bigint
	    as oldest_age_seconds
	from public.whatsapp_webhook_inbox
	where status in ('pending', 'retry', 'processing')
	group by 1, 2, 3
	order by 1, 2, 3
`

const (
	webhookQueueHealthTimeout          = 900 * time.Millisecond
	webhookQueueHealthStatementTimeout = "750ms"
)

// These labels are fixed classes. The query never returns payload, phone,
// route key, lead identity, provider message ID, or raw event type.
type webhookQueueHealthGroup struct {
	Lane             string `json:"lane"`
	EventClass       string `json:"event_class"`
	Status           string `json:"status"`
	ActiveCount      int64  `json:"active_count"`
	OldestAgeSeconds int64  `json:"oldest_age_seconds"`
}

func webhookQueueHealthAlert(group webhookQueueHealthGroup) bool {
	if group.Status == "processing" && group.OldestAgeSeconds >= 300 {
		return true
	}
	if group.Lane == evolutionWebhookLaneLive {
		return group.ActiveCount >= 1000 ||
			(group.Status == "pending" && group.OldestAgeSeconds >= 30) ||
			(group.Status == "retry" && group.OldestAgeSeconds >= 600)
	}
	if group.Lane == evolutionWebhookLaneBacklog {
		return group.ActiveCount >= 10000 ||
			(group.Status == "pending" && group.OldestAgeSeconds >= 600) ||
			(group.Status == "retry" && group.OldestAgeSeconds >= 1800)
	}
	return group.OldestAgeSeconds >= 600
}

func (repo Repository) logEvolutionWebhookQueueHealth(ctx context.Context, logger *slog.Logger) {
	probeCtx, cancel := context.WithTimeout(ctx, webhookQueueHealthTimeout)
	defer cancel()

	tx, err := repo.db.Pool().BeginTx(probeCtx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		logWebhookQueueHealthError(ctx, probeCtx, logger)
		return
	}
	defer func() {
		rollbackCtx, rollbackCancel := context.WithTimeout(context.Background(), time.Second)
		defer rollbackCancel()
		_ = tx.Rollback(rollbackCtx)
	}()
	if _, err = tx.Exec(probeCtx, "set local statement_timeout = '"+webhookQueueHealthStatementTimeout+"'"); err != nil {
		logWebhookQueueHealthError(ctx, probeCtx, logger)
		return
	}

	rows, err := tx.Query(probeCtx, webhookQueueHealthQuery)
	if err != nil {
		logWebhookQueueHealthError(ctx, probeCtx, logger)
		return
	}
	groups := make([]webhookQueueHealthGroup, 0, 12)
	var totalActive, liveActive, backlogActive int64
	var oldestLive, oldestBacklog int64
	alertGroups := 0
	for rows.Next() {
		var group webhookQueueHealthGroup
		if err = rows.Scan(&group.Lane, &group.EventClass, &group.Status,
			&group.ActiveCount, &group.OldestAgeSeconds); err != nil {
			rows.Close()
			logWebhookQueueHealthError(ctx, probeCtx, logger)
			return
		}
		groups = append(groups, group)
		totalActive += group.ActiveCount
		switch group.Lane {
		case evolutionWebhookLaneLive:
			liveActive += group.ActiveCount
			if group.OldestAgeSeconds > oldestLive {
				oldestLive = group.OldestAgeSeconds
			}
		case evolutionWebhookLaneBacklog:
			backlogActive += group.ActiveCount
			if group.OldestAgeSeconds > oldestBacklog {
				oldestBacklog = group.OldestAgeSeconds
			}
		}
		if webhookQueueHealthAlert(group) {
			alertGroups++
		}
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		logWebhookQueueHealthError(ctx, probeCtx, logger)
		return
	}
	rows.Close()
	if liveActive >= 1000 {
		alertGroups++
	}
	if backlogActive >= 10000 {
		alertGroups++
	}
	logger.LogAttrs(ctx, queueHealthLogLevel(alertGroups),
		"whatsapp webhook queue health",
		slog.String("worker_id", whatsappWebhookWorkerID),
		slog.Int64("active_total", totalActive),
		slog.Int64("active_live", liveActive),
		slog.Int64("active_backlog", backlogActive),
		slog.Int64("oldest_live_seconds", oldestLive),
		slog.Int64("oldest_backlog_seconds", oldestBacklog),
		slog.Int("alert_groups", alertGroups),
		slog.Any("groups", groups),
	)
}

func queueHealthLogLevel(alertGroups int) slog.Level {
	if alertGroups > 0 {
		return slog.LevelWarn
	}
	return slog.LevelInfo
}

func logWebhookQueueHealthError(parentCtx, probeCtx context.Context, logger *slog.Logger) {
	if errors.Is(parentCtx.Err(), context.Canceled) {
		return
	}
	reason := "query_failed"
	if errors.Is(probeCtx.Err(), context.DeadlineExceeded) {
		reason = "timeout"
	}
	logger.Warn("whatsapp webhook queue health unavailable",
		"worker_id", whatsappWebhookWorkerID, "reason", reason)
}
