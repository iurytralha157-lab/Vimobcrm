package db

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Config struct {
	URL             string
	MaxConns        int32
	MinConns        int32
	MaxConnLifetime time.Duration
	MaxConnIdleTime time.Duration
	HealthTimeout   time.Duration
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
		pool.Close()
		return nil, fmt.Errorf("failed to ping postgres: %w", err)
	}

	return postgres, nil
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
