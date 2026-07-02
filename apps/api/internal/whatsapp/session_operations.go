package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) CreateSession(ctx context.Context, tenantContext tenant.Context, input createSessionInput) (SessionOperationResponse, error) {
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
	}

	session, err := scanSession(repo.db.Pool().QueryRow(ctx, `
		with inserted as (
			insert into public.whatsapp_sessions (
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
				$3,
				$4,
				'disconnected',
				'evolution_go',
				$5::jsonb,
				true
			)
			returning *
		)
		select `+sessionSelectFields()+`
		from inserted ws
		left join public.users owner on owner.id = ws.owner_user_id
	`, tenantContext.OrganizationID, tenantContext.UserID, instanceName, input.DisplayName, jsonb(settings)))
	if err != nil {
		return SessionOperationResponse{}, err
	}

	createResult, err := repo.functions.invokeEvolution(ctx, "instance.create", map[string]any{
		"session_id": session.ID,
		"body": map[string]any{
			"name":  instanceName,
			"token": token,
		},
	})
	if err != nil {
		_ = repo.deleteSessionRow(ctx, tenantContext.OrganizationID, session.ID)
		return SessionOperationResponse{}, err
	}

	evoID := evolutionInstanceID(createResult)
	if evoID != "" {
		settings["token"] = token
		settings["evolution_go_resolved_instance_key"] = evoID
		if providerNotificationSafeApplied(createResult) {
			settings["notification_safe_settings_applied_at"] = time.Now().UTC().Format(time.RFC3339)
		}
		if err := repo.updateSessionInstance(ctx, tenantContext.OrganizationID, session.ID, evoID, settings); err != nil {
			_ = repo.deleteSessionRow(ctx, tenantContext.OrganizationID, session.ID)
			return SessionOperationResponse{}, err
		}
	}

	webhookInstanceID := evoID
	if webhookInstanceID == "" {
		webhookInstanceID = instanceName
	}
	configuredWebhookURL := repo.functions.configuredEvolutionWebhookURL(session.ID, webhookInstanceID, webhookToken)
	connectResult, err := repo.functions.invokeEvolution(ctx, "instance.connect", map[string]any{
		"session_id":  session.ID,
		"instance_id": evoID,
		"token":       token,
		"body": map[string]any{
			"webhookUrl": configuredWebhookURL,
			"subscribe":  []string{"ALL"},
			"immediate":  true,
		},
	})
	if err != nil {
		_ = repo.deleteSessionRow(ctx, tenantContext.OrganizationID, session.ID)
		return SessionOperationResponse{}, err
	}

	settings["token"] = token
	settings["webhook_token"] = webhookToken
	settings["evolution_go_resolved_instance_key"] = firstPresentAny(evoID, instanceName)
	settings["webhook_url"] = configuredWebhookURL
	settings["webhook_last_configured_at"] = time.Now().UTC().Format(time.RFC3339)
	if providerNotificationSafeApplied(connectResult) {
		settings["notification_safe_settings_applied_at"] = time.Now().UTC().Format(time.RFC3339)
	}
	if err := repo.updateSessionInstance(ctx, tenantContext.OrganizationID, session.ID, evoID, settings); err != nil {
		_ = repo.deleteSessionRow(ctx, tenantContext.OrganizationID, session.ID)
		return SessionOperationResponse{}, err
	}

	session, err = repo.GetSession(ctx, tenantContext, session.ID)
	if err != nil {
		return SessionOperationResponse{}, err
	}

	return SessionOperationResponse{Session: session, EvolutionData: createResult["data"]}, nil
}

func (repo Repository) DeleteSession(ctx context.Context, tenantContext tenant.Context, sessionID string) error {
	session, err := repo.GetManageableSession(ctx, tenantContext, sessionID)
	if err != nil {
		return err
	}

	if session.Provider == "evolution_go" {
		_, _ = repo.functions.invokeEvolution(ctx, "instance.delete", map[string]any{
			"session_id":   session.ID,
			"instanceName": session.InstanceName,
			"instance_id":  stringPtrValue(session.InstanceID),
		})
	}

	return repo.deleteSessionRow(ctx, tenantContext.OrganizationID, session.ID)
}

func (repo Repository) GetQRCode(ctx context.Context, tenantContext tenant.Context, sessionID string) (QRCodeResponse, error) {
	session, err := repo.GetSession(ctx, tenantContext, sessionID)
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
	if session.Provider != "evolution_go" {
		return ConnectionStatusResponse{}, fmt.Errorf("%w: legacy Evolution provider is disabled", ErrInvalidInput)
	}

	result, err := repo.functions.invokeEvolution(ctx, "instance.status", map[string]any{
		"session_id":  session.ID,
		"instance_id": stringPtrValue(session.InstanceID),
	})
	if err != nil {
		if errors.Is(err, ErrProviderFailed) {
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

	if !providerResultOK(result) {
		statusText := firstString(result, "status", "data.status")
		message := providerErrorMessage(result, "Failed to get status")
		_ = repo.markSessionDisconnected(ctx, tenantContext.OrganizationID, session.ID)
		return ConnectionStatusResponse{
			Connected:        false,
			Status:           "disconnected",
			State:            "close",
			InstanceNotFound: statusText == "404" || isProviderMissingInstanceMessage(message),
			RawResponse:      result["rawResponse"],
			RawStatus:        result["status"],
		}, nil
	}

	normalizedStatus := firstString(result, "normalizedStatus")
	if normalizedStatus == "" {
		normalizedStatus = "disconnected"
	}
	connected := normalizedStatus == "connected"
	state := "close"
	if connected {
		state = "open"
	} else if normalizedStatus == "qr_ready" {
		state = "qr"
	}

	rawData := firstMap(result, "data.data", "data.instance", "data.session", "data", "instance", "session")
	wuid := firstString(rawData, "jid", "Jid", "wuid", "ownerJid", "phone", "number", "Name", "name")
	if connected {
		phone := strings.Split(wuid, "@")[0]
		_, _ = repo.db.Pool().Exec(ctx, `
			update public.whatsapp_sessions
			set status = 'connected',
			    phone_number = nullif($3, ''),
			    last_connected_at = now(),
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
		`, tenantContext.OrganizationID, session.ID, phone)
	} else if normalizedStatus == "qr_ready" || normalizedStatus == "disconnected" {
		_, _ = repo.db.Pool().Exec(ctx, `
			update public.whatsapp_sessions
			set status = $3,
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
		`, tenantContext.OrganizationID, session.ID, normalizedStatus)
	}

	return ConnectionStatusResponse{
		Connected: connected,
		Status:    normalizedStatus,
		State:     state,
		Instance: map[string]any{
			"wuid": wuid,
		},
		RawResponse: result["rawResponse"],
		RawStatus:   result["status"],
	}, nil
}

func (repo Repository) RecreateSession(ctx context.Context, tenantContext tenant.Context, sessionID string) (SessionOperationResponse, error) {
	session, err := repo.GetManageableSession(ctx, tenantContext, sessionID)
	if err != nil {
		return SessionOperationResponse{}, err
	}
	if session.Provider != "evolution_go" {
		return SessionOperationResponse{}, fmt.Errorf("%w: legacy Evolution provider is disabled", ErrInvalidInput)
	}

	settings := ensureAutoReplyDefaults(session.AdvancedSettings)
	token := stringFromMap(settings, "token")
	if token == "" {
		token = createSecretToken()
	}
	webhookToken := stringFromMap(settings, "webhook_token")
	if webhookToken == "" {
		webhookToken = createSecretToken()
	}

	createResult, err := repo.functions.invokeEvolution(ctx, "instance.create", map[string]any{
		"session_id": session.ID,
		"body": map[string]any{
			"name":  session.InstanceName,
			"token": token,
		},
	})
	if err != nil {
		return SessionOperationResponse{}, err
	}

	evoID := evolutionInstanceID(createResult)
	webhookInstanceID := evoID
	if webhookInstanceID == "" {
		webhookInstanceID = session.InstanceName
	}
	configuredWebhookURL := repo.functions.configuredEvolutionWebhookURL(session.ID, webhookInstanceID, webhookToken)
	connectResult, err := repo.functions.invokeEvolution(ctx, "instance.connect", map[string]any{
		"session_id":  session.ID,
		"instance_id": evoID,
		"token":       token,
		"body": map[string]any{
			"webhookUrl": configuredWebhookURL,
			"subscribe":  []string{"ALL"},
			"immediate":  true,
		},
	})
	if err != nil {
		return SessionOperationResponse{}, err
	}

	settings["token"] = token
	settings["webhook_token"] = webhookToken
	settings["evolution_go_resolved_instance_key"] = firstPresentAny(evoID, session.InstanceName)
	settings["webhook_url"] = configuredWebhookURL
	settings["webhook_last_configured_at"] = time.Now().UTC().Format(time.RFC3339)
	if providerNotificationSafeApplied(createResult) || providerNotificationSafeApplied(connectResult) {
		settings["notification_safe_settings_applied_at"] = time.Now().UTC().Format(time.RFC3339)
	}

	_, err = repo.db.Pool().Exec(ctx, `
		update public.whatsapp_sessions
		set status = 'disconnected',
		    instance_id = nullif($3, ''),
		    advanced_settings = $4::jsonb,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, session.ID, evoID, jsonb(settings))
	if err != nil {
		return SessionOperationResponse{}, err
	}

	session, err = repo.GetSession(ctx, tenantContext, session.ID)
	if err != nil {
		return SessionOperationResponse{}, err
	}

	return SessionOperationResponse{Session: session, EvolutionData: createResult["data"]}, nil
}

func (repo Repository) LogoutSession(ctx context.Context, tenantContext tenant.Context, sessionID string) (map[string]any, error) {
	session, err := repo.GetManageableSession(ctx, tenantContext, sessionID)
	if err != nil {
		return nil, err
	}
	if session.Provider != "evolution_go" {
		return nil, fmt.Errorf("%w: legacy Evolution provider is disabled", ErrInvalidInput)
	}

	result, err := repo.functions.invokeEvolution(ctx, "instance.logout", map[string]any{
		"session_id":  session.ID,
		"instance_id": stringPtrValue(session.InstanceID),
	})
	if err != nil {
		if !isProviderDisconnectedError(err) {
			return nil, err
		}
		result = map[string]any{
			"ok":               true,
			"status":           "disconnected",
			"provider_warning": err.Error(),
		}
	}

	if err := repo.markSessionDisconnected(ctx, tenantContext.OrganizationID, session.ID); err != nil {
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
	`, organizationID, sessionID)
	return err
}

func (repo Repository) ToggleNotificationSession(ctx context.Context, tenantContext tenant.Context, sessionID string, enabled bool) error {
	sessionID, ok := normalizeUUID(sessionID)
	if !ok {
		return ErrSessionNotFound
	}
	if err := repo.ensureCanManageSession(ctx, tenantContext, sessionID); err != nil {
		return err
	}

	_, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_sessions
		set is_notification_session = $3::boolean,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, sessionID, enabled)
	return err
}

func (repo Repository) ToggleAutoReplySession(ctx context.Context, tenantContext tenant.Context, sessionID string, enabled bool) error {
	sessionID, ok := normalizeUUID(sessionID)
	if !ok {
		return ErrSessionNotFound
	}
	if err := repo.ensureCanManageSession(ctx, tenantContext, sessionID); err != nil {
		return err
	}

	_, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_sessions
		set advanced_settings = coalesce(advanced_settings, '{}'::jsonb) || jsonb_build_object('ai_auto_reply_enabled', $3::boolean),
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, sessionID, enabled)
	return err
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
		  and ($4::boolean or ws.owner_user_id = $3::uuid)
		limit 1
	`, tenantContext.OrganizationID, sessionID, tenantContext.UserID, tenantContext.IsSuperAdmin))
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrSessionNotFound
	}
	if err != nil {
		return Session{}, err
	}

	return session, nil
}

func (repo Repository) ensureCanCreateSession(ctx context.Context, tenantContext tenant.Context) error {
	if !canManageWhatsApp(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}

	quota, err := repo.GetSessionQuota(ctx, tenantContext.OrganizationID)
	if err != nil {
		return err
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

func (repo Repository) updateSessionInstance(ctx context.Context, organizationID string, sessionID string, instanceID string, settings map[string]any) error {
	_, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_sessions
		set instance_id = nullif($3, ''),
		    advanced_settings = $4::jsonb,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, organizationID, sessionID, instanceID, jsonb(settings))
	return err
}

func (repo Repository) deleteSessionRow(ctx context.Context, organizationID string, sessionID string) error {
	_, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_sessions
		set is_active = false,
		    status = 'deleted',
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, organizationID, sessionID)
	return err
}

func providerNotificationSafeApplied(result map[string]any) bool {
	settings := firstMap(result, "notificationSafeSettings")
	value, _ := settings["ok"].(bool)
	return value
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
