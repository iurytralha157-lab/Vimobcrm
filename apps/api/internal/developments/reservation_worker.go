package developments

import (
	"context"
	"errors"
	"log/slog"
	"time"
)

const (
	defaultReservationExpirationInterval = time.Minute
	defaultReservationExpirationBatch    = 100
)

type ReservationExpirationWorkerConfig struct {
	Enabled   bool
	Interval  time.Duration
	BatchSize int
}

func (repo Repository) StartReservationExpirationWorker(
	ctx context.Context,
	logger *slog.Logger,
	config ReservationExpirationWorkerConfig,
) {
	if !config.Enabled {
		return
	}
	if logger == nil {
		logger = slog.Default()
	}
	if config.Interval <= 0 {
		config.Interval = defaultReservationExpirationInterval
	}
	if config.BatchSize < 1 {
		config.BatchSize = defaultReservationExpirationBatch
	}

	go func() {
		timer := time.NewTimer(config.Interval)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				expired, err := repo.DrainDueReservationBacklog(ctx, config.BatchSize)
				if err != nil && !errors.Is(err, context.Canceled) {
					logger.Error("development reservation expiration worker failed", "error", err)
				} else if expired > 0 {
					logger.Info("development reservations expired", "count", expired)
				}
				timer.Reset(config.Interval)
			}
		}
	}()
}

// DrainDueReservationBacklog keeps transactions short while immediately
// draining more than one batch after a traffic spike or worker downtime. A
// concurrent replica can still share the queue through SKIP LOCKED.
func (repo Repository) DrainDueReservationBacklog(ctx context.Context, batchSize int) (int, error) {
	return drainDueReservationBacklog(ctx, batchSize, repo.ExpireDueReservations)
}

func drainDueReservationBacklog(
	ctx context.Context,
	batchSize int,
	expireBatch func(context.Context, int) (int, error),
) (int, error) {
	total := 0
	for {
		expired, err := expireBatch(ctx, batchSize)
		if err != nil {
			return total, err
		}
		total += expired
		if expired < batchSize {
			return total, nil
		}
		select {
		case <-ctx.Done():
			return total, ctx.Err()
		default:
		}
	}
}

// ExpireDueReservations owns only a short database transaction. Row locks are
// skipped across replicas, and the reservation/unit audit triggers run before
// commit. No network or external side effect occurs while rows are locked.
func (repo Repository) ExpireDueReservations(ctx context.Context, batchSize int) (int, error) {
	if batchSize < 1 || batchSize > 500 {
		return 0, ErrInvalidInput
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	var expired int
	if err := tx.QueryRow(ctx, `
		with candidates as (
			select reservation.id
			from public.property_development_reservations as reservation
			where reservation.status = 'active'
			  and reservation.expires_at <= clock_timestamp()
			order by reservation.expires_at, reservation.id
			limit $1
			for update of reservation skip locked
		), transitioned as (
			update public.property_development_reservations as reservation
			set status = 'expired',
			    cancellation_reason = 'ttl_elapsed',
			    updated_by = null,
			    updated_at = now()
			from candidates
			where reservation.id = candidates.id
			  and reservation.status = 'active'
			  and reservation.expires_at <= clock_timestamp()
			returning reservation.id
		)
		select count(*)::integer from transitioned
	`, batchSize).Scan(&expired); err != nil {
		return 0, normalizeDBError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return expired, nil
}
