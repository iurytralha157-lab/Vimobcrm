package leads

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestRedistributionRetriesOnlyRolledBackPostgresTransactions(t *testing.T) {
	for _, code := range []string{"40001", "40P01"} {
		t.Run(code, func(t *testing.T) {
			attempts := 0
			err := retryRedistributionTransaction(context.Background(), func() error {
				attempts++
				if attempts == 1 {
					return fmt.Errorf("statement failed: %w", &pgconn.PgError{Code: code})
				}
				return nil
			})
			if err != nil || attempts != 2 {
				t.Fatalf("attempts=%d err=%v", attempts, err)
			}
		})
	}
	for _, failure := range []error{errors.New("commit outcome unknown"), &pgconn.PgError{Code: "23514"}, &pgconn.PgError{Code: "55P03"}} {
		attempts := 0
		err := retryRedistributionTransaction(context.Background(), func() error { attempts++; return failure })
		if err != failure || attempts != 1 {
			t.Fatalf("non-retryable error retried: attempts=%d err=%v", attempts, err)
		}
	}
}

func TestRedistributionTransactionRetriesAreBounded(t *testing.T) {
	failure := &pgconn.PgError{Code: "40001"}
	attempts := 0
	err := retryRedistributionTransaction(context.Background(), func() error { attempts++; return failure })
	if err != failure || attempts != redistributionTransactionAttempts {
		t.Fatalf("attempts=%d err=%v", attempts, err)
	}
}

func TestRedistributionRetryHonorsCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	attempts := 0
	err := retryRedistributionTransaction(ctx, func() error {
		attempts++
		cancel()
		return &pgconn.PgError{Code: "40P01"}
	})
	if !errors.Is(err, context.Canceled) || attempts != 1 {
		t.Fatalf("attempts=%d err=%v", attempts, err)
	}
}
