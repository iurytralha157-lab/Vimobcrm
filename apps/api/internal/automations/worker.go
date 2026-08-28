package automations

import (
	"context"
	"errors"
	"log/slog"
	"time"
)

const (
	defaultAutomationRuntimeWorkerInterval    = 30 * time.Second
	defaultAutomationInactivityWorkerInterval = 5 * time.Minute
	defaultAutomationWorkerRunTimeout         = 25 * time.Second
	defaultAutomationWorkerLockTimeout        = 2 * time.Second
	defaultAutomationRuntimeDrainLimit        = 64
	automationRuntimeManualWakeDebounce       = 500 * time.Millisecond
	automationRuntimeLockRetryDelay           = 250 * time.Millisecond
	automationRuntimeFailureRetryMaxDelay     = 5 * time.Second
)

var errAutomationWorkerLockBusy = errors.New("automation worker lock is busy")

type runtimeWakeDebounce struct {
	timer *time.Timer
	ch    <-chan time.Time
}

func newRuntimeWakeDebounce() *runtimeWakeDebounce {
	timer := time.NewTimer(time.Hour)
	if !timer.Stop() {
		<-timer.C
	}
	return &runtimeWakeDebounce{timer: timer}
}

func (debounce *runtimeWakeDebounce) Arm(delay time.Duration) {
	debounce.Cancel()
	debounce.timer.Reset(delay)
	debounce.ch = debounce.timer.C
}

func (debounce *runtimeWakeDebounce) Cancel() {
	if debounce == nil || debounce.timer == nil || debounce.ch == nil {
		return
	}
	if !debounce.timer.Stop() {
		select {
		case <-debounce.timer.C:
		default:
		}
	}
	debounce.ch = nil
}

func (debounce *runtimeWakeDebounce) Consume() {
	debounce.ch = nil
}

func (debounce *runtimeWakeDebounce) Stop() {
	if debounce == nil || debounce.timer == nil {
		return
	}
	debounce.Cancel()
	debounce.timer.Stop()
}

type WorkerConfig struct {
	Enabled            bool
	RuntimeInterval    time.Duration
	InactivityInterval time.Duration
	RunTimeout         time.Duration
	LockTimeout        time.Duration
	RuntimeDrainLimit  int
}

func (config WorkerConfig) normalized() WorkerConfig {
	if config.RuntimeInterval <= 0 {
		config.RuntimeInterval = defaultAutomationRuntimeWorkerInterval
	}
	if config.InactivityInterval <= 0 {
		config.InactivityInterval = defaultAutomationInactivityWorkerInterval
	}
	if config.RunTimeout <= 0 {
		config.RunTimeout = defaultAutomationWorkerRunTimeout
	}
	if config.LockTimeout <= 0 {
		config.LockTimeout = defaultAutomationWorkerLockTimeout
	}
	if config.RuntimeDrainLimit <= 0 {
		config.RuntimeDrainLimit = defaultAutomationRuntimeDrainLimit
	}
	return config
}

// StartRuntimeWorker starts the backend-owned automation coordinator. The Edge
// Functions perform bounded queue claims. Manual starts signal the shared,
// coalesced runtimeWake channel; this loop serially drains those batches while a
// database advisory lock prevents multiple API replicas from stampeding them.
// The periodic tick is retained because scheduled work and another replica's
// durable queued rows cannot rely on an in-memory wake-up.
func (repo Repository) StartRuntimeWorker(ctx context.Context, logger *slog.Logger, config WorkerConfig) {
	config = config.normalized()
	if !config.Enabled || !repo.functions.isConfigured() {
		return
	}
	if logger == nil {
		logger = slog.Default()
	}

	runPeriodic := func(initialDelay time.Duration, interval time.Duration, label string, callback func(context.Context) error) {
		timer := time.NewTimer(initialDelay)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				runCtx, cancel := context.WithTimeout(ctx, config.RunTimeout)
				err := repo.withWorkerLock(runCtx, "vimob:automation-worker:"+label, config.LockTimeout, callback)
				cancel()
				if err != nil && !errors.Is(err, context.Canceled) && !errors.Is(err, errAutomationWorkerLockBusy) {
					logger.Error("automation worker failed", "worker", label, "error", err)
				}
				timer.Reset(interval)
			}
		}
	}

	go func() {
		initialTimer := time.NewTimer(3 * time.Second)
		defer initialTimer.Stop()
		periodicTicker := time.NewTicker(config.RuntimeInterval)
		defer periodicTicker.Stop()
		manualWakeDebounce := newRuntimeWakeDebounce()
		defer manualWakeDebounce.Stop()
		retryTimer := time.NewTimer(time.Hour)
		if !retryTimer.Stop() {
			<-retryTimer.C
		}
		defer retryTimer.Stop()
		var retryC <-chan time.Time
		failureRetryDelay := automationRuntimeLockRetryDelay
		scheduleRetry := func(delay time.Duration) {
			if retryC != nil {
				return
			}
			retryTimer.Reset(delay)
			retryC = retryTimer.C
		}
		clearRetry := func() {
			if retryC == nil {
				return
			}
			if !retryTimer.Stop() {
				select {
				case <-retryTimer.C:
				default:
				}
			}
			retryC = nil
		}

		for {
			includeScheduled := false
			select {
			case <-ctx.Done():
				return
			case <-repo.runtimeWake:
				manualWakeDebounce.Arm(automationRuntimeManualWakeDebounce)
				continue
			case <-manualWakeDebounce.ch:
				manualWakeDebounce.Consume()
			case <-initialTimer.C:
				manualWakeDebounce.Cancel()
				includeScheduled = true
			case <-periodicTicker.C:
				manualWakeDebounce.Cancel()
				includeScheduled = true
			case <-retryC:
				retryC = nil
				manualWakeDebounce.Cancel()
				includeScheduled = true
			}

			runCtx, cancel := context.WithTimeout(ctx, config.RunTimeout)
			hasMore := false
			err := repo.withWorkerLock(runCtx, "vimob:automation-worker:runtime", config.LockTimeout, func(lockCtx context.Context) error {
				var drainErr error
				hasMore, drainErr = repo.processRuntime(lockCtx, includeScheduled, config.RuntimeDrainLimit)
				return drainErr
			})
			cancel()

			switch {
			case errors.Is(err, errAutomationWorkerLockBusy):
				scheduleRetry(automationRuntimeLockRetryDelay)
			case errors.Is(err, context.DeadlineExceeded):
				scheduleRetry(automationRuntimeLockRetryDelay)
			case err != nil && !errors.Is(err, context.Canceled):
				logger.Error("automation worker failed", "worker", "runtime", "error", err)
				scheduleRetry(failureRetryDelay)
				failureRetryDelay = min(failureRetryDelay*2, automationRuntimeFailureRetryMaxDelay)
			case hasMore:
				clearRetry()
				failureRetryDelay = automationRuntimeLockRetryDelay
				scheduleRetry(0)
			case err == nil:
				clearRetry()
				failureRetryDelay = automationRuntimeLockRetryDelay
			}
		}
	}()
	go runPeriodic(20*time.Second, config.InactivityInterval, "inactivity", repo.ProcessInactivityOnce)
}

// ProcessRuntimeOnce is exported to make local smoke tests and operational
// probes deterministic without starting a background goroutine.
func (repo Repository) ProcessRuntimeOnce(ctx context.Context) error {
	if repo.db != nil && repo.db.Pool() != nil {
		hasWork, err := repo.hasRuntimeWork(ctx)
		if err != nil || !hasWork {
			return err
		}
	}
	return repo.invokeRuntimeBatch(ctx)
}

func (repo Repository) invokeRuntimeBatch(ctx context.Context) error {
	return repo.functions.invoke(ctx, "automation-runner", map[string]any{
		"event_batch_size":     25,
		"execution_batch_size": 5,
		"delay_batch_size":     25,
		"run_inactivity":       false,
	})
}

func (repo Repository) processRuntime(ctx context.Context, includeScheduled bool, batchLimit int) (bool, error) {
	if batchLimit <= 0 {
		return repo.hasImmediateRuntimeWork(ctx)
	}

	if includeScheduled {
		hasWork, err := repo.hasRuntimeWork(ctx)
		if err != nil || !hasWork {
			return false, err
		}
		if err := repo.invokeRuntimeBatch(ctx); err != nil {
			return true, err
		}
		batchLimit--
	}

	return drainRuntimeBatches(
		ctx,
		batchLimit,
		repo.hasImmediateRuntimeWork,
		repo.invokeRuntimeBatch,
	)
}

func drainRuntimeBatches(
	ctx context.Context,
	batchLimit int,
	hasWork func(context.Context) (bool, error),
	runBatch func(context.Context) error,
) (bool, error) {
	for batch := 0; batch < batchLimit; batch++ {
		if err := ctx.Err(); err != nil {
			return true, err
		}
		pending, err := hasWork(ctx)
		if err != nil || !pending {
			return false, err
		}
		if err := runBatch(ctx); err != nil {
			return true, err
		}
	}

	return hasWork(ctx)
}

// ProcessInactivityOnce is kept on a slower, isolated wake-up so a large lead
// scan can never delay message events, due delays, or execution claims.
func (repo Repository) ProcessInactivityOnce(ctx context.Context) error {
	if repo.db != nil && repo.db.Pool() != nil {
		hasWork, err := repo.hasInactivityWork(ctx)
		if err != nil || !hasWork {
			return err
		}
	}
	return repo.functions.invoke(ctx, "automation-inactivity", map[string]any{
		"batch_size": 100,
	})
}

func (repo Repository) withWorkerLock(ctx context.Context, lockName string, lockTimeout time.Duration, callback func(context.Context) error) error {
	if repo.db == nil || repo.db.Pool() == nil {
		return errors.New("postgres pool is not initialized")
	}

	lockCtx, cancel := context.WithTimeout(ctx, lockTimeout)
	conn, err := repo.db.Pool().Acquire(lockCtx)
	cancel()
	if err != nil {
		return err
	}
	defer conn.Release()

	tx, err := conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())

	locked := false
	lockCtx, cancel = context.WithTimeout(ctx, lockTimeout)
	err = tx.QueryRow(lockCtx, `
		select pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended($1, 0))
	`, lockName).Scan(&locked)
	cancel()
	if err != nil || !locked {
		if err == nil {
			return errAutomationWorkerLockBusy
		}
		return err
	}

	return callback(ctx)
}

func (repo Repository) hasRuntimeWork(ctx context.Context) (bool, error) {
	var hasWork bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.automation_event_outbox o
			where o.attempts < o.max_attempts
			  and o.available_at <= now()
			  and (
			    o.status in ('pending', 'failed')
			    or (o.status = 'processing' and o.locked_at < now() - interval '5 minutes')
			  )
			limit 1
		) or exists (
			select 1
			from public.automation_executions e
			where (
			    e.status = 'queued'
			    or (e.status = 'running' and e.locked_at < now() - interval '15 minutes')
			    or (e.status = 'waiting' and e.next_execution_at <= now())
			  )
			limit 1
		) or exists (
			select 1
			from public.automations a
			join public.automation_flow_versions fv on fv.id = a.active_flow_version_id
			join public.organization_modules om
			  on om.organization_id = a.organization_id
			 and lower(trim(om.module_name)) = 'automations'
			 and coalesce(om.is_enabled, false) = true
			where a.is_active = true
			  and a.deleted_at is null
			  and fv.trigger_type = 'scheduled'
			  and fv.requires_review = false
			limit 1
		)
	`).Scan(&hasWork)
	return hasWork, err
}

func (repo Repository) hasImmediateRuntimeWork(ctx context.Context) (bool, error) {
	if repo.db == nil || repo.db.Pool() == nil {
		return true, nil
	}

	var hasWork bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.automation_event_outbox o
			where o.attempts < o.max_attempts
			  and o.available_at <= now()
			  and (
			    o.status in ('pending', 'failed')
			    or (o.status = 'processing' and o.locked_at < now() - interval '5 minutes')
			  )
			limit 1
		) or exists (
			select 1
			from public.automation_executions e
			where (
			    e.status = 'queued'
			    or (e.status = 'running' and e.locked_at < now() - interval '15 minutes')
			    or (e.status = 'waiting' and e.next_execution_at <= now())
			  )
			limit 1
		)
	`).Scan(&hasWork)
	return hasWork, err
}

func (repo Repository) hasInactivityWork(ctx context.Context) (bool, error) {
	var hasWork bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.automations a
			join public.automation_flow_versions fv on fv.id = a.active_flow_version_id
			join public.organization_modules om
			  on om.organization_id = a.organization_id
			 and lower(trim(om.module_name)) = 'automations'
			 and coalesce(om.is_enabled, false) = true
			where a.is_active = true
			  and a.deleted_at is null
			  and fv.trigger_type = 'inactivity'
			  and fv.requires_review = false
			  and coalesce(fv.trigger_config->>'inactivity_value', '') ~ '^[0-9]+$'
			  and fv.trigger_config->>'inactivity_unit' in ('hours', 'days')
			limit 1
		)
	`).Scan(&hasWork)
	return hasWork, err
}
