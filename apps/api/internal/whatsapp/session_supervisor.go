package whatsapp

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"
)

const (
	whatsappSessionSupervisorInitialDelay = 30 * time.Second
	whatsappSessionSupervisorInterval     = time.Minute
	whatsappSupervisorBatchLimit          = 5
	whatsappWebhookSubscriptionVersion    = "lead-message-events-v2"
	whatsappWebhookRolloutManagedSetting  = "webhook_rollout_managed"
	whatsappNotificationSafeVersion       = "evolution-advanced-settings-v1"
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
	if logger == nil {
		logger = slog.Default()
	}

	go func() {
		timer := time.NewTimer(whatsappSessionSupervisorInitialDelay)
		defer timer.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				if err := handler.repo.superviseActiveSessions(ctx, logger); err != nil && !errors.Is(err, context.Canceled) {
					logger.Error("whatsapp session supervisor failed", "error", err)
				}
				timer.Reset(whatsappSessionSupervisorInterval)
			}
		}
	}()
}

func (repo Repository) superviseActiveSessions(ctx context.Context, logger *slog.Logger) error {
	rows, err := repo.db.Pool().Query(ctx, `
		select `+sessionSelectFields()+`
		from public.whatsapp_sessions ws
		left join public.users owner on owner.id = ws.owner_user_id
		where coalesce(ws.is_active, true) = true
		  and coalesce(ws.status, '') <> 'deleted'
		  and ws.provider = 'evolution_go'
		order by
		  case
		    when coalesce(ws.advanced_settings->>'webhook_rollout_managed', 'false') = 'true' then 0
		    else 1
		  end,
		  ws.updated_at asc,
		  ws.id asc
		limit $1::integer
	`, whatsappSupervisorBatchLimit)
	if err != nil {
		return err
	}

	sessions := make([]Session, 0, whatsappSupervisorBatchLimit)
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
		if err := repo.superviseSession(ctx, session, now); err != nil && !errors.Is(err, context.Canceled) {
			logger.Warn("whatsapp session supervision skipped", "session_id", session.ID, "error", err)
		}
	}

	return nil
}

func (repo Repository) superviseSession(ctx context.Context, session Session, now time.Time) error {
	settings := ensureAutoReplyDefaults(cloneMap(session.AdvancedSettings))
	settingsChanged := false

	token := strings.TrimSpace(stringFromMap(settings, "token"))
	if token == "" {
		token = createSecretToken()
		settings["token"] = token
		settingsChanged = true
	}
	webhookToken := strings.TrimSpace(stringFromMap(settings, "webhook_token"))
	if webhookToken == "" {
		webhookToken = createSecretToken()
		settings["webhook_token"] = webhookToken
		settingsChanged = true
	}

	instanceKey := sessionEvolutionInstanceKey(session, settings)
	if instanceKey == "" {
		if settingsChanged {
			return repo.updateSessionSettings(ctx, session.OrganizationID, session.ID, settings)
		}
		return nil
	}

	configuredWebhookURL := repo.functions.configuredEvolutionWebhookURL(session.ID, instanceKey, webhookToken)
	connectBody, shouldConnect, appliesWebhook := evolutionSupervisorConnectPlan(
		repo.functions.webhookRolloutSessionIDs,
		session.ID,
		settings,
		configuredWebhookURL,
		session.Status,
	)
	rolloutAllowed := webhookRolloutAllowsSession(repo.functions.webhookRolloutSessionIDs, session.ID)
	if appliesWebhook && rolloutAllowed && !webhookRolloutManaged(settings) {
		// Persist rollout intent before touching the provider. If the provider
		// succeeds but a later database write fails, rollback still knows this
		// session may be pointing at the backend.
		setWebhookRolloutManaged(settings, true)
		if err := repo.updateSessionSettings(ctx, session.OrganizationID, session.ID, settings); err != nil {
			return err
		}
		settingsChanged = false
	}
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
			setWebhookRolloutManaged(settings, rolloutAllowed)
			settingsChanged = true
			if err := repo.updateSessionSettings(ctx, session.OrganizationID, session.ID, settings); err != nil {
				return err
			}
			settingsChanged = false
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
		if err := repo.updateSessionSettings(ctx, session.OrganizationID, session.ID, settings); err != nil {
			return err
		}
		settingsChanged = false
	}

	statusResult, err := repo.functions.invokeEvolution(ctx, "instance.status", map[string]any{
		"session_id":  session.ID,
		"instance_id": instanceKey,
		"token":       token,
	})
	if err != nil {
		if errors.Is(err, ErrProviderFailed) {
			_ = repo.markSessionDisconnected(ctx, session.OrganizationID, session.ID)
			return nil
		}
		return err
	}
	repo.updateSessionStatusFromProvider(ctx, session, statusResult)

	if settingsChanged {
		return repo.updateSessionSettings(ctx, session.OrganizationID, session.ID, settings)
	}
	return nil
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
	if !webhookRolloutAllowsSession(allowlist, sessionID) && !webhookRolloutManaged(settings) && strings.EqualFold(strings.TrimSpace(status), "disconnected") {
		// Keep the existing disconnected-session supervision without sending any
		// webhook, subscription or advanced-setting fields to the provider.
		return map[string]any{}, true, false
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
	rolloutAllowed := webhookRolloutAllowsSession(allowlist, sessionID)
	rollbackManaged := !rolloutAllowed && webhookRolloutManaged(settings)
	if (!rolloutAllowed && !rollbackManaged) || strings.TrimSpace(expectedURL) == "" {
		return false
	}
	if rollbackManaged {
		// The marker is the source of truth for rollback. Re-apply the legacy URL
		// even if cached settings already claim it, then clear the marker only
		// after the provider accepts the request.
		return true
	}

	return webhookConfigurationDue(settings, expectedURL) || strings.EqualFold(strings.TrimSpace(status), "disconnected")
}

func webhookRolloutManaged(settings map[string]any) bool {
	managed, ok := settings[whatsappWebhookRolloutManagedSetting].(bool)
	return ok && managed
}

func setWebhookRolloutManaged(settings map[string]any, managed bool) {
	if managed {
		settings[whatsappWebhookRolloutManagedSetting] = true
		return
	}
	delete(settings, whatsappWebhookRolloutManagedSetting)
	delete(settings, "notification_safe_settings_version")
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

func (repo Repository) updateSessionStatusFromProvider(ctx context.Context, session Session, result map[string]any) {
	if !providerResultOK(result) {
		_ = repo.markSessionDisconnected(ctx, session.OrganizationID, session.ID)
		return
	}

	normalizedStatus := firstString(result, "normalizedStatus")
	if normalizedStatus == "" {
		normalizedStatus = normalizeEvolutionStatus(result["data"])
	}
	if normalizedStatus == "" {
		return
	}

	if normalizedStatus == "connected" {
		rawData := firstMap(result, "data.data", "data.instance", "data.session", "data", "instance", "session")
		wuid := firstString(rawData, "jid", "Jid", "wuid", "ownerJid", "phone", "number", "Name", "name")
		phone := strings.Split(wuid, "@")[0]
		_, _ = repo.db.Pool().Exec(ctx, `
			update public.whatsapp_sessions
			set status = 'connected',
			    phone_number = nullif($3, ''),
			    last_connected_at = now(),
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
		`, session.OrganizationID, session.ID, phone)
		return
	}

	if normalizedStatus == "qr_ready" || normalizedStatus == "disconnected" {
		_, _ = repo.db.Pool().Exec(ctx, `
			update public.whatsapp_sessions
			set status = $3,
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
		`, session.OrganizationID, session.ID, normalizedStatus)
	}
}
