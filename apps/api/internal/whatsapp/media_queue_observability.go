package whatsapp

import (
	"context"
	"database/sql"
	"log/slog"
	"time"
)

const whatsappMediaQueueObservationInterval = time.Minute

const whatsappMediaQueueMetricsSQL = `
	select
		(select count(*)::bigint from public.media_jobs where status = 'pending') as queue_depth,
		(select min(created_at) from public.media_jobs where status = 'pending') as oldest_pending_at,
		(select count(*)::bigint from public.media_jobs where status = 'processing') as processing_jobs,
		(select count(*)::bigint
		 from public.media_jobs
		 where status = 'completed'
		   and coalesce(completed_at, updated_at) >= now() - interval '5 minutes') as completed_last_5m,
		(select count(*)::bigint
		 from public.media_jobs
		 where status = 'failed'
		   and coalesce(failed_at, updated_at) >= now() - interval '5 minutes') as failed_last_5m,
		coalesce(state.breaker_open, false) as breaker_open,
		coalesce(state.breaker_reason, '') as breaker_reason,
		state.breaker_opened_at,
		coalesce(state.breaker_job_id::text, '') as breaker_job_id
	from private.whatsapp_media_worker_state as state
	where state.singleton = true
`

type whatsappMediaQueueMetrics struct {
	Depth           int64
	OldestPendingAt sql.NullTime
	ProcessingJobs  int64
	CompletedLast5m int64
	FailedLast5m    int64
	BreakerOpen     bool
	BreakerReason   string
	BreakerOpenedAt sql.NullTime
	BreakerJobID    string
}

// StartMediaQueueObservability emits a read-only, bounded queue snapshot. It
// deliberately does not participate in readiness so an observability query can
// never restart the API or interrupt webhook ingestion.
func (handler Handler) StartMediaQueueObservability(ctx context.Context, logger *slog.Logger) {
	if !handler.workerConfig.MediaWorkerEnabled {
		return
	}
	if logger == nil {
		logger = slog.Default()
	}
	go func() {
		handler.observeMediaQueue(ctx, logger)
		ticker := time.NewTicker(whatsappMediaQueueObservationInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				handler.observeMediaQueue(ctx, logger)
			}
		}
	}()
}

func (handler Handler) observeMediaQueue(ctx context.Context, logger *slog.Logger) {
	probeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	metrics, err := handler.repo.readWhatsAppMediaQueueMetrics(probeCtx)
	if err != nil {
		logger.Warn("whatsapp media queue metrics unavailable", "error", err)
		return
	}

	attrs := []any{
		"queue_depth", metrics.Depth,
		"oldest_pending_age_seconds", whatsappMediaQueueOldestAgeSeconds(time.Now().UTC(), metrics.OldestPendingAt),
		"processing_jobs", metrics.ProcessingJobs,
		"completed_last_5m", metrics.CompletedLast5m,
		"failed_last_5m", metrics.FailedLast5m,
		"breaker_open", metrics.BreakerOpen,
	}
	if metrics.BreakerOpen {
		attrs = append(attrs,
			"breaker_reason", metrics.BreakerReason,
			"breaker_job_id", metrics.BreakerJobID,
		)
		if metrics.BreakerOpenedAt.Valid {
			attrs = append(attrs, "breaker_opened_at", metrics.BreakerOpenedAt.Time.UTC())
		}
	}
	logger.Info("whatsapp media queue metrics", attrs...)
}

func (repo Repository) readWhatsAppMediaQueueMetrics(ctx context.Context) (whatsappMediaQueueMetrics, error) {
	var metrics whatsappMediaQueueMetrics
	err := repo.db.Pool().QueryRow(ctx, whatsappMediaQueueMetricsSQL).Scan(
		&metrics.Depth,
		&metrics.OldestPendingAt,
		&metrics.ProcessingJobs,
		&metrics.CompletedLast5m,
		&metrics.FailedLast5m,
		&metrics.BreakerOpen,
		&metrics.BreakerReason,
		&metrics.BreakerOpenedAt,
		&metrics.BreakerJobID,
	)
	return metrics, err
}

func whatsappMediaQueueOldestAgeSeconds(now time.Time, oldest sql.NullTime) int64 {
	if !oldest.Valid || oldest.Time.IsZero() || oldest.Time.After(now) {
		return 0
	}
	return int64(now.Sub(oldest.Time).Seconds())
}
