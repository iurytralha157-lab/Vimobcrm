package meta

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

type marketingSyncGraphErrorPayload struct {
	Code        int
	Subcode     int
	IsTransient bool
}

type marketingSyncGraphFailure struct {
	*MarketingSyncFailure
	GraphCode    int
	GraphSubcode int
}

func (failure *marketingSyncGraphFailure) Unwrap() error {
	if failure == nil {
		return nil
	}
	return failure.MarketingSyncFailure
}

type marketingSyncGraphCollection struct {
	Items     []map[string]any
	Truncated bool
}

type marketingSyncGraphClient struct {
	service     *MarketingSyncService
	accessToken string
	deadline    time.Time
	semaphore   chan struct{}
}

func (service *MarketingSyncService) newMarketingSyncGraphClient(accessToken string, deadline time.Time, semaphore chan struct{}) *marketingSyncGraphClient {
	return &marketingSyncGraphClient{
		service:     service,
		accessToken: strings.TrimSpace(accessToken),
		deadline:    deadline,
		semaphore:   semaphore,
	}
}

func (client *marketingSyncGraphClient) object(ctx context.Context, path string, parameters map[string]any) (map[string]any, error) {
	payload, err := client.request(ctx, path, parameters)
	if err != nil {
		return nil, err
	}
	record := marketingSyncRecord(payload)
	if record == nil {
		return nil, newMarketingSyncGraphFailure("meta_invalid_response", http.StatusBadGateway, marketingSyncGraphErrorPayload{})
	}
	return record, nil
}

func (client *marketingSyncGraphClient) collection(ctx context.Context, path string, parameters map[string]any, maximumItems int) (marketingSyncGraphCollection, error) {
	if maximumItems <= 0 || maximumItems > marketingSyncMaxGraphItems {
		maximumItems = marketingSyncMaxGraphItems
	}
	items := make([]map[string]any, 0)
	seenCursors := make(map[string]struct{})
	after := ""
	for page := 0; page < marketingSyncMaxGraphPages; page++ {
		pageParameters := make(map[string]any, len(parameters)+1)
		for key, value := range parameters {
			pageParameters[key] = value
		}
		if after != "" {
			pageParameters["after"] = after
		}
		payload, err := client.request(ctx, path, pageParameters)
		if err != nil {
			return marketingSyncGraphCollection{}, err
		}
		record := marketingSyncRecord(payload)
		if record == nil {
			return marketingSyncGraphCollection{}, newMarketingSyncGraphFailure("meta_invalid_response", http.StatusBadGateway, marketingSyncGraphErrorPayload{})
		}
		data, _ := record["data"].([]any)
		for _, value := range data {
			item := marketingSyncRecord(value)
			if item == nil {
				continue
			}
			items = append(items, item)
			if len(items) >= maximumItems {
				return marketingSyncGraphCollection{Items: items, Truncated: true}, nil
			}
		}
		paging := marketingSyncRecord(record["paging"])
		cursors := marketingSyncRecord(paging["cursors"])
		nextCursor := marketingSyncText(cursors["after"])
		// Meta considers the page complete when paging.next is absent. A stale
		// cursor can still be present on the terminal page, so both signals are
		// required before another request is issued.
		if marketingSyncText(paging["next"]) == "" || nextCursor == "" {
			return marketingSyncGraphCollection{Items: items}, nil
		}
		if _, exists := seenCursors[nextCursor]; exists {
			return marketingSyncGraphCollection{}, newMarketingSyncGraphFailure("meta_repeated_paging_cursor", http.StatusBadGateway, marketingSyncGraphErrorPayload{})
		}
		seenCursors[nextCursor] = struct{}{}
		after = nextCursor
	}
	return marketingSyncGraphCollection{Items: items, Truncated: true}, nil
}

func (client *marketingSyncGraphClient) request(ctx context.Context, path string, parameters map[string]any) (any, error) {
	endpoint, err := client.endpoint(path, parameters)
	if err != nil {
		return nil, err
	}
	var lastFailure error
	for attempt := 0; attempt < 3; attempt++ {
		if err := client.ensureBeforeDeadline(ctx); err != nil {
			return nil, err
		}
		payload, response, requestErr := client.requestOnce(ctx, endpoint)
		if requestErr == nil {
			graphError := parseMarketingSyncGraphError(payload)
			if response.StatusCode >= 200 && response.StatusCode < 300 && graphError == nil {
				return payload, nil
			}
			failure := classifyMarketingSyncGraphFailure(response.StatusCode, graphError)
			lastFailure = failure
			if !shouldRetryMarketingSyncGraph(response.StatusCode, graphError) || attempt == 2 {
				return nil, failure
			}
			if err := client.waitForRetry(ctx, response.Header.Get("Retry-After"), attempt); err != nil {
				return nil, err
			}
			continue
		}

		lastFailure = requestErr
		var syncFailure *MarketingSyncFailure
		if errors.As(requestErr, &syncFailure) && syncFailure.Code == "sync_runtime_exceeded" {
			return nil, requestErr
		}
		if attempt == 2 {
			return nil, requestErr
		}
		if err := client.waitForRetry(ctx, "", attempt); err != nil {
			return nil, err
		}
	}
	if lastFailure != nil {
		return nil, lastFailure
	}
	return nil, newMarketingSyncGraphFailure("meta_request_failed", http.StatusBadGateway, marketingSyncGraphErrorPayload{})
}

func (client *marketingSyncGraphClient) endpoint(path string, parameters map[string]any) (*url.URL, error) {
	path = strings.TrimSpace(path)
	segments := strings.Split(strings.Trim(path, "/"), "/")
	if path == "" || len(segments) == 0 {
		return nil, newMarketingSyncFailure("invalid_meta_graph_path", http.StatusInternalServerError, nil)
	}
	escaped := make([]string, 0, len(segments))
	for _, segment := range segments {
		segment = strings.TrimSpace(segment)
		if segment == "" || segment == "." || segment == ".." {
			return nil, newMarketingSyncFailure("invalid_meta_graph_path", http.StatusInternalServerError, nil)
		}
		escaped = append(escaped, url.PathEscape(segment))
	}
	endpoint, err := url.Parse(client.service.graphBaseURL + "/" + client.service.graphVersion + "/" + strings.Join(escaped, "/"))
	if err != nil {
		return nil, newMarketingSyncFailure("invalid_meta_graph_path", http.StatusInternalServerError, err)
	}
	query := endpoint.Query()
	for key, value := range parameters {
		if value == nil {
			continue
		}
		query.Set(key, fmt.Sprint(value))
	}
	if client.accessToken == "" {
		return nil, newMarketingSyncFailure("meta_access_token_missing", http.StatusUnauthorized, nil)
	}
	if client.service == nil || client.service.appSecret == "" {
		return nil, newMarketingSyncFailure("meta_app_secret_missing", http.StatusServiceUnavailable, nil)
	}
	proof := hmac.New(sha256.New, []byte(client.service.appSecret))
	_, _ = proof.Write([]byte(client.accessToken))
	// Set this after caller parameters so an internal caller cannot override
	// the proof. The access token itself remains only in Authorization.
	query.Set("appsecret_proof", hex.EncodeToString(proof.Sum(nil)))
	endpoint.RawQuery = query.Encode()
	return endpoint, nil
}

func (client *marketingSyncGraphClient) requestOnce(ctx context.Context, endpoint *url.URL) (any, *http.Response, error) {
	remaining := time.Until(client.deadline)
	if remaining <= 0 {
		return nil, nil, newMarketingSyncFailure("sync_runtime_exceeded", http.StatusServiceUnavailable, context.DeadlineExceeded)
	}
	timeout := min(client.service.requestTimeout, remaining)
	requestCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	request, err := http.NewRequestWithContext(requestCtx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, nil, newMarketingSyncFailure("meta_request_failed", http.StatusBadGateway, err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", "Bearer "+client.accessToken)

	if err := client.acquire(requestCtx); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, nil, newMarketingSyncFailure("meta_request_timeout", http.StatusGatewayTimeout, err)
		}
		return nil, nil, newMarketingSyncFailure("meta_request_failed", http.StatusBadGateway, err)
	}
	defer client.release()

	httpClient := *client.service.httpClient
	httpClient.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}
	response, err := httpClient.Do(request)
	if err != nil {
		if errors.Is(requestCtx.Err(), context.DeadlineExceeded) {
			return nil, nil, newMarketingSyncFailure("meta_request_timeout", http.StatusGatewayTimeout, err)
		}
		if errors.Is(requestCtx.Err(), context.Canceled) {
			return nil, nil, newMarketingSyncFailure("meta_request_failed", http.StatusBadGateway, err)
		}
		return nil, nil, newMarketingSyncGraphFailure("meta_request_failed", http.StatusBadGateway, marketingSyncGraphErrorPayload{})
	}
	defer response.Body.Close()

	decoder := json.NewDecoder(io.LimitReader(response.Body, marketingSyncMaxResponseBytes+1))
	decoder.UseNumber()
	var payload any
	if err := decoder.Decode(&payload); err != nil {
		if !errors.Is(err, io.EOF) {
			return nil, response, newMarketingSyncGraphFailure("meta_invalid_response", http.StatusBadGateway, marketingSyncGraphErrorPayload{})
		}
	}
	return payload, response, nil
}

func (client *marketingSyncGraphClient) acquire(ctx context.Context) error {
	select {
	case client.semaphore <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (client *marketingSyncGraphClient) release() {
	select {
	case <-client.semaphore:
	default:
	}
}

func (client *marketingSyncGraphClient) ensureBeforeDeadline(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return newMarketingSyncFailure("sync_runtime_exceeded", http.StatusServiceUnavailable, err)
		}
		return err
	}
	if !client.service.now().Before(client.deadline) {
		return newMarketingSyncFailure("sync_runtime_exceeded", http.StatusServiceUnavailable, context.DeadlineExceeded)
	}
	return nil
}

func (client *marketingSyncGraphClient) waitForRetry(ctx context.Context, retryAfter string, attempt int) error {
	delay := time.Duration(1<<attempt) * 750 * time.Millisecond
	if seconds, err := strconv.ParseFloat(strings.TrimSpace(retryAfter), 64); err == nil && seconds >= 0 {
		delay = time.Duration(seconds * float64(time.Second))
	} else if when, err := http.ParseTime(strings.TrimSpace(retryAfter)); err == nil {
		delay = max(0, time.Until(when))
	}
	delay = min(delay, 8*time.Second)
	if !client.service.now().Add(delay).Before(client.deadline) {
		return newMarketingSyncFailure("sync_runtime_exceeded", http.StatusServiceUnavailable, context.DeadlineExceeded)
	}
	if err := client.service.sleep(ctx, delay); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return newMarketingSyncFailure("sync_runtime_exceeded", http.StatusServiceUnavailable, err)
		}
		return err
	}
	return nil
}

func newMarketingSyncGraphFailure(code string, status int, payload marketingSyncGraphErrorPayload) *marketingSyncGraphFailure {
	return &marketingSyncGraphFailure{
		MarketingSyncFailure: newMarketingSyncFailure(code, status, nil),
		GraphCode:            payload.Code,
		GraphSubcode:         payload.Subcode,
	}
}

func parseMarketingSyncGraphError(payload any) *marketingSyncGraphErrorPayload {
	record := marketingSyncRecord(payload)
	errorRecord := marketingSyncRecord(record["error"])
	if errorRecord == nil {
		return nil
	}
	return &marketingSyncGraphErrorPayload{
		Code:        marketingSyncInteger(errorRecord["code"]),
		Subcode:     marketingSyncInteger(errorRecord["error_subcode"]),
		IsTransient: errorRecord["is_transient"] == true,
	}
}

func classifyMarketingSyncGraphFailure(status int, payload *marketingSyncGraphErrorPayload) error {
	errorPayload := marketingSyncGraphErrorPayload{}
	if payload != nil {
		errorPayload = *payload
	}
	switch {
	case status == http.StatusTooManyRequests || containsMarketingSyncInt([]int{4, 17, 32, 613}, errorPayload.Code):
		return newMarketingSyncGraphFailure("meta_rate_limited", http.StatusTooManyRequests, errorPayload)
	case errorPayload.Code == 190:
		return newMarketingSyncGraphFailure("meta_access_token_invalid", http.StatusUnauthorized, errorPayload)
	case containsMarketingSyncInt([]int{10, 200, 294}, errorPayload.Code):
		return newMarketingSyncGraphFailure("meta_permission_denied", http.StatusForbidden, errorPayload)
	case errorPayload.Code == 100 && errorPayload.Subcode == 33:
		return newMarketingSyncGraphFailure("meta_object_unavailable", http.StatusNotFound, errorPayload)
	case errorPayload.Code == 100:
		return newMarketingSyncGraphFailure("meta_unsupported_parameter", http.StatusUnprocessableEntity, errorPayload)
	case status >= http.StatusInternalServerError || errorPayload.IsTransient:
		return newMarketingSyncGraphFailure("meta_temporarily_unavailable", http.StatusServiceUnavailable, errorPayload)
	default:
		return newMarketingSyncGraphFailure("meta_graph_error", http.StatusBadGateway, errorPayload)
	}
}

func shouldRetryMarketingSyncGraph(status int, payload *marketingSyncGraphErrorPayload) bool {
	if status == http.StatusTooManyRequests || status >= http.StatusInternalServerError {
		return true
	}
	if payload == nil {
		return false
	}
	return payload.IsTransient || containsMarketingSyncInt([]int{4, 17, 32, 613}, payload.Code)
}

func containsMarketingSyncInt(values []int, candidate int) bool {
	for _, value := range values {
		if value == candidate {
			return true
		}
	}
	return false
}

func marketingSyncRecord(value any) map[string]any {
	if record, ok := value.(map[string]any); ok {
		return record
	}
	return nil
}

func marketingSyncText(value any) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func marketingSyncNumber(value any) float64 {
	switch value := value.(type) {
	case float64:
		return value
	case float32:
		return float64(value)
	case int:
		return float64(value)
	case int64:
		return float64(value)
	case json.Number:
		parsed, _ := value.Float64()
		return parsed
	default:
		parsed, _ := strconv.ParseFloat(marketingSyncText(value), 64)
		return parsed
	}
}

func marketingSyncInteger(value any) int {
	return int(marketingSyncNumber(value))
}

func marketingSyncMapLimited[T any, R any](ctx context.Context, items []T, concurrency int, operation func(context.Context, T, int) R) []R {
	if len(items) == 0 {
		return nil
	}
	concurrency = min(max(1, concurrency), len(items))
	results := make([]R, len(items))
	jobs := make(chan int)
	var workers sync.WaitGroup
	workers.Add(concurrency)
	for range concurrency {
		go func() {
			defer workers.Done()
			for index := range jobs {
				results[index] = operation(ctx, items[index], index)
			}
		}()
	}
	for index := range items {
		select {
		case jobs <- index:
		case <-ctx.Done():
			close(jobs)
			workers.Wait()
			return results
		}
	}
	close(jobs)
	workers.Wait()
	return results
}
