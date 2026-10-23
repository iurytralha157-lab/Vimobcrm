package stageconfig

import (
	"context"
	"log/slog"
	"time"
)

type StageInactivityWorkerConfig struct {
	// No default enablement: the caller must opt in after the database and
	// product policy are validated. This candidate has no app startup wiring.
	Enabled  bool
	Interval time.Duration
}

// The returned channel closes after the current bounded transaction finishes,
// allowing a future app registration to wait during shutdown.
func (repo Repository) StartStageInactivityWorker(ctx context.Context, logger *slog.Logger, config StageInactivityWorkerConfig) <-chan struct{} {
	done := make(chan struct{})
	if !config.Enabled {
		close(done)
		return done
	}
	if config.Interval < 30*time.Second {
		config.Interval = 30 * time.Second
	}
	if logger == nil {
		logger = slog.Default()
	}
	go func() {
		defer close(done)
		timer := time.NewTimer(10 * time.Second)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				result, err := repo.ProcessStageInactivityOnce(ctx)
				if err != nil && ctx.Err() == nil {
					// Deliberately no exception details or lead/user identifiers.
					logger.Error("stage inactivity cycle failed", "code", "cycle_error", "scanned", result.Scanned, "enqueued", result.Enqueued, "notified", result.Notified, "failed", result.Failed, "dead", result.Dead)
				} else if result.Enqueued+result.Notified+result.Failed > 0 {
					logger.Info("stage inactivity cycle", "scanned", result.Scanned, "enqueued", result.Enqueued, "notified", result.Notified, "waiting", result.Waiting, "cancelled", result.Cancelled, "failed", result.Failed, "dead", result.Dead)
				}
				timer.Reset(config.Interval)
			}
		}
	}()
	return done
}
