package whatsapp

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const whatsappCallRecordingBucket = "whatsapp-call-recordings"
const whatsappCallRecordingSignedURLTTLSeconds = 60 * 60

type callMediaClaims struct {
	Version    int    `json:"v"`
	InstanceID string `json:"instanceId"`
	CallID     string `json:"callId"`
	Subject    string `json:"sub"`
	Expires    int64  `json:"exp"`
	Nonce      string `json:"nonce"`
}

type callMediaTicketResponse struct {
	URL       string    `json:"url"`
	ExpiresAt time.Time `json:"expires_at"`
}

func signCallMediaClaims(claims callMediaClaims, secret string) (string, error) {
	if len(secret) < 32 {
		return "", fmt.Errorf("%w: media secret is not configured", ErrFeatureUnavailable)
	}
	if claims.Version != 1 || claims.InstanceID == "" || claims.CallID == "" ||
		claims.Subject == "" || claims.Expires <= time.Now().Unix() || claims.Nonce == "" {
		return "", ErrInvalidInput
	}
	raw, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	encoded := base64.RawURLEncoding.EncodeToString(raw)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(encoded))
	return encoded + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

func callMediaWebSocketURL(configuredURL, ticket string) (string, error) {
	endpoint, err := url.Parse(strings.TrimSpace(configuredURL))
	if err != nil || endpoint == nil || endpoint.Host == "" || endpoint.User != nil ||
		endpoint.RawQuery != "" || endpoint.Fragment != "" {
		return "", fmt.Errorf("%w: Evolution media endpoint is invalid", ErrFeatureUnavailable)
	}
	switch endpoint.Scheme {
	case "https":
		endpoint.Scheme = "wss"
	case "http":
		endpoint.Scheme = "ws"
	default:
		return "", fmt.Errorf("%w: Evolution media endpoint is invalid", ErrFeatureUnavailable)
	}
	endpoint.Path = strings.TrimRight(endpoint.Path, "/") + "/call/media"
	endpoint.RawPath = ""
	query := url.Values{}
	query.Set("token", ticket)
	endpoint.RawQuery = query.Encode()
	return endpoint.String(), nil
}

func (repo Repository) issueCallMediaTicket(
	ctx context.Context,
	tenantContext tenant.Context,
	callID string,
) (callMediaTicketResponse, error) {
	call, err := repo.ownedCall(ctx, tenantContext, callID)
	if err != nil {
		return callMediaTicketResponse{}, err
	}
	if err := repo.requireCallFeature(ctx, tenantContext, call.SessionID, "whatsapp_calls_enabled"); err != nil {
		return callMediaTicketResponse{}, err
	}
	if call.OperatorUserID == nil || *call.OperatorUserID != tenantContext.UserID ||
		!stringIn(call.State, "incoming", "outgoing", "ringing", "active") {
		return callMediaTicketResponse{}, ErrCallNotFound
	}
	if call.State == "incoming" {
		// Answering claims an incoming call before provider media is opened.
		var claimed bool
		err = repo.db.Pool().QueryRow(ctx, `
			select answer_claim_token is not null
			from public.whatsapp_calls where id = $1::uuid
		`, call.ID).Scan(&claimed)
		if err != nil || !claimed {
			return callMediaTicketResponse{}, ErrCallNotFound
		}
	}
	providerSession, err := repo.functions.resolveEvolutionSession(ctx, map[string]any{"session_id": call.SessionID})
	if err != nil {
		return callMediaTicketResponse{}, err
	}
	destination, err := repo.functions.providerForSession(call.SessionID)
	if err != nil {
		return callMediaTicketResponse{}, fmt.Errorf("%w: %w", ErrFeatureUnavailable, err)
	}
	instanceID := repo.functions.evolutionInstanceKey(providerSession, nil, nil)
	if instanceID == "" {
		return callMediaTicketResponse{}, fmt.Errorf("%w: Evolution instance identity is missing", ErrFeatureUnavailable)
	}
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return callMediaTicketResponse{}, err
	}
	expiresAt := time.Now().UTC().Add(30 * time.Second)
	ticket, err := signCallMediaClaims(callMediaClaims{
		Version: 1, InstanceID: instanceID, CallID: call.ProviderCallID,
		Subject: tenantContext.UserID, Expires: expiresAt.Unix(),
		Nonce: base64.RawURLEncoding.EncodeToString(nonce[:]),
	}, destination.CallMediaHMACSecret)
	if err != nil {
		return callMediaTicketResponse{}, err
	}
	mediaURL, err := callMediaWebSocketURL(destination.APIURL, ticket)
	if err != nil {
		return callMediaTicketResponse{}, err
	}
	return callMediaTicketResponse{URL: mediaURL, ExpiresAt: expiresAt}, nil
}

type callRecordingResponse struct {
	IncomingURL *string   `json:"incoming_url"`
	OutgoingURL *string   `json:"outgoing_url"`
	ExpiresAt   time.Time `json:"expires_at"`
}

func (repo Repository) callRecordingLinks(
	ctx context.Context,
	tenantContext tenant.Context,
	callID string,
) (callRecordingResponse, error) {
	call, err := repo.ownedCall(ctx, tenantContext, callID)
	if err != nil {
		return callRecordingResponse{}, err
	}
	if !stringIn(call.RecordingStatus, "ready", "partial") {
		return callRecordingResponse{}, fmt.Errorf("%w: gravação ainda não disponível", ErrFeatureUnavailable)
	}
	result := callRecordingResponse{ExpiresAt: time.Now().UTC().Add(time.Duration(whatsappCallRecordingSignedURLTTLSeconds) * time.Second)}
	if call.RecordingIncomingPath != nil {
		url, err := repo.storage.signedURL(ctx, whatsappCallRecordingBucket, *call.RecordingIncomingPath, whatsappCallRecordingSignedURLTTLSeconds)
		if err != nil || url == "" {
			return callRecordingResponse{}, errors.Join(ErrStorageNotConfigured, err)
		}
		result.IncomingURL = &url
	}
	if call.RecordingOutgoingPath != nil {
		url, err := repo.storage.signedURL(ctx, whatsappCallRecordingBucket, *call.RecordingOutgoingPath, whatsappCallRecordingSignedURLTTLSeconds)
		if err != nil || url == "" {
			return callRecordingResponse{}, errors.Join(ErrStorageNotConfigured, err)
		}
		result.OutgoingURL = &url
	}
	return result, nil
}

func (handler Handler) CallMediaTicket(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}
	ticket, err := handler.repo.issueCallMediaTicket(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, ticket)
}

func (handler Handler) CallRecording(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}
	links, err := handler.repo.callRecordingLinks(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[callRecordingResponse]{Data: links})
}
