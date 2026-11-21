package schedule

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/pgvalue"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) ListComments(ctx context.Context, tenantContext tenant.Context, eventID string) ([]Comment, error) {
	eventID, ok := normalizeUUID(eventID)
	if !ok {
		return nil, ErrEventNotFound
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if err := repo.ensureCanViewEvent(ctx, tx, tenantContext, eventID); err != nil {
		return nil, err
	}

	rows, err := tx.Query(ctx, `
		select
			c.id::text,
			c.event_id::text,
			c.user_id::text,
			c.organization_id::text,
			c.content,
			c.created_at,
			u.id::text,
			u.name,
			u.avatar_url
		from public.schedule_event_comments c
		left join public.users u on u.id = c.user_id
		where c.organization_id = $1::uuid
		  and c.event_id = $2::uuid
		order by c.created_at asc, c.id asc
	`, tenantContext.OrganizationID, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	comments := []Comment{}
	for rows.Next() {
		comment, err := scanComment(rows)
		if err != nil {
			return nil, err
		}
		comments = append(comments, comment)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return comments, nil
}

func (repo Repository) AddComment(ctx context.Context, tenantContext tenant.Context, eventID string, content string, commandIDs ...string) (Comment, error) {
	commandID := ""
	if len(commandIDs) > 0 {
		var err error
		commandID, err = scheduleCommentCommandID(commandIDs[0])
		if err != nil {
			return Comment{}, err
		}
	}
	eventID, ok := normalizeUUID(eventID)
	if !ok {
		return Comment{}, ErrEventNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Comment{}, err
	}
	defer tx.Rollback(ctx)

	current, err := repo.getSnapshotForUpdate(ctx, tx, tenantContext.OrganizationID, eventID)
	if err != nil {
		return Comment{}, err
	}
	if ok, err := repo.canEditEvent(ctx, tx, tenantContext, current); err != nil {
		return Comment{}, err
	} else if !ok {
		return Comment{}, tenant.ErrOrganizationAccessDenied
	}
	if err := lockScheduleCommand(ctx, tx, tenantContext, "comment", commandID); err != nil {
		return Comment{}, err
	}
	if existing, replay, err := findScheduleCommentReplay(ctx, tx, tenantContext, eventID, commandID, content); err != nil {
		return Comment{}, err
	} else if replay {
		return existing, nil
	}

	var commentID string
	err = tx.QueryRow(ctx, `
		insert into public.schedule_event_comments (
			client_request_id,
			organization_id,
			event_id,
			user_id,
			content
		)
		values (
			$5::uuid,
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4
		)
		returning id::text
	`, tenantContext.OrganizationID, eventID, tenantContext.UserID, content, pgvalue.NullableString(commandID)).Scan(&commentID)
	if err != nil {
		return Comment{}, err
	}

	if current.LeadID != "" {
		if err := repo.insertTimelineEvent(ctx, tx, tenantContext, current, "commented"); err != nil {
			return Comment{}, err
		}
	}

	recipients, err := repo.eventRecipientIDs(ctx, tx, tenantContext.OrganizationID, eventID, current.UserID, tenantContext.UserID)
	if err != nil {
		return Comment{}, err
	}
	if err := repo.insertScheduleNotifications(ctx, tx, tenantContext.OrganizationID, tenantContext.UserID, recipients, "Comentario em atividade", content, map[string]any{
		"schedule_event_id": eventID,
		"comment_preview":   trimMax(content, 160),
	}); err != nil {
		return Comment{}, err
	}

	comment, err := loadScheduleComment(ctx, tx, tenantContext.OrganizationID, commentID)
	if err != nil {
		return Comment{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Comment{}, err
	}

	return comment, nil
}

func (repo Repository) getComment(ctx context.Context, organizationID string, commentID string) (Comment, error) {
	comment, err := scanComment(repo.db.Pool().QueryRow(ctx, `
		select
			c.id::text,
			c.event_id::text,
			c.user_id::text,
			c.organization_id::text,
			c.content,
			c.created_at,
			u.id::text,
			u.name,
			u.avatar_url
		from public.schedule_event_comments c
		left join public.users u on u.id = c.user_id
		where c.organization_id = $1::uuid
		  and c.id = $2::uuid
		limit 1
	`, organizationID, commentID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Comment{}, ErrCommentNotFound
	}
	if err != nil {
		return Comment{}, err
	}

	return comment, nil
}

func scanComment(row scanner) (Comment, error) {
	var comment Comment
	var userID, userName, userAvatarURL pgtype.Text
	if err := row.Scan(&comment.ID, &comment.EventID, &comment.UserID, &comment.OrganizationID, &comment.Content, &comment.CreatedAt, &userID, &userName, &userAvatarURL); err != nil {
		return Comment{}, err
	}

	if userID.Valid {
		comment.User = &UserRef{
			ID:        userID.String,
			Name:      textValue(userName),
			AvatarURL: textPtr(userAvatarURL),
		}
	}

	return comment, nil
}
