package admin

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/supabasehttp"
)

const publicSignupAuthReconciliationTimeout = 10 * time.Second

var errPublicSignupAuthEmailExists = errors.New("supabase auth user already exists")

type publicSignupAuthUser struct {
	UserID                      string
	EmailConfirmationURL        string
	NeedsAuthConfirmationResend bool
}

// createPublicSignupAuthUser is deliberately separate from createAuthUser.
// Public signup must prove ownership of the email address, while internal
// provisioning and invitation flows have different identity contracts.
func (repo Repository) createPublicSignupAuthUser(
	ctx context.Context,
	attemptID string,
	email string,
	password string,
	name string,
) (publicSignupAuthUser, error) {
	createdUser, createErr := repo.requestPublicSignupAuthUser(ctx, attemptID, email, password, name)
	if createErr != nil {
		reconciliationContext, cancel := context.WithTimeout(
			context.WithoutCancel(ctx),
			publicSignupAuthReconciliationTimeout,
		)
		defer cancel()

		reconciledUserID, found, reconcileErr := repo.reconcilePublicSignupAuthUser(
			reconciliationContext,
			attemptID,
			email,
		)
		if reconcileErr != nil {
			return publicSignupAuthUser{}, errors.Join(
				createErr,
				ErrPublicSignupConfirmationFailed,
				fmt.Errorf("reconcile ambiguous public signup auth user: %w", reconcileErr),
			)
		}
		if !found {
			return publicSignupAuthUser{}, publicSignupAuthFailure(createErr)
		}
		if err := repo.bindPublicSignupAuthUserAttempt(
			reconciliationContext,
			reconciledUserID,
			attemptID,
			email,
		); err != nil {
			return publicSignupAuthUser{}, errors.Join(
				createErr,
				fmt.Errorf("bind reconciled public signup auth user: %w", err),
				ErrPublicSignupConfirmationFailed,
			)
		}
		return publicSignupAuthUser{
			UserID:                      reconciledUserID,
			NeedsAuthConfirmationResend: true,
		}, nil
	}

	if err := repo.bindPublicSignupAuthUserAttempt(
		ctx,
		createdUser.UserID,
		attemptID,
		email,
	); err != nil {
		// Preserve the exact, provisionally signed identity. A retry can prove
		// that it belongs to this attempt, promote the binding to app_metadata,
		// and ask Auth to resend a signup confirmation without changing password.
		return publicSignupAuthUser{}, errors.Join(ErrPublicSignupConfirmationFailed, err)
	}
	return createdUser, nil
}

func (repo Repository) requestPublicSignupAuthUser(
	ctx context.Context,
	attemptID string,
	email string,
	password string,
	name string,
) (publicSignupAuthUser, error) {
	if repo.projectURL == "" || repo.apiKey == "" || repo.appURL == "" {
		return publicSignupAuthUser{}, ErrInvalidInput
	}
	provisionalBinding, err := repo.publicSignupAuthProvisionalBinding(attemptID, email)
	if err != nil {
		return publicSignupAuthUser{}, err
	}
	redirectTo := strings.TrimRight(repo.appURL, "/") + "/login?emailConfirmation=success"
	payload, err := json.Marshal(map[string]any{
		"type":     "signup",
		"email":    email,
		"password": password,
		"data": map[string]any{
			"name":                   name,
			"signup_attempt_id":      attemptID,
			"provisioning_source":    "public_onboarding",
			"signup_attempt_binding": provisionalBinding,
		},
	})
	if err != nil {
		return publicSignupAuthUser{}, err
	}
	endpoint := repo.projectURL + "/auth/v1/admin/generate_link?" + url.Values{
		"redirect_to": []string{redirectTo},
	}.Encode()
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		endpoint,
		bytes.NewReader(payload),
	)
	if err != nil {
		return publicSignupAuthUser{}, err
	}
	setAuthAdminHeaders(request, repo.apiKey)

	response, err := repo.httpClient.Do(request)
	if err != nil {
		return publicSignupAuthUser{}, err
	}
	defer response.Body.Close()
	raw, readErr := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if readErr != nil {
		return publicSignupAuthUser{}, readErr
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return publicSignupAuthUser{}, publicSignupAuthGenerateLinkError(
			response.StatusCode,
			raw,
		)
	}
	var parsed struct {
		ActionLink       string `json:"action_link"`
		Email            string `json:"email"`
		HashedToken      string `json:"hashed_token"`
		RedirectTo       string `json:"redirect_to"`
		VerificationType string `json:"verification_type"`
		ID               string `json:"id"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return publicSignupAuthUser{}, err
	}
	userID, valid := normalizeUUID(parsed.ID)
	if !valid || !strings.EqualFold(strings.TrimSpace(parsed.Email), email) {
		return publicSignupAuthUser{}, errors.New("auth signup link was generated for an unexpected user")
	}
	if parsed.VerificationType != "signup" || parsed.RedirectTo != redirectTo || strings.TrimSpace(parsed.HashedToken) == "" {
		return publicSignupAuthUser{}, errors.New("auth signup link response has an invalid contract")
	}
	if err := validatePublicSignupEmailConfirmationURL(
		parsed.ActionLink,
		repo.projectURL,
		redirectTo,
		parsed.HashedToken,
	); err != nil {
		return publicSignupAuthUser{}, err
	}
	return publicSignupAuthUser{
		UserID:               userID,
		EmailConfirmationURL: parsed.ActionLink,
	}, nil
}

func publicSignupAuthFailure(err error) error {
	if errors.Is(err, errPublicSignupAuthEmailExists) {
		return errors.Join(ErrPublicSignupEmailExists, err)
	}
	return errors.Join(ErrPublicSignupConfirmationFailed, err)
}

func publicSignupAuthGenerateLinkError(statusCode int, raw []byte) error {
	apiErr := fmt.Errorf(
		"auth admin generate public signup link failed with status %d: %s",
		statusCode,
		strings.TrimSpace(string(raw)),
	)
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return apiErr
	}
	code := strings.ToLower(strings.TrimSpace(stringValue(payload["code"])))
	if code == "" {
		code = strings.ToLower(strings.TrimSpace(stringValue(payload["error_code"])))
	}
	if code == "email_exists" || code == "user_already_exists" {
		return errors.Join(errPublicSignupAuthEmailExists, apiErr)
	}
	return apiErr
}

// publicSignupAuthProvisionalBinding is server-signed evidence used only to
// close an ambiguous generate_link response window. Authorization continues
// to rely exclusively on app_metadata after the identity is promoted below.
func (repo Repository) publicSignupAuthProvisionalBinding(attemptID string, email string) (string, error) {
	key, err := repo.publicSignupRecoveryKey()
	if err != nil {
		return "", err
	}
	signature := hmac.New(sha256.New, key)
	_, _ = signature.Write([]byte("public-signup-auth/v1\n" + attemptID + "\n" + strings.ToLower(strings.TrimSpace(email))))
	return base64.RawURLEncoding.EncodeToString(signature.Sum(nil)), nil
}

// reconcilePublicSignupAuthUser closes the process-crash/ambiguous-response
// window after Auth creation. It never adopts an account by email alone and it
// never changes a password. Only the exact attempt-owned, still-unconfirmed
// orphan is safe to resume.
func (repo Repository) reconcilePublicSignupAuthUser(
	ctx context.Context,
	attemptID string,
	email string,
) (string, bool, error) {
	if repo.db == nil {
		return "", false, errors.New("database is unavailable for auth reconciliation")
	}
	provisionalBinding, err := repo.publicSignupAuthProvisionalBinding(attemptID, email)
	if err != nil {
		return "", false, err
	}
	rows, err := repo.db.Pool().Query(ctx, `
		select auth_user.id::text
		from auth.users as auth_user
		where auth_user.email = $1
		  and (
			(
			  auth_user.raw_app_meta_data ->> 'signup_attempt_id' = $2
			  and auth_user.raw_app_meta_data ->> 'provisioning_source' = 'public_onboarding'
			)
			or (
			  auth_user.raw_user_meta_data ->> 'signup_attempt_id' = $2
			  and auth_user.raw_user_meta_data ->> 'provisioning_source' = 'public_onboarding'
			  and auth_user.raw_user_meta_data ->> 'signup_attempt_binding' = $3
			  and coalesce(auth_user.raw_app_meta_data ->> 'signup_attempt_id', '') in ('', $2)
			  and coalesce(auth_user.raw_app_meta_data ->> 'provisioning_source', '') in ('', 'public_onboarding')
			)
		  )
		  and auth_user.deleted_at is null
		  and auth_user.email_confirmed_at is null
		  and (
			not exists (
			  select 1
			  from public.users as profile
			  where profile.id = auth_user.id
			)
			or exists (
			  select 1
			  from public.users as profile
			  where profile.id = auth_user.id
			    and lower(profile.email) = $1
			    and profile.organization_id is null
			    and lower(coalesce(profile.role, '')) = 'user'
			    and coalesce(profile.is_active, true) = true
			)
		  )
		  and not exists (
			select 1
			from public.organization_members as membership
			where membership.user_id = auth_user.id
		  )
		  and not exists (
			select 1
			from public.organizations as organization
			where organization.created_by = auth_user.id
		  )
		limit 2
	`, email, attemptID, provisionalBinding)
	if err != nil {
		return "", false, err
	}
	defer rows.Close()

	userIDs := make([]string, 0, 2)
	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err != nil {
			return "", false, err
		}
		userID, valid := normalizeUUID(userID)
		if !valid {
			return "", false, errors.New("auth reconciliation returned an invalid user id")
		}
		userIDs = append(userIDs, userID)
	}
	if err := rows.Err(); err != nil {
		return "", false, err
	}
	if len(userIDs) == 0 {
		return "", false, nil
	}
	if len(userIDs) != 1 {
		return "", false, errors.New("auth reconciliation matched multiple public signup users")
	}
	return userIDs[0], true, nil
}

func (repo Repository) bindPublicSignupAuthUserAttempt(
	ctx context.Context,
	userID string,
	attemptID string,
	email string,
) error {
	if repo.projectURL == "" || repo.apiKey == "" {
		return ErrInvalidInput
	}
	payload, err := json.Marshal(map[string]any{
		"app_metadata": map[string]any{
			"signup_attempt_id":   attemptID,
			"provisioning_source": "public_onboarding",
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
			}
			if err := json.Unmarshal(raw, &parsed); err != nil {
				requestErr = err
			} else {
				boundUserID, valid := normalizeUUID(parsed.ID)
				if valid &&
					boundUserID == userID &&
					strings.EqualFold(strings.TrimSpace(parsed.Email), email) &&
					parsed.EmailConfirmedAt == nil &&
					stringValue(parsed.AppMetadata["signup_attempt_id"]) == attemptID &&
					stringValue(parsed.AppMetadata["provisioning_source"]) == "public_onboarding" {
					return nil
				}
				requestErr = errors.New("auth signup attempt binding response has an invalid contract")
			}
		} else {
			requestErr = fmt.Errorf(
				"auth admin bind public signup attempt failed with status %d: %s",
				response.StatusCode,
				strings.TrimSpace(string(raw)),
			)
		}
	}

	reconciliationContext, cancel := context.WithTimeout(
		context.WithoutCancel(ctx),
		publicSignupAuthReconciliationTimeout,
	)
	defer cancel()
	bound, reconcileErr := repo.publicSignupAuthUserAttemptBound(
		reconciliationContext,
		userID,
		attemptID,
		email,
	)
	if reconcileErr == nil && bound {
		return nil
	}
	if requestErr == nil {
		requestErr = errors.New("auth signup attempt binding request failed")
	}
	if reconcileErr == nil {
		reconcileErr = errors.New("auth signup attempt binding was not observed")
	}
	return errors.Join(requestErr, reconcileErr)
}

func (repo Repository) publicSignupAuthUserAttemptBound(
	ctx context.Context,
	userID string,
	attemptID string,
	email string,
) (bool, error) {
	if repo.db == nil {
		return false, errors.New("database is unavailable for auth binding reconciliation")
	}
	var bound bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists(
			select 1
			from auth.users as auth_user
			where auth_user.id = $1::uuid
			  and auth_user.email = $2
			  and auth_user.raw_app_meta_data ->> 'signup_attempt_id' = $3
			  and auth_user.raw_app_meta_data ->> 'provisioning_source' = 'public_onboarding'
			  and auth_user.deleted_at is null
			  and auth_user.email_confirmed_at is null
			  and not exists (
				select 1 from public.organization_members membership
				where membership.user_id = auth_user.id
			  )
			  and not exists (
				select 1 from public.organizations organization
				where organization.created_by = auth_user.id
			  )
		)
	`, userID, email, attemptID).Scan(&bound)
	return bound, err
}

func (repo Repository) resendPublicSignupEmailConfirmation(ctx context.Context, email string) error {
	if repo.projectURL == "" || repo.apiKey == "" || repo.appURL == "" {
		return ErrInvalidInput
	}
	redirectTo := strings.TrimRight(repo.appURL, "/") + "/login?emailConfirmation=success"
	payload, err := json.Marshal(map[string]any{
		"type":  "signup",
		"email": email,
	})
	if err != nil {
		return err
	}
	endpoint := repo.projectURL + "/auth/v1/resend?" + url.Values{
		"redirect_to": []string{redirectTo},
	}.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	setAuthAdminHeaders(request, repo.apiKey)

	response, err := repo.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	raw, readErr := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if readErr != nil {
		return readErr
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf(
			"auth resend public signup confirmation failed with status %d: %s",
			response.StatusCode,
			strings.TrimSpace(string(raw)),
		)
	}
	return nil
}

func (repo Repository) resendPublicSignupEmailConfirmationAfterCommit(
	ctx context.Context,
	attemptID string,
	email string,
) {
	resendContext, cancel := context.WithTimeout(
		context.WithoutCancel(ctx),
		publicSignupAuthReconciliationTimeout,
	)
	defer cancel()
	if err := repo.resendPublicSignupEmailConfirmation(resendContext, email); err != nil {
		// Provisioning is already committed. Keep the successful, idempotent
		// signup result and let the public resend endpoint recover delivery.
		slog.ErrorContext(
			resendContext,
			"post-commit public signup confirmation resend failed",
			"attempt_id",
			attemptID,
			"error",
			err,
		)
	}
}

func validatePublicSignupEmailConfirmationURL(
	actionLink string,
	projectURL string,
	redirectTo string,
	hashedToken string,
) error {
	action, err := url.Parse(strings.TrimSpace(actionLink))
	if err != nil {
		return fmt.Errorf("parse auth confirmation link: %w", err)
	}
	project, err := url.Parse(strings.TrimSpace(projectURL))
	if err != nil {
		return fmt.Errorf("parse auth project url: %w", err)
	}
	expectedPath := strings.TrimRight(project.Path, "/") + "/auth/v1/verify"
	if action.User != nil || action.Fragment != "" ||
		!strings.EqualFold(action.Scheme, project.Scheme) ||
		!strings.EqualFold(action.Host, project.Host) ||
		action.Path != expectedPath {
		return errors.New("auth confirmation link points to an unexpected origin")
	}
	query, err := url.ParseQuery(action.RawQuery)
	if err != nil ||
		len(query) != 3 ||
		len(query["type"]) != 1 ||
		len(query["token"]) != 1 ||
		len(query["redirect_to"]) != 1 ||
		query.Get("type") != "signup" ||
		query.Get("token") != hashedToken ||
		query.Get("redirect_to") != redirectTo {
		return errors.New("auth confirmation link has unexpected verification parameters")
	}
	return nil
}

func setAuthAdminHeaders(request *http.Request, apiKey string) {
	supabasehttp.SetServiceAuth(request, apiKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
}
