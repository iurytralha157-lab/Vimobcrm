package meta

import (
	"context"
	"errors"
	"log/slog"
	"time"
)

const (
	metaWebhookWorkerInterval               = 15 * time.Second
	metaWebhookWorkerBatch                  = 10
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
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				if err := handler.ProcessPendingWebhookEvents(ctx); err != nil && !errors.Is(err, context.Canceled) {
					logger.Error("meta webhook worker failed", "error", err)
				}
				timer.Reset(metaWebhookWorkerInterval)
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
	jobs, err := handler.repo.ClaimPendingWebhookEvents(ctx, metaWebhookWorkerBatch, webhookEventLease)
	if err != nil {
		return err
	}

	for _, job := range jobs {
		processCtx, cancel := context.WithTimeout(ctx, webhookProcessTimeout)
		response, err := handler.repo.ProcessWebhookPayload(processCtx, job.ID, job.Payload)
		cancel()
		if err != nil {
			_ = handler.repo.FinishWebhookEvent(context.Background(), job.ID, "", "failed", err.Error())
			continue
		}
		handler.publishWebhookResults(response)
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
