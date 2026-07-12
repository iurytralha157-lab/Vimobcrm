package automations

import (
	"context"
	"errors"
	"log/slog"
	"time"
)

const automationRuntimeWorkerInterval = 5 * time.Second
const automationInactivityWorkerInterval = 60 * time.Second

// StartRuntimeWorker starts the backend-owned automation coordinator. The Edge
// Function performs bounded queue claims; this loop only provides the wake-up
// signal and never owns an execution lock while doing network I/O.
func (repo Repository) StartRuntimeWorker(ctx context.Context, logger *slog.Logger) {
	if !repo.functions.isConfigured() {
		return
	}
	if logger == nil {
		logger = slog.Default()
	}

	run := func(initialDelay time.Duration, interval time.Duration, label string, callback func(context.Context) error) {
		timer := time.NewTimer(initialDelay)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				if err := callback(ctx); err != nil && !errors.Is(err, context.Canceled) {
					logger.Error("automation worker failed", "worker", label, "error", err)
				}
				timer.Reset(interval)
			}
		}
	}
	go run(3*time.Second, automationRuntimeWorkerInterval, "runtime", repo.ProcessRuntimeOnce)
	go run(20*time.Second, automationInactivityWorkerInterval, "inactivity", repo.ProcessInactivityOnce)
}

// ProcessRuntimeOnce is exported to make local smoke tests and operational
// probes deterministic without starting a background goroutine.
func (repo Repository) ProcessRuntimeOnce(ctx context.Context) error {
	return repo.functions.invoke(ctx, "automation-runner", map[string]any{
		"event_batch_size":     5,
		"execution_batch_size": 5,
		"delay_batch_size":     10,
		"run_inactivity":       false,
	})
}

// ProcessInactivityOnce is kept on a slower, isolated wake-up so a large lead
// scan can never delay message events, due delays, or execution claims.
func (repo Repository) ProcessInactivityOnce(ctx context.Context) error {
	return repo.functions.invoke(ctx, "automation-inactivity", map[string]any{
		"batch_size": 100,
	})
}
