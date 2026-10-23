package whatsapp

import (
	"context"
	"errors"
	"sort"

	"github.com/jackc/pgx/v5"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// Membership in a second tenant may authorize CRM history reads. WhatsApp
// operations remain restricted to the actor's original profile organization.
// The durable provider-start fence independently rechecks this same condition.
func requireOriginalWhatsAppOrganization(ctx context.Context, queryer whatsappQueryRower, tenantContext tenant.Context) error {
	var allowed bool
	err := queryer.QueryRow(ctx, `select exists (
		select 1 from public.users actor
		join public.organization_members member on member.user_id=actor.id and member.organization_id=actor.organization_id
		where actor.id=$1::uuid and actor.organization_id=$2::uuid
		and coalesce(actor.is_active,false) and coalesce(member.is_active,false) and member.deleted_at is null
	)`, tenantContext.UserID, tenantContext.OrganizationID).Scan(&allowed)
	if err != nil {
		return err
	}
	if !allowed {
		return tenant.ErrOrganizationAccessDenied
	}
	return nil
}

// Every operational admission acquires actors before session/conversation/lead.
// Canonical Users deletion holds users/member before transferring those rows.
func lockWhatsAppUserMembershipRows(ctx context.Context, tx pgx.Tx, organizationID string, userIDs ...string) error {
	ids := append([]string(nil), userIDs...)
	sort.Strings(ids)
	for index, id := range ids {
		if index > 0 && id == ids[index-1] {
			continue
		}
		var locked string
		if err := tx.QueryRow(ctx, `select id::text from public.users where id=$1::uuid for share`, id).Scan(&locked); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return tenant.ErrOrganizationAccessDenied
			}
			return err
		}
		if err := tx.QueryRow(ctx, `select user_id::text from public.organization_members where organization_id=$1::uuid and user_id=$2::uuid for share`, organizationID, id).Scan(&locked); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return tenant.ErrOrganizationAccessDenied
			}
			return err
		}
	}
	return nil
}

func lockOriginalWhatsAppActor(ctx context.Context, tx pgx.Tx, actor tenant.Context) error {
	if err := lockWhatsAppUserMembershipRows(ctx, tx, actor.OrganizationID, actor.UserID); err != nil {
		return err
	}
	return requireOriginalWhatsAppOrganization(ctx, tx, actor)
}

func currentLockedWhatsAppOperator(ctx context.Context, tx pgx.Tx, actor tenant.Context) (tenant.Context, string, error) {
	if err := lockOriginalWhatsAppActor(ctx, tx, actor); err != nil {
		return tenant.Context{}, "", err
	}
	if err := lockWhatsAppActorRoles(ctx, tx, actor); err != nil {
		return tenant.Context{}, "", err
	}
	current, snapshot, err := currentWhatsAppActorWithSnapshot(ctx, tx, actor)
	if err != nil {
		return tenant.Context{}, "", err
	}
	if !current.HasPermission(permissions.WhatsAppOperate) || !current.HasPermission(permissions.WhatsAppView) {
		return tenant.Context{}, "", tenant.ErrOrganizationAccessDenied
	}
	return current, snapshot, nil
}
