package settings

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func pushDeviceActorSession(ctx context.Context, actor tenant.Context) (string, error) {
	subject, ok := httpserver.UserFromContext(ctx)
	sid, valid := normalizeUUID(subject.SessionID)
	if !ok || !valid || subject.ID != actor.UserID {
		return "", tenant.ErrOrganizationAccessDenied
	}
	return sid, nil
}

func lockPushDeviceActor(ctx context.Context, tx pgx.Tx, actor tenant.Context) error {
	var role string
	if err := tx.QueryRow(ctx, `select coalesce(role,'') from public.users where id=$1::uuid and coalesce(is_active,false) for share`, actor.UserID).Scan(&role); err != nil {
		if err == pgx.ErrNoRows {
			return tenant.ErrOrganizationAccessDenied
		}
		return err
	}
	var member string
	err := tx.QueryRow(ctx, `select user_id::text from public.organization_members where organization_id=$1::uuid and user_id=$2::uuid and coalesce(is_active,false) and deleted_at is null for share`, actor.OrganizationID, actor.UserID).Scan(&member)
	if err == pgx.ErrNoRows && strings.EqualFold(strings.TrimSpace(role), "super_admin") {
		return nil
	}
	if err == pgx.ErrNoRows {
		return tenant.ErrOrganizationAccessDenied
	}
	return err
}

func lockPushDeviceSession(ctx context.Context, tx pgx.Tx, actor tenant.Context, sid string) error {
	var session string
	err := tx.QueryRow(ctx, `select id::text from auth.sessions where id=$1::uuid and user_id=$2::uuid for share`, sid, actor.UserID).Scan(&session)
	if err == pgx.ErrNoRows {
		return tenant.ErrOrganizationAccessDenied
	}
	return err
}

func (repo Repository) savePushTokenAtomically(ctx context.Context, actor tenant.Context, request PushTokenRequest, endpoint, token, platform string, deviceInfo []byte) (PushTokenResult, error) {
	sid, err := pushDeviceActorSession(ctx, actor)
	if err != nil {
		return PushTokenResult{}, err
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return PushTokenResult{}, err
	}
	defer func() {
		cleanupContext, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = tx.Rollback(cleanupContext)
	}()
	if _, err = tx.Exec(ctx, `set local lock_timeout='2s';set local statement_timeout='5s';set local idle_in_transaction_session_timeout='20s'`); err != nil {
		return PushTokenResult{}, err
	}
	if err = lockPushDeviceActor(ctx, tx, actor); err != nil {
		return PushTokenResult{}, err
	}
	// This is shared across accounts and organizations. Actor locks precede the
	// device lock; every deactivation and upsert uses this same transaction.
	if _, err = tx.Exec(ctx, `select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('push-device:'||private.push_device_endpoint_key($1,$2,$3),0))`, endpoint, platform, token); err != nil {
		return PushTokenResult{}, err
	}
	if err = ctx.Err(); err != nil {
		return PushTokenResult{}, err
	}
	// Recheck after waiting for endpoint ownership. A request authenticated before
	// logout must not register its old session after that session was revoked.
	if err = lockPushDeviceSession(ctx, tx, actor, sid); err != nil {
		return PushTokenResult{}, err
	}
	if request.SyncOnly != nil && *request.SyncOnly {
		var dead bool
		if err = tx.QueryRow(ctx, `select exists(select 1 from public.push_tokens where user_id=$1::uuid
		 and private.push_device_endpoint_key(endpoint,platform,token)=private.push_device_endpoint_key($2,$3,$4) and is_active is not true)
		 and not exists(select 1 from public.push_tokens where user_id=$1::uuid
		 and private.push_device_endpoint_key(endpoint,platform,token)=private.push_device_endpoint_key($2,$3,$4) and is_active is true)`, actor.UserID, endpoint, platform, token).Scan(&dead); err != nil {
			return PushTokenResult{}, err
		}
		if dead {
			if err = tx.Commit(ctx); err != nil {
				return PushTokenResult{}, err
			}
			return PushTokenResult{OK: true, Active: false, RequiresResubscribe: true}, nil
		}
	}
	// A passive sync that needs a new subscription must not revoke the device
	// currently registered to another account.
	if _, err = tx.Exec(ctx, `update public.push_tokens set is_active=false,updated_at=now()
	 where user_id is distinct from $1::uuid and is_active is true
	 and private.push_device_endpoint_key(endpoint,platform,token)=private.push_device_endpoint_key($2,$3,$4)`, actor.UserID, endpoint, platform, token); err != nil {
		return PushTokenResult{}, err
	}
	// Preserve a sole active legacy row's ID when the sender previously used an
	// endpoint-less token or a different native platform prefix. If an exact row
	// already exists, its ID remains canonical and the former alias is retired.
	if _, err = tx.Exec(ctx, `update public.push_tokens set endpoint=$2,updated_at=now()
	 where id=(select candidate.id from public.push_tokens candidate where candidate.user_id=$1::uuid
	 and (candidate.is_active is true or candidate.token=$4)
	 and private.push_device_endpoint_key(candidate.endpoint,candidate.platform,candidate.token)=private.push_device_endpoint_key($2,$3,$4)
	 order by candidate.is_active desc nulls last,candidate.id limit 1)
	 and not exists(select 1 from public.push_tokens exact where exact.user_id=$1::uuid and exact.endpoint=$2)`, actor.UserID, endpoint, platform, token); err != nil {
		return PushTokenResult{}, err
	}
	if _, err = tx.Exec(ctx, `update public.push_tokens set is_active=false,updated_at=now()
	 where user_id=$1::uuid and endpoint is distinct from $2 and is_active is true
	 and private.push_device_endpoint_key(endpoint,platform,token)=private.push_device_endpoint_key($2,$3,$4)`, actor.UserID, endpoint, platform, token); err != nil {
		return PushTokenResult{}, err
	}
	_, err = tx.Exec(ctx, `insert into public.push_tokens(organization_id,user_id,token,platform,device_info,endpoint,p256dh,auth,user_agent,is_active,registration_sid)
	 values($1::uuid,$2::uuid,$4,$5,$6::jsonb,$3,$7,$8,$9,true,$10::uuid)
	 on conflict(user_id,endpoint) where endpoint is not null do update set organization_id=excluded.organization_id,token=excluded.token,platform=excluded.platform,
	 device_info=excluded.device_info,p256dh=excluded.p256dh,auth=excluded.auth,user_agent=excluded.user_agent,is_active=true,registration_sid=excluded.registration_sid,updated_at=now()`,
		actor.OrganizationID, actor.UserID, endpoint, token, platform, string(deviceInfo), cleanStringPointer(request.P256DH), cleanStringPointer(request.Auth), cleanStringPointer(request.UserAgent), sid)
	if err != nil {
		return PushTokenResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return PushTokenResult{}, err
	}
	return PushTokenResult{OK: true, Active: true}, nil
}

func (repo Repository) deactivatePushTokenSession(ctx context.Context, actor tenant.Context, request DeactivatePushTokenRequest) error {
	sid, err := pushDeviceActorSession(ctx, actor)
	if err != nil {
		return err
	}
	_, err = repo.db.Pool().Exec(ctx, `update public.push_tokens set is_active=false,updated_at=now()
	 where user_id=$1::uuid and ($2::text is null or endpoint=$2)
	 and (registration_sid is null or registration_sid=$3::uuid)`, actor.UserID, cleanStringPointer(request.Endpoint), sid)
	return err
}
