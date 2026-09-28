package whatsapp

import (
	"sync"
	"testing"
	"time"
)

func TestOutboxTimingWindowAggregatesConcurrentWorkersAndResets(t *testing.T) {
	var metric outboxTimingMetric
	var workers sync.WaitGroup
	for range 8 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for range 50 {
				metric.record(outboxTimingProviderCall, 3200*time.Millisecond, false)
			}
		}()
	}
	workers.Wait()
	metric.record(outboxTimingProviderCall, 7*time.Second, true)
	metric.record(outboxTimingQueueWait, 15*time.Millisecond, false)

	window := metric.snapshotAndReset()
	if window.ProviderCall.Count != 401 || window.ProviderCall.Failures != 1 ||
		window.ProviderCall.P50UpperMs != 5000 || window.ProviderCall.P95UpperMs != 5000 ||
		window.ProviderCall.MaxMs != 7000 {
		t.Fatalf("provider timing summary = %+v", window.ProviderCall)
	}
	if window.QueueWait.Count != 1 || window.QueueWait.P50UpperMs != 25 {
		t.Fatalf("queue wait summary = %+v", window.QueueWait)
	}
	if reset := metric.snapshotAndReset(); reset.ProviderCall.Count != 0 || reset.QueueWait.Count != 0 {
		t.Fatalf("timing window did not reset: %+v", reset)
	}
}

func TestOutboxTimingOverflowReportsObservedMaximum(t *testing.T) {
	var metric outboxTimingMetric
	metric.record(outboxTimingQueueWait, -time.Second, false)
	metric.record(outboxTimingQueueWait, 2*time.Hour, false)
	window := metric.snapshotAndReset()
	if window.QueueWait.Count != 2 || window.QueueWait.AverageMs != 3600000 ||
		window.QueueWait.P95UpperMs != 7200000 || window.QueueWait.MaxMs != 7200000 {
		t.Fatalf("overflow timing summary = %+v", window.QueueWait)
	}
}

func TestOutboxTimingSeparatesFinalizationOutcomes(t *testing.T) {
	var metric outboxTimingMetric
	metric.recordWithFinalizationOutcome(outboxTimingFinalization, 20*time.Millisecond, false, false, false)
	metric.recordWithFinalizationOutcome(outboxTimingFinalization, 40*time.Millisecond, true, true, false)
	metric.recordWithFinalizationOutcome(outboxTimingFinalization, 60*time.Millisecond, true, false, true)
	finalization := metric.snapshotAndReset().Finalization
	if finalization.Count != 3 || finalization.Failures != 2 ||
		finalization.PendingFinalizations != 1 || finalization.UnknownFinalizations != 1 {
		t.Fatalf("finalization outcome summary = %+v", finalization)
	}
}
