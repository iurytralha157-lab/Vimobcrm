package users

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db        *dbpkg.Postgres
	authAdmin authAdminClient
}

func NewRepository(db *dbpkg.Postgres, authConfig AuthAdminConfig) Repository {
	return Repository{
		db:        db,
		authAdmin: newAuthAdminClient(authConfig),
	}
}

func (repo Repository) ListOrganizationUsers(ctx context.Context, tenantContext tenant.Context) ([]User, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select distinct on (u.id)
			u.id::text,
			u.organization_id,
			u.name,
			u.email,
			u.role,
			u.avatar_url,
			coalesce(u.is_active, false),
			u.whatsapp,
			u.created_at::text,
			u.updated_at::text
		from public.users u
		left join public.organization_members om
		  on om.user_id = u.id
		 and om.organization_id = $1::uuid
		where (u.organization_id = $1::uuid or om.id is not null)
		  and coalesce(u.is_active, false) = true
		order by u.id, u.name
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	users := []User{}
	for rows.Next() {
		user, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		users = append(users, user)
	}

	return users, rows.Err()
}

func (repo Repository) ListUserOrganizations(ctx context.Context, userID string) ([]UserOrganization, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		with memberships as (
			select
				om.organization_id,
				coalesce(nullif(om.role, ''), 'user') as role,
				coalesce(om.is_active, false) as is_active,
				om.joined_at,
				om.updated_at
			from public.organization_members om
			where om.user_id = $1::uuid
			  and coalesce(om.is_active, false) = true
			union
			select
				u.organization_id,
				coalesce(nullif(u.role, ''), 'user') as role,
				coalesce(u.is_active, false) as is_active,
				u.created_at as joined_at,
				u.updated_at
			from public.users u
			where u.id = $1::uuid
			  and u.organization_id is not null
			  and coalesce(u.is_active, false) = true
		)
		select distinct on (m.organization_id)
			m.organization_id::text,
			o.name,
			o.logo_url,
			m.role,
			m.is_active,
			m.joined_at::text,
			m.updated_at::text
		from memberships m
		join public.organizations o on o.id = m.organization_id
		where coalesce(o.is_active, true) = true
		order by m.organization_id, o.name asc
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []UserOrganization{}
	for rows.Next() {
		var item UserOrganization
		var logoURL, lastAccessedAt pgtype.Text
		if err := rows.Scan(
			&item.OrganizationID,
			&item.OrganizationName,
			&logoURL,
			&item.MemberRole,
			&item.IsActive,
			&item.JoinedAt,
			&lastAccessedAt,
		); err != nil {
			return nil, err
		}
		item.OrganizationLogo = textPointer(logoURL)
		item.LastAccessedAt = textPointer(lastAccessedAt)
		items = append(items, item)
	}

	return items, rows.Err()
}

func (repo Repository) CreateOrganizationUser(ctx context.Context, tenantContext tenant.Context, input CreateUserInput) (CreateUserResult, error) {
	if !canManageUsers(tenantContext) {
		return CreateUserResult{}, tenant.ErrOrganizationAccessDenied
	}

	input.Role = normalizeRole(input.Role)
	existing, err := repo.findUserByEmail(ctx, input.Email)
	if err == nil {
		user, linkErr := repo.linkExistingUser(ctx, tenantContext, existing, input)
		if linkErr != nil {
			return CreateUserResult{}, linkErr
		}

		wasMultiOrg, wasOrphan := false, existing.OrganizationID == nil
		if existing.OrganizationID != nil && *existing.OrganizationID != tenantContext.OrganizationID {
			wasMultiOrg = true
		}

		return CreateUserResult{
			Success:     true,
			User:        user,
			WasMultiOrg: wasMultiOrg,
			WasOrphan:   wasOrphan,
			Message:     "Usuario vinculado a organizacao.",
		}, nil
	}
	if !errors.Is(err, ErrUserNotFound) {
		return CreateUserResult{}, err
	}

	password, err := generateTemporaryPassword()
	if err != nil {
		return CreateUserResult{}, err
	}

	authUserID, err := repo.authAdmin.createUser(ctx, authAdminCreateUserInput{
		Email:    input.Email,
		Password: password,
		Name:     input.Name,
	})
	if err != nil {
		return CreateUserResult{}, err
	}

	user, err := repo.insertNewUser(ctx, tenantContext, authUserID, input)
	if err != nil {
		return CreateUserResult{}, err
	}

	return CreateUserResult{
		Success:           true,
		User:              user,
		GeneratedPassword: &password,
		WhatsappSent:      false,
		Message:           "Usuario criado. Envie a senha temporaria ao usuario.",
	}, nil
}

func (repo Repository) UpdateOrganizationUser(ctx context.Context, tenantContext tenant.Context, userID string, input UpdateUserInput) (User, error) {
	if !canManageUsers(tenantContext) {
		return User{}, tenant.ErrOrganizationAccessDenied
	}

	userID, ok := normalizeUUID(userID)
	if !ok {
		return User{}, ErrInvalidInput
	}

	existing, err := repo.getOrganizationUser(ctx, tenantContext.OrganizationID, userID)
	if err != nil {
		return User{}, err
	}
	if existing.Role == "super_admin" {
		return User{}, tenant.ErrOrganizationAccessDenied
	}
	if userID == tenantContext.UserID {
		if input.IsActive != nil && !*input.IsActive {
			return User{}, ErrInvalidInput
		}
		if input.Role != nil && normalizeRole(*input.Role) != existing.Role {
			return User{}, ErrInvalidInput
		}
	}

	name := existing.Name
	if input.Name != nil {
		name = strings.TrimSpace(*input.Name)
		if name == "" {
			return User{}, ErrInvalidInput
		}
	}

	role := existing.Role
	if input.Role != nil {
		role = normalizeRole(*input.Role)
		if role == "" {
			return User{}, ErrInvalidInput
		}
	}

	isActive := existing.IsActive
	if input.IsActive != nil {
		isActive = *input.IsActive
	}

	user, err := scanUser(repo.db.Pool().QueryRow(ctx, `
		update public.users
		set
			name = $3,
			role = $4,
			is_active = $5,
			avatar_url = coalesce($6, avatar_url),
			whatsapp = coalesce($7, whatsapp),
			updated_at = now()
		where id = $1::uuid
		  and exists (
		    select 1
		    from public.organization_members om
		    where om.user_id = public.users.id
		      and om.organization_id = $2::uuid
		  )
		returning
			id::text,
			organization_id,
			name,
			email,
			role,
			avatar_url,
			coalesce(is_active, false),
			whatsapp,
			created_at::text,
			updated_at::text
	`, userID, tenantContext.OrganizationID, name, role, isActive, input.AvatarURL, input.Whatsapp))
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrUserNotFound
	}
	if err != nil {
		return User{}, err
	}

	memberRole := memberRoleFromUserRole(role)
	_, err = repo.db.Pool().Exec(ctx, `
		update public.organization_members
		set role = $3,
		    is_active = $4,
		    updated_at = now()
		where organization_id = $1::uuid
		  and user_id = $2::uuid
	`, tenantContext.OrganizationID, userID, memberRole, isActive)
	if err != nil {
		return User{}, err
	}

	return user, nil
}

func (repo Repository) DeleteOrganizationUser(ctx context.Context, tenantContext tenant.Context, userID string) error {
	if !canManageUsers(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}

	userID, ok := normalizeUUID(userID)
	if !ok {
		return ErrInvalidInput
	}
	if userID == tenantContext.UserID {
		return ErrInvalidInput
	}

	existing, err := repo.getOrganizationUser(ctx, tenantContext.OrganizationID, userID)
	if err != nil {
		return err
	}
	if existing.Role == "super_admin" {
		return tenant.ErrOrganizationAccessDenied
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		update public.organization_members
		set is_active = false,
		    updated_at = now()
		where organization_id = $1::uuid
		  and user_id = $2::uuid
	`, tenantContext.OrganizationID, userID); err != nil {
		return err
	}

	var fallbackOrganizationID pgtype.UUID
	err = tx.QueryRow(ctx, `
		select organization_id
		from public.organization_members
		where user_id = $1::uuid
		  and organization_id <> $2::uuid
		  and is_active = true
		order by updated_at desc
		limit 1
	`, userID, tenantContext.OrganizationID).Scan(&fallbackOrganizationID)
	if errors.Is(err, pgx.ErrNoRows) {
		_, err = tx.Exec(ctx, `
			update public.users
			set is_active = false,
			    updated_at = now()
			where id = $1::uuid
		`, userID)
	} else if err == nil {
		_, err = tx.Exec(ctx, `
			update public.users
			set organization_id = $2::uuid,
			    updated_at = now()
			where id = $1::uuid
			  and organization_id = $3::uuid
		`, userID, fallbackOrganizationID.String(), tenantContext.OrganizationID)
	}
	if err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (repo Repository) ListSummaries(ctx context.Context, tenantContext tenant.Context, userIDs []string) ([]Summary, error) {
	userIDs = normalizeUserIDs(userIDs)
	if len(userIDs) == 0 {
		return []Summary{}, nil
	}

	args := make([]any, 0, len(userIDs)+1)
	args = append(args, tenantContext.OrganizationID)
	placeholders := make([]string, 0, len(userIDs))
	for index, id := range userIDs {
		args = append(args, id)
		placeholders = append(placeholders, fmt.Sprintf("$%d::uuid", index+2))
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			u.id::text,
			u.name,
			u.avatar_url
		from public.users u
		left join public.organization_members om
		  on om.user_id = u.id
		 and om.organization_id = $1::uuid
		 and om.is_active = true
		where u.id in (`+strings.Join(placeholders, ", ")+`)
		  and (
		    u.organization_id = $1::uuid
		    or om.id is not null
		  )
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	summaries := []Summary{}
	for rows.Next() {
		var summary Summary
		var name, avatarURL pgtype.Text
		if err := rows.Scan(&summary.ID, &name, &avatarURL); err != nil {
			return nil, err
		}
		summary.Name = textPointer(name)
		summary.AvatarURL = textPointer(avatarURL)
		summaries = append(summaries, summary)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return summaries, nil
}

func (repo Repository) findUserByEmail(ctx context.Context, email string) (User, error) {
	user, err := scanUser(repo.db.Pool().QueryRow(ctx, `
		select
			id::text,
			organization_id,
			name,
			email,
			role,
			avatar_url,
			coalesce(is_active, false),
			whatsapp,
			created_at::text,
			updated_at::text
		from public.users
		where lower(email) = lower($1)
		limit 1
	`, email))
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrUserNotFound
	}
	if err != nil {
		return User{}, err
	}

	return user, nil
}

func (repo Repository) getOrganizationUser(ctx context.Context, organizationID string, userID string) (User, error) {
	user, err := scanUser(repo.db.Pool().QueryRow(ctx, `
		select
			u.id::text,
			u.organization_id,
			u.name,
			u.email,
			u.role,
			u.avatar_url,
			coalesce(u.is_active, false),
			u.whatsapp,
			u.created_at::text,
			u.updated_at::text
		from public.users u
		left join public.organization_members om
		  on om.user_id = u.id
		 and om.organization_id = $1::uuid
		 and om.is_active = true
		where u.id = $2::uuid
		  and (u.organization_id = $1::uuid or om.id is not null)
		limit 1
	`, organizationID, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrUserNotFound
	}
	if err != nil {
		return User{}, err
	}

	return user, nil
}

func (repo Repository) linkExistingUser(ctx context.Context, tenantContext tenant.Context, existing User, input CreateUserInput) (User, error) {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return User{}, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		update public.users
		set organization_id = coalesce(organization_id, $2::uuid),
		    is_active = true,
		    whatsapp = coalesce($3, whatsapp),
		    updated_at = now()
		where id = $1::uuid
	`, existing.ID, tenantContext.OrganizationID, firstNonNilString(input.Whatsapp, input.Phone)); err != nil {
		return User{}, err
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
	`, tenantContext.OrganizationID, existing.ID, memberRoleFromUserRole(input.Role)); err != nil {
		return User{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return User{}, err
	}

	return repo.getOrganizationUser(ctx, tenantContext.OrganizationID, existing.ID)
}

func (repo Repository) insertNewUser(ctx context.Context, tenantContext tenant.Context, authUserID string, input CreateUserInput) (User, error) {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return User{}, err
	}
	defer tx.Rollback(ctx)

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
	`, authUserID, tenantContext.OrganizationID, input.Name, input.Email, input.Role, firstNonNilString(input.Whatsapp, input.Phone)); err != nil {
		return User{}, err
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
	`, tenantContext.OrganizationID, authUserID, memberRoleFromUserRole(input.Role)); err != nil {
		return User{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return User{}, err
	}

	return repo.getOrganizationUser(ctx, tenantContext.OrganizationID, authUserID)
}

type userScanner interface {
	Scan(dest ...any) error
}

func scanUser(row userScanner) (User, error) {
	var user User
	var organizationID pgtype.UUID
	var avatarURL, whatsapp pgtype.Text

	err := row.Scan(
		&user.ID,
		&organizationID,
		&user.Name,
		&user.Email,
		&user.Role,
		&avatarURL,
		&user.IsActive,
		&whatsapp,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if err != nil {
		return User{}, err
	}

	if organizationID.Valid {
		value := organizationID.String()
		user.OrganizationID = &value
	}
	user.AvatarURL = textPointer(avatarURL)
	user.Whatsapp = textPointer(whatsapp)

	return user, nil
}

func normalizeCreateUserInput(request CreateUserRequest) (CreateUserInput, error) {
	name := strings.TrimSpace(request.Name)
	if name == "" {
		return CreateUserInput{}, ErrInvalidInput
	}

	email, err := normalizeEmail(request.Email)
	if err != nil {
		return CreateUserInput{}, err
	}

	role := normalizeRole(request.Role)
	if role == "" {
		return CreateUserInput{}, ErrInvalidInput
	}

	return CreateUserInput{
		Name:     name,
		Email:    email,
		Phone:    cleanStringPointer(request.Phone),
		Whatsapp: cleanStringPointer(request.Whatsapp),
		Endereco: cleanStringPointer(request.Endereco),
		Role:     role,
	}, nil
}

func normalizeUpdateUserInput(request UpdateUserRequest) (UpdateUserInput, error) {
	input := UpdateUserInput{
		Name:     cleanStringPointer(request.Updates.Name),
		IsActive: request.Updates.IsActive,
		AvatarURL: cleanStringPointer(request.Updates.AvatarURL),
		Whatsapp: cleanStringPointer(request.Updates.Whatsapp),
	}
	if request.Updates.Role != nil {
		role := normalizeRole(*request.Updates.Role)
		if role == "" {
			return UpdateUserInput{}, ErrInvalidInput
		}
		input.Role = &role
	}

	return input, nil
}

func normalizeEmail(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	parsed, err := mail.ParseAddress(value)
	if err != nil || parsed.Address != value {
		return "", ErrInvalidInput
	}

	return value, nil
}

func normalizeRole(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "user":
		return "user"
	case "admin":
		return "admin"
	default:
		return ""
	}
}

func memberRoleFromUserRole(value string) string {
	if normalizeRole(value) == "admin" {
		return "admin"
	}

	return "user"
}

func cleanStringPointer(value *string) *string {
	if value == nil {
		return nil
	}
	cleaned := strings.TrimSpace(*value)
	if cleaned == "" {
		return nil
	}

	return &cleaned
}

func firstNonNilString(values ...*string) *string {
	for _, value := range values {
		if value != nil && strings.TrimSpace(*value) != "" {
			cleaned := strings.TrimSpace(*value)
			return &cleaned
		}
	}

	return nil
}

func canManageUsers(tenantContext tenant.Context) bool {
	return tenantContext.HasPermission("users_manage") || tenantContext.HasPermission("settings_manage")
}

func normalizeUserIDs(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		normalized, ok := normalizeUUID(value)
		if !ok {
			continue
		}
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		out = append(out, normalized)
	}

	return out
}

func normalizeUUID(value string) (string, bool) {
	var uuid pgtype.UUID
	if err := uuid.Scan(strings.TrimSpace(value)); err != nil {
		return "", false
	}
	if !uuid.Valid {
		return "", false
	}

	return uuid.String(), true
}

func textPointer(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}

	return &value.String
}
