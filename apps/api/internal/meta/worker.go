package meta

import (
	"context"
	"errors"
	"log/slog"
	"time"
)

const (
	metaWebhookWorkerInterval = 15 * time.Second
	metaWebhookWorkerBatch    = 10
)

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

	return nil
}
