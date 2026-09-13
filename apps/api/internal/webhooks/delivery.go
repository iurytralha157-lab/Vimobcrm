package webhooks

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	webhookDeliveryBatchSize = 20
	webhookDeliveryLease     = 90 * time.Second
	webhookDeliveryWorkers   = 8
	webhookDeliveryInterval  = 2 * time.Second
	webhookRequestTimeout    = 10 * time.Second
)

var blockedWebhookNetworkPrefixes = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("100::/64"),
	netip.MustParsePrefix("2001:db8::/32"),
}

type webhookDelivery struct {
	ID            string
	WebhookID     string
	EventType     string
	EventKey      string
	TargetURL     string
	SigningSecret string
	Payload       []byte
	Attempts      int
	MaxAttempts   int
}

// StartDeliveryWorker drains the private outbox. App wiring places this method
// behind the global background-worker gate, so API-only replicas can opt out.
func (repo Repository) StartDeliveryWorker(ctx context.Context, logger *slog.Logger) {
	workerID := newWebhookWorkerID()
	repo.processWebhookDeliveries(ctx, logger, workerID)
	ticker := time.NewTicker(webhookDeliveryInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			repo.processWebhookDeliveries(ctx, logger, workerID)
		}
	}
}

func (repo Repository) processWebhookDeliveries(ctx context.Context, logger *slog.Logger, workerID string) {
	deliveries, err := repo.claimWebhookDeliveries(ctx, workerID, webhookDeliveryBatchSize)
	if err != nil {
		if logger != nil && ctx.Err() == nil {
			logger.Error("claim outgoing webhook deliveries", "error", err)
		}
		return
	}

	client := newWebhookHTTPClient()
	semaphore := make(chan struct{}, webhookDeliveryWorkers)
	var group sync.WaitGroup
	for _, delivery := range deliveries {
		delivery := delivery
		group.Add(1)
		go func() {
			defer group.Done()
			semaphore <- struct{}{}
			defer func() { <-semaphore }()

			status, deliveryErr := deliverWebhook(ctx, client, delivery)
			if err := repo.finishWebhookDelivery(ctx, workerID, delivery, status, deliveryErr); err != nil && logger != nil && ctx.Err() == nil {
				logger.Error(
					"finish outgoing webhook delivery",
					"delivery_id", delivery.ID,
					"webhook_id", delivery.WebhookID,
					"error", err,
				)
			}
		}()
	}
	group.Wait()
}

func (repo Repository) claimWebhookDeliveries(
	ctx context.Context,
	workerID string,
	limit int,
) ([]webhookDelivery, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		with candidate as (
			select delivery.id
			from private.webhook_delivery_outbox delivery
			join public.webhooks_integrations webhook
			  on webhook.id = delivery.webhook_id
			 and webhook.organization_id = delivery.organization_id
			join public.organizations organization
			  on organization.id = delivery.organization_id
			 and coalesce(organization.is_active, true) = true
			where delivery.attempts < delivery.max_attempts
			  and (
			    (delivery.status in ('pending', 'retry') and delivery.next_attempt_at <= now())
			    or (delivery.status = 'delivering' and delivery.lease_until < now())
			  )
			  and webhook.type = 'outgoing'
			  and webhook.is_active = true
			  and exists (
				select 1
				from public.organization_modules module
				where module.organization_id = delivery.organization_id
				  and lower(trim(module.module_name)) = 'webhooks'
				  and coalesce(module.is_enabled, false) = true
			  )
			  and (
				(lower(trim(organization.subscription_type)) = 'free'
				  and lower(trim(organization.subscription_status)) = 'active')
				or (lower(trim(organization.subscription_type)) = 'trial'
				  and lower(trim(organization.subscription_status)) = 'trial'
				  and organization.trial_ends_at > now())
				or (lower(trim(organization.subscription_type)) = 'paid' and (
				  lower(trim(organization.subscription_status)) = 'active'
				  or (lower(trim(organization.subscription_status)) in ('overdue', 'past_due')
				    and organization.billing_grace_until > now())
				))
			  )
			order by delivery.next_attempt_at, delivery.created_at, delivery.id
			limit $2
			for update of delivery skip locked
		), claimed as (
			update private.webhook_delivery_outbox delivery
			set status = 'delivering',
			    attempts = delivery.attempts + 1,
			    lease_owner = $1,
			    lease_until = now() + $3::interval,
			    updated_at = now()
			from candidate
			where delivery.id = candidate.id
			returning delivery.*
		)
		select
			claimed.id::text,
			claimed.webhook_id::text,
			claimed.event_type,
			claimed.event_key,
			webhook.webhook_url,
			webhook.api_token,
			claimed.payload,
			claimed.attempts,
			claimed.max_attempts
		from claimed
		join public.webhooks_integrations webhook
		  on webhook.id = claimed.webhook_id
		order by claimed.created_at, claimed.id
	`, workerID, limit, webhookDeliveryLease.String())
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	deliveries := make([]webhookDelivery, 0, limit)
	for rows.Next() {
		var delivery webhookDelivery
		if err := rows.Scan(
			&delivery.ID,
			&delivery.WebhookID,
			&delivery.EventType,
			&delivery.EventKey,
			&delivery.TargetURL,
			&delivery.SigningSecret,
			&delivery.Payload,
			&delivery.Attempts,
			&delivery.MaxAttempts,
		); err != nil {
			return nil, err
		}
		deliveries = append(deliveries, delivery)
	}
	return deliveries, rows.Err()
}

func deliverWebhook(
	ctx context.Context,
	client *http.Client,
	delivery webhookDelivery,
) (int, error) {
	if _, err := validateOutgoingWebhookURL(delivery.TargetURL); err != nil {
		return 0, err
	}
	if len(delivery.SigningSecret) < 32 {
		return 0, errors.New("webhook signing secret is unavailable")
	}

	requestContext, cancel := context.WithTimeout(ctx, webhookRequestTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(
		requestContext,
		http.MethodPost,
		delivery.TargetURL,
		bytes.NewReader(delivery.Payload),
	)
	if err != nil {
		return 0, err
	}
	timestamp := strconv.FormatInt(time.Now().UTC().Unix(), 10)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", "Vimob-Webhooks/1.0")
	request.Header.Set("X-Vimob-Delivery", delivery.ID)
	request.Header.Set("X-Vimob-Event", delivery.EventType)
	request.Header.Set("X-Vimob-Timestamp", timestamp)
	request.Header.Set("X-Vimob-Signature", webhookSignature(delivery.SigningSecret, timestamp, delivery.Payload))
	request.Header.Set("Idempotency-Key", delivery.EventKey)

	response, err := client.Do(request)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return response.StatusCode, fmt.Errorf("webhook endpoint returned HTTP %d", response.StatusCode)
	}
	return response.StatusCode, nil
}

func webhookSignature(secret string, timestamp string, payload []byte) string {
	signature := hmac.New(sha256.New, []byte(secret))
	_, _ = signature.Write([]byte(timestamp))
	_, _ = signature.Write([]byte("."))
	_, _ = signature.Write(payload)
	return "sha256=" + hex.EncodeToString(signature.Sum(nil))
}

func (repo Repository) finishWebhookDelivery(
	ctx context.Context,
	workerID string,
	delivery webhookDelivery,
	responseStatus int,
	deliveryErr error,
) error {
	if deliveryErr == nil {
		_, err := repo.db.Pool().Exec(ctx, `
			with completed as (
				update private.webhook_delivery_outbox
				set status = 'delivered',
				    response_status = $3,
				    last_error = null,
				    delivered_at = now(),
				    lease_owner = null,
				    lease_until = null,
				    updated_at = now()
				where id = $1::uuid
				  and lease_owner = $2
				  and status = 'delivering'
				returning webhook_id
			)
			update public.webhooks_integrations webhook
			set last_triggered_at = now(), updated_at = now()
			from completed
			where webhook.id = completed.webhook_id
		`, delivery.ID, workerID, responseStatus)
		return err
	}

	terminal := !webhookDeliveryShouldRetry(responseStatus) || delivery.Attempts >= delivery.MaxAttempts
	status := "retry"
	if terminal {
		status = "dead"
	}
	nextAttempt := time.Now().UTC().Add(webhookRetryDelay(delivery.Attempts))
	errorMessage := truncateWebhookError(deliveryErr.Error())
	persistedResponseStatus := responseStatus
	if persistedResponseStatus < 100 || persistedResponseStatus > 599 {
		persistedResponseStatus = 0
	}
	_, err := repo.db.Pool().Exec(ctx, `
		update private.webhook_delivery_outbox
		set status = $3,
		    response_status = nullif($4, 0),
		    last_error = $5,
		    next_attempt_at = $6,
		    lease_owner = null,
		    lease_until = null,
		    updated_at = now()
		where id = $1::uuid
		  and lease_owner = $2
		  and status = 'delivering'
	`, delivery.ID, workerID, status, persistedResponseStatus, errorMessage, nextAttempt)
	return err
}

func webhookDeliveryShouldRetry(responseStatus int) bool {
	return responseStatus == 0 ||
		responseStatus == http.StatusRequestTimeout ||
		responseStatus == http.StatusTooEarly ||
		responseStatus == http.StatusTooManyRequests ||
		(responseStatus >= http.StatusInternalServerError && responseStatus <= 599)
}

func webhookRetryDelay(attempt int) time.Duration {
	schedule := []time.Duration{
		time.Minute,
		5 * time.Minute,
		30 * time.Minute,
		2 * time.Hour,
		6 * time.Hour,
		12 * time.Hour,
	}
	if attempt < 1 {
		return schedule[0]
	}
	index := attempt - 1
	if index >= len(schedule) {
		index = len(schedule) - 1
	}
	return schedule[index]
}

func truncateWebhookError(message string) string {
	message = strings.TrimSpace(message)
	if len(message) <= 2000 {
		return message
	}
	return message[:2000]
}

func newWebhookWorkerID() string {
	var random [12]byte
	if _, err := rand.Read(random[:]); err != nil {
		return fmt.Sprintf("webhook-worker-%d", time.Now().UnixNano())
	}
	return "webhook-worker-" + hex.EncodeToString(random[:])
}

func validateOutgoingWebhookURL(rawURL string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil {
		return nil, errors.New("outgoing webhook URL must be a public HTTPS URL")
	}
	hostname := strings.ToLower(strings.TrimSuffix(parsed.Hostname(), "."))
	if hostname == "localhost" || strings.HasSuffix(hostname, ".localhost") || strings.HasSuffix(hostname, ".local") {
		return nil, errors.New("outgoing webhook URL cannot target a local host")
	}
	if address, err := netip.ParseAddr(hostname); err == nil && !isPublicWebhookAddress(address) {
		return nil, errors.New("outgoing webhook URL cannot target a private address")
	}
	return parsed, nil
}

func newWebhookHTTPClient() *http.Client {
	dialer := &net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}
	transport := &http.Transport{
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          50,
		IdleConnTimeout:       30 * time.Second,
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: 8 * time.Second,
	}
	transport.DialContext = func(ctx context.Context, network string, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		addresses, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		if err != nil {
			return nil, err
		}
		for _, candidate := range addresses {
			candidate = candidate.Unmap()
			if !isPublicWebhookAddress(candidate) {
				continue
			}
			connection, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(candidate.String(), port))
			if dialErr == nil {
				return connection, nil
			}
			err = dialErr
		}
		if err == nil {
			err = errors.New("webhook hostname did not resolve to a public address")
		}
		return nil, err
	}
	return &http.Client{
		Transport: transport,
		Timeout:   webhookRequestTimeout,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

func isPublicWebhookAddress(address netip.Addr) bool {
	address = address.Unmap()
	if !address.IsValid() ||
		!address.IsGlobalUnicast() ||
		address.IsUnspecified() ||
		address.IsLoopback() ||
		address.IsPrivate() ||
		address.IsLinkLocalUnicast() ||
		address.IsLinkLocalMulticast() ||
		address.IsMulticast() {
		return false
	}
	for _, prefix := range blockedWebhookNetworkPrefixes {
		if prefix.Contains(address) {
			return false
		}
	}
	return true
}
