package leads

import (
	"context"
	"time"
)

const (
	scheduleNotificationBurstBatches = 128
	scheduleNotificationBurstBudget  = 5 * time.Second
)

// Drain due Agenda recipients promptly instead of waiting another worker
// interval after every 50 rows. Each batch commits independently, preserving
// progress across timeouts/restarts and retaining the existing advisory-lock
// and dedupe boundary between replicas. No provider send/replay occurs here.
func (repo Repository) createDueScheduleNotificationBurst(ctx context.Context) (int64, error) {
	return runScheduleNotificationBurst(ctx, repo.createDueScheduleNotifications)
}

func runScheduleNotificationBurst(ctx context.Context, enqueue func(context.Context) (int64, error)) (int64, error) {
	deadline := time.Now().Add(scheduleNotificationBurstBudget)
	var total int64
	for batch := 0; batch < scheduleNotificationBurstBatches && time.Now().Before(deadline); batch++ {
		if err := ctx.Err(); err != nil {
			return total, err
		}
		batchContext, cancel := context.WithDeadline(ctx, deadline)
		created, err := enqueue(batchContext)
		cancel()
		if err != nil {
			return total, err
		}
		total += created
		if created < scheduleNotificationEnqueueLimit {
			break
		}
	}
	return total, nil
}
