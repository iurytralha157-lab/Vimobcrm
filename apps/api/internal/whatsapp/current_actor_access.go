package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// Resolve the same current grants/overrides as tenant resolution, without its
// request cache. READ may use an active secondary membership; operational
// callers separately enforce the original organization and hold actor/member
// locks through admission. The settings override writer owns member FOR UPDATE.
const currentWhatsAppActorRoleGrantsSQL = `coalesce((select string_agg(distinct permission.key,',' order by permission.key)
 from public.user_organization_roles assignment join public.organization_roles role on role.id=assignment.role_id and role.organization_id=assignment.organization_id and role.is_active
 join public.organization_role_permissions grant_row on grant_row.role_id=assignment.role_id and grant_row.organization_id=assignment.organization_id
 join public.available_permissions permission on permission.id=grant_row.permission_id
 where assignment.organization_id=$1::uuid and assignment.user_id=$2::uuid and assignment.is_active),'')`

const currentWhatsAppActorOverridesSQL = `coalesce((select jsonb_object_agg(permission_key,allowed)::text from public.user_permission_overrides where organization_id=$1::uuid and user_id=$2::uuid),'{}')`

const currentWhatsAppActorTeamLeaderSQL = `exists(select 1 from public.team_members leader join public.teams team on team.id=leader.team_id and team.organization_id=leader.organization_id
 where leader.organization_id=$1::uuid and leader.user_id=$2::uuid and leader.is_active and leader.is_leader
 and leader.membership_generation=member.membership_generation and coalesce(team.is_active,true))`

const currentWhatsAppActorFromSQL = `from public.users profile left join public.organization_members member on member.organization_id=$1::uuid and member.user_id=profile.id
 and coalesce(member.is_active,false) and member.deleted_at is null
 where profile.id=$2::uuid and coalesce(profile.is_active,false)
 and (member.user_id is not null or lower(btrim(profile.role))='super_admin')`

func currentWhatsAppActorSnapshotSQL() string {
	return `jsonb_build_array(profile.role,profile.is_active,member.role,member.is_active,member.deleted_at,member.membership_generation,` +
		currentWhatsAppActorTeamLeaderSQL + `,` + currentWhatsAppActorRoleGrantsSQL + `,` + currentWhatsAppActorOverridesSQL + `)::text`
}

// A final resource query must compare this state in its own snapshot. A
// permission/custom-role change between actor resolution and resource lookup
// otherwise could reuse stale visibility flags even without any network I/O.
func currentWhatsAppActorSnapshotPredicateSQL(placeholder string) string {
	return `exists(select 1 ` + currentWhatsAppActorFromSQL + ` and ` + currentWhatsAppActorSnapshotSQL() + `=` + placeholder + `)`
}

func currentWhatsAppActor(ctx context.Context, queryer whatsappQueryRower, actor tenant.Context) (tenant.Context, error) {
	current, _, err := currentWhatsAppActorWithSnapshot(ctx, queryer, actor)
	return current, err
}

// Assignment/override writers lock the membership first; custom-role grant
// replacement locks the role FOR UPDATE. Hold its SHARE lock until the durable
// start/admission commits, then resolve in a new statement after any wait.
func lockWhatsAppActorRoles(ctx context.Context, tx pgx.Tx, actor tenant.Context) error {
	rows, err := tx.Query(ctx, `select role.id::text from public.organization_roles role
	 where role.organization_id=$1::uuid and exists(select 1 from public.user_organization_roles assignment
	 where assignment.organization_id=role.organization_id and assignment.role_id=role.id
	 and assignment.user_id=$2::uuid and assignment.is_active)
	 order by role.id for share of role`, actor.OrganizationID, actor.UserID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return err
		}
	}
	return rows.Err()
}

func currentWhatsAppActorWithSnapshot(ctx context.Context, queryer whatsappQueryRower, actor tenant.Context) (tenant.Context, string, error) {
	current := tenant.Context{OrganizationID: actor.OrganizationID, UserID: actor.UserID}
	var grants, overrides, snapshot string
	err := queryer.QueryRow(ctx, `select coalesce(member.role,''),coalesce(profile.role,''),`+currentWhatsAppActorTeamLeaderSQL+`,`+
		currentWhatsAppActorRoleGrantsSQL+`,`+currentWhatsAppActorOverridesSQL+`,`+currentWhatsAppActorSnapshotSQL()+` `+currentWhatsAppActorFromSQL,
		actor.OrganizationID, actor.UserID).Scan(&current.MemberRole, &current.UserRole, &current.IsTeamLeader, &grants, &overrides, &snapshot)
	if errors.Is(err, pgx.ErrNoRows) {
		return tenant.Context{}, "", tenant.ErrOrganizationAccessDenied
	}
	if err != nil {
		return tenant.Context{}, "", err
	}
	var parsed map[string]bool
	if err := json.Unmarshal([]byte(overrides), &parsed); err != nil {
		return tenant.Context{}, "", err
	}
	var roleGrants []string
	if grants != "" {
		roleGrants = strings.Split(grants, ",")
	}
	current.IsSuperAdmin = strings.EqualFold(strings.TrimSpace(current.UserRole), "super_admin")
	current.Permissions = permissions.Resolve(current.MemberRole, current.IsTeamLeader, roleGrants, parsed)
	return current, snapshot, nil
}
