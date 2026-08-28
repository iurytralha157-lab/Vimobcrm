package admin

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/searchtext"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type ExternalConfig struct {
	Environment          string
	ProjectURL           string
	APIKey               string
	ResendAPIKey         string
	FromEmail            string
	ReplyTo              string
	SupportEmail         string
	AppURL               string
	EvolutionGoURL       string
	EvolutionGoAPIKey    string
	AsaasURL             string
	AsaasAPIKey          string
	SignupRecoverySecret string
}

type Repository struct {
	db                   *dbpkg.Postgres
	environment          string
	projectURL           string
	apiKey               string
	resendAPIKey         string
	fromEmail            string
	replyTo              string
	supportEmail         string
	appURL               string
	evolutionGoURL       string
	evolutionGoAPIKey    string
	asaasURL             string
	asaasAPIKey          string
	signupRecoverySecret string
	httpClient           *http.Client
}

const organizationAuthCleanupTimeout = 10 * time.Second

func NewRepository(db *dbpkg.Postgres, externalConfig ExternalConfig) Repository {
	return Repository{
		db:                   db,
		environment:          strings.ToLower(strings.TrimSpace(externalConfig.Environment)),
		projectURL:           strings.TrimRight(strings.TrimSpace(externalConfig.ProjectURL), "/"),
		apiKey:               strings.TrimSpace(externalConfig.APIKey),
		resendAPIKey:         strings.TrimSpace(externalConfig.ResendAPIKey),
		fromEmail:            cleanEmailHeader(firstNonEmpty(externalConfig.FromEmail, "Vimob CRM <naoresponde@vimobcrm.com.br>")),
		replyTo:              cleanEmailHeader(firstNonEmpty(externalConfig.ReplyTo, "contato@vimobcrm.com.br")),
		supportEmail:         cleanEmailHeader(firstNonEmpty(externalConfig.SupportEmail, "contato@vimobcrm.com.br")),
		appURL:               strings.TrimRight(firstNonEmpty(externalConfig.AppURL, "https://app.vimobcrm.com.br"), "/"),
		evolutionGoURL:       strings.TrimRight(strings.TrimSpace(externalConfig.EvolutionGoURL), "/"),
		evolutionGoAPIKey:    strings.TrimSpace(externalConfig.EvolutionGoAPIKey),
		asaasURL:             strings.TrimRight(strings.TrimSpace(externalConfig.AsaasURL), "/"),
		asaasAPIKey:          strings.TrimSpace(externalConfig.AsaasAPIKey),
		signupRecoverySecret: strings.TrimSpace(externalConfig.SignupRecoverySecret),
		httpClient:           &http.Client{Timeout: 30 * time.Second},
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
			'email', o.email,
			'cnpj', o.cnpj,
			'logo_url', o.logo_url,
			'is_active', o.is_active,
			'subscription_status', o.subscription_status,
			'subscription_type', o.subscription_type,
			'segment', o.segment,
			'max_users', o.max_users,
			'admin_notes', o.admin_notes,
			'created_at', o.created_at,
			'last_access_at', o.last_access_at,
			'user_count', (select count(*) from public.users u where u.organization_id = o.id),
			'lead_count', (select count(*) from public.leads l where l.organization_id = o.id),
			'automation_count', (select count(*) from public.automations a where a.organization_id = o.id),
			'mrr', coalesce(o.subscription_value, 0),
			'health_score', case when o.is_active then 100 else 0 end,
			'days_trial_left', case when o.trial_ends_at is null then 0 else floor(extract(epoch from (o.trial_ends_at - now())) / 86400)::int end,
			'overdue_amount', 0,
			'plan_id', o.plan_id::text,
			'plan_name', p.name,
			'subscription_value', o.subscription_value,
			'billing_day', o.billing_day,
			'next_billing_date', o.next_billing_date,
			'asaas_customer_id', o.asaas_customer_id,
			'asaas_subscription_id', o.asaas_subscription_id,
			'creci', o.creci,
			'max_whatsapp_sessions_override', o.max_whatsapp_sessions_override
		)
		from public.organizations o
		left join public.admin_subscription_plans p on p.id = o.plan_id
		where ($1 = '' or `+searchtext.AnySQL([]string{"o.name", "o.email", "o.cnpj"}, "$1")+`)
		  and ($2 = 'all' or o.subscription_status = $2)
		  and ($3 = 'all' or o.segment = $3)
		order by o.created_at desc
	`, searchtext.Pattern(search), status, segment)
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
	isAdminAudience := tenantContext.IsSuperAdmin || tenantContext.HasRole("owner", "admin")
	isBrokerAudience := !tenantContext.IsSuperAdmin && tenantContext.HasRole("user")
	return repo.queryJSONRows(ctx, `
		select a.record
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
		order by a.created_at desc
		limit 30
	`, tenantContext.OrganizationID, tenantContext.UserID, isAdminAudience, isBrokerAudience)
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
		select (to_jsonb(i) - 'token' - 'token_hash') || jsonb_build_object(
			'is_expired', i.expires_at <= now(),
			'email_status', delivery.status,
			'email_provider_message_id', delivery.provider_message_id,
			'email_accepted_at', delivery.accepted_at,
			'email_delivered_at', delivery.delivered_at,
			'email_last_event_at', delivery.last_event_at
		)
		from public.invitations i
		left join lateral (
			select
				logs.status,
				logs.provider_message_id,
				logs.accepted_at,
				logs.delivered_at,
				logs.last_event_at
			from public.email_logs logs
			where logs.organization_id = i.organization_id
			  and logs.provider = 'resend'
			  and logs.template_key = 'invitation'
			  and logs.metadata ->> 'invitation_id' = i.id::text
			order by logs.created_at desc
			limit 1
		) delivery on true
		where i.organization_id = $1::uuid
		  and (i.used_at is null or i.used_at >= now() - interval '90 days')
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
	if (role == "admin" || role == "manager") && !canCreatePrivilegedInvitation(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	var email *string
	var recipientUserID *string
	existingAccount := false
	if request.Email != nil {
		normalizedEmail, err := normalizeEmail(*request.Email)
		if err != nil {
			return nil, err
		}
		email = &normalizedEmail
		existingUserID, lookupErr := repo.userIDByEmail(ctx, normalizedEmail)
		if lookupErr == nil && existingUserID != "" {
			existingAccount = true
			recipientUserID = &existingUserID
			alreadyMember, memberErr := repo.userBelongsToOrganization(ctx, existingUserID, resolvedOrganizationID)
			if memberErr != nil {
				return nil, memberErr
			}
			if alreadyMember {
				return nil, ErrInvitationUserAlreadyMember
			}
		} else if lookupErr != nil && !errors.Is(lookupErr, pgx.ErrNoRows) {
			return nil, lookupErr
		}

		if _, err := repo.db.Pool().Exec(ctx, `
			delete from public.invitations
			where organization_id = $1::uuid
			  and lower(btrim(email)) = lower(btrim($2))
			  and used_at is null
			  and expires_at <= now()
		`, resolvedOrganizationID, normalizedEmail); err != nil {
			return nil, err
		}

		pending, pendingErr := repo.pendingInvitationExists(ctx, resolvedOrganizationID, normalizedEmail)
		if pendingErr != nil {
			return nil, pendingErr
		}
		if pending {
			return nil, ErrInvitationAlreadyPending
		}
	}
	plaintextToken, err := randomInvitationToken()
	if err != nil {
		return nil, err
	}
	tokenHash := invitationTokenHash(plaintextToken)

	item, err := repo.queryJSONObject(ctx, `
		insert into public.invitations (
			organization_id,
			email,
			role,
			created_by,
			expires_at,
			token,
			token_hash
		)
		values (
			$1::uuid,
			$2,
			$3,
			$4::uuid,
			coalesce($5::timestamptz, now() + interval '7 days'),
			$6,
			$7
		)
		returning to_jsonb(invitations) - 'token' - 'token_hash'
	`, resolvedOrganizationID, email, role, tenantContext.UserID, cleanString(request.ExpiresAt), plaintextToken, tokenHash)
	if err != nil {
		if isPendingInvitationUniqueViolation(err) {
			return nil, ErrInvitationAlreadyPending
		}
		return nil, err
	}
	invitationID, _ := item["id"].(string)
	stripInvitationToken(item)

	emailSent := false
	if email != nil {
		organizationName, orgErr := repo.organizationName(ctx, resolvedOrganizationID)
		if orgErr != nil {
			return nil, orgErr
		}
		if plaintextToken != "" {
			delivery, sendErr := repo.sendInvitationEmail(ctx, invitationEmailInput{
				InvitationID:     invitationID,
				OrganizationID:   resolvedOrganizationID,
				UserID:           recipientUserID,
				Email:            *email,
				OrganizationName: organizationName,
				Role:             role,
				InviteURL:        repo.invitationURL(plaintextToken),
				ExistingAccount:  existingAccount,
				IdempotencyKey:   invitationEmailIdempotencyKey(invitationID, tokenHash),
			})
			if sendErr != nil {
				// Keep the token valid when delivery is rejected or its outcome is
				// ambiguous. The UI can show the pending invite and safely retry it;
				// deleting it here could turn an already accepted Resend request into
				// an email containing a dead link.
				slog.Error(
					"invitation created but email delivery failed",
					"invitation_id", invitationID,
					"organization_id", resolvedOrganizationID,
					"error", sendErr,
				)
				item["email_sent"] = false
				item["existing_account"] = existingAccount
				return item, nil
			}
			emailSent = true
			item["email_status"] = delivery.Status
			item["email_provider_message_id"] = delivery.ProviderMessageID
		}
	}
	item["email_sent"] = emailSent
	item["existing_account"] = existingAccount
	return item, nil
}

func (repo Repository) ResendInvitation(ctx context.Context, tenantContext tenant.Context, invitationID string) (map[string]any, error) {
	invitationID, ok := normalizeUUID(invitationID)
	if !ok {
		return nil, ErrInvalidInput
	}

	var scopedOrganizationID any
	if tenantContext.IsSuperAdmin {
		scopedOrganizationID = nil
	} else {
		if tenantContext.OrganizationID == "" {
			return nil, tenant.ErrOrganizationAccessDenied
		}
		scopedOrganizationID = tenantContext.OrganizationID
	}

	var organizationID string
	var email pgtype.Text
	var role string
	var previousToken string
	var previousTokenHash string
	var previousExpiresAt time.Time
	err := repo.db.Pool().QueryRow(ctx, `
		select organization_id::text, email, coalesce(nullif(role, ''), 'user'), token, token_hash, expires_at
		from public.invitations
		where id = $1::uuid
		  and used_at is null
		  and ($2::uuid is null or organization_id = $2::uuid)
	`, invitationID, scopedOrganizationID).Scan(
		&organizationID,
		&email,
		&role,
		&previousToken,
		&previousTokenHash,
		&previousExpiresAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if !email.Valid || strings.TrimSpace(email.String) == "" {
		return nil, ErrInvitationEmailMissing
	}
	if (role == "admin" || role == "manager") && !canCreatePrivilegedInvitation(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	normalizedEmail, err := normalizeEmail(email.String)
	if err != nil {
		return nil, err
	}
	existingAccount := false
	var recipientUserID *string
	existingUserID, lookupErr := repo.userIDByEmail(ctx, normalizedEmail)
	if lookupErr == nil && existingUserID != "" {
		existingAccount = true
		recipientUserID = &existingUserID
		alreadyMember, memberErr := repo.userBelongsToOrganization(ctx, existingUserID, organizationID)
		if memberErr != nil {
			return nil, memberErr
		}
		if alreadyMember {
			return nil, ErrInvitationUserAlreadyMember
		}
	} else if lookupErr != nil && !errors.Is(lookupErr, pgx.ErrNoRows) {
		return nil, lookupErr
	}

	organizationName, err := repo.organizationName(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	newToken, err := randomInvitationToken()
	if err != nil {
		return nil, err
	}
	newTokenHash := invitationTokenHash(newToken)

	item, err := repo.queryJSONObject(ctx, `
		update public.invitations
		set token = $2,
		    token_hash = $3,
		    expires_at = now() + interval '7 days'
		where id = $1::uuid
		  and used_at is null
		  and token = $4
		  and token_hash = $5
		returning to_jsonb(invitations) - 'token' - 'token_hash'
	`, invitationID, newToken, newTokenHash, previousToken, previousTokenHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	stripInvitationToken(item)

	delivery, sendErr := repo.sendInvitationEmail(ctx, invitationEmailInput{
		InvitationID:     invitationID,
		OrganizationID:   organizationID,
		UserID:           recipientUserID,
		Email:            normalizedEmail,
		OrganizationName: organizationName,
		Role:             role,
		InviteURL:        repo.invitationURL(newToken),
		ExistingAccount:  existingAccount,
		IdempotencyKey:   invitationEmailIdempotencyKey(invitationID, newTokenHash),
	})
	if sendErr != nil {
		if !errors.Is(sendErr, errInvitationEmailDefinitelyNotAccepted) {
			// A timeout, a truncated response or an acceptance-log failure can
			// happen after Resend accepted the message. Keep the new token valid
			// so an eventually delivered email never contains a dead link.
			slog.Error(
				"invitation resend delivery outcome is unknown",
				"invitation_id", invitationID,
				"organization_id", organizationID,
				"error", sendErr,
			)
			item["email_sent"] = false
			item["email_status"] = "delivery_unknown"
			item["existing_account"] = existingAccount
			return item, nil
		}

		restoreContext, cancelRestore := context.WithTimeout(context.WithoutCancel(ctx), invitationEmailLogTimeout)
		defer cancelRestore()
		restoreErr := repo.restoreInvitationTokenPair(
			restoreContext,
			invitationID,
			previousToken,
			previousTokenHash,
			previousExpiresAt,
			newToken,
			newTokenHash,
		)
		deliveryErr := fmt.Errorf("%w: %v", ErrInvitationEmailFailed, sendErr)
		if restoreErr != nil {
			return nil, errors.Join(deliveryErr, fmt.Errorf("restore invitation token pair: %w", restoreErr))
		}
		return nil, deliveryErr
	}

	item["email_sent"] = true
	item["email_status"] = delivery.Status
	item["email_provider_message_id"] = delivery.ProviderMessageID
	item["existing_account"] = existingAccount
	return item, nil
}

func (repo Repository) restoreInvitationTokenPair(
	ctx context.Context,
	invitationID string,
	previousToken string,
	previousTokenHash string,
	previousExpiresAt time.Time,
	failedToken string,
	failedTokenHash string,
) error {
	tag, err := repo.db.Pool().Exec(ctx, `
		update public.invitations
		set token = $2,
		    token_hash = $3,
		    expires_at = $4
		where id = $1::uuid
		  and used_at is null
		  and token = $5
		  and token_hash = $6
	`, invitationID, previousToken, previousTokenHash, previousExpiresAt, failedToken, failedTokenHash)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("invitation token pair changed concurrently")
	}
	return nil
}

func stripInvitationToken(item map[string]any) {
	delete(item, "token")
	delete(item, "token_hash")
}

func canCreatePrivilegedInvitation(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin ||
		(tenantContext.HasRole("owner", "admin") &&
			tenantContext.HasPermission(permissions.PermissionsManage))
}

func (repo Repository) userBelongsToOrganization(ctx context.Context, userID string, organizationID string) (bool, error) {
	var belongs bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.users u
			where u.id = $1::uuid
			  and (
				u.organization_id = $2::uuid
				or exists (
					select 1
					from public.organization_members om
					where om.user_id = u.id
					  and om.organization_id = $2::uuid
				)
			  )
		)
	`, userID, organizationID).Scan(&belongs)
	return belongs, err
}

func (repo Repository) pendingInvitationExists(ctx context.Context, organizationID string, email string) (bool, error) {
	var exists bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.invitations i
			where i.organization_id = $1::uuid
			  and lower(btrim(i.email)) = lower(btrim($2))
			  and i.used_at is null
			  and i.expires_at > now()
		)
	`, organizationID, email).Scan(&exists)
	return exists, err
}

func isPendingInvitationUniqueViolation(err error) bool {
	var pgError *pgconn.PgError
	return errors.As(err, &pgError) &&
		pgError.Code == "23505" &&
		pgError.ConstraintName == "invitations_pending_org_email_uidx"
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
		  and (coalesce(nullif(role, ''), 'user') not in ('admin', 'manager') or $3)
	`, invitationID, tenantContext.OrganizationID, canCreatePrivilegedInvitation(tenantContext))
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
	tokenHash := invitationTokenHash(token)
	item, err := repo.queryJSONObject(ctx, `
		select jsonb_build_object(
			'id', i.id::text,
			'email', i.email,
			'role', i.role,
			'organization_id', i.organization_id::text,
			'organization_name', o.name,
			'expires_at', i.expires_at,
			'existing_account', exists (
				select 1
				from auth.users au
				where lower(au.email) = lower(i.email)
				  and au.deleted_at is null
				limit 1
			)
		)
		from public.invitations i
		join public.organizations o on o.id = i.organization_id
		where i.token_hash = $1
		  and i.used_at is null
		  and i.expires_at > now()
		limit 1
	`, tokenHash)
	if errors.Is(err, pgx.ErrNoRows) {
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
			'slug', p.slug,
			'name', p.name,
			'price', p.price,
			'reference_price', p.reference_price,
			'discount_percentage', p.discount_percentage,
			'billing_cycle', p.billing_cycle,
			'billing_periods', p.billing_periods,
			'description', p.description,
			'display_features', p.display_features,
			'display_order', p.display_order,
			'trial_enabled', p.trial_enabled,
			'trial_days', p.trial_days,
			'max_users', p.max_users,
			'max_leads', p.max_leads,
			'max_whatsapp_sessions', p.max_whatsapp_sessions,
			'modules', coalesce(to_jsonb(p.modules), '[]'::jsonb),
			'is_public', p.is_public
		)
		from public.admin_subscription_plans p
		where coalesce(p.is_active, true) = true
		order by p.display_order asc, p.price asc, p.name asc
	`)
}

const listPublicSubscriptionPlansSQL = `
		select jsonb_build_object(
			'id', p.id::text,
			'slug', p.slug,
			'name', p.name,
			'price', p.price,
			'reference_price', p.reference_price,
			'discount_percentage', p.discount_percentage,
			'billing_cycle', p.billing_cycle,
			'billing_periods', p.billing_periods,
			'description', p.description,
			'display_features', p.display_features,
			'display_order', p.display_order,
			'trial_enabled', p.trial_enabled,
			'trial_days', p.trial_days,
			'max_users', p.max_users,
			'max_whatsapp_sessions', p.max_whatsapp_sessions,
			'modules', coalesce(to_jsonb(p.modules), '[]'::jsonb)
		)
		from public.admin_subscription_plans p
		where coalesce(p.is_active, true) = true
		  and coalesce(p.is_public, true) = true
		order by p.display_order asc, p.price asc, p.name asc
	`

func (repo Repository) ListPublicSubscriptionPlans(ctx context.Context) ([]map[string]any, error) {
	return repo.queryJSONRows(ctx, listPublicSubscriptionPlansSQL)
}

func (repo Repository) ListTableRows(ctx context.Context, tenantContext tenant.Context, table string, limit int) ([]map[string]any, error) {
	if !tenantContext.IsSuperAdmin {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	if !isAllowedAdminReadTable(table) {
		return nil, ErrInvalidInput
	}
	if limit < 1 || limit > 200 {
		limit = 60
	}
	if strings.TrimSpace(table) == "notifications" {
		return repo.queryJSONRows(ctx, `
			select jsonb_build_object(
			  'id', notification.id,
			  'title', '[redigido]',
			  'type', coalesce(notification.type, 'info'),
			  'is_read', notification.is_read,
			  'created_at', notification.created_at
			)
			from public.notifications as notification
			order by notification.created_at desc, notification.id
			limit $1
		`, limit)
	}
	identifier := pgx.Identifier{"public", table}.Sanitize()
	return repo.queryJSONRows(ctx, fmt.Sprintf(`select to_jsonb(t) from (select * from %s limit $1) t`, identifier), limit)
}

func (repo Repository) CountTableRows(ctx context.Context, tenantContext tenant.Context, table string) (int64, error) {
	if !tenantContext.IsSuperAdmin {
		return 0, tenant.ErrOrganizationAccessDenied
	}
	if !isAllowedAdminReadTable(table) {
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
	if strings.TrimSpace(table) == "announcements" {
		return repo.createAnnouncementWithNotifications(ctx, payload)
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

const listOrganizationPaymentsSQL = `
	select jsonb_build_object(
		'id', p.id::text,
		'status', coalesce(p.status, ''),
		'value', p.value,
		'billing_type', p.billing_type,
		'due_date', p.due_date,
		'payment_date', p.payment_date,
		'created_at', p.created_at,
		'updated_at', p.updated_at
	)
	from public.asaas_payments p
	where p.organization_id = $1::uuid
	order by p.due_date desc nulls last, p.created_at desc
	limit 80
`

func (repo Repository) ListOrganizationPayments(ctx context.Context, tenantContext tenant.Context, organizationID string) ([]map[string]any, error) {
	if !tenantContext.IsSuperAdmin {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	organizationID, ok := normalizeUUID(organizationID)
	if !ok {
		return nil, ErrInvalidInput
	}
	return repo.queryJSONRows(ctx, listOrganizationPaymentsSQL, organizationID)
}

func (repo Repository) DashboardOverview(ctx context.Context, tenantContext tenant.Context, period int) (map[string]any, error) {
	if !tenantContext.IsSuperAdmin {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	if period < 1 {
		period = 30
	}
	if period > 365 {
		period = 365
	}

	return repo.queryJSONObject(ctx, `
		with params as (
			select greatest(1, least($1::int, 365)) as period_days
		),
		bounds as (
			select
				period_days,
				(current_date - ((period_days - 1) * interval '1 day'))::date as current_start,
				(current_date + interval '1 day')::date as current_end,
				(current_date - ((period_days * 2 - 1) * interval '1 day'))::date as previous_start,
				(current_date - ((period_days - 1) * interval '1 day'))::date as previous_end
			from params
		),
		paid_payments as (
			select
				coalesce(p.payment_date, p.due_date, p.created_at::date)::date as paid_on,
				coalesce(p.value, 0) as amount
			from public.asaas_payments p
			where upper(coalesce(p.status, '')) in ('CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH')
		),
		current_revenue as (
			select coalesce(sum(pp.amount), 0) as amount
			from paid_payments pp
			cross join bounds b
			where pp.paid_on >= b.current_start
			  and pp.paid_on < b.current_end
		),
		previous_revenue as (
			select coalesce(sum(pp.amount), 0) as amount
			from paid_payments pp
			cross join bounds b
			where pp.paid_on >= b.previous_start
			  and pp.paid_on < b.previous_end
		),
		current_orgs as (
			select count(*)::numeric as amount
			from public.organizations o
			cross join bounds b
			where o.created_at >= b.current_start
			  and o.created_at < b.current_end
		),
		previous_orgs as (
			select count(*)::numeric as amount
			from public.organizations o
			cross join bounds b
			where o.created_at >= b.previous_start
			  and o.created_at < b.previous_end
		),
		overdue_payments as (
			select coalesce(sum(p.value), 0) as amount
			from public.asaas_payments p
			where upper(coalesce(p.status, '')) not in ('CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH')
			  and (
				upper(coalesce(p.status, '')) in ('OVERDUE', 'OVERDUE_PAYMENT')
				or (p.due_date is not null and p.due_date < current_date)
			  )
		)
		select jsonb_build_object(
			'period_days', (select period_days from params),
			'financial', jsonb_build_object(
				'mrr', coalesce((select sum(subscription_value) from public.organizations where is_active = true and subscription_status in ('active', 'trial')), 0),
				'revenue_period', (select amount from current_revenue),
				'revenue_forecast', coalesce((select sum(subscription_value) from public.organizations where subscription_status in ('trial', 'pending_payment', 'active')), 0),
				'avg_ticket', coalesce((select avg(subscription_value) from public.organizations where subscription_value is not null), 0),
				'overdue_total', (select amount from overdue_payments),
				'revenue_growth_pct', (
					select case
						when previous_revenue.amount = 0 and current_revenue.amount > 0 then 100
						when previous_revenue.amount = 0 then 0
						else round(((current_revenue.amount - previous_revenue.amount) / previous_revenue.amount) * 100, 2)
					end
					from current_revenue, previous_revenue
				)
			),
			'platform', jsonb_build_object(
				'total_orgs', (select count(*) from public.organizations),
				'active_orgs', (select count(*) from public.organizations where is_active = true),
				'trial_orgs', (select count(*) from public.organizations where subscription_status = 'trial'),
				'cancelled_orgs', (select count(*) from public.organizations where subscription_status in ('cancelled', 'canceled')),
				'active_users_today', (select count(*) from public.users where is_active = true and updated_at >= current_date),
				'orgs_growth_pct', (
					select case
						when previous_orgs.amount = 0 and current_orgs.amount > 0 then 100
						when previous_orgs.amount = 0 then 0
						else round(((current_orgs.amount - previous_orgs.amount) / previous_orgs.amount) * 100, 2)
					end
					from current_orgs, previous_orgs
				)
			),
			'operational', jsonb_build_object(
				'leads_today', (select count(*) from public.leads where created_at >= current_date),
				'automations_today', (select count(*) from public.automation_executions where started_at >= current_date),
				'activities_today', (select count(*) from public.activities where created_at >= current_date),
				'errors_recent', (select count(*) from public.error_events where created_at >= now() - interval '24 hours' and severity in ('error', 'critical')),
				'accesses_today', (select count(*) from public.organizations where last_access_at >= current_date)
			)
		)
	`, period)
}

func (repo Repository) DashboardTimeseries(ctx context.Context, tenantContext tenant.Context, period int) (map[string]any, error) {
	if !tenantContext.IsSuperAdmin {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	if period < 1 {
		period = 30
	}
	if period > 365 {
		period = 365
	}
	return repo.queryJSONObject(ctx, `
		with params as (
			select greatest(1, least($1::int, 365)) as period_days
		),
		days as (
			select generate_series(
				(current_date - (((select period_days from params) - 1) * interval '1 day'))::date,
				current_date,
				interval '1 day'
			)::date as day
		),
		revenue_by_day as (
			select
				coalesce(p.payment_date, p.due_date, p.created_at::date)::date as day,
				sum(coalesce(p.value, 0)) as value
			from public.asaas_payments p
			where upper(coalesce(p.status, '')) in ('CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH')
			group by 1
		),
		created_orgs as (
			select o.created_at::date as day, count(*) as total
			from public.organizations o
			group by 1
		),
		trial_orgs as (
			select o.created_at::date as day, count(*) as total
			from public.organizations o
			where o.subscription_status = 'trial'
			group by 1
		),
		cancelled_orgs as (
			select o.updated_at::date as day, count(*) as total
			from public.organizations o
			where o.subscription_status in ('cancelled', 'canceled')
			group by 1
		),
		leads_by_day as (
			select l.created_at::date as day, count(*) as total
			from public.leads l
			group by 1
		),
		accesses_by_day as (
			select o.last_access_at::date as day, count(*) as total
			from public.organizations o
			where o.last_access_at is not null
			group by 1
		),
		automations_by_day as (
			select e.started_at::date as day, count(*) as total
			from public.automation_executions e
			group by 1
		)
		select jsonb_build_object(
			'revenue', coalesce((
				select jsonb_agg(jsonb_build_object(
					'date', d.day,
					'value', coalesce(r.value, 0)
				) order by d.day)
				from days d
				left join revenue_by_day r on r.day = d.day
			), '[]'::jsonb),
			'orgs', coalesce((
				select jsonb_agg(jsonb_build_object(
					'date', d.day,
					'created', coalesce(co.total, 0),
					'trial', coalesce(t.total, 0),
					'cancelled', coalesce(c.total, 0)
				) order by d.day)
				from days d
				left join created_orgs co on co.day = d.day
				left join trial_orgs t on t.day = d.day
				left join cancelled_orgs c on c.day = d.day
			), '[]'::jsonb),
			'usage', coalesce((
				select jsonb_agg(jsonb_build_object(
					'date', d.day,
					'leads', coalesce(l.total, 0),
					'accesses', coalesce(a.total, 0),
					'automations', coalesce(ex.total, 0)
				) order by d.day)
				from days d
				left join leads_by_day l on l.day = d.day
				left join accesses_by_day a on a.day = d.day
				left join automations_by_day ex on ex.day = d.day
			), '[]'::jsonb),
			'health', jsonb_build_object(
				'active', (select count(*) from public.organizations where subscription_status = 'active'),
				'trial', (select count(*) from public.organizations where subscription_status = 'trial'),
				'overdue', (select count(*) from public.organizations where subscription_status in ('overdue', 'past_due')),
				'cancelled', (select count(*) from public.organizations where subscription_status in ('cancelled', 'canceled'))
			)
		)
	`, period)
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
			'overdue', coalesce((
				select jsonb_agg(jsonb_build_object(
					'id', overdue_orgs.id::text,
					'name', overdue_orgs.name,
					'oldest_due', overdue_orgs.oldest_due,
					'days_overdue', overdue_orgs.days_overdue,
					'amount_due', overdue_orgs.amount_due
				) order by overdue_orgs.days_overdue desc)
				from (
					select
						o.id,
						o.name,
						min(p.due_date) as oldest_due,
						(current_date - min(p.due_date))::int as days_overdue,
						sum(coalesce(p.value, 0)) as amount_due
					from public.asaas_payments p
					join public.organizations o on o.id = p.organization_id
					where upper(coalesce(p.status, '')) not in ('CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH')
					  and p.due_date is not null
					  and (
						upper(coalesce(p.status, '')) in ('OVERDUE', 'OVERDUE_PAYMENT')
						or p.due_date < current_date
					  )
					group by o.id, o.name
					order by days_overdue desc, amount_due desc
					limit 20
				) overdue_orgs
			), '[]'::jsonb),
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
			'issues', coalesce((
				select jsonb_agg(jsonb_build_object(
					'id', issue_rows.id::text,
					'organization_id', issue_rows.organization_id::text,
					'organization_name', issue_rows.organization_name,
					'type', issue_rows.source,
					'severity', issue_rows.severity,
					'title', issue_rows.message,
					'description', issue_rows.route,
					'created_at', issue_rows.created_at
				) order by issue_rows.created_at desc)
				from (
					select
						e.id,
						e.organization_id,
						o.name as organization_name,
						e.source,
						e.severity,
						e.message,
						coalesce(e.route, e.path, e.component) as route,
						e.created_at
					from public.error_events e
					left join public.organizations o on o.id = e.organization_id
					where e.severity in ('error', 'critical')
					  and e.resolved_at is null
					order by e.created_at desc
					limit 20
				) issue_rows
			), '[]'::jsonb),
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
	return repo.createOrganizationWithAdminInvitation(ctx, tenantContext, request)
}

func runOrganizationProvisioningForNewAuthUser(
	ctx context.Context,
	persist func(context.Context) error,
) error {
	// Auth identities are global principals and may gain a membership in
	// another tenant while persistence is failing. Never compensate a database
	// failure by deleting the principal; preserve it for an idempotent retry.
	return persist(ctx)
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
			subscription_type = coalesce($17, subscription_type),
			max_users = coalesce($5, max_users),
			admin_notes = coalesce($6, admin_notes),
			plan_id = case when $14 then null else coalesce($7::uuid, plan_id) end,
			subscription_value = coalesce($8, subscription_value),
			billing_day = coalesce($9, billing_day),
			next_billing_date = case when $15 then null else coalesce($10::date, next_billing_date) end,
			trial_ends_at = case when $16 then null else coalesce($11::date, trial_ends_at) end,
			creci = coalesce($12, creci),
			max_whatsapp_sessions_override = coalesce($13, max_whatsapp_sessions_override),
			updated_at = now()
		where id = $1::uuid
	`, organizationID, cleanString(request.Name), request.IsActive, cleanString(request.SubscriptionStatus), request.MaxUsers, cleanString(request.AdminNotes), cleanString(request.PlanID), request.SubscriptionValue, request.BillingDay, cleanString(request.NextBillingDate), cleanString(request.TrialEndsAt), cleanString(request.Creci), request.MaxWhatsappSessionsOverride, request.ClearPlanID, request.ClearNextBillingDate, request.ClearTrialEndsAt, cleanString(request.SubscriptionType))
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
	modules := organizationModulesWithCore(request.Modules)
	if _, err := repo.db.Pool().Exec(ctx, `
		update public.organization_modules
		set is_enabled = false,
		    updated_at = now()
		where organization_id = $1::uuid
	`, organizationID); err != nil {
		return err
	}
	for _, moduleName := range modules {
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

func (repo Repository) UpdateModuleAccess(ctx context.Context, tenantContext tenant.Context, request ModuleAccessRequest) error {
	if !tenantContext.IsSuperAdmin {
		return tenant.ErrOrganizationAccessDenied
	}
	organizationID, ok := normalizeUUID(request.OrganizationID)
	moduleName := canonicalOrganizationModuleName(request.ModuleName)
	if !ok || moduleName == "" {
		return ErrInvalidInput
	}
	isEnabled := request.IsEnabled || isCoreOrganizationModule(moduleName)
	_, err := repo.db.Pool().Exec(ctx, `
		insert into public.organization_modules (organization_id, module_name, is_enabled)
		values ($1::uuid, $2, $3)
		on conflict (organization_id, module_name)
		do update set is_enabled = excluded.is_enabled, updated_at = now()
	`, organizationID, moduleName, isEnabled)
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

func (repo Repository) ResetUserPassword(ctx context.Context, tenantContext tenant.Context, userID string) (map[string]any, error) {
	if !tenantContext.IsSuperAdmin {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	userID, ok := normalizeUUID(userID)
	if !ok {
		return nil, ErrInvalidInput
	}

	var name, email string
	err := repo.db.Pool().QueryRow(ctx, `
		select
			coalesce(nullif(btrim(app_user.name), ''), split_part(auth_user.email, '@', 1)),
			auth_user.email
		from auth.users auth_user
		left join public.users app_user on app_user.id = auth_user.id
		where auth_user.id = $1::uuid
		  and auth_user.deleted_at is null
	`, userID).Scan(&name, &email)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	email = strings.TrimSpace(email)
	if email == "" {
		return nil, ErrInvalidInput
	}

	if err := repo.sendAuthPasswordRecovery(ctx, email); err != nil {
		return nil, err
	}

	_, err = repo.db.Pool().Exec(ctx, `
		insert into public.password_change_events (user_id, source, metadata)
		values (
			$1::uuid,
			'recovery',
			jsonb_build_object('reset_by', $2::uuid, 'reset_source', 'superadmin')
		)
	`, userID, tenantContext.UserID)
	if err != nil {
		// The recovery email has already been accepted by Auth. Do not turn a
		// successful security action into a false failure because only its audit
		// trail could not be persisted.
		slog.Error(
			"password recovery email sent but audit event failed",
			"user_id", userID,
			"reset_by", tenantContext.UserID,
			"error", err,
		)
	}

	return map[string]any{
		"user_id":      userID,
		"name":         name,
		"email":        email,
		"delivery":     "email",
		"email_sent":   true,
		"requested_at": time.Now().UTC().Format(time.RFC3339),
	}, nil
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
	setAuthAdminHeaders(request, repo.apiKey)
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
		"admin_subscription_plans",
		"onboarding_requests",
		"feature_requests",
		"announcements",
		"help_articles",
		"audit_logs",
		"email_templates",
		"email_logs",
		"organization_modules":
		return true
	default:
		return false
	}
}

func isAllowedAdminReadTable(table string) bool {
	return strings.TrimSpace(table) == "notifications" || isAllowedAdminTable(table)
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

func randomInvitationToken() (string, error) {
	var bytes [32]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes[:]), nil
}

func invitationTokenHash(token string) string {
	token = strings.TrimSpace(token)
	if token == "" {
		return ""
	}
	digest := sha256.Sum256([]byte(token))
	return hex.EncodeToString(digest[:])
}
