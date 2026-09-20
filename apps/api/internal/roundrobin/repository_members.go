package roundrobin

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) AddMember(ctx context.Context, tenantContext tenant.Context, roundRobinID string, input memberMutationInput) ([]Member, error) {
	if !canManageRoundRobinScope(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	roundRobinID, ok := normalizeUUID(roundRobinID)
	if !ok {
		return nil, ErrRoundRobinNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if err := setAuditActor(ctx, tx, tenantContext); err != nil {
		return nil, err
	}

	if err := repo.ensureRoundRobinMutable(ctx, tx, tenantContext, roundRobinID); err != nil {
		return nil, err
	}
	state, err := repo.getStateForUpdate(ctx, tx, tenantContext.OrganizationID, roundRobinID)
	if err != nil {
		return nil, err
	}
	if err := repo.rejectPendingWhatsAppIntake(ctx, tx, tenantContext.OrganizationID, roundRobinID); err != nil {
		return nil, err
	}

	items := []memberInput{{
		Type:     input.Type,
		EntityID: input.EntityID,
		UserID:   input.UserID,
		TeamID:   input.TeamID,
		Weight:   input.Weight,
	}}
	if err := ensureRoundRobinInputInScope(tenantContext, nil, items, true, false); err != nil {
		return nil, err
	}
	ids, err := repo.insertMembers(
		ctx,
		tx,
		tenantContext,
		roundRobinID,
		items,
		boolFromObject(objectFromObject(state.Metadata, "settings"), "ignore_availability"),
	)
	if err != nil {
		return nil, err
	}
	if err := repo.validateWhatsAppMessageDistribution(ctx, tx, tenantContext.OrganizationID, roundRobinID); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	members := make([]Member, 0, len(ids))
	for _, id := range ids {
		member, err := repo.getMember(ctx, tenantContext.OrganizationID, id)
		if err != nil {
			return nil, err
		}
		members = append(members, member)
	}

	return members, nil
}

func (repo Repository) UpdateMember(ctx context.Context, tenantContext tenant.Context, memberID string, input updateMemberInput) (Member, error) {
	if !canManageRoundRobinScope(tenantContext) {
		return Member{}, tenant.ErrOrganizationAccessDenied
	}

	memberID, ok := normalizeUUID(memberID)
	if !ok {
		return Member{}, ErrMemberNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Member{}, err
	}
	defer tx.Rollback(ctx)
	if err := setAuditActor(ctx, tx, tenantContext); err != nil {
		return Member{}, err
	}
	roundRobinID, err := repo.ensureRoundRobinMemberMutable(ctx, tx, tenantContext, memberID)
	if err != nil {
		return Member{}, err
	}
	if err := repo.rejectPendingWhatsAppIntake(ctx, tx, tenantContext.OrganizationID, roundRobinID); err != nil {
		return Member{}, err
	}

	setClauses := []string{}
	args := []any{tenantContext.OrganizationID, memberID}
	if input.Weight != nil {
		args = append(args, *input.Weight)
		setClauses = append(setClauses, fmt.Sprintf("weight = $%d", len(args)))
	}
	if input.Position != nil {
		args = append(args, *input.Position)
		setClauses = append(setClauses, fmt.Sprintf("position = $%d", len(args)))
	}
	if input.IsActive.Set {
		args = append(args, valueOrNil(input.IsActive.Value))
		setClauses = append(setClauses, fmt.Sprintf("is_active = coalesce($%d::boolean, false)", len(args)))
	}

	commandTag, err := tx.Exec(ctx, `
		update public.round_robin_members
		set `+strings.Join(setClauses, ", ")+`
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, args...)
	if err != nil {
		return Member{}, err
	}
	if commandTag.RowsAffected() == 0 {
		return Member{}, ErrMemberNotFound
	}
	if err := repo.validateWhatsAppMessageDistribution(ctx, tx, tenantContext.OrganizationID, roundRobinID); err != nil {
		return Member{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Member{}, err
	}

	return repo.getMember(ctx, tenantContext.OrganizationID, memberID)
}

func (repo Repository) DeleteMember(ctx context.Context, tenantContext tenant.Context, memberID string) error {
	if !canManageRoundRobinScope(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}

	memberID, ok := normalizeUUID(memberID)
	if !ok {
		return ErrMemberNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := setAuditActor(ctx, tx, tenantContext); err != nil {
		return err
	}
	roundRobinID, err := repo.ensureRoundRobinMemberMutable(ctx, tx, tenantContext, memberID)
	if err != nil {
		return err
	}
	if err := repo.rejectPendingWhatsAppIntake(ctx, tx, tenantContext.OrganizationID, roundRobinID); err != nil {
		return err
	}

	commandTag, err := tx.Exec(ctx, `
		delete from public.round_robin_members
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, memberID)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() == 0 {
		return ErrMemberNotFound
	}
	if err := repo.validateWhatsAppMessageDistribution(ctx, tx, tenantContext.OrganizationID, roundRobinID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (repo Repository) listMembers(ctx context.Context, organizationID string, roundRobinID *string) ([]Member, error) {
	return listMembersWithQueryer(ctx, repo.db.Pool(), organizationID, roundRobinID)
}

func listMembersWithQueryer(ctx context.Context, q queryer, organizationID string, roundRobinID *string) ([]Member, error) {
	args := []any{organizationID}
	where := "rrm.organization_id = $1::uuid"
	if roundRobinID != nil {
		args = append(args, *roundRobinID)
		where += " and rrm.round_robin_id = $2::uuid"
	}

	rows, err := q.Query(ctx, `
		select
			rrm.id::text,
			rrm.round_robin_id::text,
			rrm.user_id::text,
			rrm.team_id::text,
			coalesce(rrm.position, 0),
			rrm.weight,
			coalesce(rrm.is_active, true),
			u.id::text,
			u.name,
			u.email,
			u.avatar_url,
			coalesce(logs.total, 0)
		from public.round_robin_members rrm
		join public.round_robins rr
		  on rr.organization_id = rrm.organization_id
		 and rr.id = rrm.round_robin_id
		left join public.users u
		  on u.id = rrm.user_id
		left join lateral (
			select count(*)::bigint as total
			from public.round_robin_logs rrl
			where rrl.organization_id = rrm.organization_id
			  and rrl.round_robin_id = rrm.round_robin_id
			  and (
			    rrl.member_id = rrm.id
			    or (
			      rrl.member_id is null
			      and (
			        (rrm.user_id is not null and rrl.assigned_user_id = rrm.user_id)
			        or (rrm.user_id is null and rrl.metadata->>'member_id' = rrm.id::text)
			      )
			    )
			  )
		) logs on true
		where `+where+`
		  and rr.deleted_at is null
		order by rrm.round_robin_id, coalesce(rrm.position, 0) asc, rrm.created_at asc
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Member{}
	for rows.Next() {
		member, err := scanMember(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, member)
	}
	return out, rows.Err()
}

func (repo Repository) getMember(ctx context.Context, organizationID string, memberID string) (Member, error) {
	member, err := scanMember(repo.db.Pool().QueryRow(ctx, `
		select
			rrm.id::text,
			rrm.round_robin_id::text,
			rrm.user_id::text,
			rrm.team_id::text,
			coalesce(rrm.position, 0),
			rrm.weight,
			coalesce(rrm.is_active, true),
			u.id::text,
			u.name,
			u.email,
			u.avatar_url,
			coalesce(logs.total, 0)
		from public.round_robin_members rrm
		join public.round_robins rr
		  on rr.organization_id = rrm.organization_id
		 and rr.id = rrm.round_robin_id
		left join public.users u
		  on u.id = rrm.user_id
		left join lateral (
			select count(*)::bigint as total
			from public.round_robin_logs rrl
			where rrl.organization_id = rrm.organization_id
			  and rrl.round_robin_id = rrm.round_robin_id
			  and (
			    rrl.member_id = rrm.id
			    or (
			      rrl.member_id is null
			      and (
			        (rrm.user_id is not null and rrl.assigned_user_id = rrm.user_id)
			        or (rrm.user_id is null and rrl.metadata->>'member_id' = rrm.id::text)
			      )
			    )
			  )
		) logs on true
		where rrm.organization_id = $1::uuid
		  and rrm.id = $2::uuid
		  and rr.deleted_at is null
		limit 1
	`, organizationID, memberID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Member{}, ErrMemberNotFound
	}
	return member, err
}
