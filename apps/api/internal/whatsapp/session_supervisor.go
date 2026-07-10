package whatsapp

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"
)

const (
	whatsappSessionSupervisorInitialDelay = 90 * time.Second
	whatsappSessionSupervisorInterval     = 10 * time.Minute
	whatsappWebhookRefreshInterval        = 15 * time.Minute
	whatsappSupervisorBatchLimit          = 5
)

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
		order by ws.updated_at asc, ws.id asc
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
	if configuredWebhookURL != "" && webhookRefreshDue(settings, configuredWebhookURL, now) {
		result, err := repo.functions.invokeEvolution(ctx, "instance.connect", map[string]any{
			"session_id":  session.ID,
			"instance_id": instanceKey,
			"token":       token,
			"body":        evolutionWebhookConnectBody(configuredWebhookURL),
		})
		if err != nil {
			return err
		}
		settings["webhook_url"] = configuredWebhookURL
		settings["webhook_last_configured_at"] = now.Format(time.RFC3339)
		settings["evolution_go_resolved_instance_key"] = instanceKey
		settingsChanged = true
		if providerNotificationSafeApplied(result) {
			settings["notification_safe_settings_applied_at"] = now.Format(time.RFC3339)
		}
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

func evolutionWebhookConnectBody(webhookURL string) map[string]any {
	return withoutEmptyMap(map[string]any{
		"webhookUrl":  webhookURL,
		"webhook_url": webhookURL,
		"url":         webhookURL,
		"subscribe":   []string{"ALL"},
		"events":      []string{"ALL"},
		"immediate":   true,
		"advancedSettings": map[string]any{
			"rejectCall":      false,
			"groupsIgnore":    false,
			"alwaysOnline":    true,
			"readMessages":    false,
			"readStatus":      false,
			"syncFullHistory": false,
		},
	})
}

func webhookRefreshDue(settings map[string]any, expectedURL string, now time.Time) bool {
	if strings.TrimSpace(stringFromMap(settings, "webhook_url")) != expectedURL {
		return true
	}
	configuredAt := strings.TrimSpace(stringFromMap(settings, "webhook_last_configured_at"))
	if configuredAt == "" {
		return true
	}
	parsed, err := time.Parse(time.RFC3339, configuredAt)
	if err != nil {
		return true
	}
	return now.Sub(parsed) >= whatsappWebhookRefreshInterval
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
