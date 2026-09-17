package whatsapp

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	sessionStatusScopeOrganization = "organization"
	sessionStatusScopeTeam         = "team"
	sessionStatusScopeSelf         = "self"
)

// SessionStatus is intentionally not an alias of Session. The integration
// status page must not acquire provider identifiers, settings, tokens or any
// conversation/message fields when the operational model grows.
type SessionStatus struct {
	ID              string                    `json:"id"`
	DisplayName     string                    `json:"display_name"`
	Status          string                    `json:"status"`
	PhoneNumber     *string                   `json:"phone_number"`
	ProfileName     *string                   `json:"profile_name"`
	LastConnectedAt *time.Time                `json:"last_connected_at"`
	UpdatedAt       time.Time                 `json:"updated_at"`
	Owner           SessionStatusOwner        `json:"owner"`
	Capabilities    SessionStatusCapabilities `json:"capabilities"`
}

type SessionStatusOwner struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	AvatarURL *string `json:"avatar_url"`
}

type SessionStatusCapabilities struct {
	CanManage                bool `json:"can_manage"`
	CanSetNotificationSender bool `json:"can_set_notification_sender"`
}

type SessionStatusListMeta struct {
	Scope string `json:"scope"`
}

type sessionStatusListResult struct {
	Statuses []SessionStatus
	Meta     SessionStatusListMeta
}

type sessionStatusScope struct {
	OrganizationID        string
	UserID                string
	Kind                  string
	AllOrganization       bool
	IncludeLedTeamMembers bool
	UserIDs               []string
	TeamIDs               []string
	IsSuperAdmin          bool
}

type sessionStatusQuerySpec struct {
	SQL   string
	Args  []any
	Scope sessionStatusScope
}

const listSessionStatusesSQL = `
select
  ws.id::text,
  coalesce(
    nullif(btrim(ws.display_name), ''),
    nullif(btrim(ws.profile_name), ''),
    'Conexão WhatsApp'
  ) as display_name,
  coalesce(nullif(btrim(ws.status), ''), 'disconnected') as status,
  nullif(btrim(ws.phone_number), '') as phone_number,
  nullif(btrim(ws.profile_name), '') as profile_name,
  ws.last_connected_at,
  coalesce(ws.updated_at, ws.created_at, 'epoch'::timestamptz) as updated_at,
  ws.owner_user_id::text,
  coalesce(nullif(btrim(owner.name), ''), 'Usuário') as owner_name,
  nullif(btrim(owner.avatar_url), '') as owner_avatar_url,
  ws.provider = 'evolution_go' as supports_management
from public.whatsapp_sessions ws
join public.users owner
  on owner.id = ws.owner_user_id
 and coalesce(owner.is_active, false) = true
where ws.organization_id = $1::uuid
  and coalesce(ws.is_active, true) = true
  and coalesce(ws.status, '') <> 'deleted'
  and ws.provider in ('evolution', 'evolution_go')
  and exists (
    select 1
    from public.organization_members owner_membership
    where owner_membership.organization_id = $1::uuid
      and owner_membership.user_id = ws.owner_user_id
      and coalesce(owner_membership.is_active, false) = true
      and owner_membership.deleted_at is null
  )
  and exists (
    select 1
    from public.organizations active_organization
    where active_organization.id = $1::uuid
      and coalesce(active_organization.is_active, true) = true
  )
  and exists (
    select 1
    from public.users caller_user
    where caller_user.id = $2::uuid
      and coalesce(caller_user.is_active, false) = true
      and (
        $3::boolean
        or exists (
          select 1
          from public.organization_members caller_membership
          where caller_membership.organization_id = $1::uuid
            and caller_membership.user_id = $2::uuid
            and coalesce(caller_membership.is_active, false) = true
            and caller_membership.deleted_at is null
        )
      )
  )
  and (
    (
      $4::boolean
      and (
        $3::boolean
        or exists (
          select 1
          from public.organization_members administrative_membership
          where administrative_membership.organization_id = $1::uuid
            and administrative_membership.user_id = $2::uuid
            and coalesce(administrative_membership.is_active, false) = true
            and administrative_membership.deleted_at is null
            and lower(btrim(administrative_membership.role)) in (
              'owner',
              'admin',
              'administrator',
              'administrador',
              'proprietario',
              'proprietário'
            )
        )
      )
    )
    or (
      not $4::boolean
      and (
        ws.owner_user_id = $2::uuid
        or (
          $5::boolean
          and exists (
            select 1
            from public.team_members leader
            join public.team_members member
              on member.organization_id = leader.organization_id
             and member.team_id = leader.team_id
            join public.teams team
              on team.id = leader.team_id
             and team.organization_id = leader.organization_id
            where leader.organization_id = $1::uuid
              and leader.user_id = $2::uuid
              and coalesce(leader.is_active, true) = true
              and coalesce(leader.is_leader, false) = true
              and member.user_id = ws.owner_user_id
              and coalesce(member.is_active, true) = true
              and coalesce(team.is_active, true) = true
              and (
                leader.team_id = any($7::uuid[])
                or member.user_id = any($6::uuid[])
              )
          )
        )
      )
    )
  )
order by (ws.owner_user_id = $2::uuid) desc,
         lower(coalesce(nullif(btrim(owner.name), ''), 'Usuário')),
         lower(coalesce(nullif(btrim(ws.display_name), ''), nullif(btrim(ws.profile_name), ''), 'Conexão WhatsApp')),
         ws.id
`

func resolveSessionStatusScope(tenantContext tenant.Context) (sessionStatusScope, error) {
	organizationID, organizationOK := normalizeUUID(tenantContext.OrganizationID)
	userID, userOK := normalizeUUID(tenantContext.UserID)
	if !organizationOK || !userOK {
		return sessionStatusScope{}, tenant.ErrOrganizationAccessDenied
	}

	scope := sessionStatusScope{
		OrganizationID: organizationID,
		UserID:         userID,
		Kind:           sessionStatusScopeSelf,
		UserIDs:        []string{userID},
		IsSuperAdmin:   tenantContext.IsSuperAdmin,
	}
	if tenantContext.IsSuperAdmin || tenantContext.HasRole("owner", "admin") {
		scope.Kind = sessionStatusScopeOrganization
		scope.AllOrganization = true
		scope.UserIDs = []string{}
		return scope, nil
	}

	if !tenantContext.IsTeamLeader {
		return scope, nil
	}

	scope.Kind = sessionStatusScopeTeam
	scope.IncludeLedTeamMembers = true
	for _, candidate := range tenantContext.LedUserIDs {
		scope.UserIDs = appendUniqueSessionStatusUUID(scope.UserIDs, candidate)
	}
	for _, candidate := range tenantContext.LedTeamIDs {
		scope.TeamIDs = appendUniqueSessionStatusUUID(scope.TeamIDs, candidate)
	}
	return scope, nil
}

func appendUniqueSessionStatusUUID(values []string, candidate string) []string {
	normalized, ok := normalizeUUID(candidate)
	if !ok {
		return values
	}
	for _, current := range values {
		if strings.EqualFold(current, normalized) {
			return values
		}
	}
	return append(values, normalized)
}

func buildSessionStatusQuery(tenantContext tenant.Context) (sessionStatusQuerySpec, error) {
	scope, err := resolveSessionStatusScope(tenantContext)
	if err != nil {
		return sessionStatusQuerySpec{}, err
	}
	userIDs := scope.UserIDs
	if userIDs == nil {
		userIDs = []string{}
	}
	teamIDs := scope.TeamIDs
	if teamIDs == nil {
		teamIDs = []string{}
	}

	return sessionStatusQuerySpec{
		SQL: listSessionStatusesSQL,
		Args: []any{
			scope.OrganizationID,
			scope.UserID,
			scope.IsSuperAdmin,
			scope.AllOrganization,
			scope.IncludeLedTeamMembers,
			userIDs,
			teamIDs,
		},
		Scope: scope,
	}, nil
}

func (repo Repository) ListSessionStatuses(ctx context.Context, tenantContext tenant.Context) (sessionStatusListResult, error) {
	spec, err := buildSessionStatusQuery(tenantContext)
	if err != nil {
		return sessionStatusListResult{}, err
	}

	rows, err := repo.db.Pool().Query(ctx, spec.SQL, spec.Args...)
	if err != nil {
		return sessionStatusListResult{}, err
	}
	defer rows.Close()

	statuses := []SessionStatus{}
	for rows.Next() {
		var status SessionStatus
		var phoneNumber pgtype.Text
		var profileName pgtype.Text
		var lastConnectedAt pgtype.Timestamptz
		var ownerAvatarURL pgtype.Text
		var supportsManagement bool
		if err := rows.Scan(
			&status.ID,
			&status.DisplayName,
			&status.Status,
			&phoneNumber,
			&profileName,
			&lastConnectedAt,
			&status.UpdatedAt,
			&status.Owner.ID,
			&status.Owner.Name,
			&ownerAvatarURL,
			&supportsManagement,
		); err != nil {
			return sessionStatusListResult{}, err
		}

		status.PhoneNumber = sessionStatusTextPointer(phoneNumber)
		status.ProfileName = sessionStatusTextPointer(profileName)
		status.LastConnectedAt = sessionStatusTimePointer(lastConnectedAt)
		status.Owner.AvatarURL = sessionStatusTextPointer(ownerAvatarURL)
		status.UpdatedAt = status.UpdatedAt.UTC()
		status.Capabilities = sessionStatusCapabilitiesFor(tenantContext, status.Owner.ID, supportsManagement)
		statuses = append(statuses, status)
	}
	if err := rows.Err(); err != nil {
		return sessionStatusListResult{}, err
	}

	return sessionStatusListResult{
		Statuses: statuses,
		Meta: SessionStatusListMeta{
			Scope: spec.Scope.Kind,
		},
	}, nil
}

func sessionStatusCapabilitiesFor(tenantContext tenant.Context, ownerUserID string, supportsManagement bool) SessionStatusCapabilities {
	isOwner := strings.EqualFold(strings.TrimSpace(ownerUserID), strings.TrimSpace(tenantContext.UserID))
	canManage := supportsManagement && isOwner && tenantContext.HasPermission(permissions.WhatsAppManage)
	return SessionStatusCapabilities{
		CanManage:                canManage,
		CanSetNotificationSender: canManage && tenantContext.HasRole("owner", "admin"),
	}
}

func sessionStatusTextPointer(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	result := value.String
	return &result
}

func sessionStatusTimePointer(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	result := value.Time.UTC()
	return &result
}
