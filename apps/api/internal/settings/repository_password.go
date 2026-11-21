package settings

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/passwordpolicy"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) ChangePassword(ctx context.Context, tenantContext tenant.Context, authorization string, request ChangePasswordRequest) (ChangePasswordResult, error) {
	return changePassword(
		ctx,
		tenantContext.UserID,
		authorization,
		request,
		repo.verifyCurrentPassword,
		repo.authAdmin.revokeSessions,
		repo.authAdmin.updatePassword,
		repo.recordPasswordChangeEvent,
		repo.sendPasswordChangedNotification,
		slog.Default(),
	)
}

type passwordVerifier func(context.Context, string, string) error

type passwordUpdateFunc func(context.Context, string, string) error

type passwordSessionRevoker func(context.Context, string, string) error

type passwordChangeEventRecorder func(context.Context, string, string) error

type passwordChangedNotifier func(context.Context, string) bool

func changePassword(
	ctx context.Context,
	userID string,
	authorization string,
	request ChangePasswordRequest,
	verifyPassword passwordVerifier,
	revokeSessions passwordSessionRevoker,
	updatePassword passwordUpdateFunc,
	recordEvent passwordChangeEventRecorder,
	notify passwordChangedNotifier,
	logger *slog.Logger,
) (ChangePasswordResult, error) {
	password := request.Password
	if !passwordpolicy.IsStrong(password) {
		return ChangePasswordResult{}, ErrInvalidInput
	}

	source, ok := normalizePasswordChangeSource(request.Source)
	if !ok {
		return ChangePasswordResult{}, ErrInvalidInput
	}

	scope := "others"
	if source == "recovery" {
		scope = "global"
	} else {
		if request.CurrentPassword == "" {
			return ChangePasswordResult{}, ErrCurrentPasswordRequired
		}
		if len(request.CurrentPassword) > 1024 {
			return ChangePasswordResult{}, ErrInvalidInput
		}
		if err := verifyPassword(ctx, userID, request.CurrentPassword); err != nil {
			return ChangePasswordResult{}, err
		}
	}
	if err := revokeSessions(ctx, authorization, scope); err != nil {
		return ChangePasswordResult{}, errors.Join(ErrPasswordSessionRevocationUnconfirmed, err)
	}

	if err := updatePassword(ctx, userID, password); err != nil {
		return ChangePasswordResult{}, errors.Join(ErrPasswordUpdateAfterRevocationUnconfirmed, err)
	}

	if err := recordEvent(ctx, userID, source); err != nil {
		if logger == nil {
			logger = slog.Default()
		}
		logger.ErrorContext(
			ctx,
			"password changed but audit event persistence failed",
			"user_id", userID,
			"source", source,
			"error", err,
		)
	}

	emailSent := notify(ctx, userID)

	return ChangePasswordResult{
		Allowed:               true,
		Message:               "Senha alterada com sucesso!",
		EmailNotificationSent: emailSent,
		SessionsRevoked:       true,
	}, nil
}

func normalizePasswordChangeSource(raw string) (string, bool) {
	source := strings.ToLower(strings.TrimSpace(raw))
	if source == "" {
		source = "settings"
	}

	switch source {
	case "settings", "recovery":
		return source, true
	default:
		return "", false
	}
}

func (repo Repository) recordPasswordChangeEvent(ctx context.Context, userID string, source string) error {
	_, err := repo.db.Pool().Exec(ctx, `
		insert into public.password_change_events (user_id, source, metadata)
		values ($1::uuid, $2, '{}'::jsonb)
	`, userID, source)
	return err
}

func (repo Repository) sendPasswordChangedNotification(ctx context.Context, userID string) bool {
	if !repo.email.isConfigured() {
		return false
	}

	var name, email pgtype.Text
	err := repo.db.Pool().QueryRow(ctx, `
		select name, email
		from public.users
		where id = $1::uuid
	`, userID).Scan(&name, &email)
	if err != nil || !email.Valid || strings.TrimSpace(email.String) == "" {
		return false
	}

	err = repo.email.sendPasswordChanged(ctx, passwordChangedEmailInput{
		UserID:    userID,
		Email:     email.String,
		Name:      textValue(name),
		ChangedAt: time.Now(),
	})

	return err == nil
}

func (repo Repository) PasswordStatus(ctx context.Context, tenantContext tenant.Context) (PasswordStatus, error) {
	var status PasswordStatus
	var event PasswordChangeEvent
	err := repo.db.Pool().QueryRow(ctx, `
		select changed_at::text, source
		from public.password_change_events
		where user_id = $1::uuid
		  and (metadata ->> 'reset_source') is distinct from 'superadmin'
		order by changed_at desc
		limit 1
	`, tenantContext.UserID).Scan(&event.ChangedAt, &event.Source)
	if err == nil {
		status.LastChange = &event
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return PasswordStatus{}, err
	}

	var lockout PasswordChangeLockout
	var lockedUntil, reason pgtype.Text
	err = repo.db.Pool().QueryRow(ctx, `
		select locked_until::text, lock_level, last_lock_reason
		from public.password_change_lockouts
		where user_id = $1::uuid
		limit 1
	`, tenantContext.UserID).Scan(&lockedUntil, &lockout.LockLevel, &reason)
	if err == nil {
		lockout.LockedUntil = textPointer(lockedUntil)
		lockout.LastLockReason = textPointer(reason)
		status.Lockout = &lockout
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return PasswordStatus{}, err
	}

	return status, nil
}
