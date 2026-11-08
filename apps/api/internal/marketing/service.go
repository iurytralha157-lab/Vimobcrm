package marketing

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
)

// Store persists connections. The Postgres implementation only touches the
// marketing_connection*, marketing_oauth_flows and vault.secrets tables.
type Store interface {
	CreateFlow(ctx context.Context, flow Flow) (string, error)
	ConsumeFlow(ctx context.Context, flowID string, nonceHash string) (Flow, error)
	SaveConnection(ctx context.Context, input SaveConnectionInput) (string, error)
	ListConnections(ctx context.Context, organizationID string) ([]Connection, error)
	UpdateSelection(ctx context.Context, organizationID string, connectionID string, assetIDs []string) error
	DeleteConnection(ctx context.Context, organizationID string, connectionID string) error
	LoadSyncTarget(ctx context.Context, organizationID string, connectionID string) (SyncTarget, error)
	MarkSyncResult(ctx context.Context, organizationID string, connectionID string, status string, lastError string) error
}

type Service struct {
	config Config
	store  Store
	meta   *metaClient
	syncer Syncer
	now    func() time.Time
}

func NewService(config Config, store Store, syncer Syncer) *Service {
	return &Service{config: config, store: store, meta: newMetaClient(config.Meta, nil), syncer: syncer, now: time.Now}
}

func (service *Service) Availability(organizationID string) (enabled bool, metaConfigured bool) {
	return service.config.organizationEnabled(organizationID), service.config.Meta.configured()
}

func (service *Service) requireEnabled(organizationID string) error {
	if !service.config.organizationEnabled(organizationID) {
		return newFailure("marketing_connections_disabled", http.StatusForbidden)
	}
	return nil
}

func (service *Service) StartMeta(ctx context.Context, organizationID string, userID string, returnURL string) (string, error) {
	if err := service.requireEnabled(organizationID); err != nil {
		return "", err
	}
	if !service.config.Meta.configured() {
		return "", newFailure("marketing_meta_not_configured", http.StatusServiceUnavailable)
	}
	if !service.returnURLAllowed(returnURL) {
		return "", newFailure("invalid_return_url", http.StatusBadRequest)
	}
	nonce, err := randomNonce()
	if err != nil {
		return "", newFailure("marketing_connection_failed", http.StatusInternalServerError, err)
	}
	flowID, err := service.store.CreateFlow(ctx, Flow{
		OrganizationID: organizationID,
		UserID:         userID,
		Provider:       ProviderMeta,
		NonceHash:      hashNonce(nonce),
		ReturnURL:      returnURL,
		ExpiresAt:      service.now().UTC().Add(flowLifetime),
	})
	if err != nil {
		return "", err
	}
	return service.meta.authorizationURL(flowID + "." + nonce), nil
}

// CompleteMeta returns the validated return URL whenever the state was valid,
// so the browser can go back to the CRM even when the login failed. An invalid
// state returns no URL and never reaches the Graph API.
func (service *Service) CompleteMeta(ctx context.Context, state string, code string, providerError string) (string, error) {
	flowID, nonce, ok := strings.Cut(strings.TrimSpace(state), ".")
	if !ok || flowID == "" || nonce == "" {
		return "", newFailure("invalid_oauth_state", http.StatusBadRequest)
	}
	flow, err := service.store.ConsumeFlow(ctx, flowID, hashNonce(nonce))
	if err != nil {
		return "", err
	}
	if flow.Provider != ProviderMeta {
		return "", newFailure("invalid_oauth_state", http.StatusBadRequest)
	}
	if providerError != "" {
		return flow.ReturnURL, newFailure("meta_login_cancelled", http.StatusBadRequest)
	}
	if strings.TrimSpace(code) == "" {
		return flow.ReturnURL, newFailure("meta_code_missing", http.StatusBadRequest)
	}
	token, expiresAt, err := service.meta.exchangeCode(ctx, code)
	if err != nil {
		return flow.ReturnURL, err
	}
	identity, err := service.meta.fetchIdentity(ctx, token)
	if err != nil {
		return flow.ReturnURL, err
	}
	scopes, err := service.meta.fetchGrantedScopes(ctx, token)
	if err != nil {
		return flow.ReturnURL, err
	}
	assets, err := service.meta.fetchAssets(ctx, token)
	if err != nil && !isPermissionDenied(err) {
		return flow.ReturnURL, err
	}
	_, err = service.store.SaveConnection(ctx, SaveConnectionInput{
		OrganizationID:   flow.OrganizationID,
		UserID:           flow.UserID,
		Provider:         ProviderMeta,
		ExternalUserID:   identity.ID,
		ExternalUserName: identity.Name,
		GrantedScopes:    scopes,
		AccessToken:      token,
		TokenExpiresAt:   expiresAt,
		Assets:           assets,
	})
	return flow.ReturnURL, err
}

func (service *Service) List(ctx context.Context, organizationID string) ([]Connection, error) {
	if !service.config.organizationEnabled(organizationID) {
		return []Connection{}, nil
	}
	connections, err := service.store.ListConnections(ctx, organizationID)
	if err != nil {
		return nil, err
	}
	for index := range connections {
		connections[index].MissingScopes = missingScopes(connections[index])
	}
	return connections, nil
}

func (service *Service) UpdateSelection(ctx context.Context, organizationID string, connectionID string, assetIDs []string) error {
	if err := service.requireEnabled(organizationID); err != nil {
		return err
	}
	return service.store.UpdateSelection(ctx, organizationID, connectionID, assetIDs)
}

// Disconnect only forgets the login in the CRM. It must not call the provider:
// DELETE /me/permissions removes the whole app from the person's account,
// which would also take away the access the lead intake relies on.
func (service *Service) Disconnect(ctx context.Context, organizationID string, connectionID string) error {
	if err := service.requireEnabled(organizationID); err != nil {
		return err
	}
	return service.store.DeleteConnection(ctx, organizationID, connectionID)
}

func (service *Service) returnURLAllowed(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Host == "" || parsed.User != nil {
		return false
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return false
	}
	return service.originAllowed(parsed.Scheme + "://" + parsed.Host)
}

func (service *Service) originAllowed(origin string) bool {
	origin = strings.TrimRight(strings.TrimSpace(origin), "/")
	return origin != "" && slices.ContainsFunc(service.config.AllowedOrigins, func(item string) bool {
		return strings.EqualFold(strings.TrimRight(strings.TrimSpace(item), "/"), origin)
	})
}

func missingScopes(connection Connection) []string {
	missing := []string{}
	if connection.Provider != ProviderMeta {
		return missing
	}
	for _, scope := range metaLoginScopes {
		if !slices.Contains(connection.GrantedScopes, scope) {
			missing = append(missing, scope)
		}
	}
	return missing
}

func isPermissionDenied(err error) bool {
	var failure *Failure
	return errors.As(err, &failure) && failure.Code == "meta_permission_denied"
}

func randomNonce() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func hashNonce(nonce string) string {
	sum := sha256.Sum256([]byte(nonce))
	return hex.EncodeToString(sum[:])
}
