package meta

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	conversionFeedbackMaxResponseBytes = int64(1 << 20)
)

var (
	conversionFeedbackDatasetIDPattern = regexp.MustCompile(`^[0-9]{5,30}$`)
	conversionFeedbackLeadIDPattern    = regexp.MustCompile(`^[0-9]{15,17}$`)
)

type conversionFeedbackJob struct {
	ID             string
	OrganizationID string
	IntegrationID  string
	DatasetID      string
	LeadgenID      string
	EventKind      string
	EventName      string
	EventID        string
	EventTime      time.Time
	TestEventCode  string
	Attempts       int
	MaxAttempts    int
}

type conversionFeedbackDelivery struct {
	Job         conversionFeedbackJob
	AccessToken string
	Email       string
	Phone       string
}

type conversionFeedbackUserData struct {
	LeadID json.Number `json:"lead_id"`
	Email  []string    `json:"em,omitempty"`
	Phone  []string    `json:"ph,omitempty"`
}

type conversionFeedbackEvent struct {
	EventName    string                     `json:"event_name"`
	EventTime    int64                      `json:"event_time"`
	EventID      string                     `json:"event_id"`
	ActionSource string                     `json:"action_source"`
	UserData     conversionFeedbackUserData `json:"user_data"`
	CustomData   map[string]string          `json:"custom_data"`
}

type conversionFeedbackRequest struct {
	Data          []conversionFeedbackEvent `json:"data"`
	PartnerAgent  string                    `json:"partner_agent,omitempty"`
	TestEventCode string                    `json:"test_event_code,omitempty"`
}

type conversionFeedbackResponse struct {
	EventsReceived int             `json:"events_received"`
	Messages       json.RawMessage `json:"messages"`
	TraceID        string          `json:"fbtrace_id"`
}

type conversionFeedbackGraphErrorBody struct {
	Error struct {
		Message     string `json:"message"`
		Type        string `json:"type"`
		Code        int    `json:"code"`
		Subcode     int    `json:"error_subcode"`
		IsTransient bool   `json:"is_transient"`
		TraceID     string `json:"fbtrace_id"`
	} `json:"error"`
}

type conversionFeedbackError struct {
	Code       string
	Message    string
	HTTPStatus int
	Retryable  bool
	RetryAfter time.Duration
	TraceID    string
}

func (err *conversionFeedbackError) Error() string {
	if err == nil {
		return "Meta conversion feedback failed"
	}
	if strings.TrimSpace(err.Message) == "" {
		return "Meta conversion feedback failed: " + err.Code
	}
	return "Meta conversion feedback failed: " + err.Message
}

type conversionFeedbackSendResult struct {
	EventsReceived int
	TraceID        string
}

func (repo Repository) sendConversionFeedbackEvent(ctx context.Context, delivery conversionFeedbackDelivery) (conversionFeedbackSendResult, error) {
	job := delivery.Job
	if !conversionFeedbackDatasetIDPattern.MatchString(job.DatasetID) {
		return conversionFeedbackSendResult{}, permanentConversionFeedbackError("invalid_dataset_id", "CRM Dataset ID is invalid")
	}
	if !conversionFeedbackLeadIDPattern.MatchString(job.LeadgenID) {
		return conversionFeedbackSendResult{}, permanentConversionFeedbackError("invalid_lead_id", "Meta lead ID is invalid")
	}
	if strings.TrimSpace(job.EventName) == "" || strings.TrimSpace(job.EventID) == "" {
		return conversionFeedbackSendResult{}, permanentConversionFeedbackError("invalid_event", "CRM event name or event ID is missing")
	}
	if job.EventTime.IsZero() {
		return conversionFeedbackSendResult{}, permanentConversionFeedbackError("invalid_event_time", "CRM event time is missing")
	}

	token := strings.TrimSpace(delivery.AccessToken)
	if token == "" {
		return conversionFeedbackSendResult{}, permanentConversionFeedbackError("missing_dataset_token", "CRM Dataset access token is unavailable")
	}
	userData := conversionFeedbackUserData{LeadID: json.Number(job.LeadgenID)}
	if normalized := normalizeConversionFeedbackEmail(delivery.Email); normalized != "" {
		userData.Email = []string{hashConversionFeedbackIdentifier(normalized)}
	}
	if normalized := normalizeConversionFeedbackPhone(delivery.Phone); normalized != "" {
		userData.Phone = []string{hashConversionFeedbackIdentifier(normalized)}
	}

	payload := conversionFeedbackRequest{
		Data: []conversionFeedbackEvent{{
			EventName:    job.EventName,
			EventTime:    job.EventTime.UTC().Unix(),
			EventID:      job.EventID,
			ActionSource: "system_generated",
			UserData:     userData,
			CustomData: map[string]string{
				"lead_event_source": "Vimob CRM",
				"event_source":      "crm",
			},
		}},
		PartnerAgent:  conversionFeedbackPartnerAgent(repo.config.ConversionFeedbackPartnerAgent),
		TestEventCode: strings.TrimSpace(job.TestEventCode),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return conversionFeedbackSendResult{}, permanentConversionFeedbackError("payload_encoding_failed", "CRM event payload could not be encoded")
	}

	graphURL, proof, err := repo.conversionFeedbackGraphURL(job.DatasetID, token)
	if err != nil {
		return conversionFeedbackSendResult{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, graphURL, bytes.NewReader(body))
	if err != nil {
		return conversionFeedbackSendResult{}, permanentConversionFeedbackError("request_creation_failed", "CRM event request could not be created")
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")

	response, err := repo.client.Do(request)
	if err != nil {
		return conversionFeedbackSendResult{}, &conversionFeedbackError{
			Code:      "network_error",
			Message:   sanitizeConversionFeedbackMessage(err.Error(), token, proof),
			Retryable: true,
		}
	}
	defer response.Body.Close()

	responseBody, readErr := io.ReadAll(io.LimitReader(response.Body, conversionFeedbackMaxResponseBytes))
	if readErr != nil {
		return conversionFeedbackSendResult{}, &conversionFeedbackError{
			Code:       "response_read_failed",
			Message:    "Meta response could not be read",
			HTTPStatus: response.StatusCode,
			Retryable:  true,
		}
	}

	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return conversionFeedbackSendResult{}, decodeConversionFeedbackGraphError(
			response.StatusCode,
			responseBody,
			token,
			proof,
			response.Header.Get("Retry-After"),
		)
	}

	var decoded conversionFeedbackResponse
	if err := json.Unmarshal(responseBody, &decoded); err != nil {
		return conversionFeedbackSendResult{}, &conversionFeedbackError{
			Code:       "invalid_provider_response",
			Message:    "Meta returned an invalid acknowledgement",
			HTTPStatus: response.StatusCode,
			Retryable:  true,
		}
	}
	if decoded.EventsReceived != 1 {
		return conversionFeedbackSendResult{}, &conversionFeedbackError{
			Code:       "event_not_acknowledged",
			Message:    "Meta did not acknowledge exactly one CRM event",
			HTTPStatus: response.StatusCode,
			Retryable:  true,
			TraceID:    strings.TrimSpace(decoded.TraceID),
		}
	}

	return conversionFeedbackSendResult{
		EventsReceived: decoded.EventsReceived,
		TraceID:        strings.TrimSpace(decoded.TraceID),
	}, nil
}

func conversionFeedbackPartnerAgent(value string) string {
	return strings.TrimSpace(value)
}

func (repo Repository) conversionFeedbackGraphURL(datasetID string, token string) (string, string, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(repo.config.GraphBaseURL), "/")
	version := strings.Trim(strings.TrimSpace(repo.config.GraphVersion), "/")
	if baseURL == "" || version == "" {
		return "", "", permanentConversionFeedbackError("graph_not_configured", "Meta Graph API is not configured")
	}

	parsed, err := url.Parse(baseURL + "/" + version + "/" + url.PathEscape(datasetID) + "/events")
	if err != nil {
		return "", "", permanentConversionFeedbackError("invalid_graph_url", "Meta Graph API URL is invalid")
	}
	proof := ""
	if repo.config.ConversionFeedbackAppSecretProofEnabled {
		appSecret := strings.TrimSpace(repo.config.AppSecret)
		if appSecret == "" {
			return "", "", permanentConversionFeedbackError("missing_app_secret", "Meta app secret is unavailable")
		}
		proof = oauthAppSecretProof(appSecret, token)
		query := parsed.Query()
		query.Set("appsecret_proof", proof)
		parsed.RawQuery = query.Encode()
	}
	return parsed.String(), proof, nil
}

func decodeConversionFeedbackGraphError(status int, body []byte, token string, proof string, retryAfterHeader string) error {
	var decoded conversionFeedbackGraphErrorBody
	_ = json.Unmarshal(body, &decoded)

	code := "http_" + strconv.Itoa(status)
	if decoded.Error.Code != 0 {
		code = strconv.Itoa(decoded.Error.Code)
		if decoded.Error.Subcode != 0 {
			code += "/" + strconv.Itoa(decoded.Error.Subcode)
		}
	}
	message := strings.TrimSpace(decoded.Error.Message)
	if message == "" {
		message = http.StatusText(status)
	}
	message = sanitizeConversionFeedbackMessage(message, token, proof)

	return &conversionFeedbackError{
		Code:       code,
		Message:    message,
		HTTPStatus: status,
		Retryable: status == http.StatusTooManyRequests ||
			status >= http.StatusInternalServerError ||
			decoded.Error.IsTransient ||
			isConversionFeedbackRateLimitCode(decoded.Error.Code),
		RetryAfter: parseConversionFeedbackRetryAfter(retryAfterHeader),
		TraceID:    strings.TrimSpace(decoded.Error.TraceID),
	}
}

func isConversionFeedbackRateLimitCode(code int) bool {
	switch code {
	case 4, 17, 32, 613:
		return true
	default:
		return false
	}
}

func parseConversionFeedbackRetryAfter(value string) time.Duration {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}
	if seconds, err := strconv.ParseInt(value, 10, 64); err == nil {
		if seconds <= 0 {
			return 0
		}
		return time.Duration(seconds) * time.Second
	}
	if retryAt, err := http.ParseTime(value); err == nil {
		delay := time.Until(retryAt)
		if delay > 0 {
			return delay
		}
	}
	return 0
}

func permanentConversionFeedbackError(code string, message string) error {
	return &conversionFeedbackError{Code: code, Message: message}
}

func normalizeConversionFeedbackEmail(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func normalizeConversionFeedbackPhone(value string) string {
	var digits strings.Builder
	for _, char := range value {
		if char >= '0' && char <= '9' {
			digits.WriteRune(char)
		}
	}
	return strings.TrimLeft(digits.String(), "0")
}

func hashConversionFeedbackIdentifier(value string) string {
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}

func sanitizeConversionFeedbackMessage(value string, secrets ...string) string {
	clean := strings.TrimSpace(value)
	for _, secret := range secrets {
		if secret = strings.TrimSpace(secret); secret != "" {
			clean = strings.ReplaceAll(clean, secret, "[redacted]")
		}
	}
	clean = strings.Map(func(char rune) rune {
		if char == '\n' || char == '\r' || char == '\t' {
			return ' '
		}
		if char < 32 || char == 127 {
			return -1
		}
		return char
	}, clean)
	if len(clean) > 2000 {
		clean = clean[:2000]
	}
	if clean == "" {
		return "Meta request failed"
	}
	return clean
}
