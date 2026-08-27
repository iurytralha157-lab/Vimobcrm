package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	whatsappWebhookSubscriptionVersion  = "lead-message-events-v2"
	whatsappNotificationSafeVersion     = "evolution-advanced-settings-v1"
	whatsappSessionSupervisorClaimLease = 5 * time.Minute
	whatsappSessionRecoveryMaxFailures  = 3
)

type evolutionRecoveryOutcome uint8

const (
	evolutionRecoveryWaiting evolutionRecoveryOutcome = iota
	evolutionRecoveryAttempted
	evolutionRecoveryDeferred
	evolutionRecoveryRequiresPairing
	evolutionRecoveryProviderBlocked
)

var whatsappWebhookSubscriptions = []string{
	// GROUP, LABEL and CONTACT are intentionally absent. They are not part of
	// the lead-only realtime inbox and remain available through explicit,
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
		timer := time.NewTimer(config.SessionSupervisorInitialDelay)
		defer timer.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				if err := handler.repo.superviseActiveSessionsWithLimit(ctx, logger, config.SessionSupervisorBatch, config.SessionSupervisorInterval, config.SessionSupervisorRecoveryIDs); err != nil && !errors.Is(err, context.Canceled) {
					logger.Error("whatsapp session supervisor failed", "error", err)
				}
				timer.Reset(config.SessionSupervisorInterval)
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

func (repo Repository) superviseActiveSessionsWithLimit(ctx context.Context, logger *slog.Logger, batch int, minimumAge time.Duration, recoverySessionIDs []string) error {
	batch = normalizeWorkerBatch(batch, defaultWhatsAppSessionSupervisorBatch)
	if minimumAge <= 0 {
		minimumAge = defaultWhatsAppSessionSupervisorInterval
	}
	if minimumAge < whatsappSessionSupervisorClaimLease {
		minimumAge = whatsappSessionSupervisorClaimLease
	}
	rows, err := repo.db.Pool().Query(ctx, `
		with candidates as (
			select ws.id
			from public.whatsapp_sessions ws
			where coalesce(ws.is_active, true) = true
			  and coalesce(ws.status, '') not in ('deleted', 'disabled')
			  and ws.provider = 'evolution_go'
			  and lower(coalesce(ws.advanced_settings->>'auto_reconnect_enabled', 'true')) <> 'false'
			  and ws.updated_at <= now() - ($2::bigint * interval '1 millisecond')
			order by ws.updated_at asc, ws.id asc
			for update of ws skip locked
			limit $1::integer
		), claimed as (
			update public.whatsapp_sessions target
			set updated_at = now()
			from candidates
			where target.id = candidates.id
			returning target.*
		)
		select `+sessionSelectFields()+`
		from claimed ws
		left join public.users owner on owner.id = ws.owner_user_id
		order by ws.updated_at asc, ws.id asc
	`, batch, minimumAge.Milliseconds())
	if err != nil {
		return err
	}

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

	now := time.Now().UTC()
	for _, session := range sessions {
		if err := repo.superviseSession(ctx, session, now, recoverySessionIDs); err != nil && !errors.Is(err, context.Canceled) {
			logger.Warn("whatsapp session supervision skipped", "session_id", session.ID, "error", err)
		}
	}

	return nil
}

func (repo Repository) superviseSession(ctx context.Context, session Session, now time.Time, recoverySessionIDs []string) error {
	unlock, locked, err := repo.acquireWhatsAppSessionLock(ctx, session.ID, false)
	if err != nil {
		return err
	}
	if !locked {
		return nil
	}
	defer unlock()

	return repo.superviseSessionLocked(ctx, session, now, recoverySessionIDs)
}

func (repo Repository) superviseSessionLocked(ctx context.Context, session Session, now time.Time, recoverySessionIDs []string) error {
	currentSession, ok, err := repo.getSupervisorSession(ctx, session.OrganizationID, session.ID)
	if err != nil {
		return err
	}
	if !ok {
		return nil
	}
	session = currentSession

	settings := ensureAutoReplyDefaults(cloneMap(session.AdvancedSettings))
	if !sessionAutoReconnectEnabled(settings) {
		return nil
	}
	settingsPatch := map[string]any{}
	settingsRemoveKeys := []string{}

	token := strings.TrimSpace(stringFromMap(settings, "token"))
	if token == "" {
		return fmt.Errorf("%w: Evolution Go session token is missing", ErrProviderFailed)
	}
	webhookToken := strings.TrimSpace(stringFromMap(settings, "webhook_token"))
	if webhookToken == "" {
		webhookToken = createSecretToken()
		settings["webhook_token"] = webhookToken
		if err := repo.patchSessionSettings(ctx, session.OrganizationID, session.ID, map[string]any{"webhook_token": webhookToken}, nil); err != nil {
			return err
		}
	}

	instanceKey := sessionEvolutionInstanceKey(session, settings)
	if instanceKey == "" {
		return repo.patchSessionSettings(ctx, session.OrganizationID, session.ID, settingsPatch, settingsRemoveKeys)
	}

	statusResult, err := repo.functions.invokeEvolution(ctx, "instance.status", map[string]any{
		"session_id":  session.ID,
		"instance_id": instanceKey,
		"token":       token,
	})
	if err != nil {
		return err
	}
	observedStatus, authoritative, instanceMissing := evolutionConnectionObservation(statusResult)
	if !authoritative {
		return fmt.Errorf("%w: Evolution Go connection status is unavailable", ErrProviderOutcomeUnknown)
	}
	if err := repo.updateSessionStatusFromProvider(ctx, session, observedStatus, statusResult); err != nil {
		return err
	}
	if instanceMissing {
		return fmt.Errorf("%w: Evolution Go instance was not found", ErrProviderFailed)
	}

	if observedStatus == "connected" && autoReconnectRecoveryStatePresent(settings) {
		if err := repo.clearSessionRecoveryState(ctx, session.OrganizationID, session.ID); err != nil {
			return err
		}
		clearAutoReconnectRecoverySettings(settings)
	}

	if observedStatus == "disconnected" && session.LastConnectedAt != nil && sessionIDAllowlistAllows(recoverySessionIDs, session.ID) && autoReconnectRetryDue(settings, now) {
		outcome, err := repo.recoverSession(ctx, session, instanceKey, token)
		if err != nil {
			if outcome == evolutionRecoveryAttempted {
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

		statusResult, err = repo.functions.invokeEvolution(ctx, "instance.status", map[string]any{
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
		if status, ok, missing := evolutionConnectionObservation(statusResult); ok && !missing {
			observedStatus = status
			if err := repo.updateSessionStatusFromProvider(ctx, session, observedStatus, statusResult); err != nil {
				return err
			}
		}
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

	if notificationSafeSettingsDue(repo.functions.webhookRolloutSessionIDs, session.ID, settings) {
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

func (repo Repository) getSupervisorSession(ctx context.Context, organizationID string, sessionID string) (Session, bool, error) {
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
		limit 1
	`, organizationID, sessionID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, false, nil
	}
	if err != nil {
		return Session{}, false, err
	}
	return session, true, nil
}

func (repo Repository) recoverSession(ctx context.Context, session Session, instanceKey string, token string) (evolutionRecoveryOutcome, error) {
	payload := map[string]any{
		"session_id":  session.ID,
		"instance_id": instanceKey,
		"token":       token,
	}
	infoResult, err := repo.functions.invokeEvolution(ctx, "instance.info", payload)
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
	allowed, err := repo.sessionRecoveryStillAllowed(ctx, session)
	if err != nil {
		return evolutionRecoveryWaiting, err
	}
	if !allowed {
		return evolutionRecoveryWaiting, nil
	}
	latestStatusResult, err := repo.functions.invokeEvolution(ctx, "instance.status", payload)
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
		if err := repo.updateSessionStatusFromProvider(ctx, session, latestStatus, latestStatusResult); err != nil {
			return evolutionRecoveryWaiting, err
		}
		if latestStatus == "connected" {
			if err := repo.clearSessionRecoveryState(ctx, session.OrganizationID, session.ID); err != nil {
				return evolutionRecoveryWaiting, err
			}
		}
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

func (repo Repository) sessionRecoveryStillAllowed(ctx context.Context, session Session) (bool, error) {
	var allowed bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.whatsapp_sessions ws
			where ws.organization_id = $1::uuid
			  and ws.id = $2::uuid
			  and ws.provider = 'evolution_go'
			  and coalesce(ws.is_active, true) = true
			  and coalesce(ws.status, '') not in ('deleted', 'disabled')
			  and lower(coalesce(ws.advanced_settings->>'auto_reconnect_enabled', 'true')) <> 'false'
		)
	`, session.OrganizationID, session.ID).Scan(&allowed)
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
	return reason == "recovery_exhausted" || reason == "provider_recovery_blocked"
}

func autoReconnectRecoveryStatePresent(settings map[string]any) bool {
	return autoReconnectFailureCount(settings) > 0 ||
		autoReconnectGraceObserved(settings) ||
		strings.TrimSpace(stringFromMap(settings, "auto_reconnect_retry_after")) != "" ||
		strings.TrimSpace(stringFromMap(settings, "auto_reconnect_blocked_reason")) != ""
}

func clearAutoReconnectRecoverySettings(settings map[string]any) {
	delete(settings, "auto_reconnect_failure_count")
	delete(settings, "auto_reconnect_retry_after")
	delete(settings, "auto_reconnect_blocked_reason")
	delete(settings, "auto_reconnect_grace_observed_at")
}

func (repo Repository) recordSessionRecoveryDeferred(ctx context.Context, session Session, now time.Time) error {
	patch := map[string]any{
		"auto_reconnect_grace_observed_at": now.UTC().Format(time.RFC3339),
		"auto_reconnect_retry_after":       now.UTC().Add(5 * time.Minute).Format(time.RFC3339),
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
	_ = allowlist
	_ = sessionID
	if strings.TrimSpace(expectedURL) == "" {
		return false
	}
	if strings.EqualFold(strings.TrimSpace(status), "disconnected") {
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
	subscriptions := append([]string(nil), whatsappWebhookSubscriptions...)
	return withoutEmptyMap(map[string]any{
		"webhookUrl":  webhookURL,
		"webhook_url": webhookURL,
		"url":         webhookURL,
		"subscribe":   subscriptions,
		"events":      append([]string(nil), subscriptions...),
		"immediate":   true,
		"advancedSettings": map[string]any{
			"rejectCall":      false,
			"ignoreGroups":    false,
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
	if normalizedStatus == "connected" {
		rawData := firstMap(result, "data.data", "data.instance", "data.session", "data", "instance", "session")
		wuid := firstString(rawData, "jid", "Jid", "wuid", "ownerJid", "phone", "number", "Name", "name")
		phone, validPhone := phoneFromIdentityValue(wuid)
		if !validPhone {
			phone = ""
		}
		_, err := repo.db.Pool().Exec(ctx, `
			update public.whatsapp_sessions
			set status = 'connected',
			    phone_number = coalesce(nullif($3, ''), phone_number),
			    last_connected_at = now(),
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
			  and coalesce(is_active, true) = true
			  and coalesce(status, '') not in ('deleted', 'disabled')
		`, session.OrganizationID, session.ID, phone)
		return err
	}

	if normalizedStatus == "qr_ready" || normalizedStatus == "disconnected" {
		_, err := repo.db.Pool().Exec(ctx, `
			update public.whatsapp_sessions
			set status = $3,
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
			  and coalesce(is_active, true) = true
			  and coalesce(status, '') not in ('deleted', 'disabled')
		`, session.OrganizationID, session.ID, normalizedStatus)
		return err
	}
	return nil
}
