package settings

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/supabasehttp"
)

func (repo Repository) verifyCurrentPassword(ctx context.Context, userID string, currentPassword string) error {
	var email string
	err := repo.db.Pool().QueryRow(ctx, `
		select coalesce(email, '')
		from auth.users
		where id = $1::uuid and deleted_at is null
	`, userID).Scan(&email)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && email == "") {
		return ErrCurrentPasswordInvalid
	}
	if err != nil {
		return ErrAuthOperation
	}
	return repo.authAdmin.verifyCurrentPassword(ctx, userID, email, currentPassword)
}

func (client authAdminClient) verifyCurrentPassword(ctx context.Context, userID string, email string, currentPassword string) error {
	if client.projectURL == "" || client.apiKey == "" {
		return ErrAuthNotConfigured
	}
	if ctx.Err() != nil {
		return ErrAuthOperation
	}

	// Once the grant starts, finish reading the response so a disconnect does
	// not prevent disposal of a session that Auth has already minted.
	proofCtx, cancelProof := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancelProof()
	payload, _ := json.Marshal(map[string]string{"email": email, "password": currentPassword})
	request, err := http.NewRequestWithContext(proofCtx, http.MethodPost, client.projectURL+"/auth/v1/token?grant_type=password", bytes.NewReader(payload))
	if err != nil {
		return ErrAuthOperation
	}
	supabasehttp.SetServiceAuth(request, client.apiKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")

	// A redirect must never forward credentials or a proof bearer elsewhere.
	directHTTP := *client.httpClient
	directHTTP.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	client.httpClient = &directHTTP
	response, err := client.httpClient.Do(request)
	if err != nil {
		return ErrAuthOperation
	}
	defer response.Body.Close()
	switch response.StatusCode {
	case http.StatusOK:
	case http.StatusBadRequest, http.StatusUnprocessableEntity:
		return ErrCurrentPasswordInvalid
	case http.StatusTooManyRequests:
		return ErrCurrentPasswordRateLimited
	default:
		return ErrAuthOperation
	}

	var proof struct {
		AccessToken string `json:"access_token"`
		User        struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	err = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&proof)
	if strings.TrimSpace(proof.AccessToken) == "" {
		return ErrAuthOperation
	}

	// GoTrue's password grant creates a session. Dispose it even if the
	// browser disconnects or the provider returns a different account.
	cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if client.revokeSessions(cleanupCtx, "Bearer "+proof.AccessToken, "local") != nil {
		return ErrAuthOperation
	}
	if err != nil || ctx.Err() != nil {
		return ErrAuthOperation
	}
	if proof.User.ID != userID {
		return ErrCurrentPasswordInvalid
	}
	return nil
}
