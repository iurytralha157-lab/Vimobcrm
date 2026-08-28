package users

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/mail"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

const authUserCompensationTimeout = 10 * time.Second

type Repository struct {
	db        *dbpkg.Postgres
	authAdmin authAdminClient
}

type queryRower interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type queryRowExecutor interface {
	queryRower
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

func NewRepository(db *dbpkg.Postgres, authConfig AuthAdminConfig) Repository {
	return Repository{
		db:        db,
		authAdmin: newAuthAdminClient(authConfig),
	}
}

func (repo Repository) ListOrganizationUsers(ctx context.Context, tenantContext tenant.Context, listScope OrganizationUserListScope) ([]User, error) {
	if listScope == OrganizationUserListManagement && !canManageUsers(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	if listScope == OrganizationUserListFilters && !canListInactiveUserFilters(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	includeInactive := listScope != OrganizationUserListActive
	restrictToLedUsers := listScope == OrganizationUserListFilters &&
		!canListAllInactiveUserFilters(tenantContext)

	rows, err := repo.db.Pool().Query(ctx, `
		select
			u.id::text,
			om.organization_id,
			u.name,
			u.email,
			case
			  when u.role = 'super_admin' then 'super_admin'
			  else coalesce(nullif(lower(btrim(om.role)), ''), 'user')
			end,
			u.avatar_url,
			(coalesce(u.is_active, false) and coalesce(om.is_active, false)),
			u.whatsapp,
			u.created_at::text,
			u.updated_at::text
		from public.users u
		join public.organization_members om
		  on om.user_id = u.id
		 and om.organization_id = $1::uuid
		where om.deleted_at is null
		  and (
		    $2::boolean
		    or (
		      coalesce(u.is_active, false) = true
		      and coalesce(om.is_active, false) = true
		    )
		  )
		  and (
		    not $3::boolean
		    or u.id = $4::uuid
		    or u.id::text = any($6::text[])
		    or exists (
		      select 1
		      from public.team_members team_member
		      where team_member.organization_id = $1::uuid
		        and team_member.user_id = u.id
		        and team_member.team_id::text = any($5::text[])
		    )
		    or exists (
		      select 1
		      from public.leads lead
		      where lead.organization_id = $1::uuid
		        and lead.assigned_user_id = u.id
		        and lead.team_id::text = any($5::text[])
		    )
		  )
		order by coalesce(om.is_active, false) desc, u.name asc, u.id asc
	`,
		tenantContext.OrganizationID,
		includeInactive,
		restrictToLedUsers,
		tenantContext.UserID,
		tenantContext.LedTeamIDs,
		tenantContext.LedUserIDs,
	)
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
		select
			om.organization_id::text,
			o.name,
			o.logo_url,
			coalesce(nullif(om.role, ''), 'user'),
			coalesce(om.is_active, false),
			om.joined_at::text,
			om.updated_at::text
		from public.organization_members om
		join public.users u on u.id = om.user_id
		join public.organizations o on o.id = om.organization_id
		where om.user_id = $1::uuid
		  and coalesce(om.is_active, false) = true
		  and om.deleted_at is null
		  and coalesce(u.is_active, false) = true
		  and coalesce(o.is_active, true) = true
		order by o.name asc, om.organization_id
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

	// Internal identities must be created through /v1/invitations so the
	// recipient proves control of the e-mail address and chooses their own
	// password. Keeping this compatibility endpoint closed also prevents an
	// administrator from receiving or forwarding a plaintext temporary secret.
	return CreateUserResult{}, ErrInvitationRequired
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
	currentMemberRole, err := repo.organizationMemberRole(ctx, tenantContext.OrganizationID, userID)
	if err != nil {
		return User{}, err
	}
	if existing.Role == "super_admin" {
		return User{}, tenant.ErrOrganizationAccessDenied
	}
	if !canManageOrganizationMemberRole(tenantContext, currentMemberRole, currentMemberRole) {
		return User{}, tenant.ErrOrganizationAccessDenied
	}
	if userID == tenantContext.UserID {
		if input.IsActive != nil && !*input.IsActive {
			return User{}, ErrInvalidInput
		}
	}
	if isMembershipStatusOnlyUpdate(input) {
		tx, err := repo.db.Pool().Begin(ctx)
		if err != nil {
			return User{}, err
		}
		defer tx.Rollback(ctx)
		if err := lockCanonicalUserAccess(ctx, tx, userID); err != nil {
			return User{}, err
		}

		tag, err := tx.Exec(ctx, `
			update public.organization_members
			set is_active = $3,
			    updated_at = now()
			where organization_id = $1::uuid
			  and user_id = $2::uuid
			  and deleted_at is null
		`, tenantContext.OrganizationID, userID, *input.IsActive)
		if err != nil {
			return User{}, err
		}
		if tag.RowsAffected() == 0 {
			return User{}, ErrUserNotFound
		}
		if err := syncCanonicalUserAccess(ctx, tx, userID, tenantContext.OrganizationID); err != nil {
			return User{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return User{}, err
		}

		return repo.getOrganizationUser(ctx, tenantContext.OrganizationID, userID)
	}

	name := existing.Name
	if input.Name != nil {
		name = strings.TrimSpace(*input.Name)
		if name == "" {
			return User{}, ErrInvalidInput
		}
	}

	memberRole := currentMemberRole
	if input.Role != nil {
		role := normalizeRole(*input.Role)
		if role == "" {
			return User{}, ErrInvalidInput
		}
		desiredMemberRole := memberRoleFromUserRole(role)
		if desiredMemberRole != currentMemberRole {
			if userID == tenantContext.UserID {
				return User{}, ErrInvalidInput
			}
			if !canManageOrganizationMemberRole(tenantContext, currentMemberRole, desiredMemberRole) {
				return User{}, tenant.ErrOrganizationAccessDenied
			}
			memberRole = desiredMemberRole
		}
	}

	isActive := existing.IsActive
	if input.IsActive != nil {
		isActive = *input.IsActive
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return User{}, err
	}
	defer tx.Rollback(ctx)
	if err := lockCanonicalUserAccess(ctx, tx, userID); err != nil {
		return User{}, err
	}

	tag, err := tx.Exec(ctx, `
		update public.users
		set
			name = $3,
			avatar_url = coalesce($4, avatar_url),
			whatsapp = coalesce($5, whatsapp),
			role = case
			  when role = 'super_admin' then role
			  when organization_id = $2::uuid and $6 in ('owner', 'admin') then 'admin'
			  when organization_id = $2::uuid then 'user'
			  else role
			end,
			updated_at = now()
		where id = $1::uuid
		  and exists (
		    select 1
		    from public.organization_members om
		    where om.user_id = public.users.id
		      and om.organization_id = $2::uuid
		      and om.deleted_at is null
		  )
	`, userID, tenantContext.OrganizationID, name, input.AvatarURL, input.Whatsapp, memberRole)
	if err != nil {
		return User{}, err
	}
	if tag.RowsAffected() == 0 {
		return User{}, ErrUserNotFound
	}

	memberTag, err := tx.Exec(ctx, `
		update public.organization_members
		set role = $3,
		    is_active = $4,
		    updated_at = now()
		where organization_id = $1::uuid
		  and user_id = $2::uuid
		  and deleted_at is null
	`, tenantContext.OrganizationID, userID, memberRole, isActive)
	if err != nil {
		return User{}, err
	}
	if memberTag.RowsAffected() == 0 {
		return User{}, ErrUserNotFound
	}
	if err := syncCanonicalUserAccess(ctx, tx, userID, tenantContext.OrganizationID); err != nil {
		return User{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return User{}, err
	}

	return repo.getOrganizationUser(ctx, tenantContext.OrganizationID, userID)
}

func (repo Repository) GetDeleteUserImpact(ctx context.Context, tenantContext tenant.Context, userID string) (DeleteUserImpact, error) {
	if !canManageUsers(tenantContext) {
		return DeleteUserImpact{}, tenant.ErrOrganizationAccessDenied
	}

	userID, ok := normalizeUUID(userID)
	if !ok {
		return DeleteUserImpact{}, ErrInvalidInput
	}

	existing, err := repo.getOrganizationUser(ctx, tenantContext.OrganizationID, userID)
	if err != nil {
		return DeleteUserImpact{}, err
	}
	if existing.Role == "super_admin" {
		return DeleteUserImpact{}, tenant.ErrOrganizationAccessDenied
	}

	return repo.getDeleteUserImpact(ctx, repo.db.Pool(), tenantContext.OrganizationID, userID)
}

func (repo Repository) DeleteOrganizationUser(ctx context.Context, tenantContext tenant.Context, userID string, input DeleteUserInput) (DeleteUserResult, error) {
	if !canManageUsers(tenantContext) {
		return DeleteUserResult{}, tenant.ErrOrganizationAccessDenied
	}

	userID, ok := normalizeUUID(userID)
	if !ok {
		return DeleteUserResult{}, ErrInvalidInput
	}
	if userID == tenantContext.UserID {
		return DeleteUserResult{}, ErrInvalidInput
	}

	existing, err := repo.getOrganizationUser(ctx, tenantContext.OrganizationID, userID)
	if err != nil {
		return DeleteUserResult{}, err
	}
	if existing.Role == "super_admin" {
		return DeleteUserResult{}, tenant.ErrOrganizationAccessDenied
	}
	currentMemberRole, err := repo.organizationMemberRole(ctx, tenantContext.OrganizationID, userID)
	if err != nil {
		return DeleteUserResult{}, err
	}
	if !canManageOrganizationMemberRole(tenantContext, currentMemberRole, currentMemberRole) {
		return DeleteUserResult{}, tenant.ErrOrganizationAccessDenied
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return DeleteUserResult{}, err
	}
	defer tx.Rollback(ctx)
	if err := lockCanonicalUserAccess(ctx, tx, userID); err != nil {
		return DeleteUserResult{}, err
	}

	impact, err := repo.getDeleteUserImpact(ctx, tx, tenantContext.OrganizationID, userID)
	if err != nil {
		return DeleteUserResult{}, err
	}

	if impact.Leads > 0 {
		targetID, err := repo.normalizeTransferTarget(ctx, tenantContext.OrganizationID, userID, input.TransferLeadsToUserID)
		if err != nil {
			return DeleteUserResult{}, err
		}
		if _, err := tx.Exec(ctx, `
			update public.leads
			set assigned_user_id = $3::uuid,
			    updated_at = now()
			where organization_id = $1::uuid
			  and assigned_user_id = $2::uuid
		`, tenantContext.OrganizationID, userID, targetID); err != nil {
			return DeleteUserResult{}, err
		}
	}

	if impact.Properties > 0 {
		targetID, err := repo.normalizeTransferTarget(ctx, tenantContext.OrganizationID, userID, input.TransferPropertiesToUserID)
		if err != nil {
			return DeleteUserResult{}, err
		}
		if _, err := tx.Exec(ctx, `
			update public.properties
			set responsible_user_id = $3::uuid,
			    cadastrado_por = $3::uuid,
			    updated_at = now()
			where organization_id = $1::uuid
			  and (
			    responsible_user_id = $2::uuid
			    or (responsible_user_id is null and created_by = $2::uuid)
			  )
		`, tenantContext.OrganizationID, userID, targetID); err != nil {
			return DeleteUserResult{}, err
		}
	}

	if impact.WhatsAppSessions > 0 {
		if _, err := tx.Exec(ctx, `
			update public.whatsapp_sessions
			set status = 'disconnected',
			    is_active = false,
			    is_notification_session = false,
			    updated_at = now()
			where organization_id = $1::uuid
			  and owner_user_id = $2::uuid
			  and coalesce(status, '') <> 'deleted'
		`, tenantContext.OrganizationID, userID); err != nil {
			return DeleteUserResult{}, err
		}
	}

	if _, err := tx.Exec(ctx, `
		update public.organization_members
		set is_active = false,
		    deleted_at = now(),
		    updated_at = now()
		where organization_id = $1::uuid
		  and user_id = $2::uuid
	`, tenantContext.OrganizationID, userID); err != nil {
		return DeleteUserResult{}, err
	}

	if err := syncCanonicalUserAccess(ctx, tx, userID, tenantContext.OrganizationID); err != nil {
		return DeleteUserResult{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return DeleteUserResult{}, err
	}

	return DeleteUserResult{Success: true, Impact: impact}, nil
}

func (repo Repository) getDeleteUserImpact(ctx context.Context, runner queryRower, organizationID string, userID string) (DeleteUserImpact, error) {
	var impact DeleteUserImpact
	err := runner.QueryRow(ctx, `
		select
			(
				select count(*)
				from public.leads
				where organization_id = $1::uuid
				  and assigned_user_id = $2::uuid
			) as leads,
			(
				select count(*)
				from public.properties
				where organization_id = $1::uuid
				  and (
				    responsible_user_id = $2::uuid
				    or (responsible_user_id is null and created_by = $2::uuid)
				  )
			) as properties,
			(
				select count(*)
				from public.whatsapp_sessions
				where organization_id = $1::uuid
				  and owner_user_id = $2::uuid
				  and coalesce(is_active, true) = true
				  and coalesce(status, '') <> 'deleted'
			) as whatsapp_sessions
	`, organizationID, userID).Scan(&impact.Leads, &impact.Properties, &impact.WhatsAppSessions)
	if err != nil {
		return DeleteUserImpact{}, err
	}

	return impact, nil
}

func (repo Repository) normalizeTransferTarget(ctx context.Context, organizationID string, sourceUserID string, value *string) (string, error) {
	if value == nil {
		return "", ErrInvalidInput
	}
	targetID, ok := normalizeUUID(*value)
	if !ok || targetID == sourceUserID {
		return "", ErrInvalidInput
	}

	target, err := repo.getOrganizationUser(ctx, organizationID, targetID)
	if err != nil {
		return "", err
	}
	if target.Role == "super_admin" || !target.IsActive {
		return "", ErrInvalidInput
	}

	return targetID, nil
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
		join public.organization_members om
		  on om.user_id = u.id
		 and om.organization_id = $1::uuid
		 and om.is_active = true
		 and om.deleted_at is null
		where u.id in (`+strings.Join(placeholders, ", ")+`)
		  and coalesce(u.is_active, false) = true
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
			app_user.id::text,
			app_user.organization_id,
			app_user.name,
			auth_user.email,
			app_user.role,
			app_user.avatar_url,
			coalesce(app_user.is_active, false),
			app_user.whatsapp,
			app_user.created_at::text,
			app_user.updated_at::text
		from auth.users auth_user
		join public.users app_user on app_user.id = auth_user.id
		where lower(auth_user.email) = lower($1)
		  and auth_user.deleted_at is null
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
			om.organization_id,
			u.name,
			u.email,
			case
			  when u.role = 'super_admin' then 'super_admin'
			  else coalesce(nullif(lower(btrim(om.role)), ''), 'user')
			end,
			u.avatar_url,
			(coalesce(u.is_active, false) and coalesce(om.is_active, false)),
			u.whatsapp,
			u.created_at::text,
			u.updated_at::text
		from public.users u
		join public.organization_members om
		  on om.user_id = u.id
		 and om.organization_id = $1::uuid
		where u.id = $2::uuid
		  and om.deleted_at is null
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

func (repo Repository) organizationMemberRole(ctx context.Context, organizationID string, userID string) (string, error) {
	var role string
	err := repo.db.Pool().QueryRow(ctx, `
		select coalesce(nullif(lower(btrim(role)), ''), 'user')
		from public.organization_members
		where organization_id = $1::uuid
		  and user_id = $2::uuid
		  and deleted_at is null
		limit 1
	`, organizationID, userID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrUserNotFound
	}
	return role, err
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
			deleted_at = null,
			updated_at = now()
	`, tenantContext.OrganizationID, existing.ID, memberRoleFromUserRole(input.Role)); err != nil {
		return User{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return User{}, err
	}

	return repo.getOrganizationUser(ctx, tenantContext.OrganizationID, existing.ID)
}

func (repo Repository) insertNewUser(ctx context.Context, tenantContext tenant.Context, authUserID string, input CreateUserInput) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
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
		values ($1::uuid, $2::uuid, $3, $4, 'user', $5, true)
		on conflict (id)
		do update set
			organization_id = excluded.organization_id,
			name = excluded.name,
			email = excluded.email,
			role = case when public.users.role = 'super_admin' then public.users.role else 'user' end,
			whatsapp = excluded.whatsapp,
			is_active = true,
			updated_at = now()
	`, authUserID, tenantContext.OrganizationID, input.Name, input.Email, firstNonNilString(input.Whatsapp, input.Phone)); err != nil {
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
			deleted_at = null,
			updated_at = now()
	`, tenantContext.OrganizationID, authUserID, memberRoleFromUserRole(input.Role)); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}

	return nil
}

func persistCreatedAuthUser(
	ctx context.Context,
	authUserID string,
	persist func(context.Context) error,
	deleteAuthUser func(context.Context, string) error,
) error {
	persistErr := persist(ctx)
	if persistErr == nil {
		return nil
	}

	cleanupContext, cancel := context.WithTimeout(context.WithoutCancel(ctx), authUserCompensationTimeout)
	defer cancel()

	if cleanupErr := deleteAuthUser(cleanupContext, authUserID); cleanupErr != nil {
		slog.Error(
			"failed to compensate auth user after database persistence failure",
			"auth_user_id", authUserID,
			"cleanup_error", cleanupErr,
			"persistence_error", persistErr,
		)
	}

	return persistErr
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
		Name:      cleanStringPointer(request.Updates.Name),
		IsActive:  request.Updates.IsActive,
		AvatarURL: cleanStringPointer(request.Updates.AvatarURL),
		Whatsapp:  cleanStringPointer(request.Updates.Whatsapp),
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

func normalizeDeleteUserInput(request DeleteUserRequest) (DeleteUserInput, error) {
	return DeleteUserInput{
		TransferLeadsToUserID:      cleanStringPointer(request.TransferLeadsToUserID),
		TransferPropertiesToUserID: cleanStringPointer(request.TransferPropertiesToUserID),
	}, nil
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
	case "manager":
		return "manager"
	default:
		return ""
	}
}

func memberRoleFromUserRole(value string) string {
	switch normalizeRole(value) {
	case "admin":
		return "admin"
	case "manager":
		return "manager"
	default:
		return "user"
	}
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
	return tenantContext.HasPermission(permissions.UsersManage)
}

func canManageOrganizationMemberRole(tenantContext tenant.Context, currentRole string, desiredRole string) bool {
	if tenantContext.IsSuperAdmin {
		return true
	}

	actorRank := organizationMemberRoleRank(tenantContext.MemberRole)
	currentRank := organizationMemberRoleRank(currentRole)
	desiredRank := organizationMemberRoleRank(desiredRole)
	if actorRank < 0 || currentRank < 0 || desiredRank < 0 || currentRank > actorRank || desiredRank > actorRank {
		return false
	}

	if currentRank >= organizationMemberRoleRank("manager") || desiredRank >= organizationMemberRoleRank("manager") {
		return tenantContext.HasRole("owner", "admin") &&
			tenantContext.HasPermission(permissions.PermissionsManage)
	}

	return true
}

func organizationMemberRoleRank(role string) int {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "owner":
		return 3
	case "admin":
		return 2
	case "manager":
		return 1
	case "user":
		return 0
	default:
		return -1
	}
}

func canListInactiveUserFilters(tenantContext tenant.Context) bool {
	return tenantContext.HasPermission(permissions.LeadViewAll) ||
		tenantContext.HasPermission(permissions.LeadViewTeam) ||
		tenantContext.HasPermission(permissions.PropertyView)
}

func canListAllInactiveUserFilters(tenantContext tenant.Context) bool {
	return canManageUsers(tenantContext) ||
		tenantContext.HasPermission(permissions.LeadViewAll) ||
		tenantContext.HasPermission(permissions.PropertyView)
}

func lockCanonicalUserAccess(ctx context.Context, runner queryRower, userID string) error {
	var lockedUserID string
	err := runner.QueryRow(ctx, `
		select id::text
		from public.users
		where id = $1::uuid
		for update
	`, userID).Scan(&lockedUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrUserNotFound
	}
	return err
}

func syncCanonicalUserAccess(
	ctx context.Context,
	runner queryRowExecutor,
	userID string,
	preferredOrganizationID string,
) error {
	_, err := runner.Exec(ctx, `
		with selected_membership as (
			select
				membership.organization_id,
				membership.role
			from public.organization_members membership
			join public.users current_user on current_user.id = membership.user_id
			join public.organizations organization on organization.id = membership.organization_id
			where membership.user_id = $1::uuid
			  and membership.is_active = true
			  and membership.deleted_at is null
			  and coalesce(organization.is_active, true) = true
			order by
				(membership.organization_id = current_user.organization_id) desc,
				(membership.organization_id = $2::uuid) desc,
				membership.updated_at desc,
				membership.organization_id
			limit 1
		), selected_state as (
			select organization_id, role
			from selected_membership
			union all
			select null::uuid, 'user'::text
			where not exists (select 1 from selected_membership)
		)
		update public.users target_user
		set
			organization_id = selected_state.organization_id,
			is_active = selected_state.organization_id is not null,
			role = case
				when target_user.role = 'super_admin' then target_user.role
				when selected_state.role in ('owner', 'admin') then 'admin'
				else 'user'
			end,
			updated_at = now()
		from selected_state
		where target_user.id = $1::uuid
	`, userID, preferredOrganizationID)
	return err
}

func isMembershipStatusOnlyUpdate(input UpdateUserInput) bool {
	return input.IsActive != nil && input.Name == nil && input.Role == nil && input.AvatarURL == nil && input.Whatsapp == nil
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
