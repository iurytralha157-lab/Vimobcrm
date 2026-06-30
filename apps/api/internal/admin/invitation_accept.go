package admin

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type invitationRecord struct {
	ID               string
	Email            string
	Role             string
	OrganizationID   string
	OrganizationName string
}

func (repo Repository) AcceptInvitationPublic(ctx context.Context, token string, request AcceptInvitationRequest) (AcceptInvitationResult, error) {
	invitation, err := repo.invitationByTokenForAccept(ctx, token)
	if err != nil {
		return AcceptInvitationResult{}, err
	}

	existingUserID, err := repo.userIDByEmail(ctx, invitation.Email)
	if err == nil && existingUserID != "" {
		return AcceptInvitationResult{
			Success:          false,
			RequiresLogin:    true,
			Email:            invitation.Email,
			OrganizationID:   invitation.OrganizationID,
			OrganizationName: invitation.OrganizationName,
			Message:          "Este e-mail ja possui uma conta. Entre para aceitar o convite.",
		}, nil
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return AcceptInvitationResult{}, err
	}

	name := strings.TrimSpace(request.Name)
	password := strings.TrimSpace(request.Password)
	if name == "" || len(password) < 8 || !request.TermsAccepted || !request.PrivacyAccepted {
		return AcceptInvitationResult{}, ErrInvalidInput
	}

	authUserID, err := repo.createAuthUser(ctx, invitation.Email, password, name)
	if err != nil {
		return AcceptInvitationResult{}, err
	}

	if err := repo.activateInvitationForUser(ctx, invitation, authUserID, name, cleanString(request.Whatsapp)); err != nil {
		return AcceptInvitationResult{}, err
	}

	return AcceptInvitationResult{
		Success:          true,
		RequiresLogin:    false,
		Email:            invitation.Email,
		OrganizationID:   invitation.OrganizationID,
		OrganizationName: invitation.OrganizationName,
		Message:          "Convite aceito com sucesso.",
	}, nil
}

func (repo Repository) AcceptInvitationAuthenticated(ctx context.Context, userID string, token string) (AcceptInvitationResult, error) {
	userID, ok := normalizeUUID(userID)
	if !ok {
		return AcceptInvitationResult{}, ErrInvalidInput
	}

	invitation, err := repo.invitationByTokenForAccept(ctx, token)
	if err != nil {
		return AcceptInvitationResult{}, err
	}

	email, name, whatsapp, err := repo.userIdentity(ctx, userID)
	if err != nil {
		return AcceptInvitationResult{}, err
	}
	if !strings.EqualFold(email, invitation.Email) {
		return AcceptInvitationResult{}, ErrInvalidInput
	}

	if err := repo.activateInvitationForUser(ctx, invitation, userID, name, whatsapp); err != nil {
		return AcceptInvitationResult{}, err
	}

	return AcceptInvitationResult{
		Success:          true,
		RequiresLogin:    false,
		Email:            invitation.Email,
		OrganizationID:   invitation.OrganizationID,
		OrganizationName: invitation.OrganizationName,
		Message:          "Voce entrou na organizacao.",
	}, nil
}

func (repo Repository) invitationByTokenForAccept(ctx context.Context, token string) (invitationRecord, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return invitationRecord{}, ErrInvalidInput
	}

	var item invitationRecord
	var email pgtype.Text
	err := repo.db.Pool().QueryRow(ctx, `
		select
			i.id::text,
			i.email,
			coalesce(nullif(i.role, ''), 'user'),
			i.organization_id::text,
			o.name
		from public.invitations i
		join public.organizations o on o.id = i.organization_id
		where i.token = $1
		  and i.used_at is null
		  and i.expires_at > now()
		limit 1
	`, token).Scan(&item.ID, &email, &item.Role, &item.OrganizationID, &item.OrganizationName)
	if errors.Is(err, pgx.ErrNoRows) {
		return invitationRecord{}, ErrNotFound
	}
	if err != nil {
		return invitationRecord{}, err
	}
	if !email.Valid || strings.TrimSpace(email.String) == "" {
		return invitationRecord{}, ErrInvalidInput
	}
	item.Email = strings.TrimSpace(email.String)
	return item, nil
}

func (repo Repository) userIDByEmail(ctx context.Context, email string) (string, error) {
	var userID string
	err := repo.db.Pool().QueryRow(ctx, `
		select id::text
		from public.users
		where lower(email) = lower($1)
		limit 1
	`, email).Scan(&userID)
	return userID, err
}

func (repo Repository) userIdentity(ctx context.Context, userID string) (string, string, *string, error) {
	var email, name string
	var whatsapp pgtype.Text
	err := repo.db.Pool().QueryRow(ctx, `
		select email, name, whatsapp
		from public.users
		where id = $1::uuid
		limit 1
	`, userID).Scan(&email, &name, &whatsapp)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", nil, ErrNotFound
	}
	if err != nil {
		return "", "", nil, err
	}
	return email, name, textPointer(whatsapp), nil
}

func (repo Repository) activateInvitationForUser(ctx context.Context, invitation invitationRecord, userID string, name string, whatsapp *string) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	userRole := userRoleFromInvitation(invitation.Role)
	memberRole := memberRoleFromInvitation(invitation.Role)

	if _, err := tx.Exec(ctx, `
		insert into public.users (
			id,
			organization_id,
			name,
			email,
			role,
			whatsapp,
			is_active
		)
		values ($1::uuid, $2::uuid, $3, $4, $5, $6, true)
		on conflict (id)
		do update set
			organization_id = coalesce(public.users.organization_id, excluded.organization_id),
			name = coalesce(nullif(public.users.name, ''), excluded.name),
			whatsapp = coalesce(excluded.whatsapp, public.users.whatsapp),
			is_active = true,
			updated_at = now()
	`, userID, invitation.OrganizationID, name, invitation.Email, userRole, whatsapp); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		insert into public.organization_members (
			organization_id,
			user_id,
			role,
			is_active
		)
		values ($1::uuid, $2::uuid, $3, true)
		on conflict (organization_id, user_id)
		do update set
			role = excluded.role,
			is_active = true,
			updated_at = now()
	`, invitation.OrganizationID, userID, memberRole); err != nil {
		return err
	}

	tag, err := tx.Exec(ctx, `
		update public.invitations
		set used_at = now()
		where id = $1::uuid
		  and used_at is null
	`, invitation.ID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}

	return tx.Commit(ctx)
}

func (repo Repository) organizationName(ctx context.Context, organizationID string) (string, error) {
	var name string
	err := repo.db.Pool().QueryRow(ctx, `
		select name
		from public.organizations
		where id = $1::uuid
	`, organizationID).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return name, err
}

func userRoleFromInvitation(role string) string {
	if strings.TrimSpace(role) == "admin" {
		return "admin"
	}
	return "user"
}

func memberRoleFromInvitation(role string) string {
	if strings.TrimSpace(role) == "admin" {
		return "admin"
	}
	return "user"
}

func textPointer(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	cleaned := strings.TrimSpace(value.String)
	if cleaned == "" {
		return nil
	}
	return &cleaned
}
