package teams

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func setAuditActor(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context) error {
	userID := strings.TrimSpace(tenantContext.UserID)
	if userID == "" {
		return nil
	}
	_, err := tx.Exec(ctx, `select set_config('app.current_user_id', $1, true)`, userID)
	return err
}

func (repo Repository) beginTeamMutation(ctx context.Context) (pgx.Tx, error) {
	if repo.beginMutationTx != nil {
		return repo.beginMutationTx(ctx)
	}
	return repo.db.Pool().Begin(ctx)
}

// Lock the aggregate before locking or changing team_members and availability.
// NO KEY UPDATE still serializes team writers, while letting queue inserts take
// their FK key-share lock on this team as they hold round_robins.
func lockTeamRevision(ctx context.Context, tx pgx.Tx, organizationID, teamID string) (int64, error) {
	var revision int64
	err := tx.QueryRow(ctx, `
		select revision
		from public.teams
		where organization_id = $1::uuid
		  and id = $2::uuid
		for no key update
	`, organizationID, teamID).Scan(&revision)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrTeamNotFound
	}
	return revision, err
}

func bumpTeamRevision(ctx context.Context, tx pgx.Tx, organizationID, teamID string) error {
	tag, err := tx.Exec(ctx, `
		update public.teams
		set revision = revision + 1,
		    updated_at = clock_timestamp()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, organizationID, teamID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrTeamNotFound
	}
	return nil
}

func teamIDForMember(ctx context.Context, q queryRowExecutor, organizationID, teamMemberID string) (string, error) {
	var teamID string
	err := q.QueryRow(ctx, `
		select team_id::text
		from public.team_members
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, organizationID, teamMemberID).Scan(&teamID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrTeamMemberNotFound
	}
	return teamID, err
}

// A removal and later reinvitation can hide an old team_member without
// changing teams.revision. Lock every row that can change the visible roster,
// including temporarily inactive users and memberships, before comparing it.
func verifyExpectedTeamMembers(ctx context.Context, tx pgx.Tx, organizationID, teamID string, expected, requestedUserIDs []string) error {
	if expected == nil || len(expected) > maxTeamMembers {
		return ErrInvalidInput
	}
	ids, err := normalizeUUIDList(expected)
	if err != nil || len(ids) != len(expected) {
		return ErrInvalidInput
	}
	sort.Strings(ids)
	if err := lockTeamRosterDependencies(ctx, tx, organizationID, teamID, requestedUserIDs); err != nil {
		return err
	}
	rows, err := tx.Query(ctx, `
		select tm.id::text
		from public.team_members tm
		join public.users u on u.id = tm.user_id
		join public.organization_members om
		  on om.organization_id = tm.organization_id
		 and om.user_id = tm.user_id
		 and coalesce(om.is_active, false) = true
		 and om.deleted_at is null
		 and om.membership_generation = tm.membership_generation
		where tm.organization_id = $1::uuid
		  and tm.team_id = $2::uuid
		  and coalesce(tm.is_active, true) = true
		  and coalesce(u.is_active, false) = true
		order by tm.id
	`, organizationID, teamID)
	if err != nil {
		return err
	}
	defer rows.Close()
	index := 0
	for rows.Next() {
		var memberID string
		if err := rows.Scan(&memberID); err != nil {
			return err
		}
		if index >= len(ids) || memberID != ids[index] {
			return ErrTeamRevisionConflict
		}
		index++
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if index != len(ids) {
		return ErrTeamRevisionConflict
	}
	return nil
}

func collectTeamUUIDs(rows pgx.Rows) ([]string, error) {
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return ids, nil
}

func lockTeamRosterDependencies(ctx context.Context, tx pgx.Tx, organizationID, teamID string, requestedUserIDs []string) error {
	rows, err := tx.Query(ctx, `
		select distinct tm.user_id::text
		from public.team_members tm
		where tm.organization_id = $1::uuid
		  and tm.team_id = $2::uuid
	`, organizationID, teamID)
	if err != nil {
		return err
	}
	currentUserIDs, err := collectTeamUUIDs(rows)
	if err != nil {
		return err
	}
	targetIDs := make(map[string]struct{}, len(currentUserIDs)+len(requestedUserIDs))
	for _, id := range currentUserIDs {
		targetIDs[id] = struct{}{}
	}
	for _, id := range requestedUserIDs {
		targetIDs[id] = struct{}{}
	}
	userIDs := make([]string, 0, len(targetIDs))
	for id := range targetIDs {
		userIDs = append(userIDs, id)
	}
	sort.Strings(userIDs)
	encodedIDs, err := json.Marshal(userIDs)
	if err != nil {
		return err
	}

	// Each statement finishes before the next one starts. The user lifecycle
	// also locks public.users before organization_members, including when a
	// membership row is absent during a remove/reinvite lifecycle. NO KEY UPDATE
	// still blocks changes to user activity but permits queue FK key-share locks.
	rows, err = tx.Query(ctx, `
		select u.id::text
		from public.users u
		where u.id in (select value::uuid from jsonb_array_elements_text($1::jsonb))
		order by u.id
		for no key update of u
	`, string(encodedIDs))
	if err != nil {
		return err
	}
	lockedUsers, err := collectTeamUUIDs(rows)
	if err != nil {
		return err
	}
	lockedUserSet := make(map[string]struct{}, len(lockedUsers))
	for _, id := range lockedUsers {
		lockedUserSet[id] = struct{}{}
	}
	for _, id := range requestedUserIDs {
		if _, ok := lockedUserSet[id]; !ok {
			return ErrInvalidInput
		}
	}

	rows, err = tx.Query(ctx, `
		select om.user_id::text
		from public.organization_members om
		where om.organization_id = $1::uuid
		  and om.user_id in (select value::uuid from jsonb_array_elements_text($2::jsonb))
		order by om.user_id
		for share of om
	`, organizationID, string(encodedIDs))
	if err != nil {
		return err
	}
	lockedMemberships, err := collectTeamUUIDs(rows)
	if err != nil {
		return err
	}
	lockedMembershipSet := make(map[string]struct{}, len(lockedMemberships))
	for _, id := range lockedMemberships {
		lockedMembershipSet[id] = struct{}{}
	}
	for _, id := range requestedUserIDs {
		if _, ok := lockedMembershipSet[id]; !ok {
			return ErrInvalidInput
		}
	}

	rows, err = tx.Query(ctx, `
		select tm.id::text
		from public.team_members tm
		where tm.organization_id = $1::uuid
		  and tm.team_id = $2::uuid
		order by tm.id
		for share of tm
	`, organizationID, teamID)
	if err != nil {
		return err
	}
	_, err = collectTeamUUIDs(rows)
	return err
}
