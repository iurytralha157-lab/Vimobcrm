package leads

import (
	"context"
	"errors"
	"log/slog"
	"time"
)

const (
	announcementNotificationProducerBudget = 4 * time.Second
	announcementNotificationBatchSize      = 250
	announcementNotificationMaxBatches     = 16
	appPushNotificationInterval            = 2 * time.Second
	appPushNotificationDrainLimit          = 12
	appPushNotificationDrainBudget         = 8 * time.Second
)

// The normal worker also handles push so pending deliveries remain recoverable
// when an older replica is serving during an update or rollback.
func (repo Repository) runAppPushNotificationWorker(ctx context.Context, logger *slog.Logger) {
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			if created, err := repo.enqueueDueAnnouncementNotifications(ctx); err != nil && !errors.Is(err, context.Canceled) {
				repo.recordNotificationDispatchError()
				logger.Error("scheduled announcement notification producer failed", "error", err)
			} else if created > 0 {
				logger.Info("scheduled announcement notifications enqueued", "count", created)
			}
			deadline := time.Now().Add(appPushNotificationDrainBudget)
			for range appPushNotificationDrainLimit {
				if ctx.Err() != nil || time.Now().After(deadline) {
					break
				}
				processed, err := repo.processOneNormalizedNotificationDeliveryForLane(ctx, logger, notificationClaimAppPush)
				if err != nil && !errors.Is(err, context.Canceled) {
					repo.recordNotificationDispatchError()
					logger.Error("app push notification worker failed", "error", err)
				}
				if err != nil || !processed {
					break
				}
			}
			timer.Reset(appPushNotificationInterval)
		}
	}
}

func (repo Repository) enqueueDueAnnouncementNotifications(ctx context.Context) (int, error) {
	ctx, cancel := context.WithTimeout(ctx, announcementNotificationProducerBudget)
	defer cancel()

	var available bool
	if err := repo.db.Pool().QueryRow(ctx, `
		select pg_catalog.to_regprocedure('private.process_due_announcement_notifications(integer)') is not null
	`).Scan(&available); err != nil || !available {
		return 0, err
	}

	total := 0
	for range announcementNotificationMaxBatches {
		var processed, created int
		var moreDue bool
		err := repo.db.Pool().QueryRow(ctx, `
			select processed, notifications_created, more_due
			from private.process_due_announcement_notifications($1)
		`, announcementNotificationBatchSize).Scan(&processed, &created, &moreDue)
		if err != nil {
			return total, err
		}
		total += created
		if processed == 0 || !moreDue {
			break
		}
	}
	return total, nil
}
