package leads

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type notificationTemplateContent struct {
	Title   string
	Message string
}

func buildWhatsAppNotificationText(eventKey string, title string, content string, variables map[string]any) string {
	if rendered := stringFromMap(variables, "__rendered_whatsapp_message"); rendered != "" {
		return ensureActionableBillingWhatsAppLink(eventKey, rendered, variables)
	}

	eventKey = strings.TrimSpace(eventKey)
	title = strings.TrimSpace(title)
	content = strings.TrimSpace(content)
	if formatted := buildWhatsAppNotificationTemplate(eventKey, title, content, variables); formatted != "" {
		return ensureActionableBillingWhatsAppLink(eventKey, formatted, variables)
	}
	if title == "" {
		return content
	}
	if content == "" {
		return "🔔 *" + title + "*"
	}
	return "🔔 *" + title + "*\n" + content
}

func ensureActionableBillingWhatsAppLink(eventKey string, message string, variables map[string]any) string {
	switch strings.ToLower(strings.TrimSpace(eventKey)) {
	case "billing_payment_created",
		"billing_due_in_3_days",
		"billing_due_today",
		"billing_card_refused",
		"billing_overdue_1_day",
		"billing_overdue_5_days":
	default:
		return message
	}

	billingURL := strings.TrimSpace(stringFromMap(variables, "billing_url"))
	if billingURL == "" || strings.Contains(message, billingURL) {
		return message
	}
	message = strings.TrimSpace(message)
	if message == "" {
		return "Acesse: " + billingURL
	}
	return message + "\nAcesse: " + billingURL
}

func buildWhatsAppNotificationTemplate(eventKey string, title string, content string, variables map[string]any) string {
	if variables == nil {
		variables = map[string]any{}
	}

	leadName := firstNotificationText(
		stringFromMap(variables, "lead_name"),
		stringFromMap(variables, "leadName"),
		stringFromMap(variables, "name"),
	)
	source := firstNotificationText(stringFromMap(variables, "source"), stringFromMap(variables, "origin"))
	campaign := firstNotificationText(stringFromMap(variables, "campaign_name"), stringFromMap(variables, "campaign"), stringFromMap(variables, "campaignName"))
	formName := firstNotificationText(stringFromMap(variables, "form_name"), stringFromMap(variables, "formName"), stringFromMap(variables, "form"))
	pipeline := firstNotificationText(stringFromMap(variables, "pipeline_name"), stringFromMap(variables, "pipelineName"), stringFromMap(variables, "pipeline"))
	stage := firstNotificationText(stringFromMap(variables, "stage_name"), stringFromMap(variables, "stageName"), stringFromMap(variables, "stage"))
	actor := firstNotificationText(stringFromMap(variables, "actor_name"), stringFromMap(variables, "actorName"))
	value := firstNotificationText(stringFromMap(variables, "valor_interesse"), stringFromMap(variables, "interest_value"), stringFromMap(variables, "value"))
	date := firstNotificationText(stringFromMap(variables, "created_time"), stringFromMap(variables, "created_at"), stringFromMap(variables, "date"), stringFromMap(variables, "schedule_time"), stringFromMap(variables, "schedule_start_time"), stringFromMap(variables, "start_time"))
	if date != "" {
		date = formatNotificationTemplateDate(date)
	}
	scheduleDate := firstNotificationText(
		stringFromMap(variables, "schedule_time"),
		stringFromMap(variables, "schedule_start_time"),
		stringFromMap(variables, "start_time"),
		date,
	)
	if scheduleDate != "" {
		scheduleDate = formatNotificationTemplateDate(scheduleDate)
	}
	scheduleType := firstNotificationText(
		stringFromMap(variables, "schedule_event_type_label"),
		scheduleReminderEventTypeLabel(stringFromMap(variables, "schedule_event_type"), stringFromMap(variables, "event_type")),
	)
	scheduleLeadName := scheduleReminderLeadName(variables)
	propertyName := scheduleReminderPropertyName(variables)
	billingURL := stringFromMap(variables, "billing_url")
	billingAmount := stringFromMap(variables, "amount")
	billingDueDate := stringFromMap(variables, "due_date")

	lines := []string{}
	appendField := func(icon string, label string, value string) {
		value = strings.TrimSpace(value)
		if value != "" {
			lines = append(lines, icon+" "+label+": "+value)
		}
	}
	appendAction := func(value string) {
		appendField("✅", "Ação", value)
	}
	appendLead := func() {
		appendField("👤", "Nome", firstNotificationText(leadName, "Lead"))
	}
	appendPipeline := func() {
		if pipeline != "" && stage != "" {
			appendField("📌", "Pipeline", pipeline+" / "+stage)
			return
		}
		appendField("📌", "Pipeline", firstNotificationText(pipeline, stage))
	}
	if eventKey == "onboarding_welcome" {
		lines = append(lines, "*BEM-VINDO AO VIMOB*")
		appendField("🏢", "Organização", stringFromMap(variables, "organization_name"))
		appendField("📦", "Plano", stringFromMap(variables, "plan_name"))
		if checkoutURL := stringFromMap(variables, "checkout_url"); checkoutURL != "" {
			lines = append(lines, "Continuar: "+checkoutURL)
		}
		return strings.Join(cleanNotificationTemplateLines(lines), "\n")
	}
	if isBillingNotificationEvent(eventKey) {
		lines = append(lines, "💳 *"+strings.ToUpper(firstNotificationText(title, "Cobranca Vimob"))+"*")
		if content != "" {
			lines = append(lines, content)
		}
		appendField("💰", "Valor", billingAmount)
		appendField("📅", "Vencimento", billingDueDate)
		if eventKey == "billing_payment_receipt" {
			appendField("🧾", "Comprovante", stringFromMap(variables, "receipt_number"))
			appendField("📦", "Plano", stringFromMap(variables, "plan_name"))
			appendField("💳", "Pagamento", billingMethodLabel(stringFromMap(variables, "billing_type")))
			appendField("✅", "Pago em", stringFromMap(variables, "paid_at"))
			if verificationURL := stringFromMap(variables, "verification_url"); verificationURL != "" {
				lines = append(lines, "🔎 Verifique: "+verificationURL)
			}
		}
		if billingURL != "" {
			lines = append(lines, "🔗 Acesse: "+billingURL)
		}
		return strings.Join(cleanNotificationTemplateLines(lines), "\n")
	}

	switch eventKey {
	case "new_lead_received":
		lines = append(lines, "🔔 *NOVO LEAD*")
		appendLead()
		appendField("📲", "Origem", source)
		appendField("🎯", "Campanha", campaign)
		appendField("🧾", "Formulário", formName)
		appendPipeline()
		appendAction("acesse o CRM para atender")
	case "lead_reentry":
		lines = append(lines, "🔁 *LEAD REENTROU*")
		appendLead()
		appendField("📲", "Origem", source)
		appendField("🎯", "Campanha", campaign)
		appendField("📅", "Data", date)
		appendAction("acesse o CRM para acompanhar")
	case "lead_duplicate_existing":
		lines = append(lines, "⚠️ *LEAD JÁ EXISTIA*")
		appendLead()
		appendField("👥", "Responsável atual", firstNotificationText(stringFromMap(variables, "assignee_name"), stringFromMap(variables, "assigned_user_name")))
		appendField("📲", "Origem", source)
		appendAction("verifique o lead no CRM")
	case "lead_transferred":
		lines = append(lines, "🔄 *LEAD TRANSFERIDO*")
		appendLead()
		appendPipeline()
		appendField("🧑‍💼", "Transferido de", firstNotificationText(stringFromMap(variables, "from_user_name"), stringFromMap(variables, "previous_user_name"), actor))
		appendAction("acesse o CRM para atender")
	case "lead_stage_changed":
		lines = append(lines, "📌 *ETAPA ALTERADA*")
		appendLead()
		appendField("➡️", "Etapa", firstNotificationText(stage, stringFromMap(variables, "new_stage_name"), content))
		appendAction("acompanhe no CRM")
	case "deal_won":
		lines = append(lines, "🏆 *LEAD GANHO*")
		appendLead()
		appendField("🤝", "Responsável", actor)
		appendField("💰", "Valor", value)
		appendAction("confira o fechamento no CRM")
	case "lead_redistribution_warning":
		lines = append(lines, "⏳ *LEAD QUASE REDISTRIBUÍDO*")
		appendLead()
		appendField("⏱️", "Prazo", firstNotificationText(stringFromMap(variables, "warning_minutes"), stringFromMap(variables, "timeout_minutes"))+" min")
		appendAction("atenda antes da redistribuição")
	case "lead_redistributed_received":
		lines = append(lines, "🔄 *LEAD REDISTRIBUÍDO*")
		appendLead()
		appendField("⏱️", "Parado há", stringFromMap(variables, "timeout_minutes")+" min")
		appendAction("acesse o CRM para atender")
	case "lead_redistributed_away":
		lines = append(lines, "🔄 *LEAD REDISTRIBUÍDO*")
		appendLead()
		appendField("⏱️", "Motivo", firstNotificationText(content, "sem atendimento no prazo"))
	case "whatsapp_disconnected":
		lines = append(lines, "⚠️ *WHATSAPP DESCONECTADO*")
		appendField("📱", "Conexão", firstNotificationText(stringFromMap(variables, "session_name"), stringFromMap(variables, "display_name"), leadName, "WhatsApp"))
		appendAction("acesse Integrações para reconectar")
	case "schedule_reminder", "appointment_reminder":
		lines = append(lines, "⏰ *LEMBRETE DE AGENDA*")
		appendField("📌", "Atividade", firstNotificationText(stringFromMap(variables, "schedule_title"), stringFromMap(variables, "title"), title))
		appendField("\U0001f9ed", "Tipo", scheduleType)
		appendField("📅", "Horário", scheduleDate)
		appendField("\U0001f464", "Lead", scheduleLeadName)
		appendField("\U0001f3e0", "Im\u00f3vel", propertyName)
		appendAction("acesse a agenda")
	case "test_push":
		lines = append(lines, "🧪 *TESTE DE NOTIFICAÇÃO*")
		if content != "" {
			lines = append(lines, content)
		} else {
			lines = append(lines, "Dispatcher do backend funcionando.")
		}
	default:
		return ""
	}

	if len(lines) == 1 && content != "" {
		lines = append(lines, content)
	}
	return strings.Join(cleanNotificationTemplateLines(lines), "\n")
}

func cleanNotificationTemplateLines(lines []string) []string {
	cleaned := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasSuffix(line, ": min") || strings.HasSuffix(line, ":  min") {
			continue
		}
		if line != "" {
			cleaned = append(cleaned, line)
		}
	}
	return cleaned
}

func (repo Repository) renderNotificationTemplateContent(ctx context.Context, organizationID string, eventKey string, channel string, variables map[string]any) (notificationTemplateContent, bool, error) {
	return repo.renderNotificationTemplateContentWithQueryer(ctx, repo.db.Pool(), organizationID, eventKey, channel, variables)
}

func (repo Repository) renderNotificationTemplateContentWithQueryer(ctx context.Context, queryer notificationQueryer, organizationID string, eventKey string, channel string, variables map[string]any) (notificationTemplateContent, bool, error) {
	var content notificationTemplateContent
	var title, message pgtype.Text
	err := queryer.QueryRow(ctx, `
		select
			title,
			message
		from public.notification_templates
		where coalesce(is_active, true) = true
		  and (organization_id = $1::uuid or organization_id is null)
		  and (event_key = $2 or slug = $2)
		  and (
		    channel = $3
		    or $3 = any(coalesce(channels, array[]::text[]))
		  )
		order by
			case when organization_id = $1::uuid then 0 else 1 end,
			updated_at desc nulls last,
			created_at desc nulls last
		limit 1
	`, organizationID, eventKey, channel).Scan(&title, &message)
	if errors.Is(err, pgx.ErrNoRows) || isUndefinedTableError(err) || isUndefinedColumnError(err) {
		return notificationTemplateContent{}, false, nil
	}
	if err != nil {
		return notificationTemplateContent{}, false, err
	}
	content.Title = renderNotificationTemplateText(textValue(title), variables)
	content.Message = renderNotificationTemplateText(textValue(message), variables)
	return content, content.Title != "" || content.Message != "", nil
}

func renderNotificationTemplateText(template string, variables map[string]any) string {
	template = strings.TrimSpace(template)
	if template == "" {
		return ""
	}
	values := notificationTemplateValues(variables)
	lines := make([]string, 0)
	for _, line := range strings.Split(template, "\n") {
		hadPlaceholder := notificationTemplatePlaceholderPattern.MatchString(line)
		line = notificationTemplatePlaceholderPattern.ReplaceAllStringFunc(line, func(match string) string {
			parts := notificationTemplatePlaceholderPattern.FindStringSubmatch(match)
			if len(parts) < 2 {
				return ""
			}
			return values[parts[1]]
		})
		line = strings.TrimSpace(line)
		if line == "" || (hadPlaceholder && strings.HasSuffix(line, ":")) {
			continue
		}
		lines = append(lines, line)
	}
	return strings.Join(lines, "\n")
}

var notificationTemplatePlaceholderPattern = regexp.MustCompile(`\{\{?\s*([A-Za-z0-9_.-]+)\s*\}\}?`)

func notificationTemplateValues(variables map[string]any) map[string]string {
	values := make(map[string]string, len(variables)+4)
	for key, value := range variables {
		if strings.HasPrefix(key, "__") {
			continue
		}
		values[key] = strings.TrimSpace(fmt.Sprint(value))
	}

	rawCreatedDate := firstNotificationText(
		values["lead_created_at"],
		values["created_time"],
		values["created_at"],
		values["date"],
	)
	if rawCreatedDate != "" {
		formattedDate := formatNotificationTemplateDate(rawCreatedDate)
		values["lead_created_at"] = formattedDate
		values["created_time"] = formattedDate
		values["created_at"] = formattedDate
		values["date"] = formattedDate
	}

	rawScheduleDate := firstNotificationText(
		values["horario"],
		values["schedule_time"],
		values["schedule_start_time"],
		values["start_time"],
		values["scheduled_at"],
	)
	if rawScheduleDate != "" {
		formattedDate := formatNotificationTemplateDate(rawScheduleDate)
		values["schedule_time"] = formattedDate
		values["schedule_start_time"] = formattedDate
		values["start_time"] = formattedDate
		values["scheduled_at"] = formattedDate
		values["horario"] = formattedDate
		if values["date"] == "" {
			values["date"] = formattedDate
		}
	}
	if values["schedule_event_type_label"] == "" {
		values["schedule_event_type_label"] = scheduleReminderEventTypeLabel(values["schedule_event_type"], values["event_type"])
	}
	if values["property_name"] == "" {
		values["property_name"] = scheduleReminderPropertyText(values["property_title"], values["property_code"], values["property_id"])
	}

	return values
}

func formatNotificationTemplateDate(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}

	location, err := time.LoadLocation("America/Sao_Paulo")
	if err != nil {
		location = time.FixedZone("America/Sao_Paulo", -3*60*60)
	}
	format := func(value time.Time) string {
		return value.In(location).Format("02/01/2006 | 15:04")
	}

	if timestamp, err := strconv.ParseInt(value, 10, 64); err == nil && timestamp > 0 {
		if timestamp > 100_000_000_000 {
			timestamp /= 1_000
		}
		return format(time.Unix(timestamp, 0))
	}

	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02 15:04:05-07:00"} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return format(parsed)
		}
	}

	return value
}

func scheduleReminderEventTypeLabel(values ...string) string {
	eventType := strings.ToLower(firstNotificationText(values...))
	switch eventType {
	case "call":
		return "Liga\u00e7\u00e3o"
	case "email":
		return "E-mail"
	case "meeting":
		return "Reuni\u00e3o"
	case "task":
		return "Tarefa"
	case "message":
		return "Mensagem"
	case "visit":
		return "Visita ao im\u00f3vel"
	default:
		return firstNotificationText(values...)
	}
}

func scheduleReminderPropertyName(variables map[string]any) string {
	return scheduleReminderPropertyText(
		stringFromMap(variables, "property_title"),
		stringFromMap(variables, "property_code"),
		stringFromMap(variables, "property_id"),
	)
}

func scheduleReminderLeadName(variables map[string]any) string {
	leadName := firstNotificationText(
		stringFromMap(variables, "lead_name"),
		stringFromMap(variables, "leadName"),
	)
	if leadName != "" {
		return leadName
	}
	if stringFromMap(variables, "lead_id") != "" {
		return "Lead vinculado"
	}
	return ""
}

func scheduleReminderPropertyText(title string, code string, propertyID string) string {
	title = strings.TrimSpace(title)
	code = strings.TrimSpace(code)
	if title != "" && code != "" {
		return title + " (" + code + ")"
	}
	if title != "" {
		return title
	}
	if code != "" {
		return code
	}
	if strings.TrimSpace(propertyID) != "" {
		return "Im\u00f3vel vinculado"
	}
	return ""
}
