package db

import (
	"errors"
	"testing"
)

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
