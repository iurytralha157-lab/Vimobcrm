package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/jackc/pgx/v5/pgxpool"
)

const invitationIdentityLockPrefix = "vimob:admin-invitation-identity:"

var errInvitationIdentityLock = errors.New("invitation identity lock failed")

// Invitation acceptance is infrequent and performs provider IO while holding a
// dedicated database session. Keep this lane deliberately small and account for
// each pool independently so at least one connection remains available to the
// queries made inside the critical section, even when MaxConns is only two.
var invitationIdentityPoolSlots = struct {
	sync.Mutex
	total  int
	byPool map[*pgxpool.Pool]int
}{
	byPool: make(map[*pgxpool.Pool]int),
}

type invitationIdentityState string

const (
	invitationIdentityAbsent          invitationIdentityState = "absent"
	invitationIdentityRequiresLogin   invitationIdentityState = "requires_login"
	invitationIdentityResumableAdmin  invitationIdentityState = "resumable_admin_invitation"
	invitationIdentityResumableLegacy invitationIdentityState = "resumable_legacy_invite"
)

type invitationIdentity struct {
	UserID            string
	BoundInvitationID string
	State             invitationIdentityState
}

func (identity invitationIdentity) requiresLogin() bool {
	return identity.State == invitationIdentityRequiresLogin
}

func (identity invitationIdentity) resumable() bool {
	return identity.State == invitationIdentityResumableAdmin ||
		identity.State == invitationIdentityResumableLegacy
}

func (identity invitationIdentity) ownedByInvitation(invitationID string) bool {
	invitationID, valid := normalizeUUID(invitationID)
	return valid &&
		identity.State == invitationIdentityResumableAdmin &&
		identity.BoundInvitationID == invitationID
}

type invitationIdentityFacts struct {
	UserID                     string
	AppProvisioningSource      string
	UserProvisioningSource     string
	BoundInvitationID          string
	UserBoundInvitationID      string
	Invited                    bool
	EmailConfirmed             bool
	SignedIn                   bool
	HasPassword                bool
	HasMembership              bool
	HasProfileOrganization     bool
	HasCreatedOrganization     bool
	HasOnboardingRequest       bool
	HasLegalConsent            bool
	HasPrivilegedPublicProfile bool
}

func (facts invitationIdentityFacts) hasBusinessFootprint() bool {
	return facts.HasMembership ||
		facts.HasProfileOrganization ||
		facts.HasCreatedOrganization ||
		facts.HasOnboardingRequest ||
		facts.HasLegalConsent ||
		facts.HasPrivilegedPublicProfile
}

func classifyInvitationIdentityFacts(
	invitationID string,
	facts invitationIdentityFacts,
) invitationIdentityState {
	appSource := strings.TrimSpace(facts.AppProvisioningSource)
	userSource := strings.TrimSpace(facts.UserProvisioningSource)
	boundInvitationID := strings.TrimSpace(facts.BoundInvitationID)
	userBoundInvitationID := strings.TrimSpace(facts.UserBoundInvitationID)
	_, hasValidCurrentInvitation := normalizeUUID(invitationID)
	normalizedAdminInvitationMarker, markerIsUUID := normalizeUUID(boundInvitationID)
	hasValidAdminInvitationMarker := markerIsUUID &&
		strings.EqualFold(normalizedAdminInvitationMarker, boundInvitationID)

	if hasValidCurrentInvitation &&
		appSource == "admin_invitation" &&
		userSource == "" &&
		hasValidAdminInvitationMarker &&
		!facts.hasBusinessFootprint() {
		// A failed or interrupted acceptance may leave an Auth identity bound to
		// an older invitation that later expired or was replaced. The immutable
		// app_metadata provenance plus the absence of any CRM/onboarding footprint
		// is the ownership boundary; possession of the current invitation token is
		// what authorizes rebinding it below. Once any durable footprint exists,
		// the identity always follows the authenticated-account path instead.
		return invitationIdentityResumableAdmin
	}

	if appSource == "" &&
		userSource == "" &&
		boundInvitationID == "" &&
		userBoundInvitationID == "" &&
		facts.Invited &&
		!facts.EmailConfirmed &&
		!facts.SignedIn &&
		!facts.HasPassword &&
		!facts.hasBusinessFootprint() {
		return invitationIdentityResumableLegacy
	}

	// Every other live Auth identity is deliberately treated as an established
	// account. In particular, public onboarding identities and identities without
	// immutable, valid invitation provenance are never adopted by e-mail alone.
	return invitationIdentityRequiresLogin
}

func (repo Repository) classifyInvitationIdentity(
	ctx context.Context,
	invitationID string,
	email string,
) (invitationIdentity, error) {
	invitationID, valid := normalizeUUID(invitationID)
	if !valid {
		return invitationIdentity{}, ErrInvalidInput
	}
	normalizedEmail, err := normalizeEmail(email)
	if err != nil {
		return invitationIdentity{}, err
	}
	if repo.db == nil {
		return invitationIdentity{}, errors.New("database is unavailable for invitation identity classification")
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			auth_user.id::text,
			coalesce(auth_user.raw_app_meta_data ->> 'provisioning_source', ''),
			coalesce(auth_user.raw_user_meta_data ->> 'provisioning_source', ''),
			coalesce(auth_user.raw_app_meta_data ->> 'invitation_id', ''),
			coalesce(auth_user.raw_user_meta_data ->> 'invitation_id', ''),
			auth_user.invited_at is not null,
			auth_user.email_confirmed_at is not null,
			auth_user.last_sign_in_at is not null,
			coalesce(auth_user.encrypted_password, '') <> '',
			exists (
				select 1
				from public.organization_members membership
				where membership.user_id = auth_user.id
			),
			exists (
				select 1
				from public.users profile
				where profile.id = auth_user.id
				  and profile.organization_id is not null
			),
			exists (
				select 1
				from public.organizations organization
				where organization.created_by = auth_user.id
			),
			exists (
				select 1
				from public.onboarding_requests onboarding_request
				where onboarding_request.user_id = auth_user.id
			),
			exists (
				select 1
				from public.legal_consents consent
				where consent.user_id = auth_user.id
			),
			exists (
				select 1
				from public.users profile
				where profile.id = auth_user.id
				  and coalesce(lower(nullif(btrim(profile.role), '')), 'user') <> 'user'
			)
		from auth.users auth_user
		where lower(btrim(auth_user.email)) = lower(btrim($1))
		  and auth_user.deleted_at is null
		limit 2
	`, normalizedEmail)
	if err != nil {
		return invitationIdentity{}, err
	}
	defer rows.Close()

	identities := make([]invitationIdentity, 0, 2)
	for rows.Next() {
		var facts invitationIdentityFacts
		if err := rows.Scan(
			&facts.UserID,
			&facts.AppProvisioningSource,
			&facts.UserProvisioningSource,
			&facts.BoundInvitationID,
			&facts.UserBoundInvitationID,
			&facts.Invited,
			&facts.EmailConfirmed,
			&facts.SignedIn,
			&facts.HasPassword,
			&facts.HasMembership,
			&facts.HasProfileOrganization,
			&facts.HasCreatedOrganization,
			&facts.HasOnboardingRequest,
			&facts.HasLegalConsent,
			&facts.HasPrivilegedPublicProfile,
		); err != nil {
			return invitationIdentity{}, err
		}
		userID, valid := normalizeUUID(facts.UserID)
		if !valid {
			return invitationIdentity{}, errors.New("invitation identity lookup returned an invalid user id")
		}
		boundInvitationID := strings.TrimSpace(facts.BoundInvitationID)
		if normalizedBoundInvitationID, valid := normalizeUUID(boundInvitationID); valid {
			boundInvitationID = normalizedBoundInvitationID
		}
		identities = append(identities, invitationIdentity{
			UserID:            userID,
			BoundInvitationID: boundInvitationID,
			State:             classifyInvitationIdentityFacts(invitationID, facts),
		})
	}
	if err := rows.Err(); err != nil {
		return invitationIdentity{}, err
	}
	if len(identities) == 0 {
		return invitationIdentity{State: invitationIdentityAbsent}, nil
	}
	if len(identities) != 1 {
		return invitationIdentity{}, errors.New("invitation identity lookup matched multiple auth users")
	}
	return identities[0], nil
}

func (repo Repository) updateResumableInvitationAuthUser(
	ctx context.Context,
	identity invitationIdentity,
	invitation invitationRecord,
	password string,
	name string,
) error {
	userID, valid := normalizeUUID(identity.UserID)
	if !valid || !identity.resumable() {
		return ErrInvalidInput
	}
	invitationID, valid := normalizeUUID(invitation.ID)
	if !valid || repo.projectURL == "" || repo.apiKey == "" {
		return ErrInvalidInput
	}

	payload, err := json.Marshal(map[string]any{
		"password":      password,
		"email_confirm": true,
		"user_metadata": map[string]any{
			"name": name,
		},
		"app_metadata": map[string]any{
			"provisioning_source": "admin_invitation",
			"invitation_id":       invitationID,
		},
	})
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPut,
		repo.projectURL+"/auth/v1/admin/users/"+userID,
		bytes.NewReader(payload),
	)
	if err != nil {
		return err
	}
	setAuthAdminHeaders(request, repo.apiKey)

	response, requestErr := repo.httpClient.Do(request)
	if requestErr == nil {
		defer response.Body.Close()
		raw, readErr := io.ReadAll(io.LimitReader(response.Body, 1<<20))
		if readErr != nil {
			requestErr = readErr
		} else if response.StatusCode >= 200 && response.StatusCode < 300 {
			var parsed struct {
				ID               string         `json:"id"`
				Email            string         `json:"email"`
				EmailConfirmedAt *string        `json:"email_confirmed_at"`
				AppMetadata      map[string]any `json:"app_metadata"`
				UserMetadata     map[string]any `json:"user_metadata"`
			}
			if err := json.Unmarshal(raw, &parsed); err != nil {
				requestErr = err
			} else if parsed.ID == userID &&
				strings.EqualFold(strings.TrimSpace(parsed.Email), invitation.Email) &&
				parsed.EmailConfirmedAt != nil &&
				stringValue(parsed.AppMetadata["provisioning_source"]) == "admin_invitation" &&
				stringValue(parsed.AppMetadata["invitation_id"]) == invitationID &&
				stringValue(parsed.UserMetadata["name"]) == name {
				return nil
			} else {
				requestErr = errors.New("auth invitation identity update response has an invalid contract")
			}
		} else {
			requestErr = fmt.Errorf(
				"auth admin update invitation user failed with status %d: %s",
				response.StatusCode,
				strings.TrimSpace(string(raw)),
			)
		}
	}

	reconciliationContext, cancel := context.WithTimeout(
		context.WithoutCancel(ctx),
		invitationAuthCleanupTimeout,
	)
	defer cancel()
	reconciled, reconcileErr := repo.invitationAuthUserUpdateApplied(
		reconciliationContext,
		userID,
		invitation,
		password,
		name,
	)
	if reconcileErr == nil && reconciled {
		return nil
	}
	if requestErr == nil {
		requestErr = errors.New("auth invitation identity update request failed")
	}
	if reconcileErr == nil {
		reconcileErr = errors.New("auth invitation identity update was not observed")
	}
	return errors.Join(requestErr, reconcileErr)
}

func (repo Repository) invitationAuthUserUpdateApplied(
	ctx context.Context,
	userID string,
	invitation invitationRecord,
	password string,
	name string,
) (bool, error) {
	if repo.db == nil {
		return false, errors.New("database is unavailable for invitation auth reconciliation")
	}
	var applied bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from auth.users auth_user
			where auth_user.id = $1::uuid
			  and lower(btrim(auth_user.email)) = lower(btrim($2))
			  and auth_user.deleted_at is null
			  and auth_user.email_confirmed_at is not null
			  and auth_user.raw_app_meta_data ->> 'provisioning_source' = 'admin_invitation'
			  and auth_user.raw_app_meta_data ->> 'invitation_id' = $3
			  and auth_user.raw_user_meta_data ->> 'name' = $4
			  and auth_user.encrypted_password = extensions.crypt($5, auth_user.encrypted_password)
			  and not exists (
				select 1
				from public.organization_members membership
				where membership.user_id = auth_user.id
			  )
			  and not exists (
				select 1
				from public.organizations organization
				where organization.created_by = auth_user.id
			  )
		)
	`, userID, invitation.Email, invitation.ID, name, password).Scan(&applied)
	return applied, err
}

func (repo Repository) ensureInvitationProvisionalProfileInactive(
	ctx context.Context,
	userID string,
	invitation invitationRecord,
	name string,
) error {
	identity, err := repo.classifyInvitationIdentity(ctx, invitation.ID, invitation.Email)
	if err != nil {
		return err
	}
	if identity.UserID != userID || !identity.ownedByInvitation(invitation.ID) {
		return ErrInvalidInput
	}

	if _, err := repo.db.Pool().Exec(ctx, `
		update public.users profile
		set is_active = false,
		    name = $3,
		    email = $4,
		    updated_at = now()
		where profile.id = $1::uuid
		  and profile.organization_id is null
		  and coalesce(lower(nullif(btrim(profile.role), '')), 'user') = 'user'
		  and not exists (
			select 1
			from public.organization_members membership
			where membership.user_id = profile.id
		  )
		  and not exists (
			select 1
			from public.organizations organization
			where organization.created_by = profile.id
		  )
		  and exists (
			select 1
			from auth.users auth_user
			where auth_user.id = profile.id
			  and auth_user.deleted_at is null
			  and auth_user.raw_app_meta_data ->> 'provisioning_source' = 'admin_invitation'
			  and auth_user.raw_app_meta_data ->> 'invitation_id' = $2
		  )
	`, userID, invitation.ID, name, invitation.Email); err != nil {
		return err
	}

	var activeProfileExists bool
	if err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.users profile
			where profile.id = $1::uuid
			  and coalesce(profile.is_active, false) = true
		)
	`, userID).Scan(&activeProfileExists); err != nil {
		return err
	}
	if activeProfileExists {
		return errors.New("provisional invitation profile remained active")
	}

	// Re-read the complete state after the guarded update. A concurrent
	// membership or another provisioning marker must stop public adoption before
	// the final invitation transaction starts.
	identity, err = repo.classifyInvitationIdentity(ctx, invitation.ID, invitation.Email)
	if err != nil {
		return err
	}
	if identity.UserID != userID || !identity.ownedByInvitation(invitation.ID) {
		return ErrInvalidInput
	}
	return nil
}

func invitationIdentityReconciliationContext(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(ctx), invitationAuthCleanupTimeout)
}

// acquireInvitationIdentityLock serializes every public acceptance and resend
// for one e-mail across API replicas. The dedicated PostgreSQL session remains
// locked while Auth is called, but no database transaction is kept open. A
// bounded local gate always reserves one pool connection for the queries made
// inside the critical section.
func (repo Repository) acquireInvitationIdentityLock(
	ctx context.Context,
	email string,
) (func(), error) {
	normalizedEmail, err := normalizeEmail(email)
	if err != nil || repo.db == nil {
		return nil, errInvitationIdentityLock
	}
	pool := repo.db.Pool()
	releasePoolSlot, err := acquireInvitationIdentityPoolSlot(ctx, pool)
	if err != nil {
		return nil, err
	}
	connection, err := pool.Acquire(ctx)
	if err != nil {
		releasePoolSlot()
		return nil, errInvitationIdentityLock
	}
	lockKey := invitationIdentityLockPrefix + normalizedEmail
	var acquired bool
	if err := connection.QueryRow(ctx, `
		select pg_catalog.pg_try_advisory_lock(
			pg_catalog.hashtextextended($1, 0)
		)
	`, lockKey).Scan(&acquired); err != nil {
		closeInvitationIdentityLockConnection(connection)
		releasePoolSlot()
		return nil, errInvitationIdentityLock
	}
	if !acquired {
		connection.Release()
		releasePoolSlot()
		return nil, ErrInvitationInProgress
	}

	var once sync.Once
	return func() {
		once.Do(func() {
			defer releasePoolSlot()
			releaseContext, cancel := context.WithTimeout(
				context.Background(),
				invitationAuthCleanupTimeout,
			)
			defer cancel()
			var unlocked bool
			unlockErr := connection.QueryRow(releaseContext, `
				select pg_catalog.pg_advisory_unlock(
					pg_catalog.hashtextextended($1, 0)
				)
			`, lockKey).Scan(&unlocked)
			if unlockErr == nil && unlocked {
				connection.Release()
				return
			}

			// Never return a connection with uncertain session state to the pool.
			// Closing it also makes PostgreSQL release any surviving advisory lock.
			closeInvitationIdentityLockConnection(connection)
		})
	}, nil
}

func acquireInvitationIdentityPoolSlot(
	ctx context.Context,
	pool *pgxpool.Pool,
) (func(), error) {
	if pool == nil {
		return nil, errInvitationIdentityLock
	}
	if ctx.Err() != nil {
		return nil, errInvitationIdentityLock
	}
	poolCapacity := invitationIdentityPoolSlotCapacity(pool.Config().MaxConns)
	if poolCapacity == 0 {
		return nil, errInvitationIdentityLock
	}

	invitationIdentityPoolSlots.Lock()
	if invitationIdentityPoolSlots.total >= 2 ||
		invitationIdentityPoolSlots.byPool[pool] >= poolCapacity {
		invitationIdentityPoolSlots.Unlock()
		return nil, ErrInvitationInProgress
	}
	invitationIdentityPoolSlots.total++
	invitationIdentityPoolSlots.byPool[pool]++
	invitationIdentityPoolSlots.Unlock()

	var once sync.Once
	return func() {
		once.Do(func() {
			invitationIdentityPoolSlots.Lock()
			invitationIdentityPoolSlots.total--
			invitationIdentityPoolSlots.byPool[pool]--
			if invitationIdentityPoolSlots.byPool[pool] == 0 {
				delete(invitationIdentityPoolSlots.byPool, pool)
			}
			invitationIdentityPoolSlots.Unlock()
		})
	}, nil
}

func invitationIdentityPoolSlotCapacity(maxConns int32) int {
	capacity := int(maxConns) - 1
	if capacity < 1 {
		return 0
	}
	if capacity > 2 {
		return 2
	}
	return capacity
}

func closeInvitationIdentityLockConnection(connection *pgxpool.Conn) {
	if connection == nil {
		return
	}
	closeContext, cancel := context.WithTimeout(
		context.Background(),
		invitationAuthCleanupTimeout,
	)
	defer cancel()
	underlying := connection.Hijack()
	_ = underlying.Close(closeContext)
}
