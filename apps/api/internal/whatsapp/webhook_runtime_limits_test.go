package whatsapp

import (
	"context"
	"testing"
	"time"
)

func TestWebhookCompletionRetainsBoundAfterJobOrShutdownCancellation(t *testing.T) {
	parent, cancel := context.WithCancel(context.Background())
	cancel()
	completion, release := webhookCompletionContext(parent)
	defer release()
	if completion.Err() != nil {
		t.Fatal("canceled server/job context prevented durable lease release")
	}
	deadline, ok := completion.Deadline()
	if !ok || time.Until(deadline) > webhookCompletionTimeout || time.Until(deadline) < 4*time.Second {
		t.Fatalf("completion context is not bounded to its independent5s budget: %v/%v", deadline, ok)
	}
	if nativeWebhookItemTimeout >= 5*time.Minute || webhookRecoveryTimeout >= nativeWebhookItemTimeout {
		t.Fatal("Native/recovery budget exceeds the durable stale-lease boundary")
	}
}
