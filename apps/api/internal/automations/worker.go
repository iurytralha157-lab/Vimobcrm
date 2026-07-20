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
)

type WorkerConfig struct {
	Enabled            bool
	RuntimeInterval    time.Duration
	InactivityInterval time.Duration
	RunTimeout         time.Duration
	LockTimeout        time.Duration
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
	return config
}

// StartRuntimeWorker starts the backend-owned automation coordinator. The Edge
// Functions perform bounded queue claims; this loop only provides the wake-up
// signal after taking a short database advisory lock so multiple API replicas
// do not stampede the Supabase Functions.
func (repo Repository) StartRuntimeWorker(ctx context.Context, logger *slog.Logger, config WorkerConfig) {
	config = config.normalized()
	if !config.Enabled || !repo.functions.isConfigured() {
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
				runCtx, cancel := context.WithTimeout(ctx, config.RunTimeout)
				err := repo.withWorkerLock(runCtx, "vimob:automation-worker:"+label, config.LockTimeout, callback)
				cancel()
				if err != nil && !errors.Is(err, context.Canceled) {
					logger.Error("automation worker failed", "worker", label, "error", err)
				}
				timer.Reset(interval)
			}
		}
	}
	go run(3*time.Second, config.RuntimeInterval, "runtime", repo.ProcessRuntimeOnce)
	go run(20*time.Second, config.InactivityInterval, "inactivity", repo.ProcessInactivityOnce)
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
