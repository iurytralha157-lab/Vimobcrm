package app

import (
	"context"
	"testing"
	"time"
)

func TestAppCloseStopsClaimsAndWaitsForWhatsAppQueues(t *testing.T) {
	for _, queue := range []string{"outbox", "webhook"} {
		t.Run(queue, func(t *testing.T) {
			queueCtx, stopQueues := context.WithCancel(context.Background())
			defer stopQueues()
			outboxDone := make(chan struct{})
			webhookDone := make(chan struct{})
			var finishing chan struct{}
			if queue == "outbox" {
				close(webhookDone)
				finishing = outboxDone
			} else {
				close(outboxDone)
				finishing = webhookDone
			}

			application := &App{
				whatsappQueueCancel: stopQueues,
				whatsappOutboxDone:  outboxDone,
				whatsappWebhookDone: webhookDone,
			}
			closed := make(chan struct{})
			go func() {
				application.Close()
				close(closed)
			}()
			select {
			case <-queueCtx.Done():
			case <-time.After(2 * time.Second):
				t.Error("app did not stop WhatsApp claims")
			}
			select {
			case <-closed:
				t.Error("app closed before the WhatsApp queue finished")
			default:
			}
			close(finishing)
			select {
			case <-closed:
			case <-time.After(2 * time.Second):
				t.Fatal("app did not close after the WhatsApp queue finished")
			}
		})
	}
}
