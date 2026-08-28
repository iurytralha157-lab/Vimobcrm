package admin

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/publicingress"
)

const (
	publicSignupRecoveryCapabilityTTL = 2 * time.Hour
	publicSignupRecoveryLease         = 2 * time.Minute
	publicSignupRecoveryActionCorrect = "correct_email"
	publicSignupRecoveryActionCancel  = "cancel_and_restart"
)

type publicSignupRecoveryClaims struct {
	Version        int    `json:"v"`
	AttemptID      string `json:"attempt_id"`
	AuthUserID     string `json:"auth_user_id"`
	OrganizationID string `json:"organization_id"`
	EmailHash      string `json:"email_hash"`
	ExpiresAt      int64  `json:"exp"`
	Nonce          string `json:"nonce"`
}

type publicSignupRecoveryState struct {
	LeaseToken      string
	OldEmail        string
	RecoveryEmail   string
	CheckoutToken   string
	RequiresPayment bool
	AlreadyComplete bool
}

func (repo Repository) issuePublicSignupRecoveryCapability(
	attemptID string,
	authUserID string,
	organizationID string,
	email string,
) (string, error) {
	key, err := repo.publicSignupRecoveryKey()
	if err != nil {
		return "", err
	}
	nonce := make([]byte, 32)
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("generate signup recovery nonce: %w", err)
	}
	claims := publicSignupRecoveryClaims{
		Version:        1,
		AttemptID:      attemptID,
		AuthUserID:     authUserID,
		OrganizationID: organizationID,
		EmailHash:      sha256Hex(strings.ToLower(strings.TrimSpace(email))),
		ExpiresAt:      time.Now().UTC().Add(publicSignupRecoveryCapabilityTTL).Unix(),
		Nonce:          base64.RawURLEncoding.EncodeToString(nonce),
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	encodedPayload := base64.RawURLEncoding.EncodeToString(payload)
	unsigned := "v1." + encodedPayload
	signature := hmac.New(sha256.New, key)
	_, _ = signature.Write([]byte(unsigned))
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(signature.Sum(nil)), nil
}

func (repo Repository) publicSignupRecoveryKey() ([]byte, error) {
	secret := strings.TrimSpace(repo.signupRecoverySecret)
	if len(secret) >= 32 && len(secret) <= 512 {
		return []byte(secret), nil
	}
	if repo.environment == "production" {
		return nil, errors.New("public signup recovery secret is not configured")
	}
	// Local/test fallback remains server-only and deterministic across restarts.
	// Production is fail-closed above and in config validation.
	digest := sha256.Sum256([]byte("vimob-local-signup-recovery:" + repo.projectURL + ":" + repo.apiKey))
	return digest[:], nil
}

func (repo Repository) verifyPublicSignupRecoveryCapability(raw string, now time.Time) (publicSignupRecoveryClaims, error) {
	if len(raw) < 120 || len(raw) > 4096 {
		return publicSignupRecoveryClaims{}, ErrPublicSignupRecoveryUnavailable
	}
	parts := strings.Split(raw, ".")
	if len(parts) != 3 || parts[0] != "v1" {
		return publicSignupRecoveryClaims{}, ErrPublicSignupRecoveryUnavailable
	}
	key, err := repo.publicSignupRecoveryKey()
	if err != nil {
		return publicSignupRecoveryClaims{}, ErrPublicSignupRecoveryUnavailable
	}
	providedSignature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || len(providedSignature) != sha256.Size ||
		base64.RawURLEncoding.EncodeToString(providedSignature) != parts[2] {
		return publicSignupRecoveryClaims{}, ErrPublicSignupRecoveryUnavailable
	}
	expectedSignature := hmac.New(sha256.New, key)
	_, _ = expectedSignature.Write([]byte(parts[0] + "." + parts[1]))
	if !hmac.Equal(providedSignature, expectedSignature.Sum(nil)) {
		return publicSignupRecoveryClaims{}, ErrPublicSignupRecoveryUnavailable
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || len(payload) > 2048 ||
		base64.RawURLEncoding.EncodeToString(payload) != parts[1] {
		return publicSignupRecoveryClaims{}, ErrPublicSignupRecoveryUnavailable
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	var claims publicSignupRecoveryClaims
	if err := decoder.Decode(&claims); err != nil {
		return publicSignupRecoveryClaims{}, ErrPublicSignupRecoveryUnavailable
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return publicSignupRecoveryClaims{}, ErrPublicSignupRecoveryUnavailable
	}
	attemptID, attemptValid := normalizeUUID(claims.AttemptID)
	authUserID, authValid := normalizeUUID(claims.AuthUserID)
	organizationID, organizationValid := normalizeUUID(claims.OrganizationID)
	nonce, nonceErr := base64.RawURLEncoding.DecodeString(claims.Nonce)
	if claims.Version != 1 || !attemptValid || !authValid || !organizationValid ||
		len(claims.EmailHash) != 64 || strings.ToLower(claims.EmailHash) != claims.EmailHash ||
		nonceErr != nil || len(nonce) != 32 || claims.ExpiresAt <= now.Unix() ||
		claims.ExpiresAt > now.Add(publicSignupRecoveryCapabilityTTL+time.Minute).Unix() {
		return publicSignupRecoveryClaims{}, ErrPublicSignupRecoveryUnavailable
	}
	if _, err := hex.DecodeString(claims.EmailHash); err != nil {
		return publicSignupRecoveryClaims{}, ErrPublicSignupRecoveryUnavailable
	}
	claims.AttemptID = attemptID
	claims.AuthUserID = authUserID
	claims.OrganizationID = organizationID
	return claims, nil
}

func (repo Repository) RecoverPublicSignup(ctx context.Context, request PublicSignupRecoveryRequest) (map[string]any, error) {
	now := time.Now().UTC()
	claims, err := repo.verifyPublicSignupRecoveryCapability(strings.TrimSpace(request.Capability), now)
	if err != nil {
		return nil, ErrPublicSignupRecoveryUnavailable
	}
	action := strings.TrimSpace(request.Action)
	if action != publicSignupRecoveryActionCorrect && action != publicSignupRecoveryActionCancel {
		return nil, ErrInvalidInput
	}
	currentEmail, err := normalizeEmail(request.CurrentEmail)
	if err != nil || sha256Hex(currentEmail) != claims.EmailHash {
		return nil, ErrPublicSignupRecoveryUnavailable
	}
	recoveryEmail := currentEmail
	if action == publicSignupRecoveryActionCorrect {
		recoveryEmail, err = normalizeEmail(request.NewEmail)
		if err != nil || recoveryEmail == currentEmail || len(recoveryEmail) > onboardingEmailMaxLength {
			return nil, ErrInvalidInput
		}
	}
	operationHash := publicSignupRecoveryOperationHash(request.Capability, action, recoveryEmail)

	allowDevelopmentFallback := repo.environment == "development" || repo.environment == "local" || repo.environment == "test" || repo.environment == ""
	for _, limit := range []struct {
		key    string
		values []string
		count  int
	}{
		{key: "onboarding_signup_recovery_ip", values: []string{request.IPAddress}, count: 8},
		{key: "onboarding_signup_recovery_capability", values: []string{operationHash}, count: 5},
		{key: "onboarding_signup_recovery_email", values: []string{recoveryEmail}, count: 3},
	} {
		allowed, limitErr := publicingress.AllowWithOptions(
			ctx,
			repo.db.Pool(),
			limit.key,
			limit.values,
			limit.count,
			time.Hour,
			publicingress.AllowOptions{ProcessFallbackEnabled: allowDevelopmentFallback},
		)
		if limitErr != nil {
			return nil, limitErr
		}
		if !allowed {
			return nil, ErrPublicSignupRateLimited
		}
	}

	state, err := repo.beginPublicSignupRecovery(ctx, claims, currentEmail, recoveryEmail, operationHash, action, now)
	if err != nil {
		return nil, err
	}
	if state.AlreadyComplete {
		return publicSignupRecoverySuccess(action, recoveryEmail, state), nil
	}
	finished := false
	defer func() {
		if finished {
			return
		}
		releaseContext, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		_ = repo.releasePublicSignupRecoveryLease(releaseContext, claims, operationHash, state.LeaseToken)
	}()

	if action == publicSignupRecoveryActionCancel {
		tombstoneEmail := publicSignupCancellationTombstone(operationHash)
		if err := repo.updatePublicSignupAuthEmail(ctx, claims, currentEmail, tombstoneEmail); err != nil {
			return nil, err
		}
		if err := repo.purgeOrganizationDatabaseWithExplicitUsers(
			ctx,
			claims.OrganizationID,
			[]organizationUserCleanup{{ID: claims.AuthUserID}},
		); err != nil {
			return nil, err
		}
		finished = true
		// Keep the Auth identity tombstoned instead of deleting it after the
		// database transaction. That avoids a post-commit race in which a new
		// membership could be cascaded away by a stale Auth deletion request.
		return publicSignupRecoverySuccess(action, currentEmail, state), nil
	}

	if err := repo.updatePublicSignupAuthEmail(ctx, claims, currentEmail, recoveryEmail); err != nil {
		return nil, err
	}
	state, err = repo.finishPublicSignupEmailCorrection(
		ctx,
		claims,
		currentEmail,
		recoveryEmail,
		operationHash,
		state.LeaseToken,
		request.IPAddress,
		request.UserAgent,
	)
	if err != nil {
		return nil, err
	}
	finished = true
	repo.resendPublicSignupEmailConfirmationAfterCommit(ctx, claims.AttemptID, recoveryEmail)
	return publicSignupRecoverySuccess(action, recoveryEmail, state), nil
}

func publicSignupRecoverySuccess(action string, email string, state publicSignupRecoveryState) map[string]any {
	if action == publicSignupRecoveryActionCancel {
		return map[string]any{
			"ok":             true,
			"action":         action,
			"message":        "Cadastro cancelado. Você já pode recomeçar com os dados corretos.",
			"redirectTo":     "/cadastro",
			"restartAllowed": true,
		}
	}
	redirectTo := "/select-organization"
	checkoutToken := ""
	if state.RequiresPayment {
		checkoutToken = state.CheckoutToken
		redirectTo = "/checkout/" + checkoutToken
	}
	return map[string]any{
		"ok":              true,
		"action":          action,
		"message":         "E-mail corrigido. Enviamos um novo link de confirmação.",
		"email":           email,
		"redirectTo":      redirectTo,
		"checkoutToken":   nullableText(checkoutToken),
		"requiresPayment": state.RequiresPayment,
	}
}

func (repo Repository) beginPublicSignupRecovery(
	ctx context.Context,
	claims publicSignupRecoveryClaims,
	currentEmail string,
	recoveryEmail string,
	operationHash string,
	action string,
	now time.Time,
) (publicSignupRecoveryState, error) {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return publicSignupRecoveryState{}, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(pg_catalog.hashtextextended('public-signup-recovery:' || $1, 0))`, claims.AttemptID); err != nil {
		return publicSignupRecoveryState{}, err
	}

	var status, normalizedEmail, authUserID, organizationID string
	var recoveryTokenHash, storedRecoveryEmail, leaseToken sql.NullString
	var recoveryExpiresAt, leaseExpiresAt sql.NullTime
	err = tx.QueryRow(ctx, `
		select status, normalized_email, auth_user_id::text, organization_id::text,
		       recovery_token_hash, recovery_email, recovery_expires_at,
		       lease_token::text, lease_expires_at
		from private.public_signup_attempt_claims
		where attempt_id = $1::uuid
		for update
	`, claims.AttemptID).Scan(
		&status, &normalizedEmail, &authUserID, &organizationID,
		&recoveryTokenHash, &storedRecoveryEmail, &recoveryExpiresAt,
		&leaseToken, &leaseExpiresAt,
	)
	if errors.Is(err, pgx.ErrNoRows) || authUserID != claims.AuthUserID || organizationID != claims.OrganizationID {
		return publicSignupRecoveryState{}, ErrPublicSignupRecoveryUnavailable
	}
	if err != nil {
		return publicSignupRecoveryState{}, err
	}

	if status == "completed" && normalizedEmail == recoveryEmail && action == publicSignupRecoveryActionCorrect {
		state, exact, err := repo.completedPublicSignupRecoveryState(ctx, tx, claims, recoveryEmail)
		if err != nil {
			return publicSignupRecoveryState{}, err
		}
		if exact {
			state.AlreadyComplete = true
			if err := tx.Commit(ctx); err != nil {
				return publicSignupRecoveryState{}, err
			}
			return state, nil
		}
	}

	if status != "completed" && status != "recovering" {
		return publicSignupRecoveryState{}, ErrPublicSignupRecoveryUnavailable
	}
	if status == "completed" && normalizedEmail != currentEmail {
		return publicSignupRecoveryState{}, ErrPublicSignupRecoveryUnavailable
	}
	if status == "recovering" {
		if !recoveryTokenHash.Valid || recoveryTokenHash.String != operationHash ||
			!storedRecoveryEmail.Valid || storedRecoveryEmail.String != recoveryEmail ||
			!recoveryExpiresAt.Valid || !now.Before(recoveryExpiresAt.Time) {
			return publicSignupRecoveryState{}, ErrPublicSignupRecoveryUnavailable
		}
		if leaseExpiresAt.Valid && now.Before(leaseExpiresAt.Time) {
			return publicSignupRecoveryState{}, ErrPublicSignupRateLimited
		}
	}

	state, err := repo.assertPublicSignupRecoveryEligibility(ctx, tx, claims, currentEmail, recoveryEmail, operationHash, action)
	if err != nil {
		return publicSignupRecoveryState{}, err
	}
	newLeaseToken, err := randomUUIDString()
	if err != nil {
		return publicSignupRecoveryState{}, err
	}
	capabilityExpiresAt := time.Unix(claims.ExpiresAt, 0).UTC()
	operationExpiresAt := capabilityExpiresAt
	if status == "completed" {
		var rotatedToken string
		if err := tx.QueryRow(ctx, `
			update public.organization_checkout_capabilities
			set checkout_token = replace(gen_random_uuid()::text, '-', ''), rotated_at = now()
			where organization_id = $1::uuid
			returning checkout_token
		`, claims.OrganizationID).Scan(&rotatedToken); err != nil {
			return publicSignupRecoveryState{}, err
		}
		state.CheckoutToken = rotatedToken
	}
	tag, err := tx.Exec(ctx, `
		update private.public_signup_attempt_claims
		set status = 'recovering',
		    lease_token = $5::uuid,
		    lease_expires_at = now() + ($6::bigint * interval '1 millisecond'),
		    recovery_email = $2,
		    recovery_token_hash = $3,
		    recovery_expires_at = $4,
		    recovery_started_at = coalesce(recovery_started_at, now()),
		    updated_at = now()
		where attempt_id = $1::uuid
		  and auth_user_id = $7::uuid
		  and organization_id = $8::uuid
		  and status in ('completed', 'recovering')
	`, claims.AttemptID, recoveryEmail, operationHash, operationExpiresAt, newLeaseToken,
		publicSignupRecoveryLease.Milliseconds(), claims.AuthUserID, claims.OrganizationID)
	if err != nil || tag.RowsAffected() != 1 {
		if err != nil {
			return publicSignupRecoveryState{}, err
		}
		return publicSignupRecoveryState{}, ErrPublicSignupRecoveryUnavailable
	}
	if err := tx.Commit(ctx); err != nil {
		return publicSignupRecoveryState{}, err
	}
	state.LeaseToken = newLeaseToken
	state.OldEmail = currentEmail
	state.RecoveryEmail = recoveryEmail
	return state, nil
}

func (repo Repository) assertPublicSignupRecoveryEligibility(
	ctx context.Context,
	tx pgx.Tx,
	claims publicSignupRecoveryClaims,
	currentEmail string,
	recoveryEmail string,
	operationHash string,
	action string,
) (publicSignupRecoveryState, error) {
	state := publicSignupRecoveryState{OldEmail: currentEmail, RecoveryEmail: recoveryEmail}
	var storedEmail, createdBy, authEmail, authAttemptID, authSource string
	var providerCustomerID, providerPaymentLinkID, providerSubscriptionID string
	err := tx.QueryRow(ctx, `
		select signup_attempt_email, created_by::text, signup_requires_payment,
		       coalesce(asaas_customer_id, ''), coalesce(asaas_payment_link_id, ''), coalesce(asaas_subscription_id, '')
		from public.organizations
		where id = $1::uuid and signup_attempt_id = $2::uuid
		for update
	`, claims.OrganizationID, claims.AttemptID).Scan(
		&storedEmail, &createdBy, &state.RequiresPayment,
		&providerCustomerID, &providerPaymentLinkID, &providerSubscriptionID,
	)
	if errors.Is(err, pgx.ErrNoRows) || storedEmail != currentEmail || createdBy != claims.AuthUserID ||
		providerCustomerID != "" || providerPaymentLinkID != "" || providerSubscriptionID != "" {
		return publicSignupRecoveryState{}, ErrPublicSignupRecoveryUnavailable
	}
	if err != nil {
		return publicSignupRecoveryState{}, err
	}
	var authUnconfirmed bool
	err = tx.QueryRow(ctx, `
		select lower(email), email_confirmed_at is null,
		       coalesce(raw_app_meta_data ->> 'signup_attempt_id', ''),
		       coalesce(raw_app_meta_data ->> 'provisioning_source', '')
		from auth.users
		where id = $1::uuid and deleted_at is null
		for update
	`, claims.AuthUserID).Scan(&authEmail, &authUnconfirmed, &authAttemptID, &authSource)
	allowedAuthEmail := publicSignupRecoveryAuthEmailAllowed(action, authEmail, currentEmail, recoveryEmail, operationHash)
	if errors.Is(err, pgx.ErrNoRows) || !authUnconfirmed || !allowedAuthEmail ||
		authAttemptID != claims.AttemptID || authSource != "public_onboarding" {
		return publicSignupRecoveryState{}, ErrPublicSignupRecoveryUnavailable
	}
	if err != nil {
		return publicSignupRecoveryState{}, err
	}
	var profileEmail, profileOrganizationID, profileRole string
	var profileActive bool
	err = tx.QueryRow(ctx, `
		select lower(email), organization_id::text, lower(coalesce(role, '')), coalesce(is_active, true)
		from public.users where id = $1::uuid for update
	`, claims.AuthUserID).Scan(&profileEmail, &profileOrganizationID, &profileRole, &profileActive)
	if err != nil || profileEmail != currentEmail || profileOrganizationID != claims.OrganizationID || profileRole == "super_admin" || !profileActive {
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return publicSignupRecoveryState{}, err
		}
		return publicSignupRecoveryState{}, ErrPublicSignupRecoveryUnavailable
	}

	var membershipCount int
	var membershipExact bool
	if err := tx.QueryRow(ctx, `
		select count(*), coalesce(bool_and(
			organization_id = $1::uuid and user_id = $2::uuid and role = 'admin' and is_active = true
		), false)
		from public.organization_members
		where organization_id = $1::uuid or user_id = $2::uuid
	`, claims.OrganizationID, claims.AuthUserID).Scan(&membershipCount, &membershipExact); err != nil {
		return publicSignupRecoveryState{}, err
	}
	if membershipCount != 1 || !membershipExact {
		return publicSignupRecoveryState{}, ErrPublicSignupRecoveryUnavailable
	}

	var subscriptionCount int
	var subscriptionsSafe bool
	if err := tx.QueryRow(ctx, `
		select count(*), coalesce(bool_and(
			provider is null and provider_customer_id is null and provider_subscription_id is null
			and status in ('trial', 'pending_payment')
		), false)
		from public.subscriptions where organization_id = $1::uuid
	`, claims.OrganizationID).Scan(&subscriptionCount, &subscriptionsSafe); err != nil {
		return publicSignupRecoveryState{}, err
	}
	if subscriptionCount != 1 || !subscriptionsSafe {
		return publicSignupRecoveryState{}, ErrPublicSignupRecoveryUnavailable
	}

	var hasActivity bool
	if err := tx.QueryRow(ctx, `
		select exists(select 1 from public.asaas_payments where organization_id = $1::uuid)
		    or exists(select 1 from private.billing_checkout_intents where organization_id = $1::uuid)
		    or exists(select 1 from public.subscription_logs where organization_id = $1::uuid)
		    or exists(select 1 from public.organization_members where organization_id = $1::uuid and user_id <> $2::uuid)
		    or exists(select 1 from public.organizations where created_by = $2::uuid and id <> $1::uuid)
	`, claims.OrganizationID, claims.AuthUserID).Scan(&hasActivity); err != nil {
		return publicSignupRecoveryState{}, err
	}
	if hasActivity {
		return publicSignupRecoveryState{}, ErrPublicSignupRecoveryUnavailable
	}
	if err := tx.QueryRow(ctx, `
		select checkout_token
		from public.organization_checkout_capabilities
		where organization_id = $1::uuid
		for update
	`, claims.OrganizationID).Scan(&state.CheckoutToken); err != nil || !isCanonicalCheckoutToken(state.CheckoutToken) {
		if err != nil {
			return publicSignupRecoveryState{}, err
		}
		return publicSignupRecoveryState{}, ErrPublicSignupRecoveryUnavailable
	}
	_ = operationHash // The exact operation hash is persisted by the caller's CAS.
	return state, nil
}

func (repo Repository) completedPublicSignupRecoveryState(
	ctx context.Context,
	tx pgx.Tx,
	claims publicSignupRecoveryClaims,
	recoveryEmail string,
) (publicSignupRecoveryState, bool, error) {
	var state publicSignupRecoveryState
	var organizationEmail, authEmail string
	var authUnconfirmed bool
	err := tx.QueryRow(ctx, `
		select organization.signup_requires_payment, capability.checkout_token,
		       lower(organization.signup_attempt_email), lower(auth_user.email),
		       auth_user.email_confirmed_at is null
		from public.organizations organization
		join public.organization_checkout_capabilities capability on capability.organization_id = organization.id
		join auth.users auth_user on auth_user.id = organization.created_by
		where organization.id = $1::uuid
		  and organization.signup_attempt_id = $2::uuid
		  and organization.created_by = $3::uuid
	`, claims.OrganizationID, claims.AttemptID, claims.AuthUserID).Scan(
		&state.RequiresPayment, &state.CheckoutToken, &organizationEmail, &authEmail, &authUnconfirmed,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return publicSignupRecoveryState{}, false, nil
	}
	if err != nil {
		return publicSignupRecoveryState{}, false, err
	}
	exact := organizationEmail == recoveryEmail && authEmail == recoveryEmail && authUnconfirmed && isCanonicalCheckoutToken(state.CheckoutToken)
	return state, exact, nil
}

func (repo Repository) updatePublicSignupAuthEmail(
	ctx context.Context,
	claims publicSignupRecoveryClaims,
	oldEmail string,
	newEmail string,
) error {
	payload, err := json.Marshal(map[string]any{"email": newEmail, "email_confirm": false})
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPut,
		repo.projectURL+"/auth/v1/admin/users/"+claims.AuthUserID,
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
				ID               string  `json:"id"`
				Email            string  `json:"email"`
				EmailConfirmedAt *string `json:"email_confirmed_at"`
			}
			if err := json.Unmarshal(raw, &parsed); err != nil {
				return err
			}
			id, valid := normalizeUUID(parsed.ID)
			if !valid || id != claims.AuthUserID || strings.ToLower(strings.TrimSpace(parsed.Email)) != newEmail || parsed.EmailConfirmedAt != nil {
				return ErrPublicSignupRecoveryUnavailable
			}
			return nil
		} else {
			requestErr = fmt.Errorf("auth admin signup recovery update failed with status %d", response.StatusCode)
		}
	}

	// A lost HTTP response is ambiguous. Reconcile only the exact attempt-owned,
	// still-unconfirmed identity; never adopt or mutate by e-mail alone.
	var reconciled bool
	reconcileErr := repo.db.Pool().QueryRow(ctx, `
		select exists(
			select 1 from auth.users
			where id = $1::uuid
			  and lower(email) = $2
			  and email_confirmed_at is null
			  and deleted_at is null
			  and raw_app_meta_data ->> 'signup_attempt_id' = $3
			  and raw_app_meta_data ->> 'provisioning_source' = 'public_onboarding'
		)
	`, claims.AuthUserID, newEmail, claims.AttemptID).Scan(&reconciled)
	if reconcileErr == nil && reconciled {
		return nil
	}
	return errors.Join(requestErr, reconcileErr)
}

func (repo Repository) finishPublicSignupEmailCorrection(
	ctx context.Context,
	claims publicSignupRecoveryClaims,
	oldEmail string,
	newEmail string,
	operationHash string,
	leaseToken string,
	ipAddress string,
	userAgent string,
) (publicSignupRecoveryState, error) {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return publicSignupRecoveryState{}, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(pg_catalog.hashtextextended('public-signup-recovery:' || $1, 0))`, claims.AttemptID); err != nil {
		return publicSignupRecoveryState{}, err
	}
	var ownedAttemptID string
	if err := tx.QueryRow(ctx, `
		select attempt_id::text
		from private.public_signup_attempt_claims
		where attempt_id = $1::uuid and auth_user_id = $2::uuid and organization_id = $3::uuid
		  and status = 'recovering' and recovery_email = $4 and recovery_token_hash = $5
		  and lease_token = $6::uuid and recovery_expires_at > now()
		for update
	`, claims.AttemptID, claims.AuthUserID, claims.OrganizationID, newEmail, operationHash, leaseToken).Scan(&ownedAttemptID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return publicSignupRecoveryState{}, ErrPublicSignupRecoveryUnavailable
		}
		return publicSignupRecoveryState{}, err
	}
	if ownedAttemptID != claims.AttemptID {
		return publicSignupRecoveryState{}, ErrPublicSignupRecoveryUnavailable
	}
	state, err := repo.assertPublicSignupRecoveryEligibility(ctx, tx, claims, oldEmail, newEmail, operationHash, publicSignupRecoveryActionCorrect)
	if err != nil {
		return publicSignupRecoveryState{}, err
	}
	if _, err := tx.Exec(ctx, `
		update public.organizations
		set email = $2, billing_email = $2, signup_attempt_email = $2, updated_at = now()
		where id = $1::uuid and signup_attempt_id = $3::uuid and created_by = $4::uuid
	`, claims.OrganizationID, newEmail, claims.AttemptID, claims.AuthUserID); err != nil {
		return publicSignupRecoveryState{}, err
	}
	if _, err := tx.Exec(ctx, `
		update public.users set email = $2, updated_at = now()
		where id = $1::uuid and organization_id = $3::uuid and lower(email) = $4
	`, claims.AuthUserID, newEmail, claims.OrganizationID, oldEmail); err != nil {
		return publicSignupRecoveryState{}, err
	}
	if _, err := tx.Exec(ctx, `
		update public.notifications
		set metadata = jsonb_set(
			jsonb_set(
				(coalesce(metadata, '{}'::jsonb) #- '{variables,email_confirmation_url}' - 'email_confirmation_url')
				|| jsonb_build_object('email_confirmation_scrubbed_at', now()),
				'{dispatch,email}',
				coalesce(metadata #> '{dispatch,email}', '{}'::jsonb) || jsonb_build_object('status', 'skipped', 'error', 'recipient_corrected'),
				true
			),
			'{dispatch,whatsapp}',
			coalesce(metadata #> '{dispatch,whatsapp}', '{}'::jsonb) || jsonb_build_object('status', 'skipped', 'error', 'recipient_corrected'),
			true
		), updated_at = now()
		where organization_id = $1::uuid and user_id = $2::uuid
		  and metadata ->> 'event_key' = 'onboarding_welcome'
	`, claims.OrganizationID, claims.AuthUserID); err != nil {
		return publicSignupRecoveryState{}, err
	}
	metadata, _ := json.Marshal(map[string]any{
		"event_key":             "onboarding_email_confirmation",
		"dedupe_key":            "onboarding:email-correction:" + claims.AttemptID + ":" + operationHash[:16],
		"recipient_email":       newEmail,
		"organization_id":       claims.OrganizationID,
		"confirmation_delivery": "supabase_auth_signup_resend",
		"dispatch": map[string]any{
			"email": map[string]any{"required": false, "status": "skipped", "provider": "supabase_auth", "error": "signup_resend_after_commit"},
		},
	})
	if _, err := tx.Exec(ctx, `
		insert into public.notifications (
			organization_id, user_id, title, content, body, type, channel, target_url, metadata
		) values (
			$1::uuid, $2::uuid, 'Confirme seu novo e-mail',
			'Use o novo link para confirmar o endereço corrigido.',
			'Use o novo link para confirmar o endereço corrigido.',
			'onboarding', 'in_app', '/login?emailConfirmation=required', $3::jsonb
		) on conflict do nothing
	`, claims.OrganizationID, claims.AuthUserID, string(metadata)); err != nil {
		return publicSignupRecoveryState{}, err
	}
	auditData, _ := json.Marshal(map[string]any{"signup_attempt_id": claims.AttemptID, "recovery_action": publicSignupRecoveryActionCorrect})
	if _, err := tx.Exec(ctx, `
		insert into public.audit_logs (
			organization_id, user_id, action, entity_type, entity_id, new_data, ip_address, user_agent
		) values ($1::uuid, $2::uuid, 'signup_email_corrected', 'organization', $1::uuid, $3::jsonb, $4, $5)
	`, claims.OrganizationID, claims.AuthUserID, string(auditData), nullableText(ipAddress), nullableText(userAgent)); err != nil {
		return publicSignupRecoveryState{}, err
	}
	tag, err := tx.Exec(ctx, `
		update private.public_signup_attempt_claims
		set normalized_email = $2, status = 'completed',
		    lease_token = null, lease_expires_at = null,
		    recovery_email = null, recovery_token_hash = null,
		    recovery_expires_at = null, recovery_started_at = null,
		    updated_at = now()
		where attempt_id = $1::uuid and auth_user_id = $3::uuid and organization_id = $4::uuid
		  and status = 'recovering' and recovery_email = $2 and recovery_token_hash = $5
		  and lease_token = $6::uuid
	`, claims.AttemptID, newEmail, claims.AuthUserID, claims.OrganizationID, operationHash, leaseToken)
	if err != nil || tag.RowsAffected() != 1 {
		if err != nil {
			return publicSignupRecoveryState{}, err
		}
		return publicSignupRecoveryState{}, ErrPublicSignupRecoveryUnavailable
	}
	if err := tx.Commit(ctx); err != nil {
		return publicSignupRecoveryState{}, err
	}
	state.OldEmail = oldEmail
	state.RecoveryEmail = newEmail
	return state, nil
}

func (repo Repository) releasePublicSignupRecoveryLease(
	ctx context.Context,
	claims publicSignupRecoveryClaims,
	operationHash string,
	leaseToken string,
) error {
	_, err := repo.db.Pool().Exec(ctx, `
		update private.public_signup_attempt_claims
		set lease_expires_at = now(), updated_at = now()
		where attempt_id = $1::uuid and auth_user_id = $2::uuid and organization_id = $3::uuid
		  and status = 'recovering' and recovery_token_hash = $4 and lease_token = $5::uuid
	`, claims.AttemptID, claims.AuthUserID, claims.OrganizationID, operationHash, leaseToken)
	return err
}

func randomUUIDString() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		value[0:4], value[4:6], value[6:8], value[8:10], value[10:16]), nil
}

func sha256Hex(value string) string {
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}

func publicSignupRecoveryOperationHash(capability string, action string, recoveryEmail string) string {
	return sha256Hex(strings.TrimSpace(capability) + "\n" + action + "\n" + recoveryEmail)
}

func publicSignupCancellationTombstone(operationHash string) string {
	return "cancelled-" + operationHash[:32] + "@invalid.vimob.local"
}

func publicSignupRecoveryAuthEmailAllowed(action string, authEmail string, currentEmail string, recoveryEmail string, operationHash string) bool {
	if authEmail == currentEmail {
		return true
	}
	if action == publicSignupRecoveryActionCorrect {
		return authEmail == recoveryEmail
	}
	if action == publicSignupRecoveryActionCancel {
		return authEmail == publicSignupCancellationTombstone(operationHash)
	}
	return false
}
