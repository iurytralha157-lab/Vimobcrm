package db

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestConfigureReadOnlySessionsIsExplicitAndFailClosed(t *testing.T) {
	t.Parallel()

	readWriteConfig, err := pgxpool.ParseConfig("postgres://test:test@127.0.0.1:5432/test?sslmode=disable")
	if err != nil {
		t.Fatalf("parse read-write pool config: %v", err)
	}
	configureReadOnlySessions(readWriteConfig, false)
	if readWriteConfig.AfterConnect != nil {
		t.Fatal("read-write pool must remain unchanged when read-only mode is disabled")
	}

	readOnlyConfig, err := pgxpool.ParseConfig("postgres://test:test@127.0.0.1:5432/test?sslmode=disable")
	if err != nil {
		t.Fatalf("parse read-only pool config: %v", err)
	}
	configureReadOnlySessions(readOnlyConfig, true)
	if readOnlyConfig.AfterConnect == nil {
		t.Fatal("read-only pool must enforce the session guard on every connection")
	}
}

func TestIsRetriableStartupPingError(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		err       error
		retriable bool
	}{
		{
			name:      "supabase session pool exhausted",
			err:       errors.New("FATAL: (EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 20 (SQLSTATE XX000)"),
			retriable: true,
		},
		{
			name:      "temporary connection reset",
			err:       errors.New("connection reset by peer"),
			retriable: true,
		},
		{
			name:      "invalid credentials",
			err:       errors.New("password authentication failed"),
			retriable: false,
		},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := isRetriableStartupPingError(test.err); got != test.retriable {
				t.Fatalf("isRetriableStartupPingError() = %v, want %v", got, test.retriable)
			}
		})
	}
}
