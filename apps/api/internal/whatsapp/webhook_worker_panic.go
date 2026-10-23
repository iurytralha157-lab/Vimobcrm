package whatsapp

import (
	"context"
	"errors"
)

var errEvolutionWebhookWorkerPanic = errors.New("WhatsApp webhook processor panicked")
var errEvolutionWebhookPanicRelease = errors.New("WhatsApp webhook panic lease release panicked")

// A decoder panic must relinquish its slot without exposing the recovered
// value or inventing completion. markFailed remains the existing fenced SQL
// transition; an active Edge invocation or a stale epoch cannot be released.
func runEvolutionWebhookWithPanicRecovery(
	parent context.Context,
	process func() error,
	markFailed func(context.Context, error) error,
) (err error) {
	defer func() {
		if recover() == nil {
			return
		}
		err = errEvolutionWebhookWorkerPanic
		if markFailed == nil {
			return
		}
		completionCtx, cancel := webhookCompletionContext(parent)
		defer cancel()
		if releaseErr := releaseEvolutionWebhookAfterPanic(completionCtx, markFailed); releaseErr != nil {
			err = errors.Join(err, releaseErr)
		}
	}()
	return process()
}

func releaseEvolutionWebhookAfterPanic(ctx context.Context, markFailed func(context.Context, error) error) (err error) {
	defer func() {
		if recover() != nil {
			// Leave the durable lease for recovery when its release itself failed.
			// A second panic cannot crash the worker or disclose its payload.
			err = errEvolutionWebhookPanicRelease
		}
	}()
	return markFailed(ctx, errEvolutionWebhookWorkerPanic)
}
