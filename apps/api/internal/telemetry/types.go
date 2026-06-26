package telemetry

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

const (
	defaultLimit = 50
	maxLimit     = 200
)

var (
	ErrInvalidInput  = errors.New("invalid telemetry input")
	ErrEventNotFound = errors.New("error event not found")
)

type ErrorEvent struct {
	ID             string         `json:"id"`
	OrganizationID string         `json:"organizationId,omitempty"`
	UserID         string         `json:"userId,omitempty"`
	RequestID      string         `json:"requestId,omitempty"`
	Source         string         `json:"source"`
	Severity       string         `json:"severity"`
	Category       string         `json:"category,omitempty"`
	Message        string         `json:"message"`
	ErrorCode      string         `json:"errorCode,omitempty"`
	HTTPStatus     int            `json:"httpStatus,omitempty"`
	Method         string         `json:"method,omitempty"`
	Path           string         `json:"path,omitempty"`
	Route          string         `json:"route,omitempty"`
	Component      string         `json:"component,omitempty"`
	Stack          string         `json:"stack,omitempty"`
	StackHash      string         `json:"stackHash,omitempty"`
	Fingerprint    string         `json:"fingerprint"`
	URL            string         `json:"url,omitempty"`
	UserAgent      string         `json:"userAgent,omitempty"`
	BrowserContext map[string]any `json:"browserContext"`
	Metadata       map[string]any `json:"metadata"`
	CreatedAt      time.Time      `json:"createdAt"`
	ResolvedAt     *time.Time     `json:"resolvedAt,omitempty"`
	ResolvedBy     string         `json:"resolvedBy,omitempty"`
	ResolutionNote string         `json:"resolutionNote,omitempty"`
}

type ListResponse struct {
	Data   []ErrorEvent `json:"data"`
	Total  int64        `json:"total"`
	Limit  int          `json:"limit"`
	Offset int          `json:"offset"`
}

type CreateErrorEventRequest struct {
	RequestID      string         `json:"requestId,omitempty"`
	Source         string         `json:"source,omitempty"`
	Severity       string         `json:"severity,omitempty"`
	Category       string         `json:"category,omitempty"`
	Message        string         `json:"message"`
	ErrorCode      string         `json:"errorCode,omitempty"`
	HTTPStatus     int            `json:"httpStatus,omitempty"`
	Method         string         `json:"method,omitempty"`
	Path           string         `json:"path,omitempty"`
	Route          string         `json:"route,omitempty"`
	Component      string         `json:"component,omitempty"`
	Stack          string         `json:"stack,omitempty"`
	StackHash      string         `json:"stackHash,omitempty"`
	Fingerprint    string         `json:"fingerprint,omitempty"`
	URL            string         `json:"url,omitempty"`
	UserAgent      string         `json:"userAgent,omitempty"`
	BrowserContext map[string]any `json:"browserContext,omitempty"`
	Metadata       map[string]any `json:"metadata,omitempty"`
}

type ResolveErrorEventRequest struct {
	Note string `json:"note,omitempty"`
}

type createInput struct {
	RequestID      string
	Source         string
	Severity       string
	Category       string
	Message        string
	ErrorCode      string
	HTTPStatus     int
	Method         string
	Path           string
	Route          string
	Component      string
	Stack          string
	StackHash      string
	Fingerprint    string
	URL            string
	UserAgent      string
	BrowserContext map[string]any
	Metadata       map[string]any
}

type ListFilter struct {
	Limit          int
	Offset         int
	Search         string
	Severity       string
	Source         string
	OrganizationID string
	Fingerprint    string
	Unresolved     bool
}

func (request CreateErrorEventRequest) Validate() (createInput, error) {
	input := createInput{
		RequestID:      trimMax(request.RequestID, 160),
		Source:         trimMax(strings.ToLower(request.Source), 40),
		Severity:       trimMax(strings.ToLower(request.Severity), 40),
		Category:       trimMax(strings.ToLower(request.Category), 80),
		Message:        trimMax(request.Message, 2_000),
		ErrorCode:      trimMax(request.ErrorCode, 120),
		HTTPStatus:     request.HTTPStatus,
		Method:         trimMax(strings.ToUpper(request.Method), 12),
		Path:           trimMax(request.Path, 500),
		Route:          trimMax(request.Route, 500),
		Component:      trimMax(request.Component, 180),
		Stack:          trimMax(request.Stack, 8_000),
		StackHash:      trimMax(request.StackHash, 80),
		Fingerprint:    trimMax(request.Fingerprint, 160),
		URL:            trimMax(request.URL, 1_000),
		UserAgent:      trimMax(request.UserAgent, 500),
		BrowserContext: boundedMap(redactMap(request.BrowserContext), 8_000),
		Metadata:       boundedMap(redactMap(request.Metadata), 8_000),
	}

	if input.Source == "" {
		input.Source = "frontend"
	}
	if !validEnum(input.Source, "frontend", "backend", "api") {
		return createInput{}, fmt.Errorf("%w: source is invalid", ErrInvalidInput)
	}

	if input.Severity == "" {
		input.Severity = "error"
	}
	if !validEnum(input.Severity, "debug", "info", "warning", "error", "critical") {
		return createInput{}, fmt.Errorf("%w: severity is invalid", ErrInvalidInput)
	}

	if input.Message == "" {
		return createInput{}, fmt.Errorf("%w: message is required", ErrInvalidInput)
	}

	if input.HTTPStatus != 0 && (input.HTTPStatus < 100 || input.HTTPStatus > 599) {
		return createInput{}, fmt.Errorf("%w: httpStatus is invalid", ErrInvalidInput)
	}

	if input.StackHash == "" && input.Stack != "" {
		input.StackHash = hashString(input.Stack, 32)
	}
	if input.Fingerprint == "" {
		input.Fingerprint = buildFingerprint(input)
	}

	return input, nil
}

func (request ResolveErrorEventRequest) Validate() string {
	return trimMax(request.Note, 500)
}

func ParseListFilter(values url.Values) (ListFilter, error) {
	limit, err := parseBoundedInt(values.Get("limit"), defaultLimit, 1, maxLimit)
	if err != nil {
		return ListFilter{}, err
	}

	offset, err := parseBoundedInt(values.Get("offset"), 0, 0, 100_000)
	if err != nil {
		return ListFilter{}, err
	}

	filter := ListFilter{
		Limit:          limit,
		Offset:         offset,
		Search:         trimMax(values.Get("search"), 120),
		Severity:       trimMax(strings.ToLower(values.Get("severity")), 40),
		Source:         trimMax(strings.ToLower(values.Get("source")), 40),
		OrganizationID: strings.TrimSpace(values.Get("organizationId")),
		Fingerprint:    trimMax(values.Get("fingerprint"), 160),
		Unresolved:     values.Get("unresolved") == "true",
	}

	if filter.Severity != "" && !validEnum(filter.Severity, "debug", "info", "warning", "error", "critical") {
		return ListFilter{}, fmt.Errorf("%w: severity is invalid", ErrInvalidInput)
	}
	if filter.Source != "" && !validEnum(filter.Source, "frontend", "backend", "api") {
		return ListFilter{}, fmt.Errorf("%w: source is invalid", ErrInvalidInput)
	}
	if filter.OrganizationID != "" && !isUUID(filter.OrganizationID) {
		return ListFilter{}, fmt.Errorf("%w: organizationId is invalid", ErrInvalidInput)
	}

	return filter, nil
}

func buildFingerprint(input createInput) string {
	parts := []string{
		input.Source,
		input.Category,
		input.ErrorCode,
		input.Method,
		input.Path,
		input.Route,
		input.Component,
		strconv.Itoa(input.HTTPStatus),
		normalizeFingerprintMessage(input.Message),
	}

	return hashString(strings.Join(parts, "|"), 32)
}

func normalizeFingerprintMessage(value string) string {
	return strings.ToLower(strings.Join(strings.Fields(value), " "))
}

func hashString(value string, maxLength int) string {
	sum := sha256.Sum256([]byte(value))
	out := hex.EncodeToString(sum[:])
	if maxLength > 0 && len(out) > maxLength {
		return out[:maxLength]
	}
	return out
}

func boundedMap(value map[string]any, maxBytes int) map[string]any {
	if value == nil {
		return map[string]any{}
	}

	payload, err := json.Marshal(value)
	if err != nil {
		return map[string]any{"invalid": true}
	}
	if len(payload) <= maxBytes {
		return value
	}

	return map[string]any{
		"truncated":     true,
		"originalBytes": len(payload),
	}
}

func redactMap(value map[string]any) map[string]any {
	if value == nil {
		return nil
	}

	out := make(map[string]any, len(value))
	for key, item := range value {
		if isSensitiveKey(key) {
			out[key] = "[redacted]"
			continue
		}

		switch typed := item.(type) {
		case map[string]any:
			out[key] = redactMap(typed)
		case []any:
			out[key] = redactSlice(typed)
		default:
			out[key] = typed
		}
	}

	return out
}

func redactSlice(value []any) []any {
	out := make([]any, 0, len(value))
	for _, item := range value {
		switch typed := item.(type) {
		case map[string]any:
			out = append(out, redactMap(typed))
		case []any:
			out = append(out, redactSlice(typed))
		default:
			out = append(out, typed)
		}
	}
	return out
}

func isSensitiveKey(key string) bool {
	normalized := strings.ToLower(key)
	for _, marker := range []string{"token", "secret", "password", "authorization", "cookie", "apikey", "api_key"} {
		if strings.Contains(normalized, marker) {
			return true
		}
	}
	return false
}

func parseBoundedInt(raw string, fallback int, min int, max int) (int, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fallback, nil
	}

	value, err := strconv.Atoi(raw)
	if err != nil || value < min || value > max {
		return 0, fmt.Errorf("%w: pagination value is invalid", ErrInvalidInput)
	}

	return value, nil
}

func trimMax(value string, maxLength int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) > maxLength {
		return string(runes[:maxLength])
	}
	return value
}

func validEnum(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}

func isUUID(value string) bool {
	var uuid pgtype.UUID
	if err := uuid.Scan(strings.TrimSpace(value)); err != nil {
		return false
	}
	return uuid.Valid
}
