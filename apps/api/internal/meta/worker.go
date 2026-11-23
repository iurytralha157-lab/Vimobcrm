package meta

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"
)

const (
	metaWebhookWorkerInterval               = 15 * time.Second
	metaWebhookWorkerBatch                  = 10
	metaWebhookDatabaseTimeout              = 5 * time.Second
	metaWebhookSubscriptionReconcileTimeout = 30 * time.Second
)

type webhookSubscriptionReconciler interface {
	ReconcileWebhookSubscriptions(context.Context) error
}

type conversionFeedbackProcessor interface {
	ProcessConversionFeedback(context.Context, int, time.Duration) error
}

func (handler Handler) StartWebhookWorker(ctx context.Context, logger *slog.Logger) {
	if logger == nil {
		logger = slog.Default()
	}

	go func() {
		timer := time.NewTimer(10 * time.Second)
		defer timer.Stop()

		for {
			var err error
			select {
			case <-ctx.Done():
				return
			case <-handler.wake:
				err = handler.processPendingWebhookQueue(ctx)
			case <-timer.C:
				err = handler.ProcessPendingWebhookEvents(ctx)
				timer.Reset(metaWebhookWorkerInterval)
			}
			if err != nil && ctx.Err() == nil {
				if errors.Is(err, errMetaWebhookSubscriptionReconcile) {
					logger.Warn("meta webhook subscription reconciliation incomplete", "error", err)
				} else {
					logger.Error("meta webhook worker failed", "error", err)
				}
			}
		}
	}()
}

func (handler Handler) StartConversionFeedbackWorker(ctx context.Context, logger *slog.Logger) {
	settings := handler.config.normalizedConversionFeedbackWorkerSettings()
	if !settings.Enabled {
		return
	}
	processor, ok := handler.repo.(conversionFeedbackProcessor)
	if !ok {
		return
	}
	if logger == nil {
		logger = slog.Default()
	}

	go func() {
		timer := time.NewTimer(settings.Interval)
		defer timer.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				if err := processor.ProcessConversionFeedback(ctx, settings.Batch, settings.Lease); err != nil && !errors.Is(err, context.Canceled) {
					logger.Error("meta conversion feedback worker failed", "error", err)
				}
				timer.Reset(settings.Interval)
			}
		}
	}()
}

func (handler Handler) ProcessPendingWebhookEvents(ctx context.Context) error {
	if err := handler.processPendingWebhookQueue(ctx); err != nil {
		return err
	}

	if reconciler, ok := handler.repo.(webhookSubscriptionReconciler); ok {
		reconcileCtx, cancel := context.WithTimeout(ctx, metaWebhookSubscriptionReconcileTimeout)
		err := reconciler.ReconcileWebhookSubscriptions(reconcileCtx)
		cancel()
		if err != nil {
			return err
		}
	}

	return nil
}

func (handler Handler) processPendingWebhookQueue(ctx context.Context) error {
	for i := 0; i < metaWebhookWorkerBatch; i++ {
		// Reserve only when a processor is available. Rows waiting behind a
		// slow provider call must not start their lease as part of a batch.
		claimCtx, cancel := context.WithTimeout(ctx, metaWebhookDatabaseTimeout)
		job, err := handler.repo.ClaimPendingWebhookEvent(claimCtx, webhookEventLease)
		cancel()
		if err != nil || job == nil {
			return err
		}
		if err := handler.processWebhookJob(ctx, *job); err != nil {
			return err
		}
	}

	// Continue without waiting for the poll when the queue was busy.
	handler.wakeWebhookWorker()
	return nil
}

func (handler Handler) processWebhookJob(ctx context.Context, job webhookEventJob) error {
	processCtx, cancel := context.WithTimeout(ctx, webhookProcessTimeout)
	response, err := handler.repo.ProcessWebhookPayload(processCtx, job)
	cancel()
	if err == nil {
		handler.publishWebhookResults(response)
		return nil
	}
	if errors.Is(err, errWebhookClaimLost) {
		return nil
	}

	finishCtx, cancelFinish := context.WithTimeout(context.WithoutCancel(ctx), metaWebhookDatabaseTimeout)
	defer cancelFinish()
	finishErr := handler.repo.FinishWebhookEvent(finishCtx, job.Claim, "", "failed", err.Error())
	if finishErr != nil && !errors.Is(finishErr, errWebhookClaimLost) {
		return fmt.Errorf("finish failed Meta webhook event: %w", finishErr)
	}
	return nil
}
