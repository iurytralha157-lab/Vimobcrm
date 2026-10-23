package schedule

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type scheduleRowsQuerier interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

// Ordinary reads authorize before calling; commands authorize against their
// locked snapshot and load this projection before committing their changes.
func loadScheduleAssignees(ctx context.Context, queryer scheduleRowsQuerier, organizationID, eventID string) ([]AssigneeUser, error) {
	rows, err := queryer.Query(ctx, `
		select u.id::text, u.name, u.avatar_url
		from public.schedule_event_assignees sea
		join public.users u on u.id = sea.user_id
		where sea.organization_id = $1::uuid and sea.event_id = $2::uuid
		order by u.name asc, u.id asc
	`, organizationID, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	assignees := []AssigneeUser{}
	for rows.Next() {
		var assignee AssigneeUser
		var avatar pgtype.Text
		if err := rows.Scan(&assignee.ID, &assignee.Name, &avatar); err != nil {
			return nil, err
		}
		assignee.AvatarURL = textPtr(avatar)
		assignees = append(assignees, assignee)
	}
	return assignees, rows.Err()
}
