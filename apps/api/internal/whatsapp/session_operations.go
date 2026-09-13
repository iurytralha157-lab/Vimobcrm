package whatsapp

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

var errWhatsAppSessionLifecycleConflict = errors.New("whatsapp session lifecycle fence changed")

func (repo Repository) CreateSession(ctx context.Context, tenantContext tenant.Context, input createSessionInput) (SessionOperationResponse, error) {
	sessionID, err := createWhatsAppSessionID()
	if err != nil {
		return SessionOperationResponse{}, fmt.Errorf("%w: could not allocate WhatsApp session identity: %v", ErrProviderFailed, err)
	}
	operationID := newSessionLifecycleOperationID(sessionID, "create")
	unlock, _, err := repo.acquireWhatsAppSessionCreateLock(ctx, tenantContext.OrganizationID, sessionID, true)
	if err != nil {
		return SessionOperationResponse{}, err
	}
	defer unlock()

	if err := repo.ensureCanCreateSession(ctx, tenantContext); err != nil {
		return SessionOperationResponse{}, err
	}

	token := createSecretToken()
	webhookToken := createSecretToken()
	instanceName := createInstanceName(input.DisplayName, tenantContext.OrganizationID)
	settings := map[string]any{
		"token":                              token,
		"webhook_token":                      webhookToken,
		"evolution_go_resolved_instance_key": instanceName,
		"ai_auto_reply_enabled":              false,
		// A freshly inserted row is not recoverable until provider create,
		// connect and the final local write have all converged. Keeping recovery
		// disabled makes a process crash visible instead of starting a blind
		// second create from the supervisor.
		"auto_reconnect_enabled":        false,
		"auto_reconnect_blocked_reason": "lifecycle_in_progress",
		"lifecycle_operation":           "create",
		"lifecycle_operation_id":        operationID,
		"lifecycle_state":               "creating",
		"lifecycle_updated_at":          time.Now().UTC().Format(time.RFC3339Nano),
	}

	session, err := scanSession(repo.db.Pool().QueryRow(ctx, `
		with inserted as (
			insert into public.whatsapp_sessions (
				id,
				organization_id,
				owner_user_id,
				instance_name,
				display_name,
				status,
				provider,
				advanced_settings,
				is_active
			)
			values (
				$1::uuid,
				$2::uuid,
				$3::uuid,
				$4,
				$5,
				'disconnected',
				'evolution_go',
				$6::jsonb,
				true
			)
			returning *
		)
		select `+sessionSelectFields()+`
		from inserted ws
		left join public.users owner on owner.id = ws.owner_user_id
	`, sessionID, tenantContext.OrganizationID, tenantContext.UserID, instanceName, input.DisplayName, jsonb(settings)))
	if err != nil {
		return SessionOperationResponse{}, err
	}
	initialWebhookURL := repo.functions.configuredEvolutionWebhookURL(session.ID, instanceName)
	if initialWebhookURL == "" {
		cause := fmt.Errorf("%w: Evolution Go backend webhook is not configured", ErrProviderFailed)
		return SessionOperationResponse{}, repo.finishFailedCreateSession(
			ctx,
			tenantContext.OrganizationID,
			session,
			instanceName,
			cause,
			false,
			operationID,
		)
	}
	createBody := evolutionWebhookConnectBody(initialWebhookURL)
	createBody["name"] = instanceName
	createBody["token"] = token

	createResult, err := repo.functions.invokeEvolution(ctx, "instance.create", map[string]any{
		"session_id":                            session.ID,
		evolutionLifecycleOperationIDPayloadKey: operationID,
		"body":                                  createBody,
	})
	if err != nil {
		return SessionOperationResponse{}, repo.finishFailedCreateSession(
			ctx,
			tenantContext.OrganizationID,
			session,
			instanceName,
			err,
			false,
			operationID,
		)
	}

	evoID := evolutionInstanceID(createResult)
	providerInstanceKey := firstNonEmpty(evoID, instanceName)
	settings["token"] = token
	settings["evolution_go_resolved_instance_key"] = providerInstanceKey
	settings["lifecycle_state"] = "connecting_provider_instance"
	settings["lifecycle_updated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	if err := repo.updateSessionInstance(ctx, tenantContext.OrganizationID, session.ID, evoID, settings, operationID); err != nil {
		return SessionOperationResponse{}, repo.finishFailedCreateSession(ctx, tenantContext.OrganizationID, session, providerInstanceKey, err, true, operationID)
	}

	webhookInstanceID := evoID
	if webhookInstanceID == "" {
		webhookInstanceID = instanceName
	}
	configuredWebhookURL := repo.functions.configuredEvolutionWebhookURL(session.ID, webhookInstanceID)
	_, err = repo.functions.invokeEvolution(ctx, "instance.connect", map[string]any{
		"session_id":                            session.ID,
		"instance_id":                           evoID,
		evolutionInstanceKeyOverridePayloadKey:  providerInstanceKey,
		evolutionLifecycleOperationIDPayloadKey: operationID,
		"token":                                 token,
		"body":                                  evolutionWebhookConnectBody(configuredWebhookURL),
	})
	if err != nil {
		return SessionOperationResponse{}, repo.finishFailedCreateSession(
			ctx,
			tenantContext.OrganizationID,
			session,
			firstNonEmpty(evoID, instanceName),
			err,
			true,
			operationID,
		)
	}

	settings["token"] = token
	settings["webhook_token"] = webhookToken
	settings["evolution_go_resolved_instance_key"] = firstPresentAny(evoID, instanceName)
	settings["auto_reconnect_enabled"] = true
	clearSessionLifecycleSettings(settings)
	settings["webhook_url"] = configuredWebhookURL
	settings["webhook_last_configured_at"] = time.Now().UTC().Format(time.RFC3339)
	settings["webhook_subscription_version"] = whatsappWebhookSubscriptionVersion
	delete(settings, "webhook_rollout_managed")
	if err := repo.updateSessionInstance(ctx, tenantContext.OrganizationID, session.ID, evoID, settings, operationID); err != nil {
		return SessionOperationResponse{}, repo.finishFailedCreateSession(
			ctx,
			tenantContext.OrganizationID,
			session,
			firstNonEmpty(evoID, instanceName),
			err,
			true,
			operationID,
		)
	}

	session, err = repo.GetSession(ctx, tenantContext, session.ID)
	if err != nil {
		return SessionOperationResponse{}, err
	}

	return SessionOperationResponse{Session: session}, nil
}

func (repo Repository) DeleteSession(ctx context.Context, tenantContext tenant.Context, sessionID string) error {
	session, err := repo.GetManageableSession(ctx, tenantContext, sessionID)
	if err != nil {
		return err
	}
	unlock, _, err := repo.acquireWhatsAppSessionLock(ctx, session.ID, true)
	if err != nil {
		return err
	}
	defer unlock()
	// State may have changed while an in-flight supervisor operation held the
	// lock, so authorization and lifecycle state are read again under it.
	session, err = repo.GetManageableSession(ctx, tenantContext, session.ID)
	if err != nil {
		return err
	}
	operationID, err := repo.beginSessionLifecycle(ctx, session, "delete", true)
	if err != nil {
		return err
	}

	if session.Provider == "evolution_go" {
		result, providerErr := repo.functions.invokeEvolution(ctx, "instance.delete", map[string]any{
			"session_id":                            session.ID,
			evolutionLifecycleOperationIDPayloadKey: operationID,
			"instanceName":                          session.InstanceName,
			"instance_id":                           stringPtrValue(session.InstanceID),
		})
		if providerErr = confirmedEvolutionTerminalMutation("instance.delete", result, providerErr); providerErr != nil {
			stateErr := repo.recordSessionLifecycleFailure(ctx, session, "delete", "reconciliation_required", providerErr, true, operationID)
			return errors.Join(providerErr, stateErr)
		}
	}

	return repo.deleteSessionRow(ctx, tenantContext.OrganizationID, session.ID, operationID)
}

func (repo Repository) GetQRCode(ctx context.Context, tenantContext tenant.Context, sessionID string) (QRCodeResponse, error) {
	session, err := repo.GetSession(ctx, tenantContext, sessionID)
	if err != nil {
		return QRCodeResponse{}, err
	}
	unlock, _, err := repo.acquireWhatsAppSessionLock(ctx, session.ID, true)
	if err != nil {
		return QRCodeResponse{}, err
	}
	defer unlock()
	session, err = repo.GetSession(ctx, tenantContext, session.ID)
	if err != nil {
		return QRCodeResponse{}, err
	}
	if session.Provider != "evolution_go" {
		return QRCodeResponse{}, fmt.Errorf("%w: legacy Evolution provider is disabled", ErrInvalidInput)
	}
	result, err := repo.functions.invokeEvolution(ctx, "instance.qr", map[string]any{
		"session_id":  session.ID,
		"instance_id": stringPtrValue(session.InstanceID),
	})
	if err != nil {
		if errors.Is(err, ErrProviderFailed) {
			if isProviderDisconnectedError(err) || isProviderMissingInstanceError(err) {
				_ = repo.markSessionDisconnected(ctx, tenantContext.OrganizationID, session.ID)
			}
			return QRCodeResponse{}, nil
		}
		return QRCodeResponse{}, err
	}
	if !providerResultOK(result) {
		message := providerErrorMessage(result, "QR Code ainda nao disponivel.")
		if firstString(result, "status", "data.status") == "404" || isProviderDisconnectedMessage(message) {
			_ = repo.markSessionDisconnected(ctx, tenantContext.OrganizationID, session.ID)
		}
		return QRCodeResponse{}, nil
	}

	qr := firstString(result, "data.data.qrcode", "data.qrcode", "data.Qrcode", "qrcode", "Qrcode")
	if qr != "" {
		_, _ = repo.db.Pool().Exec(ctx, `
			update public.whatsapp_sessions
			set status = 'qr_ready',
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
			  and status <> 'connected'
		`, tenantContext.OrganizationID, session.ID)
	}

	return QRCodeResponse{Base64: qr, QRCode: qr}, nil
}

func (repo Repository) GetConnectionStatus(ctx context.Context, tenantContext tenant.Context, sessionID string) (ConnectionStatusResponse, error) {
	session, err := repo.GetSession(ctx, tenantContext, sessionID)
	if err != nil {
		return ConnectionStatusResponse{}, err
	}
	unlock, _, err := repo.acquireWhatsAppSessionProbeLock(ctx, session.ID, true)
	if err != nil {
		return ConnectionStatusResponse{}, err
	}
	defer unlock()
	session, err = repo.GetSession(ctx, tenantContext, session.ID)
	if err != nil {
		return ConnectionStatusResponse{}, err
	}
	if session.Provider != "evolution_go" {
		return ConnectionStatusResponse{}, fmt.Errorf("%w: legacy Evolution provider is disabled", ErrInvalidInput)
	}

	result, err := repo.functions.invokeEvolution(ctx, "instance.status", map[string]any{
		"session_id":  session.ID,
		"instance_id": stringPtrValue(session.InstanceID),
	})
	if err != nil {
		if errors.Is(err, ErrProviderOutcomeUnknown) {
			return ConnectionStatusResponse{}, err
		}
		if isProviderDisconnectedError(err) {
			_ = repo.markSessionDisconnected(ctx, tenantContext.OrganizationID, session.ID)
			return ConnectionStatusResponse{
				Connected:        false,
				Status:           "disconnected",
				State:            "close",
				InstanceNotFound: isProviderMissingInstanceError(err),
			}, nil
		}
		return ConnectionStatusResponse{}, err
	}

	normalizedStatus, authoritative, instanceMissing := evolutionConnectionObservation(result)
	if !authoritative {
		return ConnectionStatusResponse{}, fmt.Errorf("%w: Evolution Go connection status is unavailable", ErrProviderOutcomeUnknown)
	}
	if err := repo.updateSessionStatusFromProvider(ctx, session, normalizedStatus, result); err != nil {
		return ConnectionStatusResponse{}, err
	}
	connected := normalizedStatus == "connected"
	state := "close"
	if connected {
		state = "open"
	} else if normalizedStatus == "qr_ready" {
		state = "qr"
	}

	rawData := firstMap(result, "data.data", "data.instance", "data.session", "data", "instance", "session")
	wuid := firstString(rawData, "jid", "Jid", "wuid", "ownerJid", "phone", "number", "user.id")
	return ConnectionStatusResponse{
		Connected:        connected,
		Status:           normalizedStatus,
		State:            state,
		InstanceNotFound: instanceMissing,
		Instance: map[string]any{
			"wuid": wuid,
		},
		RawResponse: nil,
		RawStatus:   nil,
	}, nil
}

func (repo Repository) RecreateSession(ctx context.Context, tenantContext tenant.Context, sessionID string) (SessionOperationResponse, error) {
	session, err := repo.GetManageableSession(ctx, tenantContext, sessionID)
	if err != nil {
		return SessionOperationResponse{}, err
	}
	unlock, _, err := repo.acquireWhatsAppSessionLock(ctx, session.ID, true)
	if err != nil {
		return SessionOperationResponse{}, err
	}
	defer unlock()
	session, err = repo.GetManageableSession(ctx, tenantContext, session.ID)
	if err != nil {
		return SessionOperationResponse{}, err
	}
	if session.Provider != "evolution_go" {
		return SessionOperationResponse{}, fmt.Errorf("%w: legacy Evolution provider is disabled", ErrInvalidInput)
	}

	token := stringFromMap(session.AdvancedSettings, "token")
	if token == "" {
		token = createSecretToken()
	}
	webhookToken := stringFromMap(session.AdvancedSettings, "webhook_token")
	if webhookToken == "" {
		webhookToken = createSecretToken()
	}
	initialWebhookURL := repo.functions.configuredEvolutionWebhookURL(session.ID, session.InstanceName)
	if initialWebhookURL == "" {
		return SessionOperationResponse{}, fmt.Errorf("%w: Evolution Go backend webhook is not configured", ErrProviderFailed)
	}

	operationID, err := repo.beginSessionLifecycle(ctx, session, "recreate", false)
	if err != nil {
		return SessionOperationResponse{}, err
	}
	session, err = repo.GetManageableSession(ctx, tenantContext, session.ID)
	if err != nil {
		return SessionOperationResponse{}, err
	}
	settings := ensureAutoReplyDefaults(cloneMap(session.AdvancedSettings))
	settings["token"] = token
	settings["webhook_token"] = webhookToken
	settings["lifecycle_state"] = "deleting_previous_instance"
	settings["lifecycle_updated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	if webhookRolloutAllowsSession(repo.functions.webhookRolloutSessionIDs, session.ID) {
		delete(settings, "notification_safe_settings_applied_at")
		delete(settings, "notification_safe_settings_version")
	}
	if err := repo.persistSessionLifecycleSettings(ctx, tenantContext.OrganizationID, session.ID, settings, operationID); err != nil {
		return SessionOperationResponse{}, err
	}
	session.AdvancedSettings = settings

	deleteResult, deleteErr := repo.functions.invokeEvolution(ctx, "instance.delete", map[string]any{
		"session_id":                            session.ID,
		evolutionLifecycleOperationIDPayloadKey: operationID,
		"instanceName":                          session.InstanceName,
		"instance_id":                           stringPtrValue(session.InstanceID),
		"token":                                 token,
	})
	if deleteErr = confirmedEvolutionTerminalMutation("instance.delete", deleteResult, deleteErr); deleteErr != nil {
		stateErr := repo.recordSessionLifecycleFailure(ctx, session, "recreate", "reconciliation_required", deleteErr, false, operationID)
		return SessionOperationResponse{}, errors.Join(deleteErr, stateErr)
	}
	settings["lifecycle_state"] = "creating_replacement_instance"
	settings["lifecycle_updated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	if err := repo.persistSessionLifecycleSettings(ctx, tenantContext.OrganizationID, session.ID, settings, operationID); err != nil {
		return SessionOperationResponse{}, repo.finishFailedRecreateSession(ctx, session, session.InstanceName, err, false, operationID)
	}

	createBody := evolutionWebhookConnectBody(initialWebhookURL)
	createBody["name"] = session.InstanceName
	createBody["token"] = token

	createResult, err := repo.functions.invokeEvolution(ctx, "instance.create", map[string]any{
		"session_id":                            session.ID,
		evolutionLifecycleOperationIDPayloadKey: operationID,
		"body":                                  createBody,
	})
	if err != nil {
		return SessionOperationResponse{}, repo.finishFailedRecreateSession(
			ctx,
			session,
			session.InstanceName,
			err,
			false,
			operationID,
		)
	}

	evoID := evolutionInstanceID(createResult)
	providerInstanceKey := firstNonEmpty(evoID, session.InstanceName)
	configuredWebhookURL := repo.functions.configuredEvolutionWebhookURL(session.ID, providerInstanceKey)
	settings["evolution_go_resolved_instance_key"] = providerInstanceKey
	settings["lifecycle_state"] = "connecting_replacement_instance"
	settings["lifecycle_updated_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	if err := repo.updateSessionInstance(ctx, tenantContext.OrganizationID, session.ID, evoID, settings, operationID); err != nil {
		return SessionOperationResponse{}, repo.finishFailedRecreateSession(ctx, session, providerInstanceKey, err, true, operationID)
	}
	session.AdvancedSettings = settings
	_, err = repo.functions.invokeEvolution(ctx, "instance.connect", map[string]any{
		"session_id":                            session.ID,
		"instance_id":                           evoID,
		evolutionInstanceKeyOverridePayloadKey:  providerInstanceKey,
		evolutionLifecycleOperationIDPayloadKey: operationID,
		"token":                                 token,
		"body":                                  evolutionWebhookConnectBody(configuredWebhookURL),
	})
	if err != nil {
		return SessionOperationResponse{}, repo.finishFailedRecreateSession(
			ctx,
			session,
			firstNonEmpty(evoID, session.InstanceName),
			err,
			true,
			operationID,
		)
	}

	settings["token"] = token
	settings["webhook_token"] = webhookToken
	settings["evolution_go_resolved_instance_key"] = providerInstanceKey
	settings["auto_reconnect_enabled"] = true
	clearSessionLifecycleSettings(settings)
	settings["webhook_url"] = configuredWebhookURL
	settings["webhook_last_configured_at"] = time.Now().UTC().Format(time.RFC3339)
	settings["webhook_subscription_version"] = whatsappWebhookSubscriptionVersion
	delete(settings, "webhook_rollout_managed")

	if err := repo.updateSessionInstance(ctx, tenantContext.OrganizationID, session.ID, evoID, settings, operationID); err != nil {
		return SessionOperationResponse{}, repo.finishFailedRecreateSession(
			ctx,
			session,
			firstNonEmpty(evoID, session.InstanceName),
			err,
			true,
			operationID,
		)
	}

	session, err = repo.GetSession(ctx, tenantContext, session.ID)
	if err != nil {
		return SessionOperationResponse{}, err
	}

	return SessionOperationResponse{Session: session}, nil
}

func (repo Repository) LogoutSession(ctx context.Context, tenantContext tenant.Context, sessionID string) (map[string]any, error) {
	session, err := repo.GetManageableSession(ctx, tenantContext, sessionID)
	if err != nil {
		return nil, err
	}
	unlock, _, err := repo.acquireWhatsAppSessionLock(ctx, session.ID, true)
	if err != nil {
		return nil, err
	}
	defer unlock()
	session, err = repo.GetManageableSession(ctx, tenantContext, session.ID)
	if err != nil {
		return nil, err
	}
	if session.Provider != "evolution_go" {
		return nil, fmt.Errorf("%w: legacy Evolution provider is disabled", ErrInvalidInput)
	}
	operationID, err := repo.beginSessionLifecycle(ctx, session, "logout", true)
	if err != nil {
		return nil, err
	}

	result, err := repo.functions.invokeEvolution(ctx, "instance.logout", map[string]any{
		"session_id":                            session.ID,
		evolutionLifecycleOperationIDPayloadKey: operationID,
		"instance_id":                           stringPtrValue(session.InstanceID),
	})
	if err = confirmedEvolutionTerminalMutation("instance.logout", result, err); err != nil {
		stateErr := repo.recordSessionLifecycleFailure(ctx, session, "logout", "reconciliation_required", err, true, operationID)
		return nil, errors.Join(err, stateErr)
	}
	if !providerResultOK(result) {
		result = map[string]any{
			"ok":               true,
			"status":           "disconnected",
			"provider_warning": providerErrorMessage(result, "provider already disconnected"),
		}
	}
	if err := repo.markSessionLoggedOut(ctx, tenantContext.OrganizationID, session.ID, operationID); err != nil {
		return nil, err
	}

	return result, nil
}

func (repo Repository) markSessionDisconnected(ctx context.Context, organizationID string, sessionID string) error {
	_, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_sessions
		set status = 'disconnected',
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and coalesce(is_active, true) = true
		  and coalesce(status, '') not in ('deleted', 'disabled')
	`, organizationID, sessionID)
	return err
}

func (repo Repository) markSessionLoggedOut(ctx context.Context, organizationID string, sessionID string, operationID string) error {
	command, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_sessions
		set status = 'disconnected',
		    is_notification_session = false,
		    advanced_settings = (
		      coalesce(advanced_settings, '{}'::jsonb)
		      - 'auto_reconnect_failure_count'
		      - 'auto_reconnect_retry_after'
		      - 'auto_reconnect_blocked_reason'
		      - 'auto_reconnect_grace_observed_at'
		      - 'lifecycle_operation'
		      - 'lifecycle_operation_id'
		      - 'lifecycle_state'
		      - 'lifecycle_error_code'
		      - 'lifecycle_updated_at'
		      - 'notification_sender_selected_by_user_id'
		      - 'notification_sender_selected_at'
		    ) || jsonb_build_object(
		      'auto_reconnect_enabled', false,
		      'auto_reconnect_blocked_reason', 'user_logged_out'
		    ),
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and coalesce(is_active, true) = true
		  and coalesce(status, '') not in ('deleted', 'disabled')
		  and coalesce(advanced_settings->>'lifecycle_operation_id', '') = $3
	`, organizationID, sessionID, operationID)
	return requireSessionLifecycleWrite(command, err)
}

func (repo Repository) setSessionAutoReconnect(ctx context.Context, organizationID string, sessionID string, enabled bool, blockedReason string) error {
	patch := map[string]any{"auto_reconnect_enabled": enabled}
	if strings.TrimSpace(blockedReason) != "" {
		patch["auto_reconnect_blocked_reason"] = strings.TrimSpace(blockedReason)
	}
	_, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_sessions
		set advanced_settings = (
		      coalesce(advanced_settings, '{}'::jsonb)
		      - 'auto_reconnect_failure_count'
		      - 'auto_reconnect_retry_after'
		      - 'auto_reconnect_blocked_reason'
		      - 'auto_reconnect_grace_observed_at'
		    ) || $3::jsonb,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and coalesce(is_active, true) = true
		  and coalesce(status, '') not in ('deleted', 'disabled')
	`, organizationID, sessionID, jsonb(patch))
	return err
}

func (repo Repository) ToggleNotificationSession(ctx context.Context, tenantContext tenant.Context, sessionID string, enabled bool) error {
	if !canManageNotificationSender(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}

	sessionID, ok := normalizeUUID(sessionID)
	if !ok {
		return ErrSessionNotFound
	}
	if err := repo.ensureCanManageSession(ctx, tenantContext, sessionID); err != nil {
		return err
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Serialize changes per organization so two concurrent requests cannot leave
	// more than one notification sender selected.
	if _, err = tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 0))`, tenantContext.OrganizationID); err != nil {
		return err
	}
	if err = revalidateNotificationSenderAdmin(ctx, tx, tenantContext); err != nil {
		return err
	}
	if enabled {
		if _, err = tx.Exec(ctx, `
			update public.whatsapp_sessions
			set is_notification_session = false,
			    advanced_settings = coalesce(advanced_settings, '{}'::jsonb)
			      - 'notification_sender_selected_by_user_id'
			      - 'notification_sender_selected_at',
			    updated_at = now()
			where organization_id = $1::uuid
			  and is_notification_session = true
			  and id <> $2::uuid
		`, tenantContext.OrganizationID, sessionID); err != nil {
			return err
		}
	}

	command, err := tx.Exec(ctx, `
		update public.whatsapp_sessions
		set is_notification_session = $3::boolean,
		    advanced_settings = case
		      when $3::boolean then coalesce(advanced_settings, '{}'::jsonb) || jsonb_build_object(
		        'notification_sender_selected_by_user_id', $4::text,
		        'notification_sender_selected_at', now()
		      )
		      else coalesce(advanced_settings, '{}'::jsonb)
		        - 'notification_sender_selected_by_user_id'
		        - 'notification_sender_selected_at'
		    end,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and provider = 'evolution_go'
		  and coalesce(is_active, true) = true
		  and coalesce(status, '') not in ('deleted', 'disabled')
		  and (not $3::boolean or status = 'connected')
	`, tenantContext.OrganizationID, sessionID, enabled, tenantContext.UserID)
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return ErrSessionNotFound
	}
	return tx.Commit(ctx)
}

func canManageNotificationSender(tenantContext tenant.Context) bool {
	return tenantContext.HasRole("owner", "admin")
}

func revalidateNotificationSenderAdmin(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context) error {
	userID, ok := normalizeUUID(tenantContext.UserID)
	if !ok {
		return tenant.ErrOrganizationAccessDenied
	}
	if tenantContext.IsSuperAdmin {
		var role string
		err := tx.QueryRow(ctx, `
			select lower(coalesce(nullif(actor.role, ''), ''))
			from public.users actor
			where actor.id = $1::uuid
			  and coalesce(actor.is_active, false) = true
			  and lower(coalesce(actor.role, '')) = 'super_admin'
			for update of actor
		`, userID).Scan(&role)
		if errors.Is(err, pgx.ErrNoRows) {
			return tenant.ErrOrganizationAccessDenied
		}
		return err
	}

	organizationID, ok := normalizeUUID(tenantContext.OrganizationID)
	if !ok {
		return tenant.ErrOrganizationAccessDenied
	}
	var role string
	err := tx.QueryRow(ctx, `
		select lower(coalesce(nullif(member.role, ''), 'user'))
		from public.organization_members member
		join public.users actor on actor.id = member.user_id
		join public.organizations organization on organization.id = member.organization_id
		where member.organization_id = $1::uuid
		  and member.user_id = $2::uuid
		  and coalesce(member.is_active, false) = true
		  and member.deleted_at is null
		  and coalesce(actor.is_active, false) = true
		  and coalesce(organization.is_active, true) = true
		for update of member, actor, organization
	`, organizationID, userID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return tenant.ErrOrganizationAccessDenied
	}
	if err != nil {
		return err
	}
	if role != "owner" && role != "admin" {
		return tenant.ErrOrganizationAccessDenied
	}
	return nil
}

func (repo Repository) ToggleAutoReplySession(ctx context.Context, tenantContext tenant.Context, sessionID string, input ToggleAutoReplyRequest) error {
	sessionID, ok := normalizeUUID(sessionID)
	if !ok {
		return ErrSessionNotFound
	}
	if err := repo.ensureCanManageSession(ctx, tenantContext, sessionID); err != nil {
		return err
	}
	agentID := strings.TrimSpace(input.AgentID)
	if input.Enabled {
		allowed, err := repo.isOrganizationAIModuleEnabled(ctx, tenantContext.OrganizationID)
		if err != nil {
			return err
		}
		if !allowed {
			return fmt.Errorf("%w: IA nao liberada para esta organizacao.", ErrFeatureUnavailable)
		}
		aiSettings, err := repo.organizationAISettings(ctx, tenantContext.OrganizationID)
		if err != nil {
			return err
		}
		if !aiSettings.Enabled {
			return fmt.Errorf("%w: IA pausada para esta organizacao.", ErrFeatureUnavailable)
		}
		if aiSettings.MaxSessions >= 0 {
			activeCount, err := repo.activeAISessionCount(ctx, tenantContext.OrganizationID, sessionID)
			if err != nil {
				return err
			}
			if activeCount >= aiSettings.MaxSessions {
				return fmt.Errorf("%w: limite de conexoes da IA atingido.", ErrFeatureUnavailable)
			}
		}
		if agentID != "" {
			agentID, ok = normalizeUUID(agentID)
			if !ok {
				return ErrInvalidReference
			}
			exists, err := repo.aiAgentAvailable(ctx, tenantContext.OrganizationID, agentID)
			if err != nil {
				return err
			}
			if !exists {
				return ErrInvalidReference
			}
		}
	}
	if input.FollowUpIntervalDays != nil {
		if *input.FollowUpIntervalDays < 1 || *input.FollowUpIntervalDays > 30 {
			return ErrInvalidInput
		}
	}

	settingsPatch := map[string]any{
		"ai_auto_reply_enabled":    input.Enabled,
		"ai_auto_reply_updated_at": time.Now().UTC().Format(time.RFC3339),
	}
	if agentID != "" {
		settingsPatch["ai_auto_reply_agent_id"] = agentID
	}
	if input.FollowUpEnabled != nil {
		settingsPatch["ai_follow_up_enabled"] = *input.FollowUpEnabled
	}
	if input.FollowUpIntervalDays != nil {
		settingsPatch["ai_follow_up_interval_days"] = *input.FollowUpIntervalDays
	}
	if input.FollowUpTemplate != nil {
		settingsPatch["ai_follow_up_template"] = strings.TrimSpace(*input.FollowUpTemplate)
	}

	_, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_sessions
		set advanced_settings = coalesce(advanced_settings, '{}'::jsonb) || $3::jsonb,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, sessionID, jsonb(settingsPatch))
	return err
}

func (repo Repository) isOrganizationAIModuleEnabled(ctx context.Context, organizationID string) (bool, error) {
	var enabled bool
	err := repo.db.Pool().QueryRow(ctx, `
		select coalesce((
			select om.is_enabled
			from public.organization_modules om
			where om.organization_id = $1::uuid
			  and om.module_name = any(array['ai_agent', 'ai'])
			limit 1
		), false)
	`, organizationID).Scan(&enabled)
	return enabled, err
}

type organizationAISettings struct {
	Enabled     bool
	MaxSessions int
}

func (repo Repository) organizationAISettings(ctx context.Context, organizationID string) (organizationAISettings, error) {
	var settings organizationAISettings
	err := repo.db.Pool().QueryRow(ctx, `
		select
			coalesce(is_enabled, false),
			coalesce(max_sessions, 0)
		from public.organization_ai_settings
		where organization_id = $1::uuid
		limit 1
	`, organizationID).Scan(&settings.Enabled, &settings.MaxSessions)
	if errors.Is(err, pgx.ErrNoRows) {
		return organizationAISettings{Enabled: true, MaxSessions: 1}, nil
	}
	return settings, err
}

func (repo Repository) activeAISessionCount(ctx context.Context, organizationID string, excludeSessionID string) (int, error) {
	var count int
	err := repo.db.Pool().QueryRow(ctx, `
		select count(*)::int
		from public.whatsapp_sessions
		where organization_id = $1::uuid
		  and id <> $2::uuid
		  and coalesce(is_active, true) = true
		  and lower(coalesce(advanced_settings->>'ai_auto_reply_enabled', 'false')) in ('true', '1', 'yes', 'sim')
	`, organizationID, excludeSessionID).Scan(&count)
	return count, err
}

func (repo Repository) aiAgentAvailable(ctx context.Context, organizationID string, agentID string) (bool, error) {
	var exists bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.ai_agents
			where id = $1::uuid
			  and status = 'active'
			  and (organization_id is null or organization_id = $2::uuid)
		)
	`, agentID, organizationID).Scan(&exists)
	return exists, err
}

func (repo Repository) GetManageableSession(ctx context.Context, tenantContext tenant.Context, sessionID string) (Session, error) {
	sessionID, ok := normalizeUUID(sessionID)
	if !ok {
		return Session{}, ErrSessionNotFound
	}

	session, err := scanSession(repo.db.Pool().QueryRow(ctx, `
		select `+sessionSelectFields()+`
		from public.whatsapp_sessions ws
		left join public.users owner on owner.id = ws.owner_user_id
		where ws.organization_id = $1::uuid
		  and ws.id = $2::uuid
		  and coalesce(ws.is_active, true) = true
		  and coalesce(ws.status, '') <> 'deleted'
		  and ws.owner_user_id = $3::uuid
		limit 1
	`, tenantContext.OrganizationID, sessionID, tenantContext.UserID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrSessionNotFound
	}
	if err != nil {
		return Session{}, err
	}

	return session, nil
}

func (repo Repository) ensureCanCreateSession(ctx context.Context, tenantContext tenant.Context) error {
	quota, err := repo.GetSessionQuota(ctx, tenantContext.OrganizationID)
	if err != nil {
		return err
	}
	if !canCreateOwnWhatsAppSessionWithQuota(tenantContext, quota) {
		return tenant.ErrOrganizationAccessDenied
	}
	if quota.MaxSessions == nil || *quota.MaxSessions <= 0 || quota.CurrentSessions < *quota.MaxSessions {
		return nil
	}

	return fmt.Errorf("%w: Limite do plano atingido: maximo de %d WhatsApp%s.", ErrInvalidInput, *quota.MaxSessions, pluralSuffix(*quota.MaxSessions))
}

func (repo Repository) GetSessionQuota(ctx context.Context, organizationID string) (SessionQuota, error) {
	var maxSessions *int
	err := repo.db.Pool().QueryRow(ctx, `
		select coalesce(org.max_whatsapp_sessions_override, plan.max_whatsapp_sessions)::integer
		from public.organizations org
		left join public.admin_subscription_plans plan on plan.id = org.plan_id
		where org.id = $1::uuid
	`, organizationID).Scan(&maxSessions)
	if errors.Is(err, pgx.ErrNoRows) {
		return SessionQuota{}, tenant.ErrOrganizationAccessDenied
	}
	if err != nil {
		return SessionQuota{}, err
	}

	var count int
	if err := repo.db.Pool().QueryRow(ctx, `
		select count(*)::integer
		from public.whatsapp_sessions
		where organization_id = $1::uuid
		  and coalesce(is_active, true) = true
		  and coalesce(status, '') <> 'deleted'
	`, organizationID).Scan(&count); err != nil {
		return SessionQuota{}, err
	}

	canCreate := maxSessions == nil || *maxSessions <= 0 || count < *maxSessions
	return SessionQuota{MaxSessions: maxSessions, CurrentSessions: count, CanCreate: canCreate}, nil
}

func (repo Repository) updateSessionInstance(ctx context.Context, organizationID string, sessionID string, instanceID string, settings map[string]any, operationID string) error {
	command, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_sessions
		set instance_id = nullif($3, ''),
		    advanced_settings = $4::jsonb,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and coalesce(is_active, true) = true
		  and coalesce(status, '') not in ('deleted', 'disabled')
		  and coalesce(advanced_settings->>'lifecycle_operation_id', '') = $5
	`, organizationID, sessionID, instanceID, jsonb(settings), operationID)
	return requireSessionLifecycleWrite(command, err)
}

func (repo Repository) deleteSessionRow(ctx context.Context, organizationID string, sessionID string, operationID string) error {
	command, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_sessions
		set is_active = false,
		    status = 'deleted',
		    is_notification_session = false,
		    instance_id = null,
		    phone_number = null,
		    advanced_settings = coalesce(advanced_settings, '{}'::jsonb)
		      - 'token'
		      - 'webhook_token'
		      - 'evolution_go_resolved_instance_key'
		      - 'webhook_url'
		      - 'notification_sender_selected_by_user_id'
		      - 'notification_sender_selected_at',
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and coalesce(is_active, true) = true
		  and coalesce(status, '') not in ('deleted', 'disabled')
		  and coalesce(advanced_settings->>'lifecycle_operation_id', '') = $3
	`, organizationID, sessionID, operationID)
	return requireSessionLifecycleWrite(command, err)
}

func (repo Repository) beginSessionLifecycle(ctx context.Context, session Session, operation string, clearNotificationSender bool) (string, error) {
	operation = strings.ToLower(strings.TrimSpace(operation))
	operationID := newSessionLifecycleOperationID(session.ID, operation)
	command, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_sessions
		set status = 'disconnected',
		    is_notification_session = case when $5::boolean then false else is_notification_session end,
		    advanced_settings = (
		      (case
		        when $5::boolean then coalesce(advanced_settings, '{}'::jsonb)
		          - 'notification_sender_selected_by_user_id'
		          - 'notification_sender_selected_at'
		        else coalesce(advanced_settings, '{}'::jsonb)
		      end)
		      - 'auto_reconnect_failure_count'
		      - 'auto_reconnect_retry_after'
		      - 'auto_reconnect_grace_observed_at'
		      - 'lifecycle_error_code'
		    ) || jsonb_build_object(
		      'auto_reconnect_enabled', false,
		      'auto_reconnect_blocked_reason', 'lifecycle_in_progress',
		      'lifecycle_operation', $3::text,
		      'lifecycle_operation_id', $4::text,
		      'lifecycle_state', 'provider_mutation_pending',
		      'lifecycle_updated_at', now()
		    ),
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and coalesce(is_active, true) = true
		  and coalesce(status, '') not in ('deleted', 'disabled')
	`, session.OrganizationID, session.ID, operation, operationID, clearNotificationSender)
	if err != nil {
		return "", err
	}
	if command.RowsAffected() != 1 {
		return "", lifecycleConflictError()
	}
	return operationID, nil
}

func (repo Repository) persistSessionLifecycleSettings(ctx context.Context, organizationID string, sessionID string, settings map[string]any, operationID string) error {
	command, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_sessions
		set status = 'disconnected',
		    advanced_settings = $3::jsonb,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and coalesce(is_active, true) = true
		  and coalesce(status, '') not in ('deleted', 'disabled')
		  and coalesce(advanced_settings->>'lifecycle_operation_id', '') = $4
	`, organizationID, sessionID, jsonb(settings), operationID)
	return requireSessionLifecycleWrite(command, err)
}

func (repo Repository) recordSessionLifecycleFailure(
	ctx context.Context,
	session Session,
	operation string,
	state string,
	cause error,
	clearNotificationSender bool,
	operationID string,
) error {
	stateCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	command, err := repo.db.Pool().Exec(stateCtx, `
		update public.whatsapp_sessions
		set status = 'disconnected',
		    is_notification_session = case when $6::boolean then false else is_notification_session end,
		    advanced_settings = (
		      coalesce(advanced_settings, '{}'::jsonb)
		      - 'auto_reconnect_failure_count'
		      - 'auto_reconnect_retry_after'
		      - 'auto_reconnect_grace_observed_at'
		    ) || jsonb_build_object(
		      'auto_reconnect_enabled', false,
		      'auto_reconnect_blocked_reason', 'lifecycle_reconciliation_required',
		      'lifecycle_operation', $3::text,
		      'lifecycle_state', $4::text,
		      'lifecycle_error_code', $5::text,
		      'lifecycle_updated_at', now()
		    ),
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and coalesce(is_active, true) = true
		  and coalesce(status, '') not in ('deleted', 'disabled')
		  and coalesce(advanced_settings->>'lifecycle_operation_id', '') = $7
	`, session.OrganizationID, session.ID, strings.TrimSpace(operation), strings.TrimSpace(state), sessionLifecycleErrorCode(cause), clearNotificationSender, operationID)
	return requireSessionLifecycleWrite(command, err)
}

func requireSessionLifecycleWrite(command interface{ RowsAffected() int64 }, err error) error {
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return lifecycleConflictError()
	}
	return nil
}

func lifecycleConflictError() error {
	return fmt.Errorf("%w: %w", ErrProviderFailed, errWhatsAppSessionLifecycleConflict)
}

func newSessionLifecycleOperationID(sessionID string, operation string) string {
	return fmt.Sprintf("%s:%s:%d", sessionID, strings.ToLower(strings.TrimSpace(operation)), time.Now().UTC().UnixNano())
}

func createWhatsAppSessionID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	value[6] = value[6]&0x0f | 0x40
	value[8] = value[8]&0x3f | 0x80
	encoded := hex.EncodeToString(value[:])
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:32], nil
}

func sessionLifecycleErrorCode(err error) string {
	switch {
	case err == nil:
		return "unknown"
	case errors.Is(err, errWhatsAppSessionLifecycleConflict):
		return "lifecycle_fence_changed"
	case errors.Is(err, ErrProviderOutcomeUnknown):
		return "provider_outcome_unknown"
	case errors.Is(err, ErrProviderFailed):
		return "provider_rejected"
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, context.Canceled):
		return "operation_canceled"
	default:
		return "storage_write_failed"
	}
}

func clearSessionLifecycleSettings(settings map[string]any) {
	for _, key := range []string{
		"auto_reconnect_blocked_reason",
		"lifecycle_operation",
		"lifecycle_operation_id",
		"lifecycle_state",
		"lifecycle_error_code",
		"lifecycle_updated_at",
	} {
		delete(settings, key)
	}
}

func confirmedEvolutionTerminalMutation(action string, result map[string]any, err error) error {
	if err != nil {
		// A transport/read failure is never evidence that a destructive request
		// did or did not commit. Keep the local row for reconciliation.
		if errors.Is(err, ErrProviderOutcomeUnknown) {
			return err
		}
		if action == "instance.delete" && isProviderMissingInstanceError(err) {
			return nil
		}
		if action == "instance.logout" && isProviderDisconnectedError(err) {
			return nil
		}
		return err
	}
	if providerResultOK(result) {
		return nil
	}
	status := firstString(result, "status", "data.status")
	message := providerErrorMessage(result, "Evolution Go lifecycle mutation failed")
	if action == "instance.delete" && (status == "404" || isProviderMissingInstanceMessage(message)) {
		return nil
	}
	if action == "instance.logout" && (status == "404" || isProviderDisconnectedMessage(message)) {
		return nil
	}
	return fmt.Errorf("%w: %s", ErrProviderFailed, message)
}

func (repo Repository) compensateEvolutionInstance(ctx context.Context, instanceKey string) error {
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 20*time.Second)
	defer cancel()
	result, err := repo.functions.deleteEvolutionInstanceByKey(cleanupCtx, instanceKey)
	if err != nil {
		return err
	}
	// A compensation runs immediately after a confirmed create. A 404 here can
	// be eventual consistency (or a mismatched key), so only an explicit success
	// proves that it is safe to tombstone the local reconciliation identity.
	if !providerResultOK(result) {
		return fmt.Errorf(
			"%w: compensating Evolution Go delete was not explicitly confirmed: %s",
			ErrProviderFailed,
			providerErrorMessage(result, "provider cleanup was not confirmed"),
		)
	}
	return nil
}

type failedCreateAction uint8

const (
	failedCreateRetainForReconciliation failedCreateAction = iota
	failedCreateTombstone
	failedCreateCompensate
)

func failedCreateActionFor(cause error, providerCreationConfirmed bool) failedCreateAction {
	if errors.Is(cause, errWhatsAppSessionLifecycleConflict) {
		// A newer fenced operation owns the row. Deleting its provider identity
		// would turn a local write conflict into a cross-operation data loss.
		return failedCreateRetainForReconciliation
	}
	if providerCreationConfirmed {
		return failedCreateCompensate
	}
	if errors.Is(cause, ErrProviderOutcomeUnknown) {
		// Never race an ambiguous create with an immediate delete: the delete may
		// observe 404 before the create commits and leave an orphan afterwards.
		return failedCreateRetainForReconciliation
	}
	return failedCreateTombstone
}

func (repo Repository) finishFailedCreateSession(
	ctx context.Context,
	organizationID string,
	session Session,
	instanceKey string,
	cause error,
	providerCreationConfirmed bool,
	operationID string,
) error {
	action := failedCreateActionFor(cause, providerCreationConfirmed)
	if action == failedCreateTombstone {
		deleteCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		return errors.Join(cause, repo.deleteSessionRow(deleteCtx, organizationID, session.ID, operationID))
	}
	var cleanupErr error
	if action == failedCreateCompensate {
		cleanupErr = repo.compensateEvolutionInstance(ctx, instanceKey)
		if cleanupErr == nil {
			deleteCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			defer cancel()
			return errors.Join(cause, repo.deleteSessionRow(deleteCtx, organizationID, session.ID, operationID))
		}
	}
	session.OrganizationID = organizationID
	stateErr := repo.recordSessionLifecycleFailure(ctx, session, "create", "reconciliation_required", errors.Join(cause, cleanupErr), true, operationID)
	return errors.Join(cause, cleanupErr, stateErr)
}

func (repo Repository) finishFailedRecreateSession(
	ctx context.Context,
	session Session,
	instanceKey string,
	cause error,
	providerCreationConfirmed bool,
	operationID string,
) error {
	state := "retry_required"
	var cleanupErr error
	if errors.Is(cause, errWhatsAppSessionLifecycleConflict) {
		state = "reconciliation_required"
	} else if providerCreationConfirmed {
		cleanupErr = repo.compensateEvolutionInstance(ctx, instanceKey)
		if cleanupErr != nil {
			state = "reconciliation_required"
		}
	} else if errors.Is(cause, ErrProviderOutcomeUnknown) {
		// The recreate create-call has the same eventual-commit race as a fresh
		// create. Preserve its stable name/token and require reconciliation.
		state = "reconciliation_required"
	}
	stateErr := repo.recordSessionLifecycleFailure(ctx, session, "recreate", state, errors.Join(cause, cleanupErr), false, operationID)
	return errors.Join(cause, cleanupErr, stateErr)
}

func stringFromMap(values map[string]any, key string) string {
	if values == nil {
		return ""
	}
	if value, ok := values[key].(string); ok {
		return value
	}

	return ""
}

func pluralSuffix(value int) string {
	if value == 1 {
		return ""
	}

	return "s"
}

func ensureAutoReplyDefaults(settings map[string]any) map[string]any {
	if settings == nil {
		settings = map[string]any{}
	}
	if _, exists := settings["ai_auto_reply_enabled"]; !exists {
		settings["ai_auto_reply_enabled"] = false
	}
	return settings
}

func isProviderDisconnectedError(err error) bool {
	if err == nil {
		return false
	}

	return isProviderDisconnectedMessage(err.Error())
}

func isProviderDisconnectedMessage(message string) bool {
	normalized := strings.ToLower(message)
	return strings.Contains(normalized, "client disconnected") ||
		strings.Contains(normalized, "not connected") ||
		strings.Contains(normalized, "disconnected") ||
		strings.Contains(normalized, "already closed") ||
		strings.Contains(normalized, "logged out") ||
		isProviderMissingInstanceMessage(normalized)
}

func isProviderMissingInstanceError(err error) bool {
	if err == nil {
		return false
	}

	return isProviderMissingInstanceMessage(err.Error())
}

func isProviderMissingInstanceMessage(message string) bool {
	normalized := strings.ToLower(message)
	return strings.Contains(normalized, "not found") ||
		strings.Contains(normalized, "instance not found") ||
		strings.Contains(normalized, "404")
}
