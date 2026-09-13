package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/netip"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/passwordpolicy"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/pgvalue"
)

const invitationAuthCleanupTimeout = 10 * time.Second

var (
	invitationDefaultTermsVersion   = currentTermsVersion
	invitationDefaultPrivacyVersion = currentPrivacyVersion
)

var errInvitationActivationCommitUnknown = errors.New("invitation activation commit outcome is unknown")

type invitationRecord struct {
	ID               string
	Email            string
	Role             string
	OrganizationID   string
	OrganizationName string
	TokenHash        string
	UsedAt           pgtype.Timestamptz
}

type invitationLegalConsent struct {
	TermsVersion    string
	PrivacyVersion  string
	IPAddress       string
	UserAgent       string
	TermsAccepted   bool
	PrivacyAccepted bool
}

type invitationActivationEvidence struct {
	AuthUserExists      bool
	InvitationUsed      bool
	MembershipExists    bool
	PublicProfileExists bool
	LegalConsentExists  bool
}

func (evidence invitationActivationEvidence) committed() bool {
	return evidence.AuthUserExists &&
		evidence.InvitationUsed &&
		evidence.MembershipExists &&
		evidence.PublicProfileExists &&
		evidence.LegalConsentExists
}

func (evidence invitationActivationEvidence) hasNoActivationFootprint() bool {
	return !evidence.InvitationUsed &&
		!evidence.MembershipExists &&
		!evidence.PublicProfileExists &&
		!evidence.LegalConsentExists
}

type invitationConsentExecutor interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func (repo Repository) AcceptInvitationPublic(ctx context.Context, token string, request AcceptInvitationRequest) (AcceptInvitationResult, error) {
	invitation, err := repo.invitationByTokenForAccept(ctx, token)
	if err != nil {
		return AcceptInvitationResult{}, err
	}

	existingUserID, err := repo.userIDByEmail(ctx, invitation.Email)
	if err == nil && existingUserID != "" {
		if invitation.UsedAt.Valid {
			return repo.committedInvitationAcceptance(ctx, invitation, existingUserID, true)
		}
		return AcceptInvitationResult{
			Success:          false,
			RequiresLogin:    true,
			ExistingAccount:  true,
			Email:            invitation.Email,
			OrganizationID:   invitation.OrganizationID,
			OrganizationName: invitation.OrganizationName,
			Message:          "Este e-mail ja possui uma conta. Entre para aceitar o convite.",
		}, nil
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return AcceptInvitationResult{}, err
	}
	if invitation.UsedAt.Valid {
		return AcceptInvitationResult{}, ErrNotFound
	}

	name := strings.TrimSpace(request.Name)
	password := request.Password
	if !isValidInvitationName(name) ||
		!passwordpolicy.IsStrong(password) ||
		!isValidInvitationWhatsApp(request.Whatsapp) ||
		!request.TermsAccepted ||
		!request.PrivacyAccepted {
		return AcceptInvitationResult{}, ErrInvalidInput
	}
	consent, err := invitationLegalConsentFromRequest(request)
	if err != nil {
		return AcceptInvitationResult{}, err
	}

	authUserID, err := repo.createAuthUser(ctx, invitation.Email, password, name)
	if err != nil {
		if isAuthUserAlreadyExistsError(err) {
			return AcceptInvitationResult{
				Success:          false,
				RequiresLogin:    true,
				ExistingAccount:  true,
				Email:            invitation.Email,
				OrganizationID:   invitation.OrganizationID,
				OrganizationName: invitation.OrganizationName,
				Message:          "Este e-mail ja possui uma conta. Entre para aceitar o convite.",
			}, nil
		}
		return AcceptInvitationResult{}, err
	}

	if err := runInvitationActivationForNewAuthUser(
		ctx,
		authUserID,
		func(activationContext context.Context) error {
			return repo.activateInvitationForUser(
				activationContext,
				invitation,
				authUserID,
				name,
				cleanString(request.Whatsapp),
				&consent,
			)
		},
		func(reconcileContext context.Context) (invitationActivationEvidence, error) {
			return repo.reconcileInvitationActivation(
				reconcileContext,
				invitation,
				authUserID,
			)
		},
	); err != nil {
		return AcceptInvitationResult{}, err
	}

	return AcceptInvitationResult{
		Success:          true,
		RequiresLogin:    false,
		ExistingAccount:  false,
		Email:            invitation.Email,
		OrganizationID:   invitation.OrganizationID,
		OrganizationName: invitation.OrganizationName,
		Message:          "Convite aceito com sucesso.",
		TargetUserID:     authUserID,
		AcceptedNow:      true,
	}, nil
}

func (repo Repository) AcceptInvitationAuthenticated(
	ctx context.Context,
	userID string,
	token string,
	request AcceptInvitationRequest,
) (AcceptInvitationResult, error) {
	userID, ok := normalizeUUID(userID)
	if !ok {
		return AcceptInvitationResult{}, ErrInvalidInput
	}
	consent, err := invitationLegalConsentFromRequest(request)
	if err != nil {
		return AcceptInvitationResult{}, err
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
	if invitation.UsedAt.Valid {
		return repo.committedInvitationAcceptance(ctx, invitation, userID, true)
	}

	if err := repo.activateInvitationForUser(ctx, invitation, userID, name, whatsapp, &consent); err != nil {
		if errors.Is(err, ErrNotFound) {
			return repo.committedInvitationAcceptance(ctx, invitation, userID, true)
		}
		return AcceptInvitationResult{}, err
	}

	return AcceptInvitationResult{
		Success:          true,
		RequiresLogin:    false,
		ExistingAccount:  true,
		Email:            invitation.Email,
		OrganizationID:   invitation.OrganizationID,
		OrganizationName: invitation.OrganizationName,
		Message:          "Voce entrou na organizacao.",
		TargetUserID:     userID,
		AcceptedNow:      true,
	}, nil
}

func (repo Repository) committedInvitationAcceptance(
	ctx context.Context,
	invitation invitationRecord,
	userID string,
	existingAccount bool,
) (AcceptInvitationResult, error) {
	evidence, err := repo.reconcileInvitationActivation(ctx, invitation, userID)
	if err != nil {
		return AcceptInvitationResult{}, err
	}
	if !evidence.committed() {
		return AcceptInvitationResult{}, ErrNotFound
	}

	return AcceptInvitationResult{
		Success:          true,
		RequiresLogin:    false,
		ExistingAccount:  existingAccount,
		Email:            invitation.Email,
		OrganizationID:   invitation.OrganizationID,
		OrganizationName: invitation.OrganizationName,
		Message:          "Convite ja havia sido aceito.",
		TargetUserID:     userID,
	}, nil
}

func (repo Repository) invitationByTokenForAccept(ctx context.Context, token string) (invitationRecord, error) {
	token, ok := normalizeInvitationToken(token)
	if !ok {
		return invitationRecord{}, ErrInvalidInput
	}
	tokenHash := invitationTokenHash(token)

	var item invitationRecord
	var email pgtype.Text
	err := repo.db.Pool().QueryRow(ctx, `
		select
			i.id::text,
			i.email,
			coalesce(nullif(i.role, ''), 'user'),
			i.organization_id::text,
			o.name,
			i.used_at
		from public.invitations i
		join public.organizations o on o.id = i.organization_id
		where i.token_hash = $1
		  and i.expires_at > now()
		limit 1
	`, tokenHash).Scan(
		&item.ID,
		&email,
		&item.Role,
		&item.OrganizationID,
		&item.OrganizationName,
		&item.UsedAt,
	)
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
	item.TokenHash = tokenHash
	return item, nil
}

func (repo Repository) userIDByEmail(ctx context.Context, email string) (string, error) {
	var userID string
	err := repo.db.Pool().QueryRow(ctx, `
		select auth_user.id::text
		from auth.users auth_user
		where lower(auth_user.email) = lower($1)
		  and auth_user.deleted_at is null
		limit 1
	`, email).Scan(&userID)
	return userID, err
}

func (repo Repository) userIdentity(ctx context.Context, userID string) (string, string, *string, error) {
	var email, name string
	var whatsapp pgtype.Text
	err := repo.db.Pool().QueryRow(ctx, `
		select
			auth_user.email,
			coalesce(
				nullif(btrim(app_user.name), ''),
				nullif(btrim(auth_user.raw_user_meta_data ->> 'name'), ''),
				split_part(auth_user.email, '@', 1)
			),
			app_user.whatsapp
		from auth.users auth_user
		left join public.users app_user on app_user.id = auth_user.id
		where auth_user.id = $1::uuid
		  and auth_user.deleted_at is null
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

func (repo Repository) activateInvitationForUser(
	ctx context.Context,
	invitation invitationRecord,
	userID string,
	name string,
	whatsapp *string,
	consent *invitationLegalConsent,
) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	persistedRole, err := claimInvitationForActivation(ctx, tx, invitation)
	if err != nil {
		return err
	}
	invitation.Role = persistedRole
	memberRole := memberRoleFromInvitation(persistedRole)

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
			organization_id = coalesce(public.users.organization_id, excluded.organization_id),
			name = coalesce(nullif(public.users.name, ''), excluded.name),
			role = case when public.users.role = 'super_admin' then public.users.role else 'user' end,
			whatsapp = coalesce(excluded.whatsapp, public.users.whatsapp),
			is_active = true,
			updated_at = now()
	`, userID, invitation.OrganizationID, name, invitation.Email, whatsapp); err != nil {
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
			role = case
				when public.organization_members.is_active = true
				 and public.organization_members.deleted_at is null
				then public.organization_members.role
				else excluded.role
			end,
			is_active = true,
			deleted_at = null,
			updated_at = now()
	`, invitation.OrganizationID, userID, memberRole); err != nil {
		return err
	}

	if consent != nil {
		if err := insertInvitationLegalConsent(
			ctx,
			tx,
			invitation,
			userID,
			*consent,
		); err != nil {
			return err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return errors.Join(
			errInvitationActivationCommitUnknown,
			fmt.Errorf("commit invitation activation: %w", err),
		)
	}
	return nil
}

func claimInvitationForActivation(
	ctx context.Context,
	tx pgx.Tx,
	invitation invitationRecord,
) (string, error) {
	var persistedRole string
	err := tx.QueryRow(ctx, `
		update public.invitations
		set used_at = now()
		where id = $1::uuid
		  and token_hash = $2
		  and used_at is null
		  and expires_at > now()
		returning coalesce(nullif(role, ''), 'user')
	`, invitation.ID, invitation.TokenHash).Scan(&persistedRole)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return persistedRole, nil
}

func invitationLegalConsentFromRequest(request AcceptInvitationRequest) (invitationLegalConsent, error) {
	if !request.TermsAccepted || !request.PrivacyAccepted {
		return invitationLegalConsent{}, ErrInvalidInput
	}

	termsVersion, ok := invitationLegalVersion(request.TermsVersion, invitationDefaultTermsVersion)
	if !ok {
		return invitationLegalConsent{}, ErrInvalidInput
	}
	privacyVersion, ok := invitationLegalVersion(request.PrivacyVersion, invitationDefaultPrivacyVersion)
	if !ok {
		return invitationLegalConsent{}, ErrInvalidInput
	}

	return invitationLegalConsent{
		TermsVersion:    termsVersion,
		PrivacyVersion:  privacyVersion,
		IPAddress:       validInvitationIPAddress(request.IPAddress),
		UserAgent:       strings.TrimSpace(request.UserAgent),
		TermsAccepted:   true,
		PrivacyAccepted: true,
	}, nil
}

func invitationLegalVersion(value string, fallback string) (string, bool) {
	value = strings.TrimSpace(value)
	// Legal document versions are server-owned. Clients may echo the current
	// value, but cannot choose which document the audit trail records.
	if value != fallback {
		return "", false
	}
	return fallback, true
}

func isValidInvitationName(value string) bool {
	length := utf8.RuneCountInString(value)
	return utf8.ValidString(value) &&
		length >= onboardingAdminNameMinLength &&
		length <= onboardingAdminNameMaxLength
}

func isValidInvitationWhatsApp(value *string) bool {
	if value == nil || strings.TrimSpace(*value) == "" {
		return true
	}

	whatsapp := strings.TrimSpace(*value)
	if !utf8.ValidString(whatsapp) || utf8.RuneCountInString(whatsapp) > 40 {
		return false
	}
	for _, character := range whatsapp {
		if (character >= '0' && character <= '9') || character == '+' || character == ' ' ||
			character == '\t' || character == '\n' || character == '\r' || character == '(' ||
			character == ')' || character == '-' || character == '.' {
			continue
		}
		return false
	}

	digits := onlyDigitsAdmin(whatsapp)
	return len(digits) >= 10 && len(digits) <= 15
}

func validInvitationIPAddress(value string) string {
	address, err := netip.ParseAddr(strings.TrimSpace(value))
	if err != nil {
		return ""
	}
	return address.Unmap().String()
}

func insertInvitationLegalConsent(
	ctx context.Context,
	executor invitationConsentExecutor,
	invitation invitationRecord,
	userID string,
	consent invitationLegalConsent,
) error {
	metadata, err := json.Marshal(map[string]any{
		"invitation_id":    invitation.ID,
		"terms_accepted":   consent.TermsAccepted,
		"privacy_accepted": consent.PrivacyAccepted,
		"legal_documents":  currentLegalConsentEvidence(),
	})
	if err != nil {
		return err
	}

	_, err = executor.Exec(ctx, `
		insert into public.legal_consents (
			user_id,
			organization_id,
			terms_version,
			privacy_version,
			ip_address,
			user_agent,
			source,
			metadata
		)
		values ($1::uuid, $2::uuid, $3, $4, $5, $6, 'invitation', $7::jsonb)
	`,
		userID,
		invitation.OrganizationID,
		consent.TermsVersion,
		consent.PrivacyVersion,
		nullableText(consent.IPAddress),
		nullableText(consent.UserAgent),
		string(metadata),
	)
	return err
}

func runInvitationActivationForNewAuthUser(
	ctx context.Context,
	userID string,
	activate func(context.Context) error,
	reconcile func(context.Context) (invitationActivationEvidence, error),
) error {
	activationErr := activate(ctx)
	if activationErr == nil {
		return nil
	}

	cleanupContext, cancel := context.WithTimeout(context.WithoutCancel(ctx), invitationAuthCleanupTimeout)
	defer cancel()
	evidence, reconciliationErr := reconcile(cleanupContext)
	if reconciliationErr != nil {
		// A failed reconciliation cannot prove that the transaction rolled back.
		// Keep the Auth identity so a committed membership is never orphaned.
		return errors.Join(
			activationErr,
			fmt.Errorf("reconcile invitation activation for auth user %s: %w", userID, reconciliationErr),
		)
	}
	if evidence.committed() {
		// pgx can report a commit error after PostgreSQL has committed. Treat the
		// operation as successful when every durable effect is present.
		return nil
	}
	if !evidence.hasNoActivationFootprint() {
		return errors.Join(
			activationErr,
			fmt.Errorf(
				"invitation activation outcome is ambiguous for auth user %s (auth=%t invitation=%t membership=%t profile=%t consent=%t)",
				userID,
				evidence.AuthUserExists,
				evidence.InvitationUsed,
				evidence.MembershipExists,
				evidence.PublicProfileExists,
				evidence.LegalConsentExists,
			),
		)
	}
	if errors.Is(activationErr, errInvitationActivationCommitUnknown) {
		// No evidence is not proof of rollback after a network-level commit
		// ambiguity. Preserve the Auth identity so a late-visible commit can be
		// retried/reconciled without deleting the principal it references.
		return activationErr
	}
	// Even a clean-looking rollback is only a point-in-time observation. A
	// concurrent invitation or a late-visible commit may already reference the
	// same Auth principal immediately after this reconciliation. Preserve the
	// identity and let the idempotent invitation flow reconcile it on retry.
	return activationErr
}

func (repo Repository) reconcileInvitationActivation(
	ctx context.Context,
	invitation invitationRecord,
	userID string,
) (invitationActivationEvidence, error) {
	var evidence invitationActivationEvidence
	err := repo.db.Pool().QueryRow(ctx, `
		select
			exists (
				select 1
				from auth.users auth_user
				where auth_user.id = $1::uuid
				  and auth_user.deleted_at is null
			),
			exists (
				select 1
				from public.invitations invitation
				where invitation.id = $2::uuid
				  and invitation.organization_id = $3::uuid
				  and invitation.used_at is not null
			),
			exists (
				select 1
				from public.organization_members member
				where member.organization_id = $3::uuid
				  and member.user_id = $1::uuid
				  and member.is_active = true
			),
			exists (
				select 1
				from public.users app_user
				where app_user.id = $1::uuid
			),
			exists (
				select 1
				from public.legal_consents consent
				where consent.user_id = $1::uuid
				  and consent.organization_id = $3::uuid
				  and consent.source = 'invitation'
				  and consent.metadata ->> 'invitation_id' = $2
			)
	`, userID, invitation.ID, invitation.OrganizationID).Scan(
		&evidence.AuthUserExists,
		&evidence.InvitationUsed,
		&evidence.MembershipExists,
		&evidence.PublicProfileExists,
		&evidence.LegalConsentExists,
	)
	return evidence, err
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

func isAuthUserAlreadyExistsError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "already") ||
		strings.Contains(message, "registered") ||
		strings.Contains(message, "exists") ||
		strings.Contains(message, "unique")
}

func memberRoleFromInvitation(role string) string {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "admin":
		return "admin"
	case "manager":
		return "manager"
	default:
		return "user"
	}
}

func textPointer(value pgtype.Text) *string {
	return pgvalue.TextPointerTrimmed(value)
}
