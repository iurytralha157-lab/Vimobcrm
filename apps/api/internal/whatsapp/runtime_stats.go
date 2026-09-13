package whatsapp

import (
	"strings"
	"sync/atomic"
	"time"
)

type whatsappRuntimeCounters struct {
	providerRequests          atomic.Uint64
	providerFailures          atomic.Uint64
	providerOutcomeUnknown    atomic.Uint64
	providerInFlight          atomic.Int64
	providerLastAttemptMillis atomic.Int64
	providerLastSuccessMillis atomic.Int64
	providerLastFailureMillis atomic.Int64

	supervisorCycles             atomic.Uint64
	supervisorCycleFailures      atomic.Uint64
	supervisorSessionsObserved   atomic.Uint64
	supervisorSessionFailures    atomic.Uint64
	supervisorLastStartedMillis  atomic.Int64
	supervisorLastFinishedMillis atomic.Int64
	supervisorLastSuccessMillis  atomic.Int64
	supervisorLastFailureMillis  atomic.Int64
	supervisorLastClaimed        atomic.Int64
	supervisorLastErrors         atomic.Int64
	supervisorLeadershipMisses   atomic.Uint64
	supervisorLastStandbyMillis  atomic.Int64
}

func (stats *whatsappRuntimeCounters) providerStarted(now time.Time) {
	if stats == nil {
		return
	}
	stats.providerRequests.Add(1)
	stats.providerInFlight.Add(1)
	stats.providerLastAttemptMillis.Store(now.UTC().UnixMilli())
}

func (stats *whatsappRuntimeCounters) providerFinished(now time.Time, ok bool, outcomeUnknown bool) {
	if stats == nil {
		return
	}
	stats.providerInFlight.Add(-1)
	if ok {
		stats.providerLastSuccessMillis.Store(now.UTC().UnixMilli())
		return
	}
	stats.providerFailures.Add(1)
	stats.providerLastFailureMillis.Store(now.UTC().UnixMilli())
	if outcomeUnknown {
		stats.providerOutcomeUnknown.Add(1)
	}
}

func (stats *whatsappRuntimeCounters) providerOutcomeBecameUnknown() {
	if stats == nil {
		return
	}
	stats.providerOutcomeUnknown.Add(1)
}

func (stats *whatsappRuntimeCounters) supervisorStarted(now time.Time) {
	if stats == nil {
		return
	}
	stats.supervisorCycles.Add(1)
	stats.supervisorLastStartedMillis.Store(now.UTC().UnixMilli())
}

func (stats *whatsappRuntimeCounters) supervisorFinished(now time.Time, claimed int, failures int, cycleErr error) {
	if stats == nil {
		return
	}
	stats.supervisorLastFinishedMillis.Store(now.UTC().UnixMilli())
	stats.supervisorLastClaimed.Store(int64(claimed))
	stats.supervisorLastErrors.Store(int64(failures))
	if claimed > 0 {
		stats.supervisorSessionsObserved.Add(uint64(claimed))
	}
	if failures > 0 {
		stats.supervisorSessionFailures.Add(uint64(failures))
	}
	if cycleErr != nil || failures > 0 {
		stats.supervisorCycleFailures.Add(1)
		stats.supervisorLastFailureMillis.Store(now.UTC().UnixMilli())
		return
	}
	stats.supervisorLastSuccessMillis.Store(now.UTC().UnixMilli())
}

func (stats *whatsappRuntimeCounters) supervisorStandby(now time.Time) {
	if stats == nil {
		return
	}
	stats.supervisorLeadershipMisses.Add(1)
	stats.supervisorLastStandbyMillis.Store(now.UTC().UnixMilli())
}

func runtimeTimestamp(unixMillis int64) any {
	if unixMillis <= 0 {
		return nil
	}
	return time.UnixMilli(unixMillis).UTC()
}

func (handler Handler) RuntimeStats() map[string]any {
	config := handler.workerConfig.normalized()
	stats := handler.repo.functions.runtimeStats
	provider := map[string]any{
		"configured": strings.TrimSpace(handler.repo.functions.evolutionGoAPIURL) != "" && strings.TrimSpace(handler.repo.functions.evolutionGoAPIKey) != "",
	}
	if digest := strings.TrimSpace(handler.repo.functions.evolutionGoImageDigest); digest != "" {
		provider["imageDigest"] = digest
		provider["releaseEvidence"] = "configured_image_digest"
	} else {
		provider["imageDigest"] = nil
		provider["releaseEvidence"] = "unverified"
	}
	supervisor := map[string]any{
		"enabled":                 config.SessionSupervisorEnabled,
		"batchSize":               config.SessionSupervisorBatch,
		"concurrency":             whatsappSessionSupervisorConcurrency,
		"intervalMillis":          config.SessionSupervisorInterval.Milliseconds(),
		"probeTimeoutMillis":      whatsappSessionSupervisorProbeTimeout.Milliseconds(),
		"cycleTimeoutMillis":      whatsappSessionSupervisorCycleTimeout.Milliseconds(),
		"claimLeaseMillis":        whatsappSessionSupervisorClaimLease.Milliseconds(),
		"leadershipMode":          "postgres_advisory_lock",
		"stateStore":              "private.whatsapp_session_supervisor_state",
		"recoveryCanaryCount":     sessionIDAllowlistCount(config.SessionSupervisorRecoveryIDs),
		"recoveryGloballyEnabled": sessionIDAllowlistAllows(config.SessionSupervisorRecoveryIDs, "*"),
		"operationalStatus":       "starting",
	}
	if !config.SessionSupervisorEnabled {
		supervisor["operationalStatus"] = "disabled"
	}
	if stats == nil {
		provider["requests"] = uint64(0)
		provider["failures"] = uint64(0)
		provider["outcomeUnknown"] = uint64(0)
		provider["inFlight"] = int64(0)
		return map[string]any{"provider": provider, "sessionSupervisor": supervisor}
	}

	provider["requests"] = stats.providerRequests.Load()
	provider["failures"] = stats.providerFailures.Load()
	provider["outcomeUnknown"] = stats.providerOutcomeUnknown.Load()
	provider["inFlight"] = stats.providerInFlight.Load()
	provider["lastAttemptAt"] = runtimeTimestamp(stats.providerLastAttemptMillis.Load())
	provider["lastSuccessAt"] = runtimeTimestamp(stats.providerLastSuccessMillis.Load())
	provider["lastFailureAt"] = runtimeTimestamp(stats.providerLastFailureMillis.Load())

	lastFinishedMillis := stats.supervisorLastFinishedMillis.Load()
	lastStandbyMillis := stats.supervisorLastStandbyMillis.Load()
	supervisor["cycles"] = stats.supervisorCycles.Load()
	supervisor["cycleFailures"] = stats.supervisorCycleFailures.Load()
	supervisor["sessionsObserved"] = stats.supervisorSessionsObserved.Load()
	supervisor["sessionFailures"] = stats.supervisorSessionFailures.Load()
	supervisor["lastStartedAt"] = runtimeTimestamp(stats.supervisorLastStartedMillis.Load())
	supervisor["lastFinishedAt"] = runtimeTimestamp(lastFinishedMillis)
	supervisor["lastSuccessAt"] = runtimeTimestamp(stats.supervisorLastSuccessMillis.Load())
	supervisor["lastFailureAt"] = runtimeTimestamp(stats.supervisorLastFailureMillis.Load())
	supervisor["lastClaimed"] = stats.supervisorLastClaimed.Load()
	supervisor["lastErrors"] = stats.supervisorLastErrors.Load()
	supervisor["leadershipMisses"] = stats.supervisorLeadershipMisses.Load()
	supervisor["lastStandbyAt"] = runtimeTimestamp(lastStandbyMillis)
	if config.SessionSupervisorEnabled && lastFinishedMillis > 0 {
		staleAfter := 2 * config.SessionSupervisorInterval
		if staleAfter < 2*time.Minute {
			staleAfter = 2 * time.Minute
		}
		if time.Since(time.UnixMilli(lastFinishedMillis)) > staleAfter || stats.supervisorLastErrors.Load() > 0 {
			supervisor["operationalStatus"] = "degraded"
		} else {
			supervisor["operationalStatus"] = "ok"
		}
	}
	if config.SessionSupervisorEnabled && lastStandbyMillis > lastFinishedMillis {
		staleAfter := 2 * config.SessionSupervisorInterval
		if staleAfter < 2*time.Minute {
			staleAfter = 2 * time.Minute
		}
		if time.Since(time.UnixMilli(lastStandbyMillis)) <= staleAfter {
			supervisor["operationalStatus"] = "standby"
		}
	}

	return map[string]any{"provider": provider, "sessionSupervisor": supervisor}
}

func sessionIDAllowlistCount(allowlist []string) int {
	count := 0
	for _, value := range allowlist {
		if value = strings.TrimSpace(value); value != "" && value != "*" {
			count++
		}
	}
	return count
}
