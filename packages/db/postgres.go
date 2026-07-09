package db

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Config struct {
	URL                  string
	MaxConns             int32
	MinConns             int32
	MaxConnLifetime      time.Duration
	MaxConnIdleTime      time.Duration
	HealthTimeout        time.Duration
	StartupRetryTimeout  time.Duration
	StartupRetryInterval time.Duration
}

type Postgres struct {
	pool *pgxpool.Pool
}

func NewPostgres(ctx context.Context, cfg Config) (*Postgres, error) {
	if cfg.URL == "" {
		return nil, errors.New("database url is required")
	}

	poolConfig, err := pgxpool.ParseConfig(cfg.URL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse database url: %w", err)
	}

	if cfg.MaxConns > 0 {
		poolConfig.MaxConns = cfg.MaxConns
	}
	if cfg.MinConns > 0 {
		poolConfig.MinConns = cfg.MinConns
	}
	if cfg.MaxConnLifetime > 0 {
		poolConfig.MaxConnLifetime = cfg.MaxConnLifetime
	}
	if cfg.MaxConnIdleTime > 0 {
		poolConfig.MaxConnIdleTime = cfg.MaxConnIdleTime
	}
	poolConfig.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create postgres pool: %w", err)
	}

	postgres := &Postgres{pool: pool}

	pingCtx := ctx
	cancel := func() {}
	if cfg.HealthTimeout > 0 {
		pingCtx, cancel = context.WithTimeout(ctx, cfg.HealthTimeout)
	}
	defer cancel()

	if err := postgres.Ping(pingCtx); err != nil {
		if cfg.StartupRetryTimeout > 0 && isRetriableStartupPingError(err) {
			if retryErr := retryStartupPing(ctx, postgres, cfg); retryErr == nil {
				return postgres, nil
			} else {
				err = retryErr
			}
		}

		pool.Close()
		return nil, fmt.Errorf("failed to ping postgres: %w", err)
	}

	return postgres, nil
}

func retryStartupPing(ctx context.Context, postgres *Postgres, cfg Config) error {
	deadline := time.Now().Add(cfg.StartupRetryTimeout)
	interval := cfg.StartupRetryInterval
	if interval <= 0 {
		interval = 5 * time.Second
	}

	var lastErr error
	for {
		if remaining := time.Until(deadline); remaining <= 0 {
			if lastErr != nil {
				return lastErr
			}
			return context.DeadlineExceeded
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(interval):
		}

		pingTimeout := cfg.HealthTimeout
		if pingTimeout <= 0 {
			pingTimeout = 3 * time.Second
		}
		if remaining := time.Until(deadline); remaining > 0 && remaining < pingTimeout {
			pingTimeout = remaining
		}

		pingCtx, cancel := context.WithTimeout(ctx, pingTimeout)
		err := postgres.Ping(pingCtx)
		cancel()
		if err == nil {
			return nil
		}
		if !isRetriableStartupPingError(err) {
			return err
		}
		lastErr = err
	}
}

func isRetriableStartupPingError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}

	message := strings.ToLower(err.Error())
	return strings.Contains(message, "ecircuitbreaker") ||
		strings.Contains(message, "temporarily blocked") ||
		strings.Contains(message, "connection refused") ||
		strings.Contains(message, "connection reset") ||
		strings.Contains(message, "connection timed out") ||
		strings.Contains(message, "timeout") ||
		strings.Contains(message, "deadline exceeded") ||
		strings.Contains(message, "server closed the connection")
}

func (postgres *Postgres) Pool() *pgxpool.Pool {
	return postgres.pool
}

func (postgres *Postgres) Ping(ctx context.Context) error {
	if postgres == nil || postgres.pool == nil {
		return errors.New("postgres pool is not initialized")
	}

	return postgres.pool.Ping(ctx)
}

func (postgres *Postgres) Close() {
	if postgres != nil && postgres.pool != nil {
		postgres.pool.Close()
	}
}
