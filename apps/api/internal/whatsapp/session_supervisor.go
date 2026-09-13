package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	whatsappWebhookSubscriptionVersion = "lead-message-events-v3-ignore-groups"
	whatsappNotificationSafeVersion    = "evolution-advanced-settings-v3-ignore-groups"
	whatsappSessionRecoveryMaxFailures = 3

	whatsappSessionSupervisorLeaderKey        = "vimob:whatsapp-session-supervisor:leader:v1"
	whatsappSessionSupervisorConcurrency      = 2
	whatsappSessionSupervisorProbeTimeout     = 10 * time.Second
	whatsappSessionSupervisorLeaderLockWait   = 2 * time.Second
	whatsappSessionSupervisorProbeLockWait    = 500 * time.Millisecond
	whatsappSessionSupervisorMinimumProbeAge  = 30 * time.Second
	whatsappSessionSupervisorCycleTimeout     = 5 * time.Minute
	whatsappSessionSupervisorClaimLease       = 6 * time.Minute
	whatsappSessionSupervisorMaxProbeBackoff  = 30 * time.Minute
	whatsappSessionSupervisorMissingBackoff   = 30 * time.Minute
	whatsappSessionSupervisorScheduleJitterPC = 20
)

// Only one supervisor cycle may own a local database connection while it holds
// the cross-replica advisory lock. The provider probes have their own bounded
// lane in session_lock.go.
var whatsappSessionSupervisorPermit = make(chan struct{}, 1)

type evolutionRecoveryOutcome uint8

const (
	evolutionRecoveryWaiting evolutionRecoveryOutcome = iota
	evolutionRecoveryAttempted
	evolutionRecoveryDeferred
	evolutionRecoveryRequiresPairing
	evolutionRecoveryProviderBlocked
)

var whatsappLiveWebhookSubscriptions = []string{
	// Keep this as an explicit live-event allowlist. ALL and HISTORY_SYNC must
	// never be subscribed here: a reconnect must not replay historical messages
	// into the realtime CRM inbox. GROUP, LABEL and CONTACT are also
	// intentionally absent and remain available through explicit,
	// tenant-authorized sync endpoints.
	"MESSAGE",
	"SEND_MESSAGE",
	"READ_RECEIPT",
	"CONNECTION",
	"QRCODE",
}

func (handler Handler) StartSessionSupervisor(ctx context.Context, logger *slog.Logger) {
	config := handler.workerConfig.normalized()
	if !config.SessionSupervisorEnabled {
		return
	}
	if logger == nil {
		logger = slog.Default()
	}

	go func() {
		scheduleSeed := createSecretToken()
		cycle := uint64(0)
		timer := time.NewTimer(jitteredSupervisorScheduleDelay(config.SessionSupervisorInitialDelay, scheduleSeed, cycle))
		defer timer.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				if err := handler.repo.superviseActiveSessionsWithLimit(ctx, logger, config.SessionSupervisorBatch, config.SessionSupervisorInterval, config.SessionSupervisorRecoveryIDs); err != nil && !errors.Is(err, context.Canceled) {
					logger.Error("whatsapp session supervisor failed", "error", err)
				}
				cycle++
				timer.Reset(jitteredSupervisorScheduleDelay(config.SessionSupervisorInterval, scheduleSeed, cycle))
			}
		}
	}()
}

func (repo Repository) superviseActiveSessions(ctx context.Context, logger *slog.Logger) error {
	return repo.superviseActiveSessionsWithLimit(
		ctx,
		logger,
		defaultWhatsAppSessionSupervisorBatch,
		defaultWhatsAppSessionSupervisorInterval,
		nil,
	)
}

func (repo Repository) superviseActiveSessionsWithLimit(ctx context.Context, logger *slog.Logger, batch int, minimumAge time.Duration, recoverySessionIDs []string) (returnErr error) {
	if logger == nil {
		logger = slog.Default()
	}
	cycleContext, cancelCycle := context.WithTimeout(ctx, whatsappSessionSupervisorCycleTimeout)
	defer cancelCycle()
	ctx = cycleContext
	unlockLeader, leader, err := repo.acquireWhatsAppSessionSupervisorLeadership(ctx)
	if err != nil {
		return err
	}
	if !leader {
		repo.functions.runtimeStats.supervisorStandby(time.Now().UTC())
		return nil
	}
	defer unlockLeader()

	startedAt := time.Now().UTC()
	claimed := 0
	sessionFailures := 0
	repo.functions.runtimeStats.supervisorStarted(startedAt)
	defer func() {
		repo.functions.runtimeStats.supervisorFinished(time.Now().UTC(), claimed, sessionFailures, returnErr)
	}()

	batch = normalizeWorkerBatch(batch, defaultWhatsAppSessionSupervisorBatch)
	if minimumAge <= 0 {
		minimumAge = defaultWhatsAppSessionSupervisorInterval
	}
	if minimumAge < whatsappSessionSupervisorMinimumProbeAge {
		minimumAge = whatsappSessionSupervisorMinimumProbeAge
	}
	claimToken := createSecretToken()
	rows, err := repo.db.Pool().Query(ctx, `
		select `+sessionSelectFields()+`
		from private.claim_whatsapp_sessions_for_supervision(
		  $1::text,
		  $2::integer,
		  $3::bigint * interval '1 millisecond',
		  $4::bigint * interval '1 millisecond'
		) claimed
		join public.whatsapp_sessions ws
		  on ws.id = claimed.session_id
		 and ws.organization_id = claimed.organization_id
		left join public.users owner on owner.id = ws.owner_user_id
		order by claimed.organization_id asc, claimed.session_id asc
	`, claimToken, batch, minimumAge.Milliseconds(), whatsappSessionSupervisorClaimLease.Milliseconds())
	if err != nil {
		return err
	}
	defer repo.releaseSessionSupervisorClaimsByTokenWithoutCancellation(ctx, claimToken)

	sessions := make([]Session, 0, batch)
	for rows.Next() {
		session, err := scanSession(rows)
		if err != nil {
			rows.Close()
			return err
		}
		sessions = append(sessions, session)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	claimed = len(sessions)

	sessionFailures = repo.superviseClaimedSessions(ctx, logger, sessions, recoverySessionIDs, claimToken)
	if err := ctx.Err(); err != nil {
		return err
	}

	return nil
}

func (repo Repository) acquireWhatsAppSessionSupervisorLeadership(ctx context.Context) (func(), bool, error) {
	lockContext, cancel := context.WithTimeout(ctx, whatsappSessionSupervisorLeaderLockWait)
	defer cancel()
	return repo.acquireWhatsAppAdvisoryLocksWithPermit(
		lockContext,
		[]string{whatsappSessionSupervisorLeaderKey},
		false,
		whatsappSessionSupervisorPermit,
	)
}

func (repo Repository) superviseClaimedSessions(
	ctx context.Context,
	logger *slog.Logger,
	sessions []Session,
	recoverySessionIDs []string,
	claimToken string,
) int {
	workerCount := supervisorWorkerCount(len(sessions))
	if workerCount == 0 {
		return 0
	}

	var next atomic.Int64
	var failures atomic.Int64
	var workers sync.WaitGroup
	workers.Add(workerCount)
	for range workerCount {
		go func() {
			defer workers.Done()
			for {
				if ctx.Err() != nil {
					return
				}
				index := int(next.Add(1) - 1)
				if index >= len(sessions) {
					return
				}
				session := sessions[index]
				if err := repo.superviseSession(ctx, session, time.Now().UTC(), recoverySessionIDs, claimToken); err != nil && !errors.Is(err, context.Canceled) {
					failures.Add(1)
					logger.Warn("whatsapp session supervision skipped", "session_id", session.ID, "error", err)
				}
			}
		}()
	}
	workers.Wait()
	return int(failures.Load())
}

func supervisorWorkerCount(sessionCount int) int {
	if sessionCount <= 0 {
		return 0
	}
	if sessionCount < whatsappSessionSupervisorConcurrency {
		return sessionCount
	}
	return whatsappSessionSupervisorConcurrency
}

func (repo Repository) superviseSession(ctx context.Context, session Session, now time.Time, recoverySessionIDs []string, claimToken string) error {
	lockContext, cancelLock := context.WithTimeout(ctx, whatsappSessionSupervisorProbeLockWait)
	unlock, locked, err := repo.acquireWhatsAppSessionProbeLock(lockContext, session.ID, false)
	cancelLock()
	if err != nil {
		repo.releaseSessionSupervisorClaimWithoutCancellation(ctx, session.ID, claimToken)
		return err
	}
	if !locked {
		repo.releaseSessionSupervisorClaimWithoutCancellation(ctx, session.ID, claimToken)
		return nil
	}
	defer unlock()

	return repo.superviseSessionLocked(ctx, session, now, recoverySessionIDs, claimToken)
}

func (repo Repository) superviseSessionLocked(ctx context.Context, session Session, now time.Time, recoverySessionIDs []string, claimToken string) error {
	currentSession, ok, err := repo.getSupervisorSession(ctx, session.OrganizationID, session.ID, claimToken)
	if err != nil {
		repo.releaseSessionSupervisorClaimWithoutCancellation(ctx, session.ID, claimToken)
		return err
	}
	if !ok {
		repo.releaseSessionSupervisorClaimWithoutCancellation(ctx, session.ID, claimToken)
		return nil
	}
	session = currentSession
	defer repo.releaseSessionSupervisorClaimWithoutCancellation(ctx, session.ID, claimToken)

	settings := ensureAutoReplyDefaults(cloneMap(session.AdvancedSettings))
	if !sessionAutoReconnectEnabled(settings) {
		return nil
	}
	settingsPatch := map[string]any{}
	settingsRemoveKeys := []string{}

	token := strings.TrimSpace(stringFromMap(settings, "token"))
	if token == "" {
		missingTokenErr := fmt.Errorf("%w: Evolution Go session token is missing", ErrProviderFailed)
		return errors.Join(
			missingTokenErr,
			repo.recordSessionProbeFailure(ctx, session, claimToken, missingTokenErr, whatsappSessionSupervisorMissingBackoff),
			repo.blockSessionRecovery(ctx, session.OrganizationID, session.ID, "provider_credentials_missing"),
		)
	}
	webhookToken := strings.TrimSpace(stringFromMap(settings, "webhook_token"))
	if webhookToken == "" {
		webhookToken = createSecretToken()
		settings["webhook_token"] = webhookToken
		// Persist this with the rest of the supervisor patch. An eager write here
		// would change updated_at between the status request and its compare-and-
		// swap, defeating the stale-observation fence below.
		settingsPatch["webhook_token"] = webhookToken
	}

	instanceKey := sessionEvolutionInstanceKey(session, settings)
	if instanceKey == "" {
		missingIdentityErr := fmt.Errorf("%w: Evolution Go instance identity is missing", ErrProviderFailed)
		return errors.Join(
			missingIdentityErr,
			repo.recordSessionProbeFailure(ctx, session, claimToken, missingIdentityErr, whatsappSessionSupervisorMissingBackoff),
			repo.blockSessionRecovery(ctx, session.OrganizationID, session.ID, "provider_identity_missing"),
		)
	}

	statusResult, err := repo.invokeEvolutionSupervisorRead(ctx, "instance.status", map[string]any{
		"session_id":  session.ID,
		"instance_id": instanceKey,
		"token":       token,
	})
	if err != nil {
		return errors.Join(err, repo.recordSessionProbeFailure(ctx, session, claimToken, err, 0))
	}
	observedStatus, authoritative, instanceMissing := evolutionConnectionObservation(statusResult)
	if !authoritative {
		observationErr := fmt.Errorf("%w: Evolution Go connection status is unavailable", ErrProviderOutcomeUnknown)
		return errors.Join(observationErr, repo.recordSessionProbeFailure(ctx, session, claimToken, observationErr, 0))
	}
	applied, err := repo.updateSessionStatusFromProviderIfCurrent(ctx, session, observedStatus, statusResult, claimToken, !instanceMissing)
	if err != nil {
		return err
	}
	if !applied {
		// A webhook or another database actor changed the row after the probe
		// started. Its newer state wins; never write or recover from this stale
		// provider observation.
		return nil
	}
	if instanceMissing {
		missingErr := fmt.Errorf("%w: Evolution Go instance was not found", ErrProviderFailed)
		return errors.Join(
			missingErr,
			repo.recordSessionProbeFailure(ctx, session, claimToken, missingErr, whatsappSessionSupervisorMissingBackoff),
			repo.blockSessionRecovery(ctx, session.OrganizationID, session.ID, "provider_instance_missing"),
		)
	}

	if observedStatus == "connected" && autoReconnectRecoveryStatePresent(settings) {
		if err := repo.clearSessionRecoveryState(ctx, session.OrganizationID, session.ID); err != nil {
			return err
		}
		clearAutoReconnectRecoverySettings(settings)
	}

	if observedStatus == "disconnected" && session.LastConnectedAt != nil && sessionIDAllowlistAllows(recoverySessionIDs, session.ID) && autoReconnectRetryDue(settings, now) {
		outcome, err := repo.recoverSession(ctx, session, instanceKey, token, claimToken)
		if err != nil {
			if outcome == evolutionRecoveryAttempted {
				if errors.Is(err, ErrProviderOutcomeUnknown) {
					return errors.Join(err, repo.blockSessionRecovery(ctx, session.OrganizationID, session.ID, "provider_outcome_unknown"))
				}
				if stateErr := repo.recordSessionRecoveryFailure(ctx, session, now); stateErr != nil {
					return errors.Join(err, stateErr)
				}
			}
			return err
		}
		switch outcome {
		case evolutionRecoveryRequiresPairing:
			return repo.setSessionAutoReconnect(ctx, session.OrganizationID, session.ID, false, "provider_logged_out")
		case evolutionRecoveryProviderBlocked:
			return repo.blockSessionRecovery(ctx, session.OrganizationID, session.ID, "provider_recovery_blocked")
		case evolutionRecoveryWaiting:
			return nil
		case evolutionRecoveryDeferred:
			return repo.recordSessionRecoveryDeferred(ctx, session, now)
		}

		currentSession, ok, refreshErr := repo.getSupervisorSession(ctx, session.OrganizationID, session.ID, claimToken)
		if refreshErr != nil {
			return refreshErr
		}
		if !ok {
			return nil
		}
		session = currentSession
		statusResult, err = repo.invokeEvolutionSupervisorRead(ctx, "instance.status", map[string]any{
			"session_id":  session.ID,
			"instance_id": instanceKey,
			"token":       token,
		})
		if err != nil {
			if stateErr := repo.recordSessionRecoveryFailure(ctx, session, now); stateErr != nil {
				return errors.Join(err, stateErr)
			}
			return err
		}
		status, authoritative, missing := evolutionConnectionObservation(statusResult)
		if !authoritative {
			verificationErr := fmt.Errorf("%w: Evolution Go post-recovery status is unavailable", ErrProviderOutcomeUnknown)
			return errors.Join(verificationErr, repo.recordSessionRecoveryFailure(ctx, session, now))
		}
		applied, updateErr := repo.updateSessionStatusFromProviderIfCurrent(ctx, session, status, statusResult, claimToken, !missing)
		if updateErr != nil {
			return updateErr
		}
		if !applied {
			return nil
		}
		if missing {
			missingErr := fmt.Errorf("%w: Evolution Go instance disappeared after recovery", ErrProviderFailed)
			return errors.Join(
				missingErr,
				repo.recordSessionProbeFailure(ctx, session, claimToken, missingErr, whatsappSessionSupervisorMissingBackoff),
				repo.blockSessionRecovery(ctx, session.OrganizationID, session.ID, "provider_instance_missing"),
			)
		}
		observedStatus = status
		if observedStatus == "connected" {
			if err := repo.clearSessionRecoveryState(ctx, session.OrganizationID, session.ID); err != nil {
				return err
			}
			clearAutoReconnectRecoverySettings(settings)
		} else {
			return repo.recordSessionRecoveryFailure(ctx, session, now)
		}
	}

	configuredWebhookURL := repo.functions.configuredEvolutionWebhookURL(session.ID, instanceKey)
	connectBody, shouldConnect, appliesWebhook := evolutionSupervisorConnectPlan(
		repo.functions.webhookRolloutSessionIDs,
		session.ID,
		settings,
		configuredWebhookURL,
		observedStatus,
	)
	if shouldConnect {
		_, err := repo.functions.invokeEvolution(ctx, "instance.connect", map[string]any{
			"session_id":  session.ID,
			"instance_id": instanceKey,
			"token":       token,
			"body":        connectBody,
		})
		if err != nil {
			return err
		}
		if appliesWebhook {
			settings["webhook_url"] = configuredWebhookURL
			settings["webhook_last_configured_at"] = now.Format(time.RFC3339)
			settings["webhook_subscription_version"] = whatsappWebhookSubscriptionVersion
			settings["evolution_go_resolved_instance_key"] = instanceKey
			delete(settings, "webhook_rollout_managed")
			settingsPatch["webhook_url"] = configuredWebhookURL
			settingsPatch["webhook_last_configured_at"] = settings["webhook_last_configured_at"]
			settingsPatch["webhook_subscription_version"] = whatsappWebhookSubscriptionVersion
			settingsPatch["evolution_go_resolved_instance_key"] = instanceKey
			settingsRemoveKeys = append(settingsRemoveKeys, "webhook_rollout_managed")
		}
	}

	if observedStatus == "connected" && notificationSafeSettingsDue(repo.functions.webhookRolloutSessionIDs, session.ID, settings) {
		result, err := repo.functions.invokeEvolution(ctx, "instance.advancedSettings", map[string]any{
			"session_id":  session.ID,
			"instance_id": instanceKey,
			"token":       token,
		})
		if err != nil {
			return err
		}
		if !recordNotificationSafeSettingsApplied(settings, result, now) {
			return ErrProviderFailed
		}
		settingsPatch["notification_safe_settings_applied_at"] = settings["notification_safe_settings_applied_at"]
		settingsPatch["notification_safe_settings_version"] = settings["notification_safe_settings_version"]
	}

	return repo.patchSessionSettings(ctx, session.OrganizationID, session.ID, settingsPatch, settingsRemoveKeys)
}

func (repo Repository) getSupervisorSession(ctx context.Context, organizationID string, sessionID string, claimToken string) (Session, bool, error) {
	session, err := scanSession(repo.db.Pool().QueryRow(ctx, `
		select `+sessionSelectFields()+`
		from public.whatsapp_sessions ws
		left join public.users owner on owner.id = ws.owner_user_id
		where ws.organization_id = $1::uuid
		  and ws.id = $2::uuid
		  and ws.provider = 'evolution_go'
		  and coalesce(ws.is_active, true) = true
		  and coalesce(ws.status, '') not in ('deleted', 'disabled')
		  and lower(coalesce(ws.advanced_settings->>'auto_reconnect_enabled', 'true')) <> 'false'
		  and exists (
		    select 1
		    from private.whatsapp_session_supervisor_state supervisor_state
		    where supervisor_state.session_id = ws.id
		      and supervisor_state.organization_id = ws.organization_id
		      and supervisor_state.claim_token = $3
		      and supervisor_state.lease_expires_at > now()
		  )
		limit 1
	`, organizationID, sessionID, claimToken))
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, false, nil
	}
	if err != nil {
		return Session{}, false, err
	}
	return session, true, nil
}

func (repo Repository) invokeEvolutionSupervisorRead(ctx context.Context, action string, payload map[string]any) (map[string]any, error) {
	probeContext, cancel := context.WithTimeout(ctx, whatsappSessionSupervisorProbeTimeout)
	defer cancel()
	return repo.functions.invokeEvolution(probeContext, action, payload)
}

func (repo Repository) releaseSessionSupervisorClaim(ctx context.Context, sessionID string, claimToken string) error {
	_, err := repo.db.Pool().Exec(ctx, `
		update private.whatsapp_session_supervisor_state
		set claim_token = null,
		    lease_expires_at = null,
		    updated_at = now()
		where session_id = $1::uuid
		  and claim_token = $2::text
		  and lease_expires_at is not null
	`, sessionID, claimToken)
	return err
}

func (repo Repository) releaseSessionSupervisorClaimWithoutCancellation(ctx context.Context, sessionID string, claimToken string) {
	releaseContext, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer cancel()
	_ = repo.releaseSessionSupervisorClaim(releaseContext, sessionID, claimToken)
}

func (repo Repository) releaseSessionSupervisorClaimsByTokenWithoutCancellation(ctx context.Context, claimToken string) {
	releaseContext, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer cancel()
	_, _ = repo.db.Pool().Exec(releaseContext, `
		update private.whatsapp_session_supervisor_state
		set claim_token = null,
		    lease_expires_at = null,
		    updated_at = now()
		where claim_token = $1::text
	`, claimToken)
}

func (repo Repository) recoverSession(ctx context.Context, session Session, instanceKey string, token string, claimToken string) (evolutionRecoveryOutcome, error) {
	payload := map[string]any{
		"session_id":  session.ID,
		"instance_id": instanceKey,
		"token":       token,
	}
	infoResult, err := repo.invokeEvolutionSupervisorRead(ctx, "instance.info", payload)
	if err != nil {
		return evolutionRecoveryWaiting, err
	}
	disposition := evolutionProviderRecoveryDisposition(infoResult)
	if disposition != evolutionRecoveryAttempted {
		return disposition, nil
	}
	// Evolution Go already starts its own reconnect goroutine on a transient
	// disconnect. The first recoverable observation only opens a grace window;
	// it must not compete with that provider-owned reconnect attempt.
	if !autoReconnectGraceObserved(session.AdvancedSettings) {
		return evolutionRecoveryDeferred, nil
	}
	currentSession, ok, err := repo.getSupervisorSession(ctx, session.OrganizationID, session.ID, claimToken)
	if err != nil {
		return evolutionRecoveryWaiting, err
	}
	if !ok {
		return evolutionRecoveryWaiting, nil
	}
	session = currentSession
	latestStatusResult, err := repo.invokeEvolutionSupervisorRead(ctx, "instance.status", payload)
	if err != nil {
		return evolutionRecoveryWaiting, err
	}
	latestStatus, authoritative, instanceMissing := evolutionConnectionObservation(latestStatusResult)
	if !authoritative {
		return evolutionRecoveryWaiting, fmt.Errorf("%w: Evolution Go pre-recovery status is unavailable", ErrProviderOutcomeUnknown)
	}
	if instanceMissing {
		return evolutionRecoveryWaiting, fmt.Errorf("%w: Evolution Go instance was not found before recovery", ErrProviderFailed)
	}
	if latestStatus != "disconnected" {
		// The provider's own reconnect completed during the grace/recheck window.
		// Do not restart a client that has just become connected or QR-ready.
		applied, err := repo.updateSessionStatusFromProviderIfCurrent(ctx, session, latestStatus, latestStatusResult, claimToken, true)
		if err != nil {
			return evolutionRecoveryWaiting, err
		}
		if applied && latestStatus == "connected" {
			if err := repo.clearSessionRecoveryState(ctx, session.OrganizationID, session.ID); err != nil {
				return evolutionRecoveryWaiting, err
			}
		}
		return evolutionRecoveryWaiting, nil
	}
	allowed, err := repo.sessionRecoveryStillAllowed(ctx, session, claimToken)
	if err != nil {
		return evolutionRecoveryWaiting, err
	}
	if !allowed {
		return evolutionRecoveryWaiting, nil
	}

	if _, err := repo.functions.invokeEvolution(ctx, "instance.reconnect", payload); err == nil {
		return evolutionRecoveryAttempted, nil
	} else if !isProviderStaleClientError(err) {
		return evolutionRecoveryAttempted, err
	}

	phone := evolutionRecoveryPhone(session, infoResult)
	if phone == "" {
		return evolutionRecoveryAttempted, fmt.Errorf("%w: Evolution Go stale client has no recovery phone", ErrProviderFailed)
	}
	_, err = repo.functions.invokeEvolution(ctx, "instance.forceReconnect", map[string]any{
		"session_id":  session.ID,
		"instance_id": instanceKey,
		"body": map[string]any{
			"number": phone,
		},
	})
	return evolutionRecoveryAttempted, err
}

func evolutionProviderRecoveryDisposition(result map[string]any) evolutionRecoveryOutcome {
	if evolutionProviderRequiresPairing(result) {
		return evolutionRecoveryRequiresPairing
	}

	reason := evolutionProviderDisconnectReason(result)
	if strings.Contains(reason, "402") ||
		strings.Contains(reason, "405") ||
		strings.Contains(reason, "409") ||
		strings.Contains(reason, "413") ||
		strings.Contains(reason, "414") ||
		strings.Contains(reason, "temporary ban") ||
		strings.Contains(reason, "temporaryban") ||
		strings.Contains(reason, "stream replaced") ||
		strings.Contains(reason, "streamreplaced") ||
		strings.Contains(reason, "client outdated") ||
		strings.Contains(reason, "bad user agent") {
		return evolutionRecoveryProviderBlocked
	}

	providerConnected, connectedPresent := boolAtPath(result,
		"data.data.connected",
		"data.data.Connected",
		"data.connected",
		"data.Connected",
		"connected",
		"Connected",
	)
	if connectedPresent && providerConnected {
		return evolutionRecoveryAttempted
	}
	if strings.Contains(reason, "reconnecting") ||
		strings.Contains(reason, "websocket is closed") ||
		strings.Contains(reason, "websocket closed") {
		return evolutionRecoveryAttempted
	}
	// Some Evolution versions lose disconnect_reason while retaining the
	// paired-device JID. This is eligible only after the CRM recovery allowlist
	// has selected the session, and still observes the first-pass grace window.
	if providerIdentityAllowsRecovery(result) {
		return evolutionRecoveryAttempted
	}
	return evolutionRecoveryWaiting
}

func providerIdentityAllowsRecovery(result map[string]any) bool {
	identity := firstString(result,
		"data.data.jid",
		"data.data.Jid",
		"data.jid",
		"data.Jid",
		"jid",
		"Jid",
	)
	_, ok := phoneFromIdentityValue(identity)
	return ok
}

func evolutionProviderRequiresPairing(result map[string]any) bool {
	reason := evolutionProviderDisconnectReason(result)
	if reason == "" {
		return false
	}

	return strings.Contains(reason, "401") ||
		strings.Contains(reason, "403") ||
		strings.Contains(reason, "406") ||
		strings.Contains(reason, "logged out") ||
		strings.Contains(reason, "loggedout")
}

func evolutionProviderDisconnectReason(result map[string]any) string {
	return strings.ToLower(strings.TrimSpace(firstString(result,
		"data.data.disconnect_reason",
		"data.data.disconnectReason",
		"data.disconnect_reason",
		"data.disconnectReason",
		"disconnect_reason",
		"disconnectReason",
	)))
}

func evolutionRecoveryPhone(session Session, infoResult map[string]any) string {
	identity := firstString(infoResult,
		"data.data.jid",
		"data.data.Jid",
		"data.data.phone",
		"data.data.number",
		"data.jid",
		"data.Jid",
		"data.phone",
		"data.number",
		"jid",
		"Jid",
		"phone",
		"number",
	)
	phone, ok := phoneFromIdentityValue(identity)
	if !ok {
		return ""
	}
	// forceReconnect performs a provider-global device lookup. Only the JID
	// returned by instance.info is authoritative enough for that operation;
	// a cached CRM phone can belong to a previous pairing.
	return phone
}

func (repo Repository) sessionRecoveryStillAllowed(ctx context.Context, session Session, claimToken string) (bool, error) {
	var allowed bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.whatsapp_sessions ws
			where ws.organization_id = $1::uuid
			  and ws.id = $2::uuid
			  and ws.provider = 'evolution_go'
			  and coalesce(ws.is_active, true) = true
			  and coalesce(ws.status, '') = 'disconnected'
			  and lower(coalesce(ws.advanced_settings->>'auto_reconnect_enabled', 'true')) <> 'false'
			  and exists (
			    select 1
			    from private.whatsapp_session_supervisor_state supervisor_state
			    where supervisor_state.session_id = ws.id
			      and supervisor_state.organization_id = ws.organization_id
			      and supervisor_state.claim_token = $3
			      and supervisor_state.lease_expires_at > now()
			  )
		)
	`, session.OrganizationID, session.ID, claimToken).Scan(&allowed)
	return allowed, err
}

func evolutionConnectionObservation(result map[string]any) (status string, authoritative bool, instanceMissing bool) {
	if !providerResultOK(result) {
		statusCode := firstString(result, "status", "data.status")
		message := providerErrorMessage(result, "Evolution Go status unavailable")
		if statusCode == "404" {
			return "disconnected", true, true
		}
		if statusCode == "400" && isAuthoritativeEvolutionStatusDisconnect(message) {
			return "disconnected", true, false
		}
		return "", false, false
	}

	normalizedStatus := firstString(result, "normalizedStatus")
	if normalizedStatus == "" {
		normalizedStatus = normalizeEvolutionStatus(result["data"])
	}
	if normalizedStatus == "connected" || normalizedStatus == "qr_ready" || normalizedStatus == "disconnected" {
		return normalizedStatus, true, false
	}
	return "", false, false
}

func isAuthoritativeEvolutionStatusDisconnect(message string) bool {
	switch strings.ToLower(strings.TrimSpace(message)) {
	case "client disconnected", "client is disconnected", "not connected", "disconnected", "already closed", "logged out":
		return true
	default:
		return false
	}
}

func sessionAutoReconnectEnabled(settings map[string]any) bool {
	value, exists := settings["auto_reconnect_enabled"]
	if !exists {
		return true
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return !strings.EqualFold(strings.TrimSpace(typed), "false")
	default:
		return true
	}
}

func autoReconnectFailureCount(settings map[string]any) int {
	if settings == nil {
		return 0
	}
	value, exists := settings["auto_reconnect_failure_count"]
	if !exists {
		return 0
	}
	var count int
	switch typed := value.(type) {
	case int:
		count = typed
	case int32:
		count = int(typed)
	case int64:
		count = int(typed)
	case float64:
		count = int(typed)
	case string:
		count, _ = strconv.Atoi(strings.TrimSpace(typed))
	}
	if count < 0 {
		return 0
	}
	return count
}

func autoReconnectRetryDue(settings map[string]any, now time.Time) bool {
	if autoReconnectRecoveryBlocked(settings) {
		return false
	}
	raw := strings.TrimSpace(stringFromMap(settings, "auto_reconnect_retry_after"))
	if raw == "" {
		return true
	}
	retryAt, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return true
	}
	return !now.UTC().Before(retryAt.UTC())
}

func autoReconnectGraceObserved(settings map[string]any) bool {
	return strings.TrimSpace(stringFromMap(settings, "auto_reconnect_grace_observed_at")) != ""
}

func autoReconnectRecoveryBlocked(settings map[string]any) bool {
	reason := strings.ToLower(strings.TrimSpace(stringFromMap(settings, "auto_reconnect_blocked_reason")))
	return reason == "recovery_exhausted" ||
		reason == "provider_recovery_blocked" ||
		reason == "provider_instance_missing" ||
		reason == "provider_identity_missing" ||
		reason == "provider_credentials_missing" ||
		reason == "provider_outcome_unknown" ||
		reason == "lifecycle_reconciliation_required"
}

func autoReconnectRecoveryStatePresent(settings map[string]any) bool {
	return autoReconnectFailureCount(settings) > 0 ||
		autoReconnectGraceObserved(settings) ||
		strings.TrimSpace(stringFromMap(settings, "auto_reconnect_retry_after")) != "" ||
		strings.TrimSpace(stringFromMap(settings, "auto_reconnect_blocked_reason")) != ""
}

func (repo Repository) recordSessionProbeFailure(
	ctx context.Context,
	session Session,
	claimToken string,
	cause error,
	delayOverride time.Duration,
) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var previousAttempts int
	err = tx.QueryRow(ctx, `
		select probe_failure_count
		from private.whatsapp_session_supervisor_state
		where session_id = $1::uuid
		  and organization_id = $2::uuid
		  and claim_token = $3::text
		for update
	`, session.ID, session.OrganizationID, claimToken).Scan(&previousAttempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}

	attempts := previousAttempts + 1
	if attempts > 10000 {
		attempts = 10000
	}
	delay := delayOverride
	if delay <= 0 {
		delay = supervisorProbeBackoff(session.ID, attempts)
	}
	command, err := tx.Exec(ctx, `
		update private.whatsapp_session_supervisor_state
		set probe_failure_count = $4::integer,
		    retry_at = now() + ($5::bigint * interval '1 millisecond'),
		    last_error_code = $6::text,
		    claim_token = null,
		    lease_expires_at = null,
		    updated_at = now()
		where session_id = $1::uuid
		  and organization_id = $2::uuid
		  and claim_token = $3::text
	`, session.ID, session.OrganizationID, claimToken, attempts, delay.Milliseconds(), sessionProbeErrorCode(cause))
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return nil
	}
	return tx.Commit(ctx)
}

func sessionProbeErrorCode(err error) string {
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return "provider_probe_timeout"
	case errors.Is(err, ErrProviderOutcomeUnknown):
		return "provider_probe_unknown"
	case errors.Is(err, ErrProviderFailed):
		return "provider_probe_failed"
	default:
		return "provider_probe_error"
	}
}

func supervisorProbeBackoff(sessionID string, attempts int) time.Duration {
	if attempts < 1 {
		attempts = 1
	}
	shift := attempts - 1
	if shift > 5 {
		shift = 5
	}
	base := time.Minute * time.Duration(1<<shift)
	if base > whatsappSessionSupervisorMaxProbeBackoff {
		base = whatsappSessionSupervisorMaxProbeBackoff
	}
	delay := deterministicJitteredDelay(base, sessionID, attempts, "provider-probe", 20)
	if delay > whatsappSessionSupervisorMaxProbeBackoff {
		return whatsappSessionSupervisorMaxProbeBackoff
	}
	return delay
}

func deterministicJitteredDelay(base time.Duration, identity string, attempt int, lane string, percent int) time.Duration {
	if base <= 0 || percent <= 0 {
		return base
	}
	if percent > 90 {
		percent = 90
	}
	hasher := fnv.New64a()
	_, _ = hasher.Write([]byte(strings.ToLower(strings.TrimSpace(identity))))
	_, _ = hasher.Write([]byte(":" + strconv.Itoa(attempt) + ":" + lane))
	span := uint64(percent*2 + 1)
	deltaPercent := int(hasher.Sum64()%span) - percent
	return base + time.Duration(int64(base)*int64(deltaPercent)/100)
}

func jitteredSupervisorScheduleDelay(base time.Duration, seed string, cycle uint64) time.Duration {
	if base <= 0 {
		return base
	}
	hasher := fnv.New64a()
	_, _ = hasher.Write([]byte(seed))
	_, _ = hasher.Write([]byte(":" + strconv.FormatUint(cycle, 10)))
	extraPercent := int(hasher.Sum64() % uint64(whatsappSessionSupervisorScheduleJitterPC+1))
	return base + time.Duration(int64(base)*int64(extraPercent)/100)
}

func clearAutoReconnectRecoverySettings(settings map[string]any) {
	delete(settings, "auto_reconnect_failure_count")
	delete(settings, "auto_reconnect_retry_after")
	delete(settings, "auto_reconnect_blocked_reason")
	delete(settings, "auto_reconnect_grace_observed_at")
}

func (repo Repository) recordSessionRecoveryDeferred(ctx context.Context, session Session, now time.Time) error {
	delay := deterministicJitteredDelay(5*time.Minute, session.ID, 0, "provider-recovery-grace", 20)
	patch := map[string]any{
		"auto_reconnect_grace_observed_at": now.UTC().Format(time.RFC3339),
		"auto_reconnect_retry_after":       now.UTC().Add(delay).Format(time.RFC3339),
	}
	_, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_sessions
		set advanced_settings = (
		      coalesce(advanced_settings, '{}'::jsonb)
		      - 'auto_reconnect_retry_after'
		      - 'auto_reconnect_grace_observed_at'
		    ) || $3::jsonb,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and coalesce(is_active, true) = true
		  and coalesce(status, '') not in ('deleted', 'disabled')
		  and lower(coalesce(advanced_settings->>'auto_reconnect_enabled', 'true')) <> 'false'
	`, session.OrganizationID, session.ID, jsonb(patch))
	return err
}

func (repo Repository) recordSessionRecoveryFailure(ctx context.Context, session Session, now time.Time) error {
	attempts := autoReconnectFailureCount(session.AdvancedSettings) + 1
	patch := map[string]any{
		"auto_reconnect_failure_count": attempts,
	}
	if attempts >= whatsappSessionRecoveryMaxFailures {
		patch["auto_reconnect_blocked_reason"] = "recovery_exhausted"
	} else {
		delay := 5 * time.Minute
		if attempts == 2 {
			delay = 15 * time.Minute
		}
		delay = deterministicJitteredDelay(delay, session.ID, attempts, "provider-recovery", 20)
		patch["auto_reconnect_retry_after"] = now.UTC().Add(delay).Format(time.RFC3339)
	}

	_, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_sessions
		set advanced_settings = (
		      coalesce(advanced_settings, '{}'::jsonb)
		      - 'auto_reconnect_failure_count'
		      - 'auto_reconnect_retry_after'
		      - 'auto_reconnect_blocked_reason'
		    ) || $3::jsonb,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and coalesce(is_active, true) = true
		  and coalesce(status, '') not in ('deleted', 'disabled')
		  and lower(coalesce(advanced_settings->>'auto_reconnect_enabled', 'true')) <> 'false'
	`, session.OrganizationID, session.ID, jsonb(patch))
	return err
}

func (repo Repository) clearSessionRecoveryState(ctx context.Context, organizationID string, sessionID string) error {
	_, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_sessions
		set advanced_settings = coalesce(advanced_settings, '{}'::jsonb)
		      - 'auto_reconnect_failure_count'
		      - 'auto_reconnect_retry_after'
		      - 'auto_reconnect_blocked_reason'
		      - 'auto_reconnect_grace_observed_at',
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and coalesce(is_active, true) = true
		  and coalesce(status, '') not in ('deleted', 'disabled')
		  and lower(coalesce(advanced_settings->>'auto_reconnect_enabled', 'true')) <> 'false'
	`, organizationID, sessionID)
	return err
}

func (repo Repository) blockSessionRecovery(ctx context.Context, organizationID string, sessionID string, reason string) error {
	return repo.patchSessionSettings(
		ctx,
		organizationID,
		sessionID,
		map[string]any{"auto_reconnect_blocked_reason": strings.TrimSpace(reason)},
		[]string{"auto_reconnect_retry_after", "auto_reconnect_grace_observed_at"},
	)
}

func isProviderStaleClientError(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "client disconnected")
}

func evolutionSupervisorConnectPlan(
	allowlist []string,
	sessionID string,
	settings map[string]any,
	expectedURL string,
	status string,
) (body map[string]any, shouldConnect bool, appliesWebhook bool) {
	if webhookConfigurationAllowed(allowlist, sessionID, settings, expectedURL, status) {
		return evolutionWebhookConnectBody(expectedURL), true, true
	}
	return nil, false, false
}

func webhookConfigurationAllowed(
	allowlist []string,
	sessionID string,
	settings map[string]any,
	expectedURL string,
	status string,
) bool {
	// instance.connect is a provider mutation even when it is used only to
	// reconcile callback settings. Keep it behind the same explicit UUID canary
	// as recovery so a configuration rollout cannot touch the whole fleet.
	if !webhookRolloutAllowsSession(allowlist, sessionID) {
		return false
	}
	if strings.TrimSpace(expectedURL) == "" {
		return false
	}
	if !strings.EqualFold(strings.TrimSpace(status), "connected") {
		return false
	}
	return webhookConfigurationDue(settings, expectedURL)
}

func notificationSafeSettingsDue(allowlist []string, sessionID string, settings map[string]any) bool {
	if !webhookRolloutAllowsSession(allowlist, sessionID) {
		return false
	}
	return strings.TrimSpace(stringFromMap(settings, "notification_safe_settings_version")) != whatsappNotificationSafeVersion
}

func recordNotificationSafeSettingsApplied(settings map[string]any, result map[string]any, now time.Time) bool {
	if !providerResultOK(result) {
		return false
	}
	settings["notification_safe_settings_applied_at"] = now.UTC().Format(time.RFC3339)
	settings["notification_safe_settings_version"] = whatsappNotificationSafeVersion
	return true
}

func webhookRolloutAllowsSession(allowlist []string, sessionID string) bool {
	return sessionIDAllowlistAllows(allowlist, sessionID)
}

func sessionIDAllowlistAllows(allowlist []string, sessionID string) bool {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return false
	}

	for _, allowed := range allowlist {
		allowed = strings.TrimSpace(allowed)
		if allowed == "*" || strings.EqualFold(allowed, sessionID) {
			return true
		}
	}

	return false
}

func evolutionWebhookConnectBody(webhookURL string) map[string]any {
	subscriptions := append([]string(nil), whatsappLiveWebhookSubscriptions...)
	return withoutEmptyMap(map[string]any{
		"webhookUrl":  webhookURL,
		"webhook_url": webhookURL,
		"url":         webhookURL,
		"subscribe":   subscriptions,
		"events":      append([]string(nil), subscriptions...),
		"immediate":   true,
		"advancedSettings": map[string]any{
			"rejectCall":      false,
			"ignoreGroups":    true,
			"alwaysOnline":    false,
			"readMessages":    false,
			"ignoreStatus":    false,
			"syncFullHistory": false,
		},
	})
}

func webhookConfigurationDue(settings map[string]any, expectedURL string) bool {
	if strings.TrimSpace(stringFromMap(settings, "webhook_url")) != expectedURL {
		return true
	}
	return strings.TrimSpace(stringFromMap(settings, "webhook_subscription_version")) != whatsappWebhookSubscriptionVersion
}

func sessionEvolutionInstanceKey(session Session, settings map[string]any) string {
	return firstNonEmpty(
		stringFromMap(settings, "evolution_go_resolved_instance_key"),
		stringPtrValue(session.InstanceID),
		session.InstanceName,
	)
}

func (repo Repository) updateSessionSettings(ctx context.Context, organizationID string, sessionID string, settings map[string]any) error {
	_, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_sessions
		set advanced_settings = $3::jsonb,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, organizationID, sessionID, jsonb(settings))
	return err
}

func (repo Repository) patchSessionSettings(ctx context.Context, organizationID string, sessionID string, patch map[string]any, removeKeys []string) error {
	if len(patch) == 0 && len(removeKeys) == 0 {
		return nil
	}
	_, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_sessions
		set advanced_settings = (
		      coalesce(advanced_settings, '{}'::jsonb)
		      - coalesce($4::text[], '{}'::text[])
		    ) || $3::jsonb,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and coalesce(is_active, true) = true
		  and coalesce(status, '') not in ('deleted', 'disabled')
	`, organizationID, sessionID, jsonb(patch), removeKeys)
	return err
}

func (repo Repository) updateSessionStatusFromProvider(ctx context.Context, session Session, normalizedStatus string, result map[string]any) error {
	_, err := repo.updateSessionStatusFromProviderIfCurrent(ctx, session, normalizedStatus, result, "", true)
	return err
}

// updateSessionStatusFromProviderIfCurrent is a compare-and-swap between the
// row snapshot loaded immediately before the provider request and the returned
// observation. A webhook that lands while the HTTP request is in flight changes
// its ordered event tuple and makes this update a no-op. Lifecycle writes share
// the session advisory lock. This prevents a slow status response from rolling
// a newer connected/disconnected event back without treating generic updated_at
// churn as provider freshness.
func (repo Repository) updateSessionStatusFromProviderIfCurrent(
	ctx context.Context,
	session Session,
	normalizedStatus string,
	result map[string]any,
	claimToken string,
	clearProbeFailure bool,
) (bool, error) {
	if normalizedStatus != "connected" && normalizedStatus != "qr_ready" && normalizedStatus != "disconnected" {
		return false, nil
	}

	rawData := firstMap(result, "data.data", "data.instance", "data.session", "data", "instance", "session")
	wuid := firstString(rawData, "jid", "Jid", "wuid", "ownerJid", "phone", "number", "Name", "name")
	phone, validPhone := phoneFromIdentityValue(wuid)
	if !validPhone {
		phone = ""
	}
	expectedWebhookAt := stringFromAny(session.AdvancedSettings["webhook_state_event_at_ms"])
	expectedWebhookRank := stringFromAny(session.AdvancedSettings["webhook_state_event_rank"])
	expectedWebhookKey := stringFromAny(session.AdvancedSettings["webhook_state_event_key"])
	observedAtMillis := time.Now().UTC().UnixMilli()
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var currentPhone *string
	err = tx.QueryRow(ctx, `
		select phone_number
		from public.whatsapp_sessions
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and coalesce(is_active, true) = true
		  and coalesce(status, '') not in ('deleted', 'disabled')
		  and coalesce(status, '') = $3::text
		  and coalesce(advanced_settings->>'webhook_state_event_at_ms', '') = $4::text
		  and coalesce(advanced_settings->>'webhook_state_event_rank', '') = $5::text
		  and coalesce(advanced_settings->>'webhook_state_event_key', '') = $6::text
		  and (
		    $7::text = ''
		    or exists (
		      select 1
		      from private.whatsapp_session_supervisor_state supervisor_state
		      where supervisor_state.session_id = whatsapp_sessions.id
		        and supervisor_state.organization_id = whatsapp_sessions.organization_id
		        and supervisor_state.claim_token = $7::text
		        and supervisor_state.lease_expires_at > now()
		    )
		  )
		for update
	`, session.OrganizationID, session.ID, strings.TrimSpace(session.Status), expectedWebhookAt, expectedWebhookRank, expectedWebhookKey, claimToken).Scan(&currentPhone)
	if errors.Is(err, pgx.ErrNoRows) {
		if claimToken != "" {
			if _, err := tx.Exec(ctx, `
				update private.whatsapp_session_supervisor_state
				set claim_token = null,
				    lease_expires_at = null,
				    updated_at = now()
				where session_id = $1::uuid
				  and organization_id = $2::uuid
				  and claim_token = $3::text
			`, session.ID, session.OrganizationID, claimToken); err != nil {
				return false, err
			}
		}
		return false, tx.Commit(ctx)
	}
	if err != nil {
		return false, err
	}

	currentPhoneValue := stringPtrValue(currentPhone)
	needsSessionUpdate := normalizedStatus != strings.TrimSpace(session.Status) ||
		normalizedStatus == "connected" && phone != "" && phone != currentPhoneValue ||
		normalizedStatus == "connected" && session.LastConnectedAt == nil
	if needsSessionUpdate {
		if _, err := tx.Exec(ctx, `
			update public.whatsapp_sessions
			set status = $3,
			    phone_number = case
			      when $3 = 'connected' then coalesce(nullif($4, ''), phone_number)
			      else phone_number
			    end,
			    last_connected_at = case
			      when $3 = 'connected' and (coalesce(status, '') <> 'connected' or last_connected_at is null) then now()
			      else last_connected_at
			    end,
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
			  and coalesce(is_active, true) = true
			  and coalesce(status, '') not in ('deleted', 'disabled')
		`, session.OrganizationID, session.ID, normalizedStatus, phone); err != nil {
			return false, err
		}
	}

	if claimToken != "" {
		stateCommand, err := tx.Exec(ctx, `
			update private.whatsapp_session_supervisor_state
			set probe_failure_count = case when $5::boolean then 0 else probe_failure_count end,
			    retry_at = case when $5::boolean then null else retry_at end,
			    last_error_code = case when $5::boolean then null else last_error_code end,
			    last_provider_observed_at = $4::timestamptz,
			    last_provider_status = $6::text,
			    updated_at = now()
			where session_id = $1::uuid
			  and organization_id = $2::uuid
			  and claim_token = $3::text
			  and lease_expires_at > now()
		`, session.ID, session.OrganizationID, claimToken, time.UnixMilli(observedAtMillis).UTC(), clearProbeFailure, normalizedStatus)
		if err != nil {
			return false, err
		}
		if stateCommand.RowsAffected() != 1 {
			return false, nil
		}
	} else {
		// An explicit, tenant-authorized status check shares the same per-session
		// advisory lock. Its authoritative success can safely clear passive probe
		// backoff, but it never takes over or releases a supervisor lease.
		if _, err := tx.Exec(ctx, `
			update private.whatsapp_session_supervisor_state
			set probe_failure_count = 0,
			    retry_at = null,
			    last_error_code = null,
			    last_provider_observed_at = $3::timestamptz,
			    last_provider_status = $4::text,
			    updated_at = now()
			where session_id = $1::uuid
			  and organization_id = $2::uuid
		`, session.ID, session.OrganizationID, time.UnixMilli(observedAtMillis).UTC(), normalizedStatus); err != nil {
			return false, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}
