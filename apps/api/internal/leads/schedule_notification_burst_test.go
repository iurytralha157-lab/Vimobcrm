package leads

import (
	"context"
	"errors"
	"testing"
)

func TestScheduleNotificationBurstDrainsThousandsWithoutOnePollingIntervalPerBatch(t *testing.T) {
	remaining := int64(6_000)
	calls := 0
	total, err := runScheduleNotificationBurst(context.Background(), func(context.Context) (int64, error) {
		calls++
		count := min(remaining, int64(scheduleNotificationEnqueueLimit))
		remaining -= count
		return count, nil
	})
	if err != nil || total != 6_000 || remaining != 0 || calls != 121 {
		t.Fatalf("drain = total %d remaining %d calls %d err %v", total, remaining, calls, err)
	}
}

func TestScheduleNotificationBurstBoundsWorkAndPreservesCommittedProgressOnFailure(t *testing.T) {
	calls := 0
	total, err := runScheduleNotificationBurst(context.Background(), func(context.Context) (int64, error) {
		calls++
		return scheduleNotificationEnqueueLimit, nil
	})
	if err != nil || calls != scheduleNotificationBurstBatches || total != int64(scheduleNotificationBurstBatches*scheduleNotificationEnqueueLimit) {
		t.Fatalf("unbounded or lost drain: %d %d %v", calls, total, err)
	}
	failure := errors.New("synthetic database failure")
	calls = 0
	total, err = runScheduleNotificationBurst(context.Background(), func(context.Context) (int64, error) {
		calls++
		if calls == 3 {
			return 0, failure
		}
		return scheduleNotificationEnqueueLimit, nil
	})
	if !errors.Is(err, failure) || total != 100 {
		t.Fatalf("committed progress = %d error %v", total, err)
	}
}

func TestScheduleNotificationBurstHonorsCancellationWithoutEnqueueing(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	total, err := runScheduleNotificationBurst(ctx, func(context.Context) (int64, error) {
		t.Fatal("cancelled producer must not enqueue")
		return 0, nil
	})
	if total != 0 || !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel = %d %v", total, err)
	}
}
