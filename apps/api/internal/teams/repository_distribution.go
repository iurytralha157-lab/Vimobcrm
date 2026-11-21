package teams

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
)

func currentTeamQueueKeepIDs(ctx context.Context, tx pgx.Tx, organizationID, teamID string) ([]string, error) {
	rows, err := tx.Query(ctx, `
		select distinct tm.user_id::text
		from public.team_members tm
		where tm.organization_id = $1::uuid
		  and tm.team_id = $2::uuid
		order by tm.user_id::text
	`, organizationID, teamID)
	if err != nil {
		return nil, err
	}
	return collectTeamUUIDs(rows)
}

func syncRoundRobinWithTeam(ctx context.Context, tx pgx.Tx, organizationID string, teamID string, newMemberIDs []string) error {
	return syncRoundRobinWithTeamPreserving(ctx, tx, organizationID, teamID, newMemberIDs, newMemberIDs)
}

func syncRoundRobinWithTeamPreserving(ctx context.Context, tx pgx.Tx, organizationID string, teamID string, newMemberIDs, keepMemberIDs []string) error {
	rows, err := tx.Query(ctx, `
		select
			rrm.id::text,
			rrm.round_robin_id::text,
			rrm.user_id::text,
			coalesce(rrm.position, 0),
			coalesce(rrm.weight, 10),
			coalesce(rrm.membership_generation, 0),
			coalesce((
				select om.membership_generation
				from public.organization_members om
				where om.organization_id = rrm.organization_id
				  and om.user_id = rrm.user_id
			), 0),
			coalesce(rrm.is_active, true),
			exists (
			  select 1 from public.round_robin_members logical
			  where logical.organization_id = rrm.organization_id
			    and logical.round_robin_id = rrm.round_robin_id
			    and logical.team_id = rrm.team_id
			    and logical.user_id is null
			)
		from public.round_robin_members rrm
		join public.round_robins rr
		  on rr.id = rrm.round_robin_id
		 and rr.organization_id = rrm.organization_id
		where rr.organization_id = $1::uuid
		  and rrm.team_id = $2::uuid
		  and rrm.user_id is not null
		order by rr.id, rrm.position, rrm.id
		for update of rr, rrm
	`, organizationID, teamID)
	if err != nil {
		return err
	}
	defer rows.Close()

	type rrMember struct {
		ID                string
		RoundRobinID      string
		UserID            string
		Position          int
		Weight            int
		Generation        int64
		CurrentGeneration int64
		IsActive          bool
		HasLogicalEntry   bool
	}
	byQueue := map[string][]rrMember{}
	for rows.Next() {
		var member rrMember
		if err := rows.Scan(&member.ID, &member.RoundRobinID, &member.UserID, &member.Position, &member.Weight, &member.Generation, &member.CurrentGeneration, &member.IsActive, &member.HasLogicalEntry); err != nil {
			return err
		}
		byQueue[member.RoundRobinID] = append(byQueue[member.RoundRobinID], member)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	nextIDs := map[string]struct{}{}
	for _, id := range keepMemberIDs {
		nextIDs[id] = struct{}{}
	}
	insertIDs := map[string]struct{}{}
	for _, id := range newMemberIDs {
		insertIDs[id] = struct{}{}
	}
	for roundRobinID, currentMembers := range byQueue {
		currentIDs := map[string]struct{}{}
		maxPosition := -1
		defaultWeight := currentMembers[0].Weight
		logicalPresent := currentMembers[0].HasLogicalEntry
		hasResultingTeamEntry := logicalPresent
		anyActive := false
		for _, member := range currentMembers {
			currentIDs[member.UserID] = struct{}{}
			if member.Position > maxPosition {
				maxPosition = member.Position
			}
			if _, keep := nextIDs[member.UserID]; keep {
				hasResultingTeamEntry = true
			}
			anyActive = anyActive || member.IsActive
		}
		// Observe actual INSERT outcomes before deleting the last legacy row.
		// A selected user may already be a direct participant (DO NOTHING), and
		// hidden roster members need not have a participant in this queue.
		position := int64(maxPosition) + 1
		initialCount := int64(-1)
		insertedCount := int64(0)
		if !logicalPresent {
			for _, userID := range newMemberIDs {
				if _, exists := currentIDs[userID]; exists {
					continue
				}
				if initialCount < 0 {
					initialCount, err = teamQueueParticipantCount(ctx, tx, organizationID, roundRobinID)
					if err != nil {
						return err
					}
				}
				if position > maxQueueParticipantPosition {
					// ON CONFLICT cannot protect an overflowing int4 parameter. A
					// direct participant needs no new position or team-bound row.
					exists, err := teamQueueUserExists(ctx, tx, organizationID, roundRobinID, userID)
					if err != nil {
						return err
					}
					if exists {
						continue
					}
					return ErrTeamQueueSyncBlocked
				}
				tag, err := tx.Exec(ctx, `
					insert into public.round_robin_members (organization_id, round_robin_id, team_id, user_id, weight, position, is_active)
					values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, true)
					on conflict (round_robin_id, user_id) do nothing
				`, organizationID, roundRobinID, teamID, userID, defaultWeight, int(position))
				if err != nil {
					return err
				}
				if tag.RowsAffected() > 0 {
					hasResultingTeamEntry = true
					currentIDs[userID] = struct{}{}
					insertedCount += tag.RowsAffected()
					position++
				}
			}
		}
		// Preserve the binding when these effective writes would leave no team
		// participant. A logical entry expands future roster changes directly.
		anchorID := ""
		if !hasResultingTeamEntry {
			first := currentMembers[0]
			tag, err := tx.Exec(ctx, `
				update public.round_robin_members member
				set user_id = null, is_active = $5, updated_at = now()
				where member.organization_id = $1::uuid
				  and member.round_robin_id = $2::uuid
				  and member.team_id = $3::uuid
				  and member.id = $4::uuid
				  and not exists (
				    select 1 from public.round_robin_members logical
				    where logical.organization_id = $1::uuid
				      and logical.round_robin_id = $2::uuid
				      and logical.team_id = $3::uuid
				      and logical.user_id is null
				  )
			`, organizationID, roundRobinID, teamID, first.ID, anyActive)
			if err != nil {
				return err
			}
			if tag.RowsAffected() > 0 {
				anchorID = first.ID
			}
		}
		for _, member := range currentMembers {
			if member.ID == anchorID {
				continue
			}
			if _, keep := nextIDs[member.UserID]; !keep {
				if _, err := tx.Exec(ctx, `
					delete from public.round_robin_members
					where organization_id = $1::uuid
					  and id = $2::uuid
				`, organizationID, member.ID); err != nil {
					return err
				}
			} else if _, selected := insertIDs[member.UserID]; selected && member.Generation != member.CurrentGeneration {
				// An explicit re-enrollment must rebind an existing stale queue row.
				if _, err := tx.Exec(ctx, `
					update public.round_robin_members
					set is_active = true
					where organization_id = $1::uuid
					  and id = $2::uuid
				`, organizationID, member.ID); err != nil {
					return err
				}
			}
		}
		if insertedCount > 0 {
			finalCount, err := teamQueueParticipantCount(ctx, tx, organizationID, roundRobinID)
			if err != nil {
				return err
			}
			// Legacy queues above the cap can retain or reduce their count.
			// Only real growth beyond the cap prevents the entire team save.
			if finalCount > distribution.MaxQueueParticipants && finalCount > initialCount {
				return ErrTeamQueueSyncBlocked
			}
		}
	}
	return nil
}
