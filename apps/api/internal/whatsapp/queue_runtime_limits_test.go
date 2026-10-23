package whatsapp

import (
	"context"
	"errors"
	"testing"
	"testing/synctest"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestMediaWorkerAttemptCannotKeepRenewingForever(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		parent, stop := context.WithCancel(context.Background())
		defer stop()
		watchdog := time.AfterFunc(3*time.Minute, stop)
		defer watchdog.Stop()
		started := time.Now()
		processErr, leaseErr := superviseWhatsAppMediaLease(parent, time.Second,
			func(context.Context) (bool, error) { return true, nil },
			func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() })
		if !errors.Is(processErr, context.DeadlineExceeded) || leaseErr != nil {
			t.Fatalf("attempt was not bounded independently of the service: process=%v lease=%v", processErr, leaseErr)
		}
		if elapsed := time.Since(started); elapsed > 2*time.Minute {
			t.Fatalf("renewed lease kept its worker slot for %v", elapsed)
		}
	})
}

func TestMediaWorkerHeartbeatCannotHoldTheExecutorForever(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		parent, stop := context.WithCancel(context.Background())
		defer stop()
		watchdog := time.AfterFunc(3*time.Minute, stop)
		defer watchdog.Stop()
		started := time.Now()
		processErr, leaseErr := superviseWhatsAppMediaLease(parent, time.Second,
			func(ctx context.Context) (bool, error) { <-ctx.Done(); return false, ctx.Err() },
			func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() })
		if !errors.Is(processErr, context.Canceled) || !errors.Is(leaseErr, context.DeadlineExceeded) {
			t.Fatalf("blocked heartbeat did not cancel its job: process=%v lease=%v", processErr, leaseErr)
		}
		if elapsed := time.Since(started); elapsed > 6*time.Second {
			t.Fatalf("blocked heartbeat occupied its executor for %v", elapsed)
		}
	})
}

func TestMediaWorkerCompletionWinsItsOwnHeartbeatCancellation(t *testing.T) {
	for _, test := range []struct {
		name   string
		result error
	}{{"completed", nil}, {"finalization-pending", errWhatsAppMediaLocalFinalizePending}, {"local-stage-pending", errWhatsAppMediaLocalStagePending}} {
		t.Run(test.name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				renewStarted := make(chan struct{})
				processErr, leaseErr := superviseWhatsAppMediaLease(context.Background(), time.Second,
					func(ctx context.Context) (bool, error) {
						close(renewStarted)
						<-ctx.Done()
						return false, ctx.Err()
					},
					func(context.Context) error { <-renewStarted; return test.result })
				if processErr != test.result || leaseErr != nil {
					t.Fatalf("completed local stage was misclassified as a lease failure: process=%v lease=%v", processErr, leaseErr)
				}
			})
		})
	}
}

func TestMediaWorkerRealHeartbeatFailureStillCancelsTheStage(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		want := errors.New("synthetic lease query failed before local completion")
		processErr, leaseErr := superviseWhatsAppMediaLease(context.Background(), time.Second,
			func(context.Context) (bool, error) { return false, want },
			func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() })
		if !errors.Is(processErr, context.Canceled) || !errors.Is(leaseErr, want) {
			t.Fatalf("real heartbeat failure was hidden by stage completion: process=%v lease=%v", processErr, leaseErr)
		}
	})
}

func TestMediaWorkerCompletionDoesNotHideConfirmedLeaseLoss(t *testing.T) {
	for _, renewalError := range []error{nil, errors.New("synthetic independent renewal error"), context.DeadlineExceeded} {
		synctest.Test(t, func(t *testing.T) {
			renewStarted := make(chan struct{})
			processErr, leaseErr := superviseWhatsAppMediaLease(context.Background(), time.Second,
				func(ctx context.Context) (bool, error) {
					close(renewStarted)
					<-ctx.Done()
					return false, renewalError
				}, func(context.Context) error { <-renewStarted; return errWhatsAppMediaLocalFinalizePending })
			want := renewalError
			if want == nil {
				want = errWhatsAppMediaLeaseLost
			}
			if processErr != errWhatsAppMediaLocalFinalizePending || !errors.Is(leaseErr, want) {
				t.Fatalf("completion hid a confirmed lease loss: process=%v lease=%v", processErr, leaseErr)
			}
		})
	}
}

func TestQueueTransactionDeadlineIncludesPoolAcquisition(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		started := time.Now()
		ctx, tx, release, err := beginWhatsAppQueueTransaction(context.Background(), func(ctx context.Context) (pgx.Tx, error) {
			<-ctx.Done()
			return nil, ctx.Err()
		})
		if !errors.Is(err, context.DeadlineExceeded) || ctx != nil || tx != nil || release != nil || time.Since(started) != 20*time.Second {
			t.Fatalf("pool wait escaped its phase budget: %v / %v", err, time.Since(started))
		}
	})
}

func TestQueueTransactionPhaseRetainsEarlierParentDeadline(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		parent, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		started := time.Now()
		_, _, _, err := beginWhatsAppQueueTransaction(parent, func(ctx context.Context) (pgx.Tx, error) {
			<-ctx.Done()
			return nil, ctx.Err()
		})
		if !errors.Is(err, context.DeadlineExceeded) || time.Since(started) != time.Second {
			t.Fatalf("database phase extended its caller's budget: %v", err)
		}
	})
}

func TestQueueTransactionInstallsLimitsAndReleasesItsContext(t *testing.T) {
	tx := &queueLimitTestTx{exec: func(ctx context.Context, sql string) error {
		if sql != "set local lock_timeout = '2s'; set local statement_timeout = '20s'" {
			t.Fatalf("transaction omitted its lock/query limits: %q", sql)
		}
		deadline, ok := ctx.Deadline()
		if !ok || time.Until(deadline) > 20*time.Second {
			t.Fatal("SQL setup has no bounded context")
		}
		return nil
	}}
	ctx, got, release, err := beginWhatsAppQueueTransaction(context.Background(), func(context.Context) (pgx.Tx, error) { return tx, nil })
	if err != nil || got != tx || ctx.Err() != nil {
		t.Fatalf("valid transaction did not begin: %v", err)
	}
	release()
	if ctx.Err() != context.Canceled || tx.rollbacks != 1 {
		t.Fatal("release did not close the transaction and its deadline")
	}
}

func TestQueueRollbackSurvivesCanceledParentAndIsBounded(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		parent, cancel := context.WithCancel(context.Background())
		tx := &queueLimitTestTx{rollback: func(ctx context.Context) error {
			if ctx.Err() != nil {
				t.Fatal("rollback inherited cancellation")
			}
			<-ctx.Done()
			return ctx.Err()
		}}
		_, _, release, err := beginWhatsAppQueueTransaction(parent, func(context.Context) (pgx.Tx, error) { return tx, nil })
		if err != nil {
			t.Fatal(err)
		}
		cancel()
		started := time.Now()
		release()
		if elapsed := time.Since(started); elapsed > 2*time.Second || tx.rollbacks != 1 {
			t.Fatalf("rollback occupied worker indefinitely: %v / %d", elapsed, tx.rollbacks)
		}
	})
}

func TestQueueSetupFailureRollsBackBeforeReturning(t *testing.T) {
	want := errors.New("synthetic setup error")
	tx := &queueLimitTestTx{exec: func(context.Context, string) error { return want }}
	ctx, got, release, err := beginWhatsAppQueueTransaction(context.Background(), func(context.Context) (pgx.Tx, error) { return tx, nil })
	if !errors.Is(err, want) || ctx != nil || got != nil || release != nil || tx.rollbacks != 1 {
		t.Fatal("failed limit setup leaked a transaction")
	}
}

func TestQueueCompletionRemainsBoundedAfterShutdown(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		type key struct{}
		parent, cancel := context.WithCancel(context.WithValue(context.Background(), key{}, "synthetic-owner"))
		cancel()
		ctx, release := whatsappQueueCompletionContext(parent)
		defer release()
		if ctx.Err() != nil || ctx.Value(key{}) != "synthetic-owner" {
			t.Fatal("completion lost its ownership context or inherited shutdown")
		}
		started := time.Now()
		<-ctx.Done()
		if ctx.Err() != context.DeadlineExceeded || time.Since(started) != 5*time.Second {
			t.Fatal("completion escaped its five second budget")
		}
	})
}

func TestQueueTimeoutClassificationDoesNotRetryArbitraryDatabaseErrors(t *testing.T) {
	for _, err := range []error{context.Canceled, context.DeadlineExceeded, &pgconn.PgError{Code: "55P03"}, &pgconn.PgError{Code: "57014"}} {
		if !whatsappQueueOperationTimedOut(errors.Join(errors.New("synthetic operation"), err)) {
			t.Fatalf("timeout was not recognized: %v", err)
		}
	}
	for _, err := range []error{nil, errors.New("unknown failure"), &pgconn.PgError{Code: "23505"}, errWhatsAppOutboxLeaseLost} {
		if whatsappQueueOperationTimedOut(err) {
			t.Fatalf("unrelated error was released as timeout: %v", err)
		}
	}
}

type queueLimitTestTx struct {
	pgx.Tx
	exec      func(context.Context, string) error
	rollback  func(context.Context) error
	rollbacks int
}

func (tx *queueLimitTestTx) Exec(ctx context.Context, sql string, _ ...any) (pgconn.CommandTag, error) {
	if tx.exec != nil {
		return pgconn.CommandTag{}, tx.exec(ctx, sql)
	}
	return pgconn.CommandTag{}, nil
}

func (tx *queueLimitTestTx) Conn() *pgx.Conn { return nil }

func (tx *queueLimitTestTx) Rollback(ctx context.Context) error {
	tx.rollbacks++
	if tx.rollback != nil {
		return tx.rollback(ctx)
	}
	return nil
}
