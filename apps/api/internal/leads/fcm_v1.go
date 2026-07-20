package leads

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	fcmMessagingScope   = "https://www.googleapis.com/auth/firebase.messaging"
	defaultFCMTokenURI  = "https://oauth2.googleapis.com/token"
	fcmTokenExpirySkew  = 2 * time.Minute
	fcmServiceGrantType = "urn:ietf:params:oauth:grant-type:jwt-bearer"
)

type firebaseServiceAccount struct {
	ProjectID   string `json:"project_id"`
	ClientEmail string `json:"client_email"`
	PrivateKey  string `json:"private_key"`
	TokenURI    string `json:"token_uri"`
}

type fcmOAuthTokenResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	ExpiresIn   int64  `json:"expires_in"`
}

func (client *notificationPushClient) fcmV1AccessToken(ctx context.Context) (string, string, error) {
	client.fcmTokenMu.Lock()
	defer client.fcmTokenMu.Unlock()

	if client.fcmAccessToken != "" && time.Now().Before(client.fcmAccessTokenExpiry.Add(-fcmTokenExpirySkew)) {
		projectID := strings.TrimSpace(client.fcmProjectID)
		if projectID != "" {
			return client.fcmAccessToken, projectID, nil
		}
	}

	account, err := client.loadFirebaseServiceAccount()
	if err != nil {
		return "", "", err
	}
	projectID := firstNotificationText(client.fcmProjectID, account.ProjectID)
	if projectID == "" {
		return "", "", errors.New("fcm_project_id_missing")
	}
	if account.ClientEmail == "" || account.PrivateKey == "" {
		return "", "", errors.New("fcm_service_account_incomplete")
	}

	token, expiresAt, err := client.requestFCMAccessToken(ctx, account)
	if err != nil {
		return "", "", err
	}
	client.fcmProjectID = projectID
	client.fcmAccessToken = token
	client.fcmAccessTokenExpiry = expiresAt
	return token, projectID, nil
}

func (client *notificationPushClient) loadFirebaseServiceAccount() (firebaseServiceAccount, error) {
	raw := strings.TrimSpace(client.fcmServiceAccountJSON)
	if raw == "" && strings.TrimSpace(client.fcmServiceAccountFile) != "" {
		payload, err := os.ReadFile(client.fcmServiceAccountFile)
		if err != nil {
			return firebaseServiceAccount{}, fmt.Errorf("fcm_service_account_file_error: %w", err)
		}
		raw = string(payload)
	}
	if raw == "" {
		return firebaseServiceAccount{}, errors.New("fcm_service_account_missing")
	}

	payload := normalizeServiceAccountJSON(raw)
	var account firebaseServiceAccount
	if err := json.Unmarshal(payload, &account); err != nil {
		return firebaseServiceAccount{}, fmt.Errorf("fcm_service_account_invalid: %w", err)
	}
	return account, nil
}

func normalizeServiceAccountJSON(raw string) []byte {
	trimmed := strings.TrimSpace(raw)
	if strings.HasPrefix(trimmed, "{") {
		return []byte(trimmed)
	}
	for _, encoding := range []*base64.Encoding{
		base64.StdEncoding,
		base64.RawStdEncoding,
		base64.URLEncoding,
		base64.RawURLEncoding,
	} {
		decoded, err := encoding.DecodeString(trimmed)
		if err == nil && strings.HasPrefix(strings.TrimSpace(string(decoded)), "{") {
			return decoded
		}
	}
	return []byte(trimmed)
}

func (client *notificationPushClient) requestFCMAccessToken(ctx context.Context, account firebaseServiceAccount) (string, time.Time, error) {
	tokenURI := firstNotificationText(account.TokenURI, defaultFCMTokenURI)
	assertion, err := signedServiceAccountAssertion(account, tokenURI)
	if err != nil {
		return "", time.Time{}, err
	}

	form := url.Values{}
	form.Set("grant_type", fcmServiceGrantType)
	form.Set("assertion", assertion)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenURI, strings.NewReader(form.Encode()))
	if err != nil {
		return "", time.Time{}, err
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	response, err := client.httpClient.Do(request)
	if err != nil {
		return "", time.Time{}, err
	}
	defer response.Body.Close()

	payload, err := io.ReadAll(io.LimitReader(response.Body, 4096))
	if err != nil {
		return "", time.Time{}, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", time.Time{}, fmt.Errorf("fcm_access_token_error: %s", trimMax(firstNotificationText(strings.TrimSpace(string(payload)), response.Status), 240))
	}

	var parsed fcmOAuthTokenResponse
	if err := json.Unmarshal(payload, &parsed); err != nil {
		return "", time.Time{}, err
	}
	if strings.TrimSpace(parsed.AccessToken) == "" {
		return "", time.Time{}, errors.New("fcm_access_token_missing")
	}
	expiresIn := parsed.ExpiresIn
	if expiresIn <= 0 {
		expiresIn = 3600
	}
	return strings.TrimSpace(parsed.AccessToken), time.Now().Add(time.Duration(expiresIn) * time.Second), nil
}

func signedServiceAccountAssertion(account firebaseServiceAccount, tokenURI string) (string, error) {
	now := time.Now().Unix()
	header := map[string]string{
		"alg": "RS256",
		"typ": "JWT",
	}
	claims := map[string]any{
		"iss":   account.ClientEmail,
		"scope": fcmMessagingScope,
		"aud":   tokenURI,
		"iat":   now,
		"exp":   now + 3600,
	}

	encodedHeader, err := encodeJWTPart(header)
	if err != nil {
		return "", err
	}
	encodedClaims, err := encodeJWTPart(claims)
	if err != nil {
		return "", err
	}
	signingInput := encodedHeader + "." + encodedClaims
	privateKey, err := parseServiceAccountPrivateKey(account.PrivateKey)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256([]byte(signingInput))
	signature, err := rsa.SignPKCS1v15(rand.Reader, privateKey, crypto.SHA256, digest[:])
	if err != nil {
		return "", err
	}
	return signingInput + "." + base64.RawURLEncoding.EncodeToString(signature), nil
}

func encodeJWTPart(value any) (string, error) {
	payload, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

func parseServiceAccountPrivateKey(raw string) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode(bytes.ReplaceAll([]byte(raw), []byte(`\n`), []byte("\n")))
	if block == nil {
		return nil, errors.New("fcm_private_key_invalid_pem")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err == nil {
		if privateKey, ok := parsed.(*rsa.PrivateKey); ok {
			return privateKey, nil
		}
		return nil, errors.New("fcm_private_key_not_rsa")
	}
	privateKey, rsaErr := x509.ParsePKCS1PrivateKey(block.Bytes)
	if rsaErr == nil {
		return privateKey, nil
	}
	return nil, fmt.Errorf("fcm_private_key_parse_error: %w", err)
}
