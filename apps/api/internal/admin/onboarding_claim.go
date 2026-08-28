package admin

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	publicSignupAttemptLease        = 2 * time.Minute
	publicSignupCompensationLease   = 45 * time.Second
	publicSignupAttemptStatusActive = "processing"
)

var errPublicSignupAttemptLeaseLost = errors.New("public signup attempt lease was lost")

type publicSignupAttemptClaim struct {
	AttemptID  string
	Email      string
	LeaseToken string
}

type publicSignupAttemptClaimOutcome int

const (
	publicSignupAttemptClaimAcquired publicSignupAttemptClaimOutcome = iota
	publicSignupAttemptClaimBusy
	publicSignupAttemptClaimCompleted
)

func (repo Repository) claimPublicSignupAttempt(
	ctx context.Context,
	attemptID string,
	email string,
) (publicSignupAttemptClaim, publicSignupAttemptClaimOutcome, error) {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return publicSignupAttemptClaim{}, publicSignupAttemptClaimBusy, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		insert into private.public_signup_attempt_claims (
			attempt_id,
			normalized_email,
			status
		)
		values ($1::uuid, $2, 'retryable')
		on conflict (attempt_id) do nothing
	`, attemptID, email); err != nil {
		return publicSignupAttemptClaim{}, publicSignupAttemptClaimBusy, err
	}

	var storedEmail string
	var status string
	var leaseExpiresAt sql.NullTime
	var databaseNow time.Time
	if err := tx.QueryRow(ctx, `
		select normalized_email, status, lease_expires_at, clock_timestamp()
		from private.public_signup_attempt_claims
		where attempt_id = $1::uuid
		for update
	`, attemptID).Scan(&storedEmail, &status, &leaseExpiresAt, &databaseNow); err != nil {
		return publicSignupAttemptClaim{}, publicSignupAttemptClaimBusy, err
	}

	if storedEmail != email {
		return publicSignupAttemptClaim{}, publicSignupAttemptClaimBusy, ErrSignupAttemptConflict
	}
	outcome, err := classifyPublicSignupAttemptClaim(status, leaseExpiresAt, databaseNow)
	if err != nil {
		return publicSignupAttemptClaim{}, publicSignupAttemptClaimBusy, err
	}
	if outcome != publicSignupAttemptClaimAcquired {
		if err := tx.Commit(ctx); err != nil {
			return publicSignupAttemptClaim{}, publicSignupAttemptClaimBusy, err
		}
		return publicSignupAttemptClaim{}, outcome, nil
	}

	var leaseToken string
	if err := tx.QueryRow(ctx, `
		update private.public_signup_attempt_claims
		set
			status = 'processing',
			lease_token = gen_random_uuid(),
			lease_expires_at = clock_timestamp() + ($3::bigint * interval '1 millisecond'),
			auth_user_id = null,
			updated_at = now()
		where attempt_id = $1::uuid
		  and normalized_email = $2
		  and status <> 'completed'
		returning lease_token::text
	`, attemptID, email, publicSignupAttemptLease.Milliseconds()).Scan(&leaseToken); err != nil {
		return publicSignupAttemptClaim{}, publicSignupAttemptClaimBusy, err
	}

	if err := tx.Commit(ctx); err != nil {
		return publicSignupAttemptClaim{}, publicSignupAttemptClaimBusy, err
	}
	return publicSignupAttemptClaim{
		AttemptID:  attemptID,
		Email:      email,
		LeaseToken: leaseToken,
	}, publicSignupAttemptClaimAcquired, nil
}

func classifyPublicSignupAttemptClaim(
	status string,
	leaseExpiresAt sql.NullTime,
	now time.Time,
) (publicSignupAttemptClaimOutcome, error) {
	switch strings.TrimSpace(status) {
	case "completed":
		return publicSignupAttemptClaimCompleted, nil
	case "retryable":
		return publicSignupAttemptClaimAcquired, nil
	case "processing", "compensating":
		if !leaseExpiresAt.Valid || !leaseExpiresAt.Time.After(now) {
			return publicSignupAttemptClaimAcquired, nil
		}
		return publicSignupAttemptClaimBusy, nil
	default:
		return publicSignupAttemptClaimBusy, fmt.Errorf("invalid public signup attempt status %q", status)
	}
}

func (repo Repository) attachPublicSignupAuthUser(
	ctx context.Context,
	claim publicSignupAttemptClaim,
	userID string,
) (bool, error) {
	tag, err := repo.db.Pool().Exec(ctx, `
		update private.public_signup_attempt_claims
		set
			auth_user_id = $4::uuid,
			lease_expires_at = clock_timestamp() + ($5::bigint * interval '1 millisecond'),
			updated_at = now()
		where attempt_id = $1::uuid
		  and normalized_email = $2
		  and lease_token = $3::uuid
		  and status = 'processing'
		  and lease_expires_at > clock_timestamp()
	`, claim.AttemptID, claim.Email, claim.LeaseToken, userID, publicSignupAttemptLease.Milliseconds())
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// fencePublicSignupAttemptForProvisioning is the first statement in the
// provisioning transaction. It validates the lease after all external I/O and
// holds only this row lock while the database-only provisioning work commits.
func fencePublicSignupAttemptForProvisioning(
	ctx context.Context,
	tx pgx.Tx,
	claim publicSignupAttemptClaim,
	userID string,
) error {
	tag, err := tx.Exec(ctx, `
		update private.public_signup_attempt_claims
		set
			auth_user_id = $4::uuid,
			lease_expires_at = clock_timestamp() + ($5::bigint * interval '1 millisecond'),
			updated_at = now()
		where attempt_id = $1::uuid
		  and normalized_email = $2
		  and lease_token = $3::uuid
		  and status = 'processing'
		  and auth_user_id = $4::uuid
		  and lease_expires_at > clock_timestamp()
	`, claim.AttemptID, claim.Email, claim.LeaseToken, userID, publicSignupAttemptLease.Milliseconds())
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return errPublicSignupAttemptLeaseLost
	}
	return nil
}

func completePublicSignupAttempt(
	ctx context.Context,
	tx pgx.Tx,
	claim publicSignupAttemptClaim,
	userID string,
	organizationID string,
) error {
	tag, err := tx.Exec(ctx, `
		update private.public_signup_attempt_claims
		set
			status = 'completed',
			lease_token = null,
			lease_expires_at = null,
			auth_user_id = $4::uuid,
			organization_id = $5::uuid,
			completed_at = now(),
			updated_at = now()
		where attempt_id = $1::uuid
		  and normalized_email = $2
		  and lease_token = $3::uuid
		  and status = 'processing'
		  and auth_user_id = $4::uuid
	`, claim.AttemptID, claim.Email, claim.LeaseToken, userID, organizationID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return errPublicSignupAttemptLeaseLost
	}
	return nil
}

func (repo Repository) beginPublicSignupAuthCompensation(
	ctx context.Context,
	claim publicSignupAttemptClaim,
	userID string,
) (bool, error) {
	tag, err := repo.db.Pool().Exec(ctx, `
		update private.public_signup_attempt_claims
		set
			status = 'compensating',
			auth_user_id = $4::uuid,
			lease_expires_at = clock_timestamp() + ($5::bigint * interval '1 millisecond'),
			updated_at = now()
		where attempt_id = $1::uuid
		  and normalized_email = $2
		  and lease_token = $3::uuid
		  and status in ('processing', 'compensating')
	`, claim.AttemptID, claim.Email, claim.LeaseToken, userID, publicSignupCompensationLease.Milliseconds())
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

func (repo Repository) releasePublicSignupAttempt(
	ctx context.Context,
	claim publicSignupAttemptClaim,
) (bool, error) {
	tag, err := repo.db.Pool().Exec(ctx, `
		update private.public_signup_attempt_claims
		set
			status = 'retryable',
			lease_token = null,
			lease_expires_at = null,
			auth_user_id = null,
			updated_at = now()
		where attempt_id = $1::uuid
		  and normalized_email = $2
		  and lease_token = $3::uuid
		  and status in ('processing', 'compensating')
	`, claim.AttemptID, claim.Email, claim.LeaseToken)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// removePublicSignupAutomaticProfileForCompensation removes only the minimal
// profile created synchronously by public.handle_new_auth_user. The claim and
// Auth identity are locked and revalidated in the same transaction; any
// membership, organization, elevated role, changed email or active lease owner
// makes compensation fail closed.
func (repo Repository) removePublicSignupAutomaticProfileForCompensation(
	ctx context.Context,
	claim publicSignupAttemptClaim,
	userID string,
) (bool, error) {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)

	var ownedUserID string
	err = tx.QueryRow(ctx, `
		select auth_user.id::text
		from private.public_signup_attempt_claims attempt
		join auth.users auth_user
		  on auth_user.id = attempt.auth_user_id
		where attempt.attempt_id = $1::uuid
		  and attempt.normalized_email = $2
		  and attempt.lease_token = $3::uuid
		  and attempt.status = 'compensating'
		  and attempt.lease_expires_at > clock_timestamp()
		  and auth_user.id = $4::uuid
		  and lower(auth_user.email) = $2
		  and auth_user.raw_app_meta_data ->> 'signup_attempt_id' = $1
		  and auth_user.raw_app_meta_data ->> 'provisioning_source' = 'public_onboarding'
		  and auth_user.deleted_at is null
		  and auth_user.email_confirmed_at is null
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
		for update of attempt, auth_user
	`, claim.AttemptID, claim.Email, claim.LeaseToken, userID).Scan(&ownedUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if ownedUserID != userID {
		return false, nil
	}

	var profileEmail, profileRole, profileOrganizationID string
	var profileActive bool
	err = tx.QueryRow(ctx, `
		select
		  coalesce(email, ''),
		  coalesce(role, ''),
		  coalesce(is_active, true),
		  coalesce(organization_id::text, '')
		from public.users
		where id = $1::uuid
		for update
	`, userID).Scan(
		&profileEmail,
		&profileRole,
		&profileActive,
		&profileOrganizationID,
	)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return false, err
	}
	if err == nil && (!strings.EqualFold(strings.TrimSpace(profileEmail), claim.Email) ||
		!strings.EqualFold(strings.TrimSpace(profileRole), "user") ||
		!profileActive ||
		strings.TrimSpace(profileOrganizationID) != "") {
		return false, nil
	}

	if err == nil {
		tag, deleteErr := tx.Exec(ctx, `
			delete from public.users profile
			where profile.id = $1::uuid
			  and lower(profile.email) = $2
			  and lower(coalesce(profile.role, '')) = 'user'
			  and coalesce(profile.is_active, true) = true
			  and profile.organization_id is null
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
		`, userID, claim.Email)
		if deleteErr != nil {
			return false, deleteErr
		}
		if tag.RowsAffected() != 1 {
			return false, nil
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}
