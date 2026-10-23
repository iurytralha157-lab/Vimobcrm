package stageconfig

import (
	"context"
	"testing"
	"time"
)

func TestStageInactivityWorkerRequiresOptIn(t *testing.T) {
	// A zero repository has no database; the disabled worker must not touch it.
	done := (Repository{}).StartStageInactivityWorker(t.Context(), nil, StageInactivityWorkerConfig{})
	select {
	case <-done:
	default:
		t.Fatal("disabled worker did not finish immediately")
	}
}

func TestStageInactivityWorkerStopsBeforeInitialWork(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	done := (Repository{}).StartStageInactivityWorker(ctx, nil, StageInactivityWorkerConfig{Enabled: true})
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("cancelled worker did not signal shutdown")
	}
}

func TestStageInactivityCycleRecoversPanic(t *testing.T) {
	// The nil database deliberately panics before a transaction is available.
	// Recovery must also protect initialization, not only the claimed-job loop.
	if _, err := (Repository{}).ProcessStageInactivityOnce(t.Context()); err == nil {
		t.Fatal("unexpected initialization panic was not converted to a cycle error")
	}
}
