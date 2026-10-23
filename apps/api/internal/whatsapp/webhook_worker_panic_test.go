package whatsapp

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestWebhookPanicRecoveryPreservesNormalResult(t *testing.T) {
	for _, result := range []error{nil, errors.New("synthetic processor failure")} {
		calls := 0
		got := runEvolutionWebhookWithPanicRecovery(context.Background(), func() error { return result }, func(context.Context, error) error {
			calls++
			return nil
		})
		if got != result || calls != 0 {
			t.Fatalf("normal result changed or panic transition was called: %v / %d", got, calls)
		}
	}
}

func TestWebhookPanicRecoverySanitizesValuesAndReleasesOnce(t *testing.T) {
	for _, value := range []any{"synthetic-secret-payload", errors.New("synthetic-secret-payload"), map[string]string{"token": "synthetic-secret-payload"}, nil} {
		calls := 0
		got := runEvolutionWebhookWithPanicRecovery(context.Background(), func() error { panic(value) }, func(ctx context.Context, cause error) error {
			calls++
			deadline, ok := ctx.Deadline()
			if !ok || time.Until(deadline) <= 0 || time.Until(deadline) > webhookCompletionTimeout || ctx.Err() != nil {
				t.Fatal("panic release did not receive a fresh bounded completion context")
			}
			if cause != errEvolutionWebhookWorkerPanic {
				t.Fatal("panic value reached the durable failure transition")
			}
			return nil
		})
		if !errors.Is(got, errEvolutionWebhookWorkerPanic) || strings.Contains(got.Error(), "synthetic-secret") || calls != 1 {
			t.Fatalf("unsafe panic result or duplicate release: %v / %d", got, calls)
		}
	}
}

func TestWebhookPanicRecoveryUsesCompletionContextAfterCancellation(t *testing.T) {
	type key struct{}
	parent, cancel := context.WithCancel(context.WithValue(context.Background(), key{}, "synthetic-owner"))
	cancel()
	var completion context.Context
	got := runEvolutionWebhookWithPanicRecovery(parent, func() error { panic("hidden") }, func(ctx context.Context, cause error) error {
		completion = ctx
		if ctx.Err() != nil || ctx.Value(key{}) != "synthetic-owner" || cause != errEvolutionWebhookWorkerPanic {
			t.Fatal("parent cancellation or ownership was not handled correctly")
		}
		return nil
	})
	if !errors.Is(got, errEvolutionWebhookWorkerPanic) || completion == nil || completion.Err() != context.Canceled {
		t.Fatalf("completion context was not released at return: %v / %v", got, completion)
	}
}

func TestWebhookPanicRecoveryPreservesLeaseFenceRejection(t *testing.T) {
	for _, fence := range []error{errEvolutionEdgeExecutionStillActive, errors.New("synthetic stale epoch or lease")} {
		got := runEvolutionWebhookWithPanicRecovery(context.Background(), func() error { panic("hidden") }, func(context.Context, error) error { return fence })
		if !errors.Is(got, errEvolutionWebhookWorkerPanic) || !errors.Is(got, fence) {
			t.Fatalf("failure transition rejection was hidden: %v", got)
		}
	}
}

func TestWebhookPanicRecoveryCleanupFailureCannotCrashWorker(t *testing.T) {
	got := runEvolutionWebhookWithPanicRecovery(context.Background(), func() error { panic("synthetic-sensitive-decoder") }, func(context.Context, error) error { panic("synthetic-sensitive-database") })
	if !errors.Is(got, errEvolutionWebhookWorkerPanic) || !errors.Is(got, errEvolutionWebhookPanicRelease) || strings.Contains(got.Error(), "synthetic-sensitive") {
		t.Fatalf("cleanup panic escaped or leaked its value: %v", got)
	}
	if got := runEvolutionWebhookWithPanicRecovery(context.Background(), func() error { panic("hidden") }, nil); got != errEvolutionWebhookWorkerPanic {
		t.Fatalf("optional failure callback changed safe panic result: %v", got)
	}
}
