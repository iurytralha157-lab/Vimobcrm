package homefocus

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

var homeNoticeLocation = func() *time.Location {
	location, err := time.LoadLocation("America/Sao_Paulo")
	if err != nil {
		return time.FixedZone("America/Sao_Paulo", -3*60*60)
	}
	return location
}()

type billingNoticeState struct {
	OrganizationID     string
	SubscriptionStatus string
	SubscriptionType   string
	NextBillingDate    *time.Time
	BillingGraceUntil  *time.Time
	PaymentDueDate     *time.Time
	PaymentStatus      string
}

const billingNoticeStateSQL = `
	select
		lower(btrim(coalesce(o.subscription_status, ''))),
		lower(btrim(coalesce(o.subscription_type, ''))),
		o.next_billing_date,
		o.billing_grace_until,
		payment.due_date,
		coalesce(payment.status, '')
	from public.organizations o
	left join lateral (
		select
			p.due_date,
			upper(btrim(coalesce(p.status, ''))) as status
		from public.asaas_payments p
		where p.organization_id = o.id
		  and upper(btrim(coalesce(p.status, ''))) in (
			'CREATED',
			'PENDING',
			'OVERDUE',
			'DUNNING_REQUESTED',
			'DUNNING_RECEIVED',
			'CREDIT_CARD_CAPTURE_REFUSED',
			'REPROVED_BY_RISK_ANALYSIS',
			'AWAITING_RISK_ANALYSIS'
		  )
		order by
			p.due_date asc nulls last,
			coalesce(p.updated_at, p.created_at) desc nulls last,
			p.id desc
		limit 1
	) payment on true
	where o.id = $1::uuid
	limit 1
`

const activeAnnouncementNoticesSQL = `
	select
		a.id::text,
		a.message,
		coalesce(a.button_text, ''),
		coalesce(a.button_url, ''),
		nullif(a.record->>'display_duration_seconds', '')::integer,
		nullif(a.record->>'starts_at', '')::timestamptz,
		nullif(a.record->>'ends_at', '')::timestamptz
	from (
		select announcement.*, to_jsonb(announcement) as record
		from public.announcements announcement
	) a
	where coalesce(a.is_active, false) = true
	  and coalesce(a.show_banner, false) = true
	  and (
		nullif(a.record->>'starts_at', '') is null
		or nullif(a.record->>'starts_at', '')::timestamptz <= now()
	  )
	  and (
		nullif(a.record->>'ends_at', '') is null
		or nullif(a.record->>'ends_at', '')::timestamptz >= now()
	  )
	  and (
		a.target_type = 'all'
		or (
			a.target_type = 'specific'
			and nullif($2, '')::uuid = any(coalesce(a.target_user_ids, '{}'::uuid[]))
		)
		or (
			a.target_type = 'organizations'
			and nullif($1, '')::uuid = any(coalesce(a.target_organization_ids, '{}'::uuid[]))
		)
		or (a.target_type = 'admins' and $3::boolean)
		or (a.target_type = 'brokers' and $4::boolean)
	  )
	order by a.created_at desc nulls last, a.id desc
	limit 30
`

func (repo Repository) ListNotices(ctx context.Context, tenantContext tenant.Context) ([]Notice, error) {
	notices := make([]Notice, 0, 4)
	if !tenantContext.IsSuperAdmin {
		state, err := repo.loadBillingNoticeState(ctx, tenantContext.OrganizationID)
		if err != nil {
			return nil, fmt.Errorf("load billing notice state: %w", err)
		}
		if notice := buildBillingNotice(
			state,
			time.Now(),
			tenantContext.HasPermission(permissions.SettingsBilling),
		); notice != nil {
			notices = append(notices, *notice)
		}
	}

	announcements, err := repo.listAnnouncementNotices(ctx, tenantContext)
	if err != nil {
		return nil, fmt.Errorf("list announcement notices: %w", err)
	}
	return append(notices, announcements...), nil
}

func (repo Repository) loadBillingNoticeState(ctx context.Context, organizationID string) (billingNoticeState, error) {
	state := billingNoticeState{OrganizationID: strings.TrimSpace(organizationID)}
	var nextBillingDate, paymentDueDate pgtype.Date
	var billingGraceUntil pgtype.Timestamptz
	err := repo.db.Pool().QueryRow(ctx, billingNoticeStateSQL, organizationID).Scan(
		&state.SubscriptionStatus,
		&state.SubscriptionType,
		&nextBillingDate,
		&billingGraceUntil,
		&paymentDueDate,
		&state.PaymentStatus,
	)
	if err != nil {
		return billingNoticeState{}, err
	}
	state.NextBillingDate = noticeDatePointer(nextBillingDate)
	state.BillingGraceUntil = noticeTimestampPointer(billingGraceUntil)
	state.PaymentDueDate = noticeDatePointer(paymentDueDate)
	return state, nil
}

func (repo Repository) listAnnouncementNotices(ctx context.Context, tenantContext tenant.Context) ([]Notice, error) {
	isAdminAudience := tenantContext.IsSuperAdmin || tenantContext.HasRole("owner", "admin")
	isBrokerAudience := !tenantContext.IsSuperAdmin && tenantContext.HasRole("user")
	rows, err := repo.db.Pool().Query(
		ctx,
		activeAnnouncementNoticesSQL,
		tenantContext.OrganizationID,
		tenantContext.UserID,
		isAdminAudience,
		isBrokerAudience,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	notices := make([]Notice, 0, 3)
	for rows.Next() {
		var id, message, actionLabel, actionURL string
		var displayDuration pgtype.Int4
		var startsAt, endsAt pgtype.Timestamptz
		if err := rows.Scan(
			&id,
			&message,
			&actionLabel,
			&actionURL,
			&displayDuration,
			&startsAt,
			&endsAt,
		); err != nil {
			return nil, err
		}
		notice, ok := buildAnnouncementNotice(
			id,
			message,
			actionLabel,
			actionURL,
			displayDuration,
			startsAt,
			endsAt,
		)
		if !ok {
			continue
		}
		notices = append(notices, notice)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return notices, nil
}

func buildAnnouncementNotice(
	id string,
	message string,
	actionLabel string,
	actionURL string,
	displayDuration pgtype.Int4,
	startsAt pgtype.Timestamptz,
	endsAt pgtype.Timestamptz,
) (Notice, bool) {
	description := strings.TrimSpace(message)
	if description == "" || len(description) > 500 {
		return Notice{}, false
	}

	label := optionalNoticeText(actionLabel)
	if label != nil && len(*label) > 48 {
		label = nil
	}
	safeURL := optionalNoticeURL(actionURL)
	if safeURL != nil && len(*safeURL) > 2048 {
		safeURL = nil
	}
	if label == nil || safeURL == nil {
		label = nil
		safeURL = nil
	}

	duration := noticeIntPointer(displayDuration)
	if duration != nil && (*duration < 5 || *duration > 86_400) {
		duration = nil
	}
	start := noticeTimestampPointer(startsAt)
	end := noticeTimestampPointer(endsAt)
	if start != nil && end != nil && !end.After(*start) {
		return Notice{}, false
	}

	return Notice{
		ID:                     "announcement:" + id,
		Source:                 "announcement",
		Severity:               "announcement",
		Title:                  "Comunicado",
		Description:            description,
		ActionLabel:            label,
		ActionURL:              safeURL,
		Dismissible:            true,
		DisplayDurationSeconds: duration,
		StartsAt:               start,
		EndsAt:                 end,
	}, true
}
func buildBillingNotice(state billingNoticeState, now time.Time, canManageBilling bool) *Notice {
	status := strings.ToLower(strings.TrimSpace(state.SubscriptionStatus))
	subscriptionType := strings.ToLower(strings.TrimSpace(state.SubscriptionType))
	paymentStatus := strings.ToUpper(strings.TrimSpace(state.PaymentStatus))
	dueDate := effectiveBillingDueDate(state)

	var notice *Notice
	switch status {
	case "blocked":
		notice = criticalBillingNotice(state, dueDate, "Acesso bloqueado por pendência", "Regularize a assinatura para restaurar o acesso.")
	case "suspended":
		notice = criticalBillingNotice(state, dueDate, "Sua assinatura está suspensa", "Regularize a assinatura para restaurar o acesso.")
	case "cancelled", "canceled":
		notice = criticalBillingNotice(state, dueDate, "Sua assinatura foi cancelada", "Escolha um plano para continuar usando o Vimob CRM.")
	case "pending", "pending_payment":
		notice = criticalBillingNotice(state, dueDate, "Pagamento da assinatura pendente", "Conclua o pagamento para liberar todos os recursos.")
	case "overdue", "past_due":
		title := overdueNoticeTitle(dueDate, now)
		notice = criticalBillingNotice(state, dueDate, title, overdueNoticeDescription(state.BillingGraceUntil, now))
	case "active":
		switch paymentStatus {
		case "CREDIT_CARD_CAPTURE_REFUSED", "REPROVED_BY_RISK_ANALYSIS":
			notice = criticalBillingNotice(state, dueDate, "Não foi possível processar o pagamento", "Revise a forma de pagamento para evitar a interrupção do acesso.")
		default:
			if subscriptionType != "paid" || dueDate == nil {
				return nil
			}
			daysUntilDue := noticeDateDelta(databaseNoticeDate(*dueDate), now)
			if daysUntilDue < 0 {
				notice = criticalBillingNotice(state, dueDate, overdueNoticeTitle(dueDate, now), "Regularize a assinatura para evitar a interrupção do acesso.")
				break
			}
			if daysUntilDue > 5 {
				return nil
			}
			title := fmt.Sprintf("Sua assinatura vence em %d dias", daysUntilDue)
			if daysUntilDue == 0 {
				title = "Sua assinatura vence hoje"
			} else if daysUntilDue == 1 {
				title = "Sua assinatura vence amanhã"
			}
			notice = &Notice{
				ID:          billingNoticeID(state.OrganizationID, status, dueDate),
				Source:      "billing",
				Severity:    "warning",
				Title:       title,
				Description: fmt.Sprintf("Cobrança prevista para %s.", formatNoticeDate(databaseNoticeDate(*dueDate))),
				Dismissible: false,
			}
		}
	default:
		return nil
	}

	if notice == nil {
		return nil
	}
	if canManageBilling {
		label := "Ver assinatura"
		if notice.Severity == "critical" {
			label = "Regularizar assinatura"
		}
		url := "/settings?tab=subscription"
		notice.ActionLabel = &label
		notice.ActionURL = &url
	}
	return notice
}

func overdueNoticeTitle(dueDate *time.Time, now time.Time) string {
	title := "Sua assinatura está vencida"
	if dueDate == nil {
		return title
	}
	daysOverdue := -noticeDateDelta(databaseNoticeDate(*dueDate), now)
	switch {
	case daysOverdue == 1:
		return "Sua assinatura venceu há 1 dia"
	case daysOverdue > 1:
		return fmt.Sprintf("Sua assinatura venceu há %d dias", daysOverdue)
	default:
		return title
	}
}

func criticalBillingNotice(state billingNoticeState, dueDate *time.Time, title, description string) *Notice {
	return &Notice{
		ID:          billingNoticeID(state.OrganizationID, state.SubscriptionStatus, dueDate),
		Source:      "billing",
		Severity:    "critical",
		Title:       title,
		Description: description,
		Dismissible: false,
	}
}

func effectiveBillingDueDate(state billingNoticeState) *time.Time {
	paymentStatus := strings.ToUpper(strings.TrimSpace(state.PaymentStatus))
	if state.PaymentDueDate != nil {
		switch paymentStatus {
		case "OVERDUE", "CREDIT_CARD_CAPTURE_REFUSED", "REPROVED_BY_RISK_ANALYSIS", "DUNNING_REQUESTED", "DUNNING_RECEIVED", "PENDING", "CREATED", "AWAITING_RISK_ANALYSIS":
			return state.PaymentDueDate
		}
	}
	return state.NextBillingDate
}

func overdueNoticeDescription(graceUntil *time.Time, now time.Time) string {
	if graceUntil == nil {
		return "Regularize a assinatura para evitar a interrupção do acesso."
	}
	daysUntilBlock := noticeDateDelta(timestampNoticeDate(*graceUntil), now)
	switch {
	case daysUntilBlock < 0:
		return "O acesso pode ser bloqueado a qualquer momento."
	case daysUntilBlock == 0:
		return "O acesso poderá ser bloqueado hoje."
	case daysUntilBlock == 1:
		return "O acesso será bloqueado amanhã."
	default:
		return fmt.Sprintf("O acesso será bloqueado em %d dias.", daysUntilBlock)
	}
}

func billingNoticeID(organizationID, status string, dueDate *time.Time) string {
	key := "sem-data"
	if dueDate != nil {
		key = dueDate.Format("2006-01-02")
	}
	return "billing:" + strings.TrimSpace(organizationID) + ":" + strings.ToLower(strings.TrimSpace(status)) + ":" + key
}

func databaseNoticeDate(value time.Time) time.Time {
	year, month, day := value.Date()
	return time.Date(year, month, day, 0, 0, 0, 0, homeNoticeLocation)
}

func timestampNoticeDate(value time.Time) time.Time {
	year, month, day := value.In(homeNoticeLocation).Date()
	return time.Date(year, month, day, 0, 0, 0, 0, homeNoticeLocation)
}

func noticeDateDelta(target time.Time, now time.Time) int {
	targetYear, targetMonth, targetDay := target.Date()
	nowYear, nowMonth, nowDay := now.In(homeNoticeLocation).Date()
	targetUTC := time.Date(targetYear, targetMonth, targetDay, 0, 0, 0, 0, time.UTC)
	nowUTC := time.Date(nowYear, nowMonth, nowDay, 0, 0, 0, 0, time.UTC)
	return int(targetUTC.Sub(nowUTC) / (24 * time.Hour))
}

func formatNoticeDate(value time.Time) string {
	return fmt.Sprintf("%02d/%02d", value.Day(), value.Month())
}

func optionalNoticeText(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func optionalNoticeURL(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	if strings.HasPrefix(value, "/") && !strings.HasPrefix(value, "//") {
		return &value
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" {
		return nil
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil
	}
	return &value
}

func noticeDatePointer(value pgtype.Date) *time.Time {
	if !value.Valid {
		return nil
	}
	copy := value.Time
	return &copy
}

func noticeTimestampPointer(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	copy := value.Time
	return &copy
}

func noticeIntPointer(value pgtype.Int4) *int {
	if !value.Valid {
		return nil
	}
	copy := int(value.Int32)
	return &copy
}
