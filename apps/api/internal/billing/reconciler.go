package billing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

const (
	defaultInterval                        = 5 * time.Minute
	defaultBatchSize                       = 50
	defaultRequestTimeout                  = 10 * time.Second
	defaultConcurrency                     = 5
	jobLease                               = 10 * time.Minute
	maxProviderBody                        = 1 << 20
	notificationSuppressionConfirmationTTL = 5 * time.Minute
	notificationSuppressionClockSkew       = time.Minute
	cardRecurrenceWorkerTimeout            = 7 * time.Minute
)

type Config struct {
	Enabled         bool
	BaseURL         string
	APIKey          string
	FunctionsURL    string
	FunctionsAPIKey string
	AppURL          string
	Interval        time.Duration
	BatchSize       int
	RequestTimeout  time.Duration
}

type Stats struct {
	Claimed                 uint64
	Succeeded               uint64
	Failed                  uint64
	Dead                    uint64
	NotificationsCreated    uint64
	CardRecurrenceTriggered uint64
	CardRecurrenceFailed    uint64
}

type Reconciler struct {
	db       *dbpkg.Postgres
	config   Config
	client   *http.Client
	workerID string

	claimed                 atomic.Uint64
	succeeded               atomic.Uint64
	failed                  atomic.Uint64
	dead                    atomic.Uint64
	notificationsCreated    atomic.Uint64
	cardRecurrenceTriggered atomic.Uint64
	cardRecurrenceFailed    atomic.Uint64
}

type reconciliationJob struct {
	OrganizationID         string
	ProviderSubscriptionID string
	Attempts               int
	MaxAttempts            int
	WorkerID               string
}

type providerSubscription struct {
	ID          string `json:"id"`
	Customer    string `json:"customer"`
	Status      string `json:"status"`
	NextDueDate string `json:"nextDueDate"`
}

type providerPayment struct {
	ID           string   `json:"id"`
	Customer     string   `json:"customer"`
	Subscription string   `json:"subscription"`
	Status       string   `json:"status"`
	Value        *float64 `json:"value"`
	DueDate      string   `json:"dueDate"`
	PaymentDate  string   `json:"paymentDate"`
}

type providerPaymentList struct {
	Data []providerPayment `json:"data"`
}

type providerSnapshot struct {
	CustomerID         string
	SubscriptionID     string
	SubscriptionStatus string
	PaymentID          string
	PaymentStatus      string
	PaymentAmount      *float64
	PaymentDueDate     string
	NextDueDate        string
	ObservedAt         time.Time
}

type applyResult struct {
	Outcome string `json:"outcome"`
	Status  string `json:"status"`
	Field   string `json:"field"`
}

func NewReconciler(database *dbpkg.Postgres, config Config) *Reconciler {
	config = normalizeConfig(config)
	return &Reconciler{
		db:       database,
		config:   config,
		client:   &http.Client{Timeout: config.RequestTimeout},
		workerID: reconciliationWorkerID(),
	}
}

func normalizeConfig(config Config) Config {
	config.BaseURL = strings.TrimRight(strings.TrimSpace(config.BaseURL), "/")
	config.APIKey = strings.TrimSpace(config.APIKey)
	config.FunctionsURL = strings.TrimRight(strings.TrimSpace(config.FunctionsURL), "/")
	config.FunctionsAPIKey = strings.TrimSpace(config.FunctionsAPIKey)
	config.AppURL = strings.TrimRight(strings.TrimSpace(config.AppURL), "/")
	if config.Interval <= 0 {
		config.Interval = defaultInterval
	}
	if config.BatchSize <= 0 || config.BatchSize > 100 {
		config.BatchSize = defaultBatchSize
	}
	if config.RequestTimeout <= 0 || config.RequestTimeout > time.Minute {
		config.RequestTimeout = defaultRequestTimeout
	}
	return config
}

func (reconciler *Reconciler) Start(ctx context.Context, logger *slog.Logger) {
	if reconciler == nil || !reconciler.config.Enabled {
		return
	}
	if reconciler.db == nil || reconciler.config.APIKey == "" || reconciler.config.BaseURL == "" {
		if logger != nil {
			logger.Warn("Asaas billing reconciliation disabled because configuration is incomplete")
		}
		return
	}
	if logger == nil {
		logger = slog.Default()
	}

	go func() {
		timer := time.NewTimer(5 * time.Second)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				processed, err := reconciler.ProcessBatch(ctx)
				if err != nil && !errors.Is(err, context.Canceled) {
					logger.Error(
						"Asaas billing reconciliation batch failed",
						"error", err,
						"processed", processed,
					)
				}
				if _, recurrenceErr := reconciler.TriggerCardRecurrenceBatch(ctx); recurrenceErr != nil && !errors.Is(recurrenceErr, context.Canceled) {
					reconciler.cardRecurrenceFailed.Add(1)
					logger.Error("billing card recurrence worker trigger failed", "error", recurrenceErr)
				}
				created, notificationErr := reconciler.enqueueBillingNotifications(ctx)
				if notificationErr != nil && !errors.Is(notificationErr, context.Canceled) {
					logger.Error(
						"billing notification enqueue failed",
						"error", notificationErr,
					)
				} else if created > 0 {
					reconciler.notificationsCreated.Add(uint64(created))
					logger.Info("billing notifications enqueued", "count", created)
				}
				if ctx.Err() != nil {
					return
				}
				timer.Reset(reconciler.config.Interval)
			}
		}
	}()
}

func (reconciler *Reconciler) Stats() Stats {
	if reconciler == nil {
		return Stats{}
	}
	return Stats{
		Claimed:                 reconciler.claimed.Load(),
		Succeeded:               reconciler.succeeded.Load(),
		Failed:                  reconciler.failed.Load(),
		Dead:                    reconciler.dead.Load(),
		NotificationsCreated:    reconciler.notificationsCreated.Load(),
		CardRecurrenceTriggered: reconciler.cardRecurrenceTriggered.Load(),
		CardRecurrenceFailed:    reconciler.cardRecurrenceFailed.Load(),
	}
}

type cardRecurrenceWorkerResult struct {
	Claimed   int `json:"claimed"`
	Processed int `json:"processed"`
}

// TriggerCardRecurrenceBatch wakes the private Edge worker. Durable job state,
// leases, retry/backoff and dead-lettering remain in Postgres, so a failed HTTP
// wake-up never loses work and the Asaas webhook can acknowledge quickly.
func (reconciler *Reconciler) TriggerCardRecurrenceBatch(ctx context.Context) (int, error) {
	if reconciler == nil || reconciler.config.FunctionsURL == "" || reconciler.config.FunctionsAPIKey == "" {
		return 0, errors.New("billing card recurrence worker is not configured")
	}
	payload, err := json.Marshal(map[string]int{"batch_size": reconciler.config.BatchSize})
	if err != nil {
		return 0, err
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		reconciler.config.FunctionsURL+"/functions/v1/asaas-card-recurrence-worker",
		strings.NewReader(string(payload)),
	)
	if err != nil {
		return 0, err
	}
	request.Header.Set("accept", "application/json")
	request.Header.Set("content-type", "application/json")
	setSupabaseServiceAPIAuth(request, reconciler.config.FunctionsAPIKey)
	request.Header.Set("User-Agent", "VimobCRM/1.0 (Go API)")

	// The private worker also redrives checkout cancellations. One cancellation
	// may require an exact subscription GET, DELETE, terminal GET and payment
	// GET (each provider call has a 75-second deadline), plus its fenced local
	// finalization. Keep a dedicated deadline with margin while leaving the
	// normal 10-second Asaas reconciler timeout unchanged.
	workerClient := *reconciler.client
	workerClient.Timeout = cardRecurrenceWorkerTimeout
	response, err := workerClient.Do(request)
	if err != nil {
		return 0, fmt.Errorf("invoke recurrence worker: %w", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, maxProviderBody+1))
	if err != nil {
		return 0, fmt.Errorf("read recurrence worker response: %w", err)
	}
	if len(body) > maxProviderBody {
		return 0, errors.New("recurrence worker response exceeded the size limit")
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return 0, fmt.Errorf("recurrence worker returned HTTP %d", response.StatusCode)
	}
	var result cardRecurrenceWorkerResult
	if err := json.Unmarshal(body, &result); err != nil {
		return 0, fmt.Errorf("decode recurrence worker response: %w", err)
	}
	reconciler.cardRecurrenceTriggered.Add(1)
	if result.Processed > 0 {
		return result.Processed, nil
	}
	return result.Claimed, nil
}

func setSupabaseServiceAPIAuth(request *http.Request, apiKey string) {
	request.Header.Set("apikey", apiKey)
	request.Header.Del("authorization")
	segments := strings.Split(apiKey, ".")
	if len(segments) == 3 && segments[0] != "" && segments[1] != "" && segments[2] != "" {
		request.Header.Set("authorization", "Bearer "+apiKey)
	}
}

func (reconciler *Reconciler) ProcessBatch(ctx context.Context) (int, error) {
	if reconciler == nil || reconciler.db == nil {
		return 0, errors.New("billing reconciler is not initialized")
	}
	jobs, deadCount, err := reconciler.claimJobs(ctx)
	if err != nil {
		return 0, err
	}
	reconciler.claimed.Add(uint64(len(jobs)))
	if deadCount > 0 {
		reconciler.dead.Add(uint64(deadCount))
	}
	if len(jobs) == 0 {
		return 0, nil
	}

	concurrency := min(defaultConcurrency, len(jobs))
	jobChannel := make(chan reconciliationJob)
	errorChannel := make(chan error, len(jobs))
	var workers sync.WaitGroup
	workers.Add(concurrency)

	for range concurrency {
		go func() {
			defer workers.Done()
			for job := range jobChannel {
				if err := reconciler.processJob(ctx, job); err != nil {
					errorChannel <- fmt.Errorf("organization %s: %w", job.OrganizationID, err)
				}
			}
		}()
	}

sendJobs:
	for _, job := range jobs {
		select {
		case <-ctx.Done():
			break sendJobs
		case jobChannel <- job:
		}
	}
	close(jobChannel)
	workers.Wait()
	close(errorChannel)

	var processErrors []error
	for processErr := range errorChannel {
		processErrors = append(processErrors, processErr)
	}
	return len(jobs), errors.Join(processErrors...)
}

func (reconciler *Reconciler) claimJobs(ctx context.Context) ([]reconciliationJob, int, error) {
	tx, err := reconciler.db.Pool().Begin(ctx)
	if err != nil {
		return nil, 0, err
	}
	defer tx.Rollback(ctx)

	var deadCount int
	err = tx.QueryRow(ctx, `
		with dead_jobs as (
			update private.asaas_reconciliation_jobs job
			set status = 'dead',
			    locked_at = null,
			    locked_by = null,
			    last_error = coalesce(job.last_error, 'maximum reconciliation attempts reached'),
			    updated_at = now()
			where job.status in ('pending', 'retry', 'processing')
			  and job.attempts >= job.max_attempts
			  and (
			    job.status <> 'processing'
			    or job.locked_at is null
			    or job.locked_at < now() - ($1::bigint * interval '1 second')
			  )
			returning job.organization_id, job.attempts, job.last_error
		),
		alerts as (
			insert into public.error_events (
			  organization_id,
			  source,
			  severity,
			  fingerprint,
			  message,
			  category,
			  error_code,
			  component,
			  metadata,
			  occurred_at
			)
			select
			  dead.organization_id,
			  'backend',
			  'critical',
			  'billing_reconciliation_dead:' || dead.organization_id::text,
			  'Asaas billing reconciliation exhausted all retries',
			  'billing',
			  'asaas_reconciliation_dead',
			  'billing_reconciler',
			  jsonb_build_object(
			    'attempts', dead.attempts,
			    'last_error', dead.last_error
			  ),
			  now()
			from dead_jobs dead
			returning 1
		)
		select count(*)::integer from alerts
	`, int64(jobLease/time.Second)).Scan(&deadCount)
	if err != nil {
		return nil, 0, err
	}

	rows, err := tx.Query(ctx, `
		with candidates as (
			select job.organization_id
			from private.asaas_reconciliation_jobs job
			join public.organizations organization_row
			  on organization_row.id = job.organization_id
			 and organization_row.is_active = true
			where job.attempts < job.max_attempts
			  and not exists (
			    select 1
			    from private.billing_organization_asaas_cleanup_claims cleanup
			    where cleanup.organization_id = job.organization_id
			      and cleanup.completed_at is null
			  )
			  and (
			    (
			      job.status in ('pending', 'retry')
			      and job.next_attempt_at <= now()
			    )
			    or (
			      job.status = 'processing'
			      and job.locked_at < now() - ($2::bigint * interval '1 second')
			    )
			  )
			order by job.next_attempt_at, job.organization_id
			limit $3
			for update of job skip locked
		)
		update private.asaas_reconciliation_jobs job
		set status = 'processing',
		    attempts = job.attempts + 1,
		    locked_at = now(),
		    locked_by = $1,
		    last_attempt_at = now(),
		    last_error = null,
		    updated_at = now()
		from candidates
		where job.organization_id = candidates.organization_id
		returning
		  job.organization_id::text,
		  job.provider_subscription_id,
		  job.attempts,
		  job.max_attempts,
		  job.locked_by
	`, reconciler.workerID, int64(jobLease/time.Second), reconciler.config.BatchSize)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	jobs := make([]reconciliationJob, 0, reconciler.config.BatchSize)
	for rows.Next() {
		var job reconciliationJob
		if err := rows.Scan(
			&job.OrganizationID,
			&job.ProviderSubscriptionID,
			&job.Attempts,
			&job.MaxAttempts,
			&job.WorkerID,
		); err != nil {
			return nil, 0, err
		}
		jobs = append(jobs, job)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	rows.Close()

	if err := tx.Commit(ctx); err != nil {
		return nil, 0, err
	}
	return jobs, deadCount, nil
}

func (reconciler *Reconciler) processJob(ctx context.Context, job reconciliationJob) error {
	jobTimeout := reconciler.config.RequestTimeout*3 + 5*time.Second
	jobCtx, cancel := context.WithTimeout(ctx, jobTimeout)
	defer cancel()

	authorized, err := reconciler.reconciliationJobProviderMutationAuthorized(jobCtx, job)
	if err != nil {
		return reconciler.handleJobFailure(ctx, job, err)
	}
	if !authorized {
		if err := reconciler.releaseStaleJob(ctx, job); err != nil {
			return err
		}
		return nil
	}

	snapshot, err := reconciler.fetchSnapshot(jobCtx, job.ProviderSubscriptionID)
	if err != nil {
		return reconciler.handleJobFailure(ctx, job, err)
	}
	if err := reconciler.ensureCustomerNotificationsDisabled(
		jobCtx,
		job.OrganizationID,
		snapshot.CustomerID,
	); err != nil {
		return reconciler.handleJobFailure(ctx, job, err)
	}

	var rawResult string
	err = reconciler.db.Pool().QueryRow(jobCtx, `
		select private.apply_asaas_billing_snapshot_with_payment(
		  $1::uuid,
		  nullif($2, ''),
		  nullif($3, ''),
		  nullif($4, ''),
		  nullif($5, ''),
		  nullif($6, ''),
		  $7::numeric,
		  nullif($8, '')::date,
		  nullif($9, '')::date,
		  $10::timestamptz,
		  'go_periodic_reconciliation'
		)::text
	`,
		job.OrganizationID,
		snapshot.CustomerID,
		snapshot.SubscriptionID,
		snapshot.SubscriptionStatus,
		snapshot.PaymentID,
		snapshot.PaymentStatus,
		snapshot.PaymentAmount,
		snapshot.PaymentDueDate,
		snapshot.NextDueDate,
		snapshot.ObservedAt,
	).Scan(&rawResult)
	if err != nil {
		return reconciler.handleJobFailure(ctx, job, err)
	}

	var result applyResult
	if err := json.Unmarshal([]byte(rawResult), &result); err != nil {
		return reconciler.handleJobFailure(ctx, job, fmt.Errorf("decode billing apply result: %w", err))
	}

	switch result.Outcome {
	case "applied":
		reconciler.succeeded.Add(1)
		return nil
	case "stale":
		if err := reconciler.releaseStaleJob(ctx, job); err != nil {
			return err
		}
		reconciler.succeeded.Add(1)
		return nil
	case "organization_not_found":
		reconciler.succeeded.Add(1)
		return nil
	case "identifier_mismatch":
		return reconciler.handleJobFailure(
			ctx,
			job,
			fmt.Errorf("provider %s identifier does not match current organization", result.Field),
		)
	default:
		return reconciler.handleJobFailure(
			ctx,
			job,
			fmt.Errorf("unexpected billing reconciliation outcome %q", result.Outcome),
		)
	}
}

func (reconciler *Reconciler) reconciliationJobProviderMutationAuthorized(
	ctx context.Context,
	job reconciliationJob,
) (bool, error) {
	var authorized bool
	err := reconciler.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from private.asaas_reconciliation_jobs job
			join public.organizations organization_row
			  on organization_row.id = job.organization_id
			 and organization_row.is_active = true
			where job.organization_id = $1::uuid
			  and job.provider_subscription_id = $2
			  and job.status = 'processing'
			  and job.locked_by = $3
			  and job.locked_at >= now() - ($4::bigint * interval '1 second')
			  and not exists (
			    select 1
			    from private.billing_organization_asaas_cleanup_claims cleanup
			    where cleanup.organization_id = job.organization_id
			      and cleanup.completed_at is null
			  )
		)
	`,
		job.OrganizationID,
		job.ProviderSubscriptionID,
		job.WorkerID,
		int64(jobLease/time.Second),
	).Scan(&authorized)
	if err != nil {
		return false, fmt.Errorf("authorize Asaas reconciliation provider mutation: %w", err)
	}
	return authorized, nil
}

func (reconciler *Reconciler) fetchSnapshot(ctx context.Context, subscriptionID string) (providerSnapshot, error) {
	var subscription providerSubscription
	if err := reconciler.getJSON(
		ctx,
		"/subscriptions/"+url.PathEscape(subscriptionID),
		&subscription,
	); err != nil {
		return providerSnapshot{}, err
	}
	if strings.TrimSpace(subscription.ID) == "" || subscription.ID != subscriptionID {
		return providerSnapshot{}, errors.New("Asaas returned a different subscription")
	}

	var payments providerPaymentList
	if err := reconciler.getJSON(
		ctx,
		"/subscriptions/"+url.PathEscape(subscriptionID)+"/payments?limit=100&offset=0",
		&payments,
	); err != nil {
		return providerSnapshot{}, err
	}
	payment := selectRelevantPayment(payments.Data, time.Now().UTC())

	customerID := strings.TrimSpace(subscription.Customer)
	paymentStatus := ""
	paymentID := ""
	paymentDueDate := ""
	var paymentAmount *float64
	if payment != nil {
		paymentID = strings.TrimSpace(payment.ID)
		paymentStatus = strings.TrimSpace(payment.Status)
		paymentAmount = payment.Value
		paymentDueDate = strings.TrimSpace(payment.DueDate)
		if customerID == "" {
			customerID = strings.TrimSpace(payment.Customer)
		}
		if payment.Subscription != "" && payment.Subscription != subscriptionID {
			return providerSnapshot{}, errors.New("Asaas payment belongs to another subscription")
		}
	}

	return providerSnapshot{
		CustomerID:         customerID,
		SubscriptionID:     subscription.ID,
		SubscriptionStatus: strings.TrimSpace(subscription.Status),
		PaymentID:          paymentID,
		PaymentStatus:      paymentStatus,
		PaymentAmount:      paymentAmount,
		PaymentDueDate:     paymentDueDate,
		NextDueDate:        strings.TrimSpace(subscription.NextDueDate),
		ObservedAt:         time.Now().UTC(),
	}, nil
}

func (reconciler *Reconciler) getJSON(ctx context.Context, path string, destination any) error {
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		reconciler.config.BaseURL+path,
		nil,
	)
	if err != nil {
		return err
	}
	request.Header.Set("accept", "application/json")
	request.Header.Set("User-Agent", "VimobCRM/1.0 (Go API)")
	request.Header.Set("access_token", reconciler.config.APIKey)

	response, err := reconciler.client.Do(request)
	if err != nil {
		return fmt.Errorf("Asaas request failed: %w", err)
	}
	defer response.Body.Close()

	body, err := io.ReadAll(io.LimitReader(response.Body, maxProviderBody+1))
	if err != nil {
		return fmt.Errorf("read Asaas response: %w", err)
	}
	if len(body) > maxProviderBody {
		return errors.New("Asaas response exceeded the size limit")
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("Asaas request returned HTTP %d", response.StatusCode)
	}
	if err := json.Unmarshal(body, destination); err != nil {
		return fmt.Errorf("decode Asaas response: %w", err)
	}
	return nil
}

func (reconciler *Reconciler) ensureCustomerNotificationsDisabled(
	ctx context.Context,
	organizationID string,
	customerID string,
) error {
	customerID = strings.TrimSpace(customerID)
	if customerID == "" {
		return errors.New("Asaas customer is missing from the billing snapshot")
	}

	var lastConfirmedAt string
	err := reconciler.db.Pool().QueryRow(ctx, `
		select coalesce(
			subscription.metadata->>'asaas_notifications_disabled_at',
			''
		)
		from public.subscriptions subscription
		where subscription.organization_id = $1::uuid
		  and subscription.metadata->>'asaas_notifications_disabled_customer_id' = $2
		order by subscription.updated_at desc, subscription.id desc
		limit 1
	`, organizationID, customerID).Scan(&lastConfirmedAt)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("read Asaas notification suppression state: %w", err)
	}
	confirmedAt := time.Now().UTC()
	if err == nil && notificationSuppressionConfirmationIsFresh(lastConfirmedAt, confirmedAt) {
		return nil
	}

	var confirmation providerCustomerNotificationConfirmation
	if err := reconciler.putJSON(
		ctx,
		"/customers/"+url.PathEscape(customerID),
		map[string]any{"notificationDisabled": true},
		&confirmation,
	); err != nil {
		return fmt.Errorf("disable Asaas customer notifications: %w", err)
	}
	if !providerCustomerNotificationSuppressionConfirmed(confirmation, customerID) {
		return errors.New("Asaas did not confirm customer notification suppression")
	}

	result, err := reconciler.db.Pool().Exec(ctx, `
		update public.subscriptions
		set metadata = jsonb_set(
			jsonb_set(
				coalesce(metadata, '{}'::jsonb),
				'{asaas_notifications_disabled_customer_id}',
				to_jsonb($2::text),
				true
			),
			'{asaas_notifications_disabled_at}',
			to_jsonb($3::text),
			true
		),
		updated_at = now()
		where organization_id = $1::uuid
	`, organizationID, customerID, confirmedAt.Format(time.RFC3339Nano))
	if err != nil {
		return fmt.Errorf("persist Asaas notification suppression state: %w", err)
	}
	if result.RowsAffected() == 0 {
		return errors.New("subscription was not found while persisting Asaas notification suppression")
	}
	return nil
}

type providerCustomerNotificationConfirmation struct {
	ID                   string `json:"id"`
	NotificationDisabled bool   `json:"notificationDisabled"`
}

func providerCustomerNotificationSuppressionConfirmed(
	confirmation providerCustomerNotificationConfirmation,
	expectedCustomerID string,
) bool {
	return strings.TrimSpace(confirmation.ID) == strings.TrimSpace(expectedCustomerID) &&
		strings.TrimSpace(expectedCustomerID) != "" &&
		confirmation.NotificationDisabled
}

func notificationSuppressionConfirmationIsFresh(value string, now time.Time) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}

	var confirmedAt time.Time
	var err error
	for _, layout := range []string{
		time.RFC3339Nano,
		"2006-01-02 15:04:05.999999999Z07:00",
		"2006-01-02 15:04:05.999999999Z07",
	} {
		confirmedAt, err = time.Parse(layout, value)
		if err == nil {
			break
		}
	}
	if err != nil {
		return false
	}

	age := now.Sub(confirmedAt)
	return age >= -notificationSuppressionClockSkew &&
		age < notificationSuppressionConfirmationTTL
}

func (reconciler *Reconciler) putJSON(
	ctx context.Context,
	path string,
	payload any,
	destination any,
) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPut,
		reconciler.config.BaseURL+path,
		strings.NewReader(string(body)),
	)
	if err != nil {
		return err
	}
	request.Header.Set("accept", "application/json")
	request.Header.Set("content-type", "application/json")
	request.Header.Set("User-Agent", "VimobCRM/1.0 (Go API)")
	request.Header.Set("access_token", reconciler.config.APIKey)

	response, err := reconciler.client.Do(request)
	if err != nil {
		return fmt.Errorf("Asaas request failed: %w", err)
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, maxProviderBody+1))
	if err != nil {
		return fmt.Errorf("read Asaas response: %w", err)
	}
	if len(responseBody) > maxProviderBody {
		return errors.New("Asaas response exceeded the size limit")
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("Asaas request returned HTTP %d", response.StatusCode)
	}
	if destination == nil {
		return errors.New("Asaas response destination is required")
	}
	if err := json.Unmarshal(responseBody, destination); err != nil {
		return fmt.Errorf("decode Asaas response: %w", err)
	}
	return nil
}

func selectRelevantPayment(payments []providerPayment, now time.Time) *providerPayment {
	if len(payments) == 0 {
		return nil
	}
	today := now.UTC().Format("2006-01-02")
	var reversal *providerPayment
	var delinquency *providerPayment
	var dueOrPast *providerPayment
	var future *providerPayment
	var undated *providerPayment

	for index := range payments {
		payment := &payments[index]
		dueDate := strings.TrimSpace(payment.DueDate)
		if isPaymentReversalStatus(payment.Status) {
			if laterProviderPayment(payment, reversal) {
				reversal = payment
			}
		} else if isAdversePaymentStatus(payment.Status) {
			if laterProviderPayment(payment, delinquency) {
				delinquency = payment
			}
		}
		switch {
		case dueDate == "":
			if undated == nil || payment.ID > undated.ID {
				undated = payment
			}
		case dueDate <= today:
			if dueOrPast == nil ||
				dueDate > dueOrPast.DueDate ||
				(dueDate == dueOrPast.DueDate && payment.ID > dueOrPast.ID) {
				dueOrPast = payment
			}
		default:
			if future == nil ||
				dueDate < future.DueDate ||
				(dueDate == future.DueDate && payment.ID > future.ID) {
				future = payment
			}
		}
	}
	if reversal != nil {
		return reversal
	}
	if delinquency != nil {
		return delinquency
	}
	if dueOrPast != nil {
		return dueOrPast
	}
	if future != nil {
		return future
	}
	return undated
}

func laterProviderPayment(candidate *providerPayment, current *providerPayment) bool {
	if current == nil {
		return true
	}
	candidateDueDate := strings.TrimSpace(candidate.DueDate)
	currentDueDate := strings.TrimSpace(current.DueDate)
	return candidateDueDate > currentDueDate ||
		(candidateDueDate == currentDueDate && candidate.ID > current.ID)
}

func isAdversePaymentStatus(status string) bool {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "OVERDUE",
		"DUNNING_REQUESTED",
		"DUNNING_RECEIVED",
		"CREDIT_CARD_CAPTURE_REFUSED",
		"REPROVED_BY_RISK_ANALYSIS":
		return true
	default:
		return isPaymentReversalStatus(status)
	}
}

func isPaymentReversalStatus(status string) bool {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "REFUNDED",
		"REFUND_REQUESTED",
		"REFUND_IN_PROGRESS",
		"PARTIALLY_REFUNDED",
		"RECEIVED_IN_CASH_UNDONE",
		"CHARGEBACK",
		"CHARGEBACK_REQUESTED",
		"CHARGEBACK_DISPUTE",
		"AWAITING_CHARGEBACK_REVERSAL":
		return true
	default:
		return false
	}
}

func (reconciler *Reconciler) handleJobFailure(
	parentCtx context.Context,
	job reconciliationJob,
	jobErr error,
) error {
	if errors.Is(parentCtx.Err(), context.Canceled) {
		return parentCtx.Err()
	}
	reconciler.failed.Add(1)

	failureCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	dead, markErr := reconciler.failJob(failureCtx, job, jobErr)
	if dead {
		reconciler.dead.Add(1)
	}
	if markErr != nil {
		return fmt.Errorf("%w (mark reconciliation failure: %v)", jobErr, markErr)
	}
	return jobErr
}

func (reconciler *Reconciler) failJob(
	ctx context.Context,
	job reconciliationJob,
	jobErr error,
) (bool, error) {
	errorMessage := strings.TrimSpace(jobErr.Error())
	if len(errorMessage) > 2000 {
		errorMessage = errorMessage[:2000]
	}
	backoff := reconciliationBackoff(job.Attempts)

	var status string
	err := reconciler.db.Pool().QueryRow(ctx, `
		with failed as (
			update private.asaas_reconciliation_jobs job
			set status = case
			      when job.attempts >= job.max_attempts then 'dead'
			      else 'retry'
			    end,
			    next_attempt_at = case
			      when job.attempts >= job.max_attempts then job.next_attempt_at
			      else now() + ($4::bigint * interval '1 second')
			    end,
			    locked_at = null,
			    locked_by = null,
			    last_error = $3,
			    updated_at = now()
			where job.organization_id = $1::uuid
			  and job.status = 'processing'
			  and job.locked_by = $2
			returning job.organization_id, job.status, job.attempts, job.last_error
		),
		alert as (
			insert into public.error_events (
			  organization_id,
			  source,
			  severity,
			  fingerprint,
			  message,
			  category,
			  error_code,
			  component,
			  metadata,
			  occurred_at
			)
			select
			  failed.organization_id,
			  'backend',
			  'critical',
			  'billing_reconciliation_dead:' || failed.organization_id::text,
			  'Asaas billing reconciliation exhausted all retries',
			  'billing',
			  'asaas_reconciliation_dead',
			  'billing_reconciler',
			  jsonb_build_object(
			    'attempts', failed.attempts,
			    'last_error', failed.last_error
			  ),
			  now()
			from failed
			where failed.status = 'dead'
			returning 1
		)
		select failed.status
		from failed
	`, job.OrganizationID, job.WorkerID, errorMessage, int64(backoff/time.Second)).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return status == "dead", nil
}

func (reconciler *Reconciler) releaseStaleJob(ctx context.Context, job reconciliationJob) error {
	releaseCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := reconciler.db.Pool().Exec(releaseCtx, `
		update private.asaas_reconciliation_jobs
		set status = 'pending',
		    attempts = 0,
		    next_attempt_at = now() + ($3::bigint * interval '1 second'),
		    locked_at = null,
		    locked_by = null,
		    last_error = null,
		    updated_at = now()
		where organization_id = $1::uuid
		  and status = 'processing'
		  and locked_by = $2
	`, job.OrganizationID, job.WorkerID, int64(reconciler.config.Interval/time.Second))
	return err
}

func reconciliationBackoff(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	exponent := min(attempt-1, 6)
	delay := 5 * time.Minute * time.Duration(1<<exponent)
	return min(delay, 6*time.Hour)
}

func reconciliationWorkerID() string {
	hostname, _ := os.Hostname()
	return strings.Join(
		[]string{
			strings.TrimSpace(hostname),
			strconv.Itoa(os.Getpid()),
			strconv.FormatInt(time.Now().UnixNano(), 36),
		},
		":",
	)
}
