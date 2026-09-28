package whatsapp

import (
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// These measurements are intentionally aggregate. They contain no message,
// conversation, session, tenant, or provider identifiers.
type outboxTimingStage uint8

const (
	outboxTimingQueueWait outboxTimingStage = iota
	outboxTimingPreProvider
	outboxTimingProviderCall
	outboxTimingFinalization
	outboxTimingStageCount
)

// Each percentile is an upper bucket bound, not an exact observation. The
// overflow bucket reports the observed maximum rather than understating it.
var outboxTimingBucketUpperMs = [...]uint64{
	10, 25, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 30000, 60000, 300000, 3600000,
}

type outboxTimingStageValues struct {
	count                uint64
	failures             uint64
	pendingFinalizations uint64
	unknownFinalizations uint64
	totalMs              uint64
	maxMs                uint64
	buckets              [len(outboxTimingBucketUpperMs) + 1]uint64
}

type outboxTimingMetric struct {
	mu     sync.Mutex
	stages [outboxTimingStageCount]outboxTimingStageValues
}

type outboxTimingSummary struct {
	Count                uint64 `json:"count"`
	Failures             uint64 `json:"failures"`
	PendingFinalizations uint64 `json:"pending_finalizations,omitempty"`
	UnknownFinalizations uint64 `json:"unknown_finalizations,omitempty"`
	AverageMs            uint64 `json:"average_ms"`
	P50UpperMs           uint64 `json:"p50_upper_ms"`
	P95UpperMs           uint64 `json:"p95_upper_ms"`
	MaxMs                uint64 `json:"max_ms"`
}

type outboxTimingWindow struct {
	QueueWait    outboxTimingSummary `json:"queue_wait"`
	PreProvider  outboxTimingSummary `json:"pre_provider"`
	ProviderCall outboxTimingSummary `json:"provider_call"`
	Finalization outboxTimingSummary `json:"finalization"`
}

var outboxFastTiming outboxTimingMetric
var outboxMediaTiming outboxTimingMetric

func (metric *outboxTimingMetric) record(stage outboxTimingStage, elapsed time.Duration, failed bool) {
	metric.recordWithFinalizationOutcome(stage, elapsed, failed, false, false)
}

func (metric *outboxTimingMetric) recordWithFinalizationOutcome(
	stage outboxTimingStage, elapsed time.Duration, failed, pending, unknown bool,
) {
	if stage >= outboxTimingStageCount {
		return
	}
	if elapsed < 0 {
		elapsed = 0
	}
	ms := uint64(elapsed / time.Millisecond)
	metric.mu.Lock()
	defer metric.mu.Unlock()
	values := &metric.stages[stage]
	values.count++
	values.totalMs += ms
	if failed {
		values.failures++
	}
	if stage == outboxTimingFinalization {
		if pending {
			values.pendingFinalizations++
		}
		if unknown {
			values.unknownFinalizations++
		}
	}
	if ms > values.maxMs {
		values.maxMs = ms
	}
	bucket := len(outboxTimingBucketUpperMs)
	for i, upper := range outboxTimingBucketUpperMs {
		if ms <= upper {
			bucket = i
			break
		}
	}
	values.buckets[bucket]++
}

func (metric *outboxTimingMetric) snapshotAndReset() outboxTimingWindow {
	metric.mu.Lock()
	values := metric.stages
	metric.stages = [outboxTimingStageCount]outboxTimingStageValues{}
	metric.mu.Unlock()
	return outboxTimingWindow{
		QueueWait:    values[outboxTimingQueueWait].summary(),
		PreProvider:  values[outboxTimingPreProvider].summary(),
		ProviderCall: values[outboxTimingProviderCall].summary(),
		Finalization: values[outboxTimingFinalization].summary(),
	}
}

func (values outboxTimingStageValues) summary() outboxTimingSummary {
	result := outboxTimingSummary{
		Count: values.count, Failures: values.failures, MaxMs: values.maxMs,
		PendingFinalizations: values.pendingFinalizations,
		UnknownFinalizations: values.unknownFinalizations,
	}
	if values.count == 0 {
		return result
	}
	result.AverageMs = values.totalMs / values.count
	result.P50UpperMs = values.percentileUpper(50)
	result.P95UpperMs = values.percentileUpper(95)
	return result
}

func (values outboxTimingStageValues) percentileUpper(percent uint64) uint64 {
	target := (values.count*percent + 99) / 100
	seen := uint64(0)
	for index, count := range values.buckets {
		seen += count
		if seen >= target {
			if index == len(outboxTimingBucketUpperMs) {
				return values.maxMs
			}
			return outboxTimingBucketUpperMs[index]
		}
	}
	return values.maxMs
}

func recordOutboxTiming(lane whatsappOutboxLane, stage outboxTimingStage, elapsed time.Duration, failed bool) {
	if lane == whatsappOutboxLaneMedia {
		outboxMediaTiming.record(stage, elapsed, failed)
		return
	}
	outboxFastTiming.record(stage, elapsed, failed)
}

func recordOutboxFinalizationTiming(
	lane whatsappOutboxLane, elapsed time.Duration, failed, pending, unknown bool,
) {
	if lane == whatsappOutboxLaneMedia {
		outboxMediaTiming.recordWithFinalizationOutcome(outboxTimingFinalization, elapsed, failed, pending, unknown)
		return
	}
	outboxFastTiming.recordWithFinalizationOutcome(outboxTimingFinalization, elapsed, failed, pending, unknown)
}

func snapshotOutboxTiming(lane whatsappOutboxLane) outboxTimingWindow {
	if lane == whatsappOutboxLaneMedia {
		return outboxMediaTiming.snapshotAndReset()
	}
	return outboxFastTiming.snapshotAndReset()
}

type outboxPoolCounters struct {
	acquires         int64
	acquireDuration  time.Duration
	emptyAcquires    int64
	emptyAcquireWait time.Duration
}

type outboxPoolPressure struct {
	AcquiredConns      int32  `json:"acquired_conns"`
	IdleConns          int32  `json:"idle_conns"`
	TotalConns         int32  `json:"total_conns"`
	MaxConns           int32  `json:"max_conns"`
	Acquires           int64  `json:"acquires"`
	AverageAcquireMs   uint64 `json:"average_acquire_ms"`
	EmptyAcquires      int64  `json:"empty_acquires"`
	AverageEmptyWaitMs uint64 `json:"average_empty_wait_ms"`
}

func readOutboxPoolCounters(pool *pgxpool.Pool) outboxPoolCounters {
	stat := pool.Stat()
	return outboxPoolCounters{
		acquires:         stat.AcquireCount(),
		acquireDuration:  stat.AcquireDuration(),
		emptyAcquires:    stat.EmptyAcquireCount(),
		emptyAcquireWait: stat.EmptyAcquireWaitTime(),
	}
}

func snapshotOutboxPoolPressure(pool *pgxpool.Pool, previous *outboxPoolCounters) outboxPoolPressure {
	stat := pool.Stat()
	current := outboxPoolCounters{
		acquires:         stat.AcquireCount(),
		acquireDuration:  stat.AcquireDuration(),
		emptyAcquires:    stat.EmptyAcquireCount(),
		emptyAcquireWait: stat.EmptyAcquireWaitTime(),
	}
	pressure := outboxPoolPressure{
		AcquiredConns: stat.AcquiredConns(), IdleConns: stat.IdleConns(),
		TotalConns: stat.TotalConns(), MaxConns: stat.MaxConns(),
	}
	if previous != nil {
		pressure.Acquires = current.acquires - previous.acquires
		pressure.EmptyAcquires = current.emptyAcquires - previous.emptyAcquires
		if pressure.Acquires > 0 {
			pressure.AverageAcquireMs = uint64((current.acquireDuration-previous.acquireDuration)/time.Millisecond) / uint64(pressure.Acquires)
		}
		if pressure.EmptyAcquires > 0 {
			pressure.AverageEmptyWaitMs = uint64((current.emptyAcquireWait-previous.emptyAcquireWait)/time.Millisecond) / uint64(pressure.EmptyAcquires)
		}
		*previous = current
	}
	return pressure
}
