package whatsapp

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const quickReplySelectFields = `id::text, shortcut, content, created_at, updated_at`

func authorizeQuickReplyActor(actor tenant.Context, permission string) error {
	if _, ok := normalizeUUID(actor.OrganizationID); !ok {
		return tenant.ErrOrganizationAccessDenied
	}
	if _, ok := normalizeUUID(actor.UserID); !ok || !actor.HasPermission(permission) {
		return tenant.ErrOrganizationAccessDenied
	}
	return nil
}

func (repo Repository) ListQuickReplies(ctx context.Context, actor tenant.Context) ([]QuickReply, error) {
	if err := authorizeQuickReplyActor(actor, permissions.WhatsAppView); err != nil {
		return nil, err
	}
	rows, err := repo.db.Pool().Query(ctx, `select `+quickReplySelectFields+`
		from private.whatsapp_quick_replies
		where organization_id=$1::uuid and user_id=$2::uuid
		order by shortcut asc, id asc limit 200`, actor.OrganizationID, actor.UserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []QuickReply{}
	for rows.Next() {
		item, err := scanQuickReply(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (repo Repository) CreateQuickReply(ctx context.Context, actor tenant.Context, input quickReplyInput) (QuickReply, error) {
	if err := authorizeQuickReplyActor(actor, permissions.WhatsAppOperate); err != nil {
		return QuickReply{}, err
	}
	// Keep lock acquisition in a separate statement: the INSERT then receives a
	// fresh READ COMMITTED snapshot after another replica frees its owner lock.
	tx, err := repo.db.Pool().BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return QuickReply{}, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
		'whatsapp-quick-replies:' || $1::uuid::text || ':' || $2::uuid::text, 0))`, actor.OrganizationID, actor.UserID); err != nil {
		return QuickReply{}, err
	}
	item, err := scanQuickReply(tx.QueryRow(ctx, `insert into private.whatsapp_quick_replies
		(organization_id,user_id,shortcut,content) values($1::uuid,$2::uuid,$3,$4)
		returning `+quickReplySelectFields, actor.OrganizationID, actor.UserID, input.Shortcut, input.Content))
	if err != nil {
		return QuickReply{}, quickReplyDatabaseError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return QuickReply{}, quickReplyDatabaseError(err)
	}
	return item, nil
}

func (repo Repository) UpdateQuickReply(ctx context.Context, actor tenant.Context, id string, input quickReplyPatchInput) (QuickReply, error) {
	if err := authorizeQuickReplyActor(actor, permissions.WhatsAppOperate); err != nil {
		return QuickReply{}, err
	}
	id, ok := normalizeUUID(id)
	if !ok {
		return QuickReply{}, ErrQuickReplyNotFound
	}
	item, err := scanQuickReply(repo.db.Pool().QueryRow(ctx, `update private.whatsapp_quick_replies
		set shortcut=case when $4 then $5 else shortcut end,
		    content=case when $6 then $7 else content end
		where organization_id=$1::uuid and user_id=$2::uuid and id=$3::uuid
		returning `+quickReplySelectFields, actor.OrganizationID, actor.UserID, id,
		input.ShortcutSet, input.Shortcut, input.ContentSet, input.Content))
	return item, quickReplyDatabaseError(err)
}

func (repo Repository) DeleteQuickReply(ctx context.Context, actor tenant.Context, id string) error {
	if err := authorizeQuickReplyActor(actor, permissions.WhatsAppOperate); err != nil {
		return err
	}
	id, ok := normalizeUUID(id)
	if !ok {
		return ErrQuickReplyNotFound
	}
	tag, err := repo.db.Pool().Exec(ctx, `delete from private.whatsapp_quick_replies
		where organization_id=$1::uuid and user_id=$2::uuid and id=$3::uuid`, actor.OrganizationID, actor.UserID, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrQuickReplyNotFound
	}
	return nil
}

func scanQuickReply(row scanner) (QuickReply, error) {
	var item QuickReply
	err := row.Scan(&item.ID, &item.Shortcut, &item.Content, &item.CreatedAt, &item.UpdatedAt)
	return item, err
}

func quickReplyDatabaseError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrQuickReplyNotFound
	}
	var postgres *pgconn.PgError
	if errors.As(err, &postgres) {
		if postgres.Code == "23505" && postgres.ConstraintName == "whatsapp_quick_replies_owner_shortcut_key" {
			return ErrQuickReplyConflict
		}
		if postgres.Code == "23514" && postgres.ConstraintName == "whatsapp_quick_replies_owner_limit" {
			return ErrQuickReplyLimit
		}
	}
	return err
}
