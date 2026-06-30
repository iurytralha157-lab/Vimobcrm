package admin

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type ExternalConfig struct {
	ProjectURL   string
	APIKey       string
	ResendAPIKey string
	FromEmail    string
	ReplyTo      string
	SupportEmail string
	AppURL       string
}

type Repository struct {
	db           *dbpkg.Postgres
	projectURL   string
	apiKey       string
	resendAPIKey string
	fromEmail    string
	replyTo      string
	supportEmail string
	appURL       string
	httpClient   *http.Client
}

func NewRepository(db *dbpkg.Postgres, externalConfig ExternalConfig) Repository {
	return Repository{
		db:           db,
		projectURL:   strings.TrimRight(strings.TrimSpace(externalConfig.ProjectURL), "/"),
		apiKey:       strings.TrimSpace(externalConfig.APIKey),
		resendAPIKey: strings.TrimSpace(externalConfig.ResendAPIKey),
		fromEmail:    cleanEmailHeader(firstNonEmpty(externalConfig.FromEmail, "Vimob CRM <naoresponde@vimobcrm.com.br>")),
		replyTo:      cleanEmailHeader(firstNonEmpty(externalConfig.ReplyTo, "contato@vimobcrm.com.br")),
		supportEmail: cleanEmailHeader(firstNonEmpty(externalConfig.SupportEmail, "contato@vimobcrm.com.br")),
		appURL:       strings.TrimRight(firstNonEmpty(externalConfig.AppURL, "https://app.vimobcrm.com.br"), "/"),
		httpClient:   &http.Client{Timeout: 30 * time.Second},
	}
}

func (repo Repository) ListOrganizations(ctx context.Context, tenantContext tenant.Context, search string, status string, segment string) ([]map[string]any, error) {
	if !tenantContext.IsSuperAdmin {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	if status == "" {
		status = "all"
	}
	if segment == "" {
		segment = "all"
	}

	return repo.queryJSONRows(ctx, `
		select jsonb_build_object(
			'id', o.id::text,
			'name', o.name,
			'logo_url', o.logo_url,
			'is_active', o.is_active,
			'subscription_status', o.subscription_status,
			'subscription_type', o.subscription_type,
			'segment', o.segment,
			'max_users', o.max_users,
			'admin_notes', o.admin_notes,
			'created_at', o.created_at,
			'last_access_at', o.last_access_at,
			'user_count', (select count(*) from public.organization_members om where om.organization_id = o.id and om.is_active = true),
			'lead_count', (select count(*) from public.leads l where l.organization_id = o.id),
			'automation_count', (select count(*) from public.automations a where a.organization_id = o.id),
			'mrr', coalesce(o.subscription_value, 0),
			'health_score', case when o.is_active then 100 else 0 end,
			'days_trial_left', case when o.trial_ends_at is null then 0 else floor(extract(epoch from (o.trial_ends_at - now())) / 86400)::int end,
			'overdue_amount', 0,
			'plan_id', o.plan_id::text,
			'subscription_value', o.subscription_value,
			'billing_day', o.billing_day,
			'next_billing_date', o.next_billing_date,
			'asaas_customer_id', o.asaas_customer_id,
			'asaas_subscription_id', o.asaas_subscription_id,
			'creci', o.creci,
			'max_whatsapp_sessions_override', o.max_whatsapp_sessions_override
		)
		from public.organizations o
		where ($1 = '' or o.name ilike '%' || $1 || '%' or o.email ilike '%' || $1 || '%' or o.cnpj ilike '%' || $1 || '%')
		  and ($2 = 'all' or o.subscription_status = $2)
		  and ($3 = 'all' or o.segment = $3)
		order by o.created_at desc
	`, strings.TrimSpace(search), status, segment)
}

func (repo Repository) ListUsers(ctx context.Context, tenantContext tenant.Context) ([]map[string]any, error) {
	if !tenantContext.IsSuperAdmin {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	return repo.queryJSONRows(ctx, `
		select jsonb_build_object(
			'id', u.id::text,
			'name', u.name,
			'email', u.email,
			'avatar_url', u.avatar_url,
			'role', u.role,
			'organization_id', u.organization_id::text,
			'organization_name', o.name,
			'is_active', u.is_active,
			'created_at', u.created_at
		)
		from public.users u
		left join public.organizations o on o.id = u.organization_id
		order by u.created_at desc
	`)
}

func (repo Repository) ListActiveAnnouncements(ctx context.Context, tenantContext tenant.Context) ([]map[string]any, error) {
	return repo.queryJSONRows(ctx, `
		select to_jsonb(a)
		from public.announcements a
		where coalesce(a.is_active, false) = true
		  and coalesce(a.show_banner, false) = true
		order by a.created_at desc
		limit 30
	`)
}

func (repo Repository) ListMyFeatureRequests(ctx context.Context, tenantContext tenant.Context) ([]map[string]any, error) {
	return repo.queryJSONRows(ctx, `
		select to_jsonb(fr)
		from public.feature_requests fr
		where fr.user_id = $1::uuid
		order by fr.created_at desc
	`, tenantContext.UserID)
}

func (repo Repository) CreateFeatureRequest(ctx context.Context, tenantContext tenant.Context, payload map[string]any) (map[string]any, error) {
	category := strings.TrimSpace(stringValue(payload["category"]))
	title := strings.TrimSpace(stringValue(payload["title"]))
	description := strings.TrimSpace(stringValue(payload["description"]))
	if tenantContext.OrganizationID == "" || category == "" || title == "" || description == "" {
		return nil, ErrInvalidInput
	}
	return repo.queryJSONObject(ctx, `
		insert into public.feature_requests (
			organization_id,
			user_id,
			category,
			title,
			description
		)
		values ($1::uuid, $2::uuid, $3, $4, $5)
		returning to_jsonb(feature_requests)
	`, tenantContext.OrganizationID, tenantContext.UserID, category, title, description)
}

func (repo Repository) ListFeatureRequestsAdmin(ctx context.Context, tenantContext tenant.Context) ([]map[string]any, error) {
	if !tenantContext.IsSuperAdmin {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	return repo.queryJSONRows(ctx, `
		select jsonb_strip_nulls(
			to_jsonb(fr)
			|| jsonb_build_object(
				'user', case when u.id is null then null else jsonb_build_object('id', u.id::text, 'name', u.name, 'email', u.email) end,
				'organization', case when o.id is null then null else jsonb_build_object('id', o.id::text, 'name', o.name) end
			)
		)
		from public.feature_requests fr
		left join public.users u on u.id = fr.user_id
		left join public.organizations o on o.id = fr.organization_id
		order by fr.created_at desc
	`)
}

func (repo Repository) RespondFeatureRequestAdmin(ctx context.Context, tenantContext tenant.Context, id string, payload map[string]any) (map[string]any, error) {
	if !tenantContext.IsSuperAdmin {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	id, ok := normalizeUUID(id)
	if !ok {
		return nil, ErrInvalidInput
	}
	status := strings.TrimSpace(stringValue(payload["status"]))
	if status == "" {
		return nil, ErrInvalidInput
	}
	return repo.queryJSONObject(ctx, `
		update public.feature_requests
		set status = $2,
		    admin_response = $3,
		    responded_at = now(),
		    responded_by = $4::uuid,
		    updated_at = now()
		where id = $1::uuid
		returning to_jsonb(feature_requests)
	`, id, status, nullableString(payload["admin_response"]), tenantContext.UserID)
}

func (repo Repository) ListInvitations(ctx context.Context, tenantContext tenant.Context, organizationID string) ([]map[string]any, error) {
	organizationID, err := repo.resolveInvitationOrganization(tenantContext, organizationID)
	if err != nil {
		return nil, err
	}
	return repo.queryJSONRows(ctx, `
		select to_jsonb(i)
		from public.invitations i
		where i.organization_id = $1::uuid
		  and i.used_at is null
		  and i.expires_at > now()
		order by i.created_at desc
	`, organizationID)
}

func (repo Repository) CreateInvitation(ctx context.Context, tenantContext tenant.Context, request InvitationRequest) (map[string]any, error) {
	organizationID := ""
	if request.OrganizationID != nil {
		organizationID = *request.OrganizationID
	}
	resolvedOrganizationID, err := repo.resolveInvitationOrganization(tenantContext, organizationID)
	if err != nil {
		return nil, err
	}

	role := strings.TrimSpace(request.Role)
	switch role {
	case "admin", "manager", "user":
	default:
		return nil, ErrInvalidInput
	}

	var email *string
	if request.Email != nil {
		normalizedEmail, err := normalizeEmail(*request.Email)
		if err != nil {
			return nil, err
		}
		email = &normalizedEmail
	}

	item, err := repo.queryJSONObject(ctx, `
		insert into public.invitations (
			organization_id,
			email,
			role,
			created_by,
			expires_at
		)
		values (
			$1::uuid,
			$2,
			$3,
			$4::uuid,
			coalesce($5::timestamptz, now() + interval '7 days')
		)
		returning to_jsonb(invitations)
	`, resolvedOrganizationID, email, role, tenantContext.UserID, cleanString(request.ExpiresAt))
	if err != nil {
		return nil, err
	}

	emailSent := false
	if email != nil {
		organizationName, orgErr := repo.organizationName(ctx, resolvedOrganizationID)
		if orgErr != nil {
			return nil, orgErr
		}
		token, _ := item["token"].(string)
		if token != "" {
			emailSent = repo.sendInvitationEmail(ctx, invitationEmailInput{
				Email:            *email,
				OrganizationName: organizationName,
				Role:             role,
				InviteURL:        repo.invitationURL(token),
			}) == nil
		}
	}
	item["email_sent"] = emailSent
	return item, nil
}

func (repo Repository) DeleteInvitation(ctx context.Context, tenantContext tenant.Context, invitationID string) error {
	invitationID, ok := normalizeUUID(invitationID)
	if !ok {
		return ErrInvalidInput
	}

	if tenantContext.IsSuperAdmin {
		tag, err := repo.db.Pool().Exec(ctx, `delete from public.invitations where id = $1::uuid`, invitationID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		return nil
	}

	if tenantContext.OrganizationID == "" {
		return tenant.ErrOrganizationAccessDenied
	}

	tag, err := repo.db.Pool().Exec(ctx, `
		delete from public.invitations
		where id = $1::uuid
		  and organization_id = $2::uuid
	`, invitationID, tenantContext.OrganizationID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (repo Repository) ShowInvitationByToken(ctx context.Context, token string) (map[string]any, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, ErrInvalidInput
	}
	item, err := repo.queryJSONObject(ctx, `
		select jsonb_build_object(
			'id', i.id::text,
			'email', i.email,
			'role', i.role,
			'organization_id', i.organization_id::text,
			'organization_name', o.name,
			'expires_at', i.expires_at
		)
		from public.invitations i
		join public.organizations o on o.id = i.organization_id
		where i.token = $1
		  and i.used_at is null
		  and i.expires_at > now()
		limit 1
	`, token)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	return item, err
}

func (repo Repository) ShowMyOnboardingRequest(ctx context.Context, tenantContext tenant.Context) (map[string]any, error) {
	if tenantContext.UserID == "" {
		return nil, ErrInvalidInput
	}
	return repo.queryJSONObject(ctx, `
		select coalesce((
			select to_jsonb(orq)
			from public.onboarding_requests orq
			where orq.user_id = $1::uuid
			order by orq.created_at desc
			limit 1
		), 'null'::jsonb)
	`, tenantContext.UserID)
}

func (repo Repository) CreateOnboardingRequest(ctx context.Context, tenantContext tenant.Context, payload map[string]any) (map[string]any, error) {
	if tenantContext.UserID == "" {
		return nil, ErrInvalidInput
	}
	filtered := map[string]any{"user_id": tenantContext.UserID}
	for key, value := range payload {
		if isAllowedOnboardingField(key) {
			filtered[key] = cleanAdminValue(value)
		}
	}
	if strings.TrimSpace(stringValue(filtered["company_name"])) == "" ||
		strings.TrimSpace(stringValue(filtered["responsible_name"])) == "" ||
		strings.TrimSpace(stringValue(filtered["responsible_email"])) == "" {
		return nil, ErrInvalidInput
	}

	columns, placeholders, args, err := buildAdminPayload(filtered, 0)
	if err != nil {
		return nil, err
	}
	return repo.queryJSONObject(ctx, fmt.Sprintf(`
		insert into public.onboarding_requests (%s)
		values (%s)
		returning to_jsonb(onboarding_requests)
	`, strings.Join(columns, ", "), strings.Join(placeholders, ", ")), args...)
}

func (repo Repository) ListOnboardingRequestsAdmin(ctx context.Context, tenantContext tenant.Context) ([]map[string]any, error) {
	if !tenantContext.IsSuperAdmin {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	return repo.queryJSONRows(ctx, `
		select to_jsonb(orq)
		from public.onboarding_requests orq
		order by orq.created_at desc
	`)
}

func (repo Repository) UpdateOnboardingRequestAdmin(ctx context.Context, tenantContext tenant.Context, id string, payload map[string]any) (map[string]any, error) {
	if !tenantContext.IsSuperAdmin {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	id, ok := normalizeUUID(id)
	if !ok {
		return nil, ErrInvalidInput
	}

	filtered := map[string]any{
		"reviewed_by": tenantContext.UserID,
		"reviewed_at": time.Now().UTC().Format(time.RFC3339),
		"updated_at":  time.Now().UTC().Format(time.RFC3339),
	}
	for key, value := range payload {
		switch key {
		case "status", "admin_notes", "selected_plan_id", "confirmed_value", "billing_cycle":
			filtered[key] = cleanAdminValue(value)
		}
	}
	if _, ok := filtered["status"]; !ok {
		return nil, ErrInvalidInput
	}

	columns, placeholders, args, err := buildAdminPayload(filtered, 1)
	if err != nil {
		return nil, err
	}
	assignments := []string{}
	for index, column := range columns {
		assignments = append(assignments, fmt.Sprintf("%s = %s", column, placeholders[index]))
	}
	args = append([]any{id}, args...)

	item, err := repo.queryJSONObject(ctx, fmt.Sprintf(`
		update public.onboarding_requests
		set %s
		where id = $1::uuid
		returning to_jsonb(onboarding_requests)
	`, strings.Join(assignments, ", ")), args...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return item, err
}

func (repo Repository) ListActiveSubscriptionPlans(ctx context.Context) ([]map[string]any, error) {
	return repo.queryJSONRows(ctx, `
		select jsonb_build_object(
			'id', p.id::text,
			'name', p.name,
			'price', p.price,
			'billing_cycle', p.billing_cycle,
			'description', p.description
		)
		from public.admin_subscription_plans p
		where coalesce(p.is_active, true) = true
		order by p.price asc, p.name asc
	`)
}

func (repo Repository) ListTableRows(ctx context.Context, tenantContext tenant.Context, table string, limit int) ([]map[string]any, error) {
	if !tenantContext.IsSuperAdmin {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	if !isAllowedAdminTable(table) {
		return nil, ErrInvalidInput
	}
	if limit < 1 || limit > 200 {
		limit = 60
	}
	identifier := pgx.Identifier{"public", table}.Sanitize()
	return repo.queryJSONRows(ctx, fmt.Sprintf(`select to_jsonb(t) from (select * from %s limit $1) t`, identifier), limit)
}

func (repo Repository) CountTableRows(ctx context.Context, tenantContext tenant.Context, table string) (int64, error) {
	if !tenantContext.IsSuperAdmin {
		return 0, tenant.ErrOrganizationAccessDenied
	}
	if !isAllowedAdminTable(table) {
		return 0, ErrInvalidInput
	}
	identifier := pgx.Identifier{"public", table}.Sanitize()
	var count int64
	err := repo.db.Pool().QueryRow(ctx, fmt.Sprintf(`select count(*) from %s`, identifier)).Scan(&count)
	return count, err
}

func (repo Repository) CreateTableRow(ctx context.Context, tenantContext tenant.Context, table string, payload map[string]any) (map[string]any, error) {
	if !tenantContext.IsSuperAdmin {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	if !isAllowedAdminTable(table) || len(payload) == 0 {
		return nil, ErrInvalidInput
	}
	columns, placeholders, args, err := buildAdminPayload(payload, 0)
	if err != nil {
		return nil, err
	}
	identifier := pgx.Identifier{"public", table}.Sanitize()
	return repo.queryJSONObject(ctx, fmt.Sprintf(`
		insert into %s (%s)
		values (%s)
		returning to_jsonb(%s)
	`, identifier, strings.Join(columns, ", "), strings.Join(placeholders, ", "), pgx.Identifier{table}.Sanitize()), args...)
}

func (repo Repository) UpdateTableRow(ctx context.Context, tenantContext tenant.Context, table string, id string, payload map[string]any) (map[string]any, error) {
	if !tenantContext.IsSuperAdmin {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	id, ok := normalizeUUID(id)
	if !ok || !isAllowedAdminTable(table) || len(payload) == 0 {
		return nil, ErrInvalidInput
	}
	columns, placeholders, args, err := buildAdminPayload(payload, 1)
	if err != nil {
		return nil, err
	}
	assignments := []string{}
	for index, column := range columns {
		assignments = append(assignments, fmt.Sprintf("%s = %s", column, placeholders[index]))
	}
	args = append([]any{id}, args...)
	identifier := pgx.Identifier{"public", table}.Sanitize()
	item, err := repo.queryJSONObject(ctx, fmt.Sprintf(`
		update %s
		set %s
		where id = $1::uuid
		returning to_jsonb(%s)
	`, identifier, strings.Join(assignments, ", "), pgx.Identifier{table}.Sanitize()), args...)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	return item, err
}

func (repo Repository) DeleteTableRow(ctx context.Context, tenantContext tenant.Context, table string, id string) error {
	if !tenantContext.IsSuperAdmin {
		return tenant.ErrOrganizationAccessDenied
	}
	id, ok := normalizeUUID(id)
	if !ok || !isAllowedAdminTable(table) {
		return ErrInvalidInput
	}
	identifier := pgx.Identifier{"public", table}.Sanitize()
	tag, err := repo.db.Pool().Exec(ctx, fmt.Sprintf(`delete from %s where id = $1::uuid`, identifier), id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (repo Repository) DatabaseStats(ctx context.Context, tenantContext tenant.Context) (map[string]any, error) {
	if !tenantContext.IsSuperAdmin {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	return repo.queryJSONObject(ctx, `select public.get_database_stats_admin()`)
}

func (repo Repository) OrphanMemberStats(ctx context.Context, tenantContext tenant.Context) (map[string]any, error) {
	if !tenantContext.IsSuperAdmin {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	teamOrphans, err := repo.queryJSONRows(ctx, `select to_jsonb(x) from public.find_orphan_team_members() x`)
	if err != nil {
		return nil, err
	}
	rrOrphans, err := repo.queryJSONRows(ctx, `select to_jsonb(x) from public.find_orphan_rr_members() x`)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"teamOrphans": teamOrphans,
		"rrOrphans":   rrOrphans,
		"total":       len(teamOrphans) + len(rrOrphans),
	}, nil
}

func (repo Repository) CleanupOrphanMembers(ctx context.Context, tenantContext tenant.Context) (map[string]any, error) {
	if !tenantContext.IsSuperAdmin {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	return repo.queryJSONObject(ctx, `select to_jsonb(public.cleanup_orphan_members())`)
}

func (repo Repository) ListOrganizationModules(ctx context.Context, tenantContext tenant.Context, organizationID string) ([]map[string]any, error) {
	if !tenantContext.IsSuperAdmin {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	organizationID, ok := normalizeUUID(organizationID)
	if !ok {
		return nil, ErrInvalidInput
	}
	return repo.queryJSONRows(ctx, `
		select to_jsonb(om)
		from public.organization_modules om
		where organization_id = $1::uuid
		order by module_name asc
	`, organizationID)
}

func (repo Repository) DashboardOverview(ctx context.Context, tenantContext tenant.Context, period int) (map[string]any, error) {
	if !tenantContext.IsSuperAdmin {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	if period < 1 {
		period = 30
	}

	return repo.queryJSONObject(ctx, `
		select jsonb_build_object(
			'period_days', $1::int,
			'financial', jsonb_build_object(
				'mrr', coalesce((select sum(subscription_value) from public.organizations where subscription_status in ('active', 'trial')), 0),
				'revenue_period', coalesce((select sum(subscription_value) from public.organizations where created_at >= now() - make_interval(days => $1::int)), 0),
				'revenue_forecast', coalesce((select sum(subscription_value) from public.organizations where subscription_status in ('trial', 'pending_payment', 'active')), 0),
				'avg_ticket', coalesce((select avg(subscription_value) from public.organizations where subscription_value is not null), 0),
				'overdue_total', 0,
				'revenue_growth_pct', 0
			),
			'platform', jsonb_build_object(
				'total_orgs', (select count(*) from public.organizations),
				'active_orgs', (select count(*) from public.organizations where is_active = true),
				'trial_orgs', (select count(*) from public.organizations where subscription_status = 'trial'),
				'cancelled_orgs', (select count(*) from public.organizations where subscription_status in ('cancelled', 'canceled')),
				'active_users_today', (select count(*) from public.users where is_active = true and updated_at >= current_date),
				'orgs_growth_pct', 0
			),
			'operational', jsonb_build_object(
				'leads_today', (select count(*) from public.leads where created_at >= current_date),
				'automations_today', (select count(*) from public.automation_executions where started_at >= current_date),
				'activities_today', (select count(*) from public.activities where created_at >= current_date),
				'errors_recent', (select count(*) from public.audit_logs where created_at >= now() - interval '24 hours' and action ilike '%error%'),
				'accesses_today', 0
			)
		)
	`, period)
}

func (repo Repository) DashboardTimeseries(ctx context.Context, tenantContext tenant.Context) (map[string]any, error) {
	if !tenantContext.IsSuperAdmin {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	return repo.queryJSONObject(ctx, `
		select jsonb_build_object(
			'revenue', '[]'::jsonb,
			'orgs', '[]'::jsonb,
			'usage', '[]'::jsonb,
			'health', jsonb_build_object(
				'active', (select count(*) from public.organizations where subscription_status = 'active'),
				'trial', (select count(*) from public.organizations where subscription_status = 'trial'),
				'overdue', (select count(*) from public.organizations where subscription_status in ('overdue', 'past_due')),
				'cancelled', (select count(*) from public.organizations where subscription_status in ('cancelled', 'canceled'))
			)
		)
	`)
}

func (repo Repository) DashboardFeed(ctx context.Context, tenantContext tenant.Context, limit int) ([]map[string]any, error) {
	if !tenantContext.IsSuperAdmin {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	if limit < 1 || limit > 100 {
		limit = 30
	}
	return repo.queryJSONRows(ctx, `
		select jsonb_build_object(
			'id', al.id::text,
			'organization_id', al.organization_id::text,
			'organization_name', o.name,
			'type', al.entity_type,
			'severity', 'info',
			'title', al.action,
			'description', al.details::text,
			'metadata', al.details,
			'created_at', al.created_at
		)
		from public.audit_logs al
		left join public.organizations o on o.id = al.organization_id
		order by al.created_at desc
		limit $1
	`, limit)
}

func (repo Repository) DashboardPending(ctx context.Context, tenantContext tenant.Context) (map[string]any, error) {
	if !tenantContext.IsSuperAdmin {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	return repo.queryJSONObject(ctx, `
		select jsonb_build_object(
			'overdue', '[]'::jsonb,
			'idle', coalesce((
				select jsonb_agg(jsonb_build_object(
					'id', id::text,
					'name', name,
					'last_access_at', last_access_at,
					'days_idle', case when last_access_at is null then null else floor(extract(epoch from (now() - last_access_at)) / 86400)::int end
				))
				from (
					select id, name, last_access_at
					from public.organizations
					where is_active = true
					order by last_access_at nulls first
					limit 20
				) idle_orgs
			), '[]'::jsonb),
			'issues', '[]'::jsonb,
			'trials', coalesce((
				select jsonb_agg(jsonb_build_object(
					'id', id::text,
					'name', name,
					'trial_ends_at', trial_ends_at,
					'days_left', floor(extract(epoch from (trial_ends_at - now())) / 86400)::int,
					'telefone', telefone,
					'whatsapp', whatsapp,
					'email', email
				))
				from (
					select id, name, trial_ends_at, telefone, whatsapp, email
					from public.organizations
					where subscription_status = 'trial'
					  and trial_ends_at is not null
					order by trial_ends_at asc
					limit 20
				) trial_orgs
			), '[]'::jsonb)
		)
	`)
}

func (repo Repository) CreateOrganization(ctx context.Context, tenantContext tenant.Context, request CreateOrganizationRequest) (map[string]any, error) {
	if !tenantContext.IsSuperAdmin {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	name := strings.TrimSpace(request.Name)
	adminName := strings.TrimSpace(request.AdminName)
	adminEmail, err := normalizeEmail(request.AdminEmail)
	if err != nil || name == "" || adminName == "" || len(strings.TrimSpace(request.AdminPassword)) < 8 {
		return nil, ErrInvalidInput
	}

	authUserID, err := repo.createAuthUser(ctx, adminEmail, request.AdminPassword, adminName)
	if err != nil {
		return nil, err
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var orgID string
	err = tx.QueryRow(ctx, `
		insert into public.organizations (
			name, segment, whatsapp, telefone, cnpj, creci, plan_id, endereco, cidade, bairro, numero, complemento, created_by
		)
		values ($1, coalesce($2, 'imobiliario'), $3, $4, $5, $6, $7::uuid, $8, $9, $10, $11, $12, $13::uuid)
		returning id::text
	`, name, cleanString(request.Segment), cleanString(request.Whatsapp), cleanString(request.Phone), cleanString(request.CNPJ), cleanString(request.Creci), cleanString(request.PlanID), cleanString(request.Address), cleanString(request.City), cleanString(request.Neighborhood), cleanString(request.Number), cleanString(request.Complement), tenantContext.UserID).Scan(&orgID)
	if err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx, `
		insert into public.users (id, organization_id, name, email, role, whatsapp, cpf, is_active)
		values ($1::uuid, $2::uuid, $3, $4, 'admin', $5, $6, true)
		on conflict (id) do update set
			organization_id = excluded.organization_id,
			name = excluded.name,
			email = excluded.email,
			role = 'admin',
			is_active = true,
			updated_at = now()
	`, authUserID, orgID, adminName, adminEmail, cleanString(request.Whatsapp), cleanString(request.CPF)); err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx, `
		insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($1::uuid, $2::uuid, 'admin', true)
		on conflict (user_id, organization_id)
		do update set role = 'admin', is_active = true, updated_at = now()
	`, orgID, authUserID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return repo.getOrganizationByID(ctx, orgID)
}

func (repo Repository) UpdateOrganization(ctx context.Context, tenantContext tenant.Context, organizationID string, request OrganizationUpdateRequest) error {
	if !tenantContext.IsSuperAdmin {
		return tenant.ErrOrganizationAccessDenied
	}
	organizationID, ok := normalizeUUID(organizationID)
	if !ok {
		return ErrInvalidInput
	}

	tag, err := repo.db.Pool().Exec(ctx, `
		update public.organizations
		set
			name = coalesce($2, name),
			is_active = coalesce($3, is_active),
			subscription_status = coalesce($4, subscription_status),
			max_users = coalesce($5, max_users),
			admin_notes = coalesce($6, admin_notes),
			plan_id = $7::uuid,
			subscription_value = coalesce($8, subscription_value),
			billing_day = coalesce($9, billing_day),
			next_billing_date = $10::date,
			trial_ends_at = $11::date,
			creci = coalesce($12, creci),
			max_whatsapp_sessions_override = coalesce($13, max_whatsapp_sessions_override),
			updated_at = now()
		where id = $1::uuid
	`, organizationID, cleanString(request.Name), request.IsActive, cleanString(request.SubscriptionStatus), request.MaxUsers, cleanString(request.AdminNotes), cleanString(request.PlanID), request.SubscriptionValue, request.BillingDay, cleanString(request.NextBillingDate), cleanString(request.TrialEndsAt), cleanString(request.Creci), request.MaxWhatsappSessionsOverride)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (repo Repository) UpdateOrganizationAccess(ctx context.Context, tenantContext tenant.Context, organizationID string, request OrganizationAccessRequest) error {
	if err := repo.UpdateOrganization(ctx, tenantContext, organizationID, request.OrganizationUpdates); err != nil {
		return err
	}
	if _, err := repo.db.Pool().Exec(ctx, `
		update public.organization_modules
		set is_enabled = false,
		    updated_at = now()
		where organization_id = $1::uuid
	`, organizationID); err != nil {
		return err
	}
	for _, moduleName := range request.Modules {
		if err := repo.UpdateModuleAccess(ctx, tenantContext, ModuleAccessRequest{
			OrganizationID: organizationID,
			ModuleName:     moduleName,
			IsEnabled:      true,
		}); err != nil {
			return err
		}
	}
	return nil
}

func (repo Repository) DeleteOrganization(ctx context.Context, tenantContext tenant.Context, organizationID string) error {
	if !tenantContext.IsSuperAdmin {
		return tenant.ErrOrganizationAccessDenied
	}
	organizationID, ok := normalizeUUID(organizationID)
	if !ok {
		return ErrInvalidInput
	}
	tag, err := repo.db.Pool().Exec(ctx, `update public.organizations set is_active = false, updated_at = now() where id = $1::uuid`, organizationID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (repo Repository) UpdateModuleAccess(ctx context.Context, tenantContext tenant.Context, request ModuleAccessRequest) error {
	if !tenantContext.IsSuperAdmin {
		return tenant.ErrOrganizationAccessDenied
	}
	organizationID, ok := normalizeUUID(request.OrganizationID)
	moduleName := strings.TrimSpace(request.ModuleName)
	if !ok || moduleName == "" {
		return ErrInvalidInput
	}
	_, err := repo.db.Pool().Exec(ctx, `
		insert into public.organization_modules (organization_id, module_name, is_enabled)
		values ($1::uuid, $2, $3)
		on conflict (organization_id, module_name)
		do update set is_enabled = excluded.is_enabled, updated_at = now()
	`, organizationID, moduleName, request.IsEnabled)
	return err
}

func (repo Repository) UpdateUser(ctx context.Context, tenantContext tenant.Context, userID string, request UserUpdateRequest) error {
	if !tenantContext.IsSuperAdmin {
		return tenant.ErrOrganizationAccessDenied
	}
	userID, ok := normalizeUUID(userID)
	if !ok {
		return ErrInvalidInput
	}
	tag, err := repo.db.Pool().Exec(ctx, `
		update public.users
		set is_active = coalesce($2, is_active),
		    organization_id = coalesce($3::uuid, organization_id),
		    updated_at = now()
		where id = $1::uuid
	`, userID, request.IsActive, cleanString(request.OrganizationID))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (repo Repository) DeleteUser(ctx context.Context, tenantContext tenant.Context, userID string) error {
	inactive := false
	return repo.UpdateUser(ctx, tenantContext, userID, UserUpdateRequest{IsActive: &inactive})
}

func (repo Repository) getOrganizationByID(ctx context.Context, organizationID string) (map[string]any, error) {
	item, err := repo.queryJSONObject(ctx, `
		select jsonb_build_object('id', id::text, 'name', name, 'is_active', is_active)
		from public.organizations
		where id = $1::uuid
	`, organizationID)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	return item, err
}

func (repo Repository) queryJSONRows(ctx context.Context, sql string, args ...any) ([]map[string]any, error) {
	rows, err := repo.db.Pool().Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []map[string]any{}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var item map[string]any
		if err := json.Unmarshal(raw, &item); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (repo Repository) queryJSONObject(ctx context.Context, sql string, args ...any) (map[string]any, error) {
	var raw []byte
	if err := repo.db.Pool().QueryRow(ctx, sql, args...).Scan(&raw); err != nil {
		return nil, err
	}
	var item map[string]any
	if err := json.Unmarshal(raw, &item); err != nil {
		return nil, err
	}
	return item, nil
}

func (repo Repository) createAuthUser(ctx context.Context, email string, password string, name string) (string, error) {
	if repo.projectURL == "" || repo.apiKey == "" {
		return "", ErrInvalidInput
	}
	payload, _ := json.Marshal(map[string]any{
		"email":         email,
		"password":      password,
		"email_confirm": true,
		"user_metadata": map[string]any{"name": name},
	})
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, repo.projectURL+"/auth/v1/admin/users", bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	request.Header.Set("apikey", repo.apiKey)
	request.Header.Set("Authorization", "Bearer "+repo.apiKey)
	request.Header.Set("Content-Type", "application/json")
	response, err := repo.httpClient.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", fmt.Errorf("auth admin create user failed: %s", strings.TrimSpace(string(raw)))
	}
	var parsed struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return "", err
	}
	if parsed.ID == "" {
		return "", ErrInvalidInput
	}
	return parsed.ID, nil
}

func normalizeEmail(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	parsed, err := mail.ParseAddress(value)
	if err != nil || parsed.Address != value {
		return "", ErrInvalidInput
	}
	return value, nil
}

func normalizeUUID(value string) (string, bool) {
	var uuid pgtype.UUID
	if err := uuid.Scan(strings.TrimSpace(value)); err != nil {
		return "", false
	}
	if !uuid.Valid {
		return "", false
	}
	return uuid.String(), true
}

func cleanString(value *string) *string {
	if value == nil {
		return nil
	}
	cleaned := strings.TrimSpace(*value)
	if cleaned == "" {
		return nil
	}
	return &cleaned
}

func (repo Repository) resolveInvitationOrganization(tenantContext tenant.Context, organizationID string) (string, error) {
	organizationID = strings.TrimSpace(organizationID)
	if organizationID == "" {
		organizationID = tenantContext.OrganizationID
	}
	organizationID, ok := normalizeUUID(organizationID)
	if !ok {
		return "", ErrInvalidInput
	}
	if !tenantContext.IsSuperAdmin && organizationID != tenantContext.OrganizationID {
		return "", tenant.ErrOrganizationAccessDenied
	}
	return organizationID, nil
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return fmt.Sprint(typed)
	}
}

func nullableString(value any) *string {
	cleaned := strings.TrimSpace(stringValue(value))
	if cleaned == "" {
		return nil
	}
	return &cleaned
}

func buildAdminPayload(payload map[string]any, placeholderOffset int) ([]string, []string, []any, error) {
	columns := []string{}
	placeholders := []string{}
	args := []any{}
	for key, value := range payload {
		key = strings.TrimSpace(key)
		if !isSafeColumnName(key) {
			return nil, nil, nil, ErrInvalidInput
		}
		args = append(args, cleanAdminValue(value))
		columns = append(columns, pgx.Identifier{key}.Sanitize())
		placeholders = append(placeholders, fmt.Sprintf("$%d", len(args)+placeholderOffset))
	}
	return columns, placeholders, args, nil
}

func cleanAdminValue(value any) any {
	switch typed := value.(type) {
	case string:
		if strings.TrimSpace(typed) == "" {
			return nil
		}
		return typed
	case []any:
		items := make([]string, 0, len(typed))
		for _, item := range typed {
			text, ok := item.(string)
			if !ok {
				raw, _ := json.Marshal(typed)
				return string(raw)
			}
			items = append(items, text)
		}
		return items
	case map[string]any:
		raw, _ := json.Marshal(typed)
		return string(raw)
	default:
		return typed
	}
}

func isSafeColumnName(value string) bool {
	if value == "" {
		return false
	}
	for index, char := range value {
		if char == '_' || (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (index > 0 && char >= '0' && char <= '9') {
			continue
		}
		return false
	}
	return true
}

func isAllowedAdminTable(table string) bool {
	switch strings.TrimSpace(table) {
	case "organizations",
		"users",
		"organization_members",
		"onboarding_requests",
		"feature_requests",
		"announcements",
		"help_articles",
		"audit_logs",
		"notifications",
		"email_templates",
		"email_logs",
		"system_settings",
		"organization_modules":
		return true
	default:
		return false
	}
}

func isAllowedOnboardingField(field string) bool {
	switch strings.TrimSpace(field) {
	case "company_name",
		"cnpj",
		"company_address",
		"company_city",
		"company_neighborhood",
		"company_number",
		"company_complement",
		"company_phone",
		"company_whatsapp",
		"company_email",
		"segment",
		"responsible_name",
		"responsible_email",
		"responsible_cpf",
		"responsible_phone",
		"logo_url",
		"favicon_url",
		"primary_color",
		"secondary_color",
		"site_title",
		"custom_domain",
		"site_seo_description",
		"about_text",
		"banner_url",
		"banner_title",
		"instagram",
		"facebook",
		"youtube",
		"linkedin",
		"team_size",
		"selected_plan_id",
		"confirmed_value",
		"billing_cycle",
		"privacy_policy_accepted",
		"terms_accepted",
		"privacy_policy_version",
		"terms_version",
		"legal_accepted_at",
		"onboarding_completed_at",
		"creci":
		return true
	default:
		return false
	}
}

func randomToken() (string, error) {
	var bytes [8]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes[:]), nil
}
