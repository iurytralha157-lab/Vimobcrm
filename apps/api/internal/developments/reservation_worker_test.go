package developments

import (
	"context"
	"testing"
)

func TestDrainDueReservationBacklogProcessesEveryBatchImmediately(t *testing.T) {
	remaining := 250
	calls := 0

	expired, err := drainDueReservationBacklog(
		context.Background(),
		100,
		func(_ context.Context, batchSize int) (int, error) {
			calls++
			if remaining < batchSize {
				result := remaining
				remaining = 0
				return result, nil
			}
			remaining -= batchSize
			return batchSize, nil
		},
	)
	if err != nil {
		t.Fatalf("drainDueReservationBacklog() returned error: %v", err)
	}
	if expired != 250 || remaining != 0 || calls != 3 {
		t.Fatalf("expired=%d remaining=%d calls=%d, want 250, 0, 3", expired, remaining, calls)
	}
}
