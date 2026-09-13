package leads

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type DispatchNotificationRequest struct {
	EventKey       string         `json:"event_key"`
	TemplateSlug   string         `json:"template_slug"`
	OrganizationID string         `json:"organization_id"`
	UserID         string         `json:"user_id"`
	Recipient      string         `json:"recipient"`
	Title          string         `json:"title"`
	Content        string         `json:"content"`
	Variables      map[string]any `json:"variables"`
	LeadID         *string        `json:"lead_id"`
	DedupeKey      string         `json:"dedupe_key"`
	IsTest         bool           `json:"is_test"`
	Channels       []string       `json:"channels"`
}

type DispatchNotificationResult struct {
	Success      bool                  `json:"success"`
	Queued       bool                  `json:"queued"`
	Notification *Notification         `json:"notification,omitempty"`
	WhatsApp     DispatchChannelResult `json:"whatsapp"`
	Push         DispatchChannelResult `json:"push"`
	Email        DispatchChannelResult `json:"email"`
	Error        string                `json:"error,omitempty"`
}

type DispatchChannelResult struct {
	Enabled           bool          `json:"enabled"`
	Attempted         bool          `json:"attempted"`
	OK                bool          `json:"ok"`
	Permanent         bool          `json:"permanent,omitempty"`
	OutcomeUnknown    bool          `json:"-"`
	RetryAfter        time.Duration `json:"-"`
	Status            int           `json:"status,omitempty"`
	Error             string        `json:"error,omitempty"`
	Provider          string        `json:"provider,omitempty"`
	SessionID         string        `json:"session_id,omitempty"`
	InstanceID        string        `json:"instance_id,omitempty"`
	Sent              int           `json:"sent,omitempty"`
	Skipped           int           `json:"skipped,omitempty"`
	MessageID         string        `json:"-"`
	ExpectedMessageID string        `json:"-"`
	IdempotencyKey    string        `json:"-"`
	Recipient         string        `json:"-"`
}

type DispatchWhatsAppResult = DispatchChannelResult

func buildDispatchNotificationContent(eventKey string, request DispatchNotificationRequest, variables map[string]any) (string, string, string) {
	title := trimMax(firstNotificationText(request.Title, stringFromMap(variables, "title")), 180)
	content := trimMax(firstNotificationText(request.Content, stringFromMap(variables, "message"), stringFromMap(variables, "body")), 1_000)

	switch eventKey {
	case "new_lead_received":
		if title == "" {
			title = "Novo lead recebido"
		}
		if content == "" {
			leadName := firstNotificationText(stringFromMap(variables, "lead_name"), stringFromMap(variables, "leadName"), "Lead")
			source := stringFromMap(variables, "source")
			content = leadName + " foi atribuido a voce"
			if source != "" {
				content += " (origem: " + source + ")"
			}
		}
	case "deal_won":
		if title == "" {
			title = "Lead ganho"
		}
		if content == "" {
			leadName := firstNotificationText(stringFromMap(variables, "lead_name"), stringFromMap(variables, "leadName"), "Lead")
			content = "Venda concluida para " + leadName
		}
	case "lead_reentry":
		if title == "" {
			title = "Lead retornou"
		}
		if content == "" {
			leadName := firstNotificationText(stringFromMap(variables, "lead_name"), stringFromMap(variables, "leadName"), "Lead")
			content = leadName + " teve uma nova entrada"
		}
	case "update_phone_reminder":
		if title == "" {
			title = "Complete seu perfil"
		}
		if content == "" {
			content = "Adicione seu WhatsApp para receber avisos importantes."
		}
	case "gamification_update":
		if title == "" {
			title = "Atualizacao de gamificacao"
		}
		if content == "" {
			content = "Sua pontuacao foi atualizada."
		}
	case "whatsapp_disconnected":
		if title == "" {
			title = "WhatsApp desconectado"
		}
		if content == "" {
			sessionName := firstNotificationText(stringFromMap(variables, "session_name"), stringFromMap(variables, "display_name"), "Sessao")
			content = sessionName + " foi desconectada."
		}
	case "schedule_reminder", "appointment_reminder":
		if title == "" {
			title = "Lembrete de agenda"
		}
		if content == "" {
			content = "Voce tem um compromisso agendado."
		}
	case "appointment_outcome_pending":
		if title == "" {
			title = "Resultado pendente na agenda"
		}
		if content == "" {
			content = "Registre como foi o compromisso."
		}
	case "test_push":
		if title == "" {
			title = "Teste de notificacao"
		}
		if content == "" {
			content = "Se voce recebeu este aviso, o dispatcher do backend esta funcionando."
		}
	default:
		if title == "" {
			title = "Notificacao Vimob"
		}
		if content == "" {
			content = "Voce tem uma nova notificacao."
		}
	}

	return title, content, notificationTypeForEvent(eventKey)
}

func notificationTypeForEvent(eventKey string) string {
	if isBillingNotificationEvent(eventKey) {
		return "billing"
	}
	switch eventKey {
	case "new_lead_received", "lead_reentry", "lead_duplicate_existing", "lead_transferred", "lead_stage_changed", "lead_redistribution_warning", "lead_redistributed_received", "lead_redistributed_away":
		return "lead"
	case "deal_won":
		return "deal_won"
	case "gamification_update":
		return "gamification"
	case "schedule_reminder", "appointment_reminder", "appointment_outcome_pending":
		return "schedule"
	case "whatsapp_disconnected":
		return "whatsapp"
	case "test_push":
		return "test"
	default:
		return "info"
	}
}

func shouldDispatchLeadWhatsAppNotification(eventKey string) bool {
	if isBillingNotificationEvent(eventKey) {
		return true
	}
	switch strings.TrimSpace(eventKey) {
	case "onboarding_welcome":
		return true
	case "new_lead_received",
		"lead_reentry",
		"lead_duplicate_existing",
		"lead_transferred",
		"lead_stage_changed",
		"deal_won",
		"lead_redistribution_warning",
		"lead_redistributed_received",
		"lead_redistributed_away",
		"whatsapp_disconnected",
		"schedule_reminder",
		"appointment_reminder",
		"test_push":
		return true
	default:
		return false
	}
}

func shouldDispatchPushNotification(eventKey string) bool {
	eventKey = strings.TrimSpace(eventKey)
	return eventKey != ""
}

func shouldDispatchEmailNotification(eventKey string) bool {
	eventKey = strings.TrimSpace(eventKey)
	return eventKey == "deal_won" || eventKey == "onboarding_welcome" || isBillingNotificationEvent(eventKey)
}

func isBillingNotificationEvent(eventKey string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(eventKey)), "billing_")
}

func isPlatformTransactionalNotificationEvent(eventKey string) bool {
	eventKey = strings.ToLower(strings.TrimSpace(eventKey))
	return eventKey == "onboarding_welcome" ||
		eventKey == "onboarding_email_confirmation" ||
		eventKey == "schedule_reminder" ||
		eventKey == "appointment_reminder" ||
		eventKey == "appointment_outcome_pending" ||
		isBillingNotificationEvent(eventKey)
}

// validatePublicNotificationEvent keeps platform-owned transactional events out
// of both user-facing notification endpoints. These rows must originate from a
// trusted backend transaction/outbox so their recipient, amount and receipt
// payload cannot be forged by an organization user.
func validatePublicNotificationEvent(eventKey string) error {
	if isPlatformTransactionalNotificationEvent(eventKey) {
		return fmt.Errorf(
			"%w: platform transactional notifications are backend-owned",
			tenant.ErrOrganizationAccessDenied,
		)
	}
	return nil
}

func authorizePublicNotificationDispatch(tenantContext tenant.Context, eventKey string, userID string, channels []string) error {
	if err := validatePublicNotificationEvent(eventKey); err != nil {
		return err
	}

	canDispatch := canDispatchNotifications(tenantContext)
	if strings.TrimSpace(userID) != strings.TrimSpace(tenantContext.UserID) && !canDispatch {
		return tenant.ErrOrganizationAccessDenied
	}
	if requestsExternalNotificationChannel(eventKey, channels) && !canDispatch {
		return fmt.Errorf(
			"%w: email and WhatsApp notification dispatch requires elevated permission",
			tenant.ErrOrganizationAccessDenied,
		)
	}
	return nil
}

func requestsExternalNotificationChannel(eventKey string, channels []string) bool {
	if len(channels) == 0 {
		// An omitted channel list means "all supported channels". Keep a
		// push/system-only event usable by regular members, but require dispatch
		// permission whenever the event would actually fan out externally.
		return shouldDispatchEmailNotification(eventKey) || shouldDispatchLeadWhatsAppNotification(eventKey)
	}
	return requestWantsChannel(channels, "email") || requestWantsChannel(channels, "whatsapp")
}

func applyNotificationDispatchMetadata(metadata map[string]any, eventKey string, channels []string) map[string]any {
	if metadata == nil {
		metadata = map[string]any{}
	}
	eventKey = firstNotificationText(eventKey, stringFromMap(metadata, "event_key"), "notification")
	metadata["event_key"] = eventKey

	dispatch := mapFromAny(metadata["dispatch"])
	setChannel := func(channel string, required bool) {
		current := mapFromAny(dispatch[channel])
		if _, exists := current["status"]; !exists {
			current["status"] = "pending"
		}
		current["required"] = required
		dispatch[channel] = current
	}

	wantsWhatsApp := requestWantsChannel(channels, "whatsapp") && shouldDispatchLeadWhatsAppNotification(eventKey)
	wantsPush := requestWantsChannel(channels, "push") && shouldDispatchPushNotification(eventKey)
	wantsEmail := requestWantsChannel(channels, "email") && shouldDispatchEmailNotification(eventKey)

	if wantsWhatsApp {
		metadata["whatsapp_dispatch_required"] = true
		if _, exists := metadata["whatsapp_dispatch"]; !exists {
			metadata["whatsapp_dispatch"] = map[string]any{"status": "pending"}
		}
		setChannel("whatsapp", true)
	}
	if wantsPush {
		setChannel("push", true)
	}
	if wantsEmail {
		setChannel("email", true)
	}
	if len(dispatch) > 0 {
		metadata["dispatch"] = dispatch
	}
	return metadata
}

func mapFromAny(value any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	if typed, ok := value.(map[string]any); ok {
		return typed
	}
	return map[string]any{}
}

func requestWantsChannel(channels []string, channel string) bool {
	if len(channels) == 0 {
		return true
	}
	for _, item := range channels {
		if strings.EqualFold(strings.TrimSpace(item), channel) {
			return true
		}
	}
	return false
}

func canDispatchNotifications(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin ||
		canManageLeads(tenantContext) ||
		tenantContext.HasPermission(permissions.WhatsAppManage) ||
		tenantContext.HasPermission(permissions.UsersManage)
}

func firstNotificationText(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func stringFromMap(values map[string]any, key string) string {
	value, ok := values[key]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case fmt.Stringer:
		return strings.TrimSpace(typed.String())
	default:
		return strings.TrimSpace(fmt.Sprint(typed))
	}
}

func isUndefinedTableError(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "42P01"
}

func isUndefinedColumnError(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "42703"
}

func isNotificationDedupeConflict(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) &&
		pgErr.Code == "23505" &&
		pgErr.ConstraintName == "notifications_unique_dedupe_key"
}
