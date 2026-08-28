package portals

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
)

var importReportWorkerWake = make(chan struct{}, 1)

func wakeImportReportWorker() {
	select {
	case importReportWorkerWake <- struct{}{}:
	default:
	}
}

// StartImportReportWorker keeps the provider webhook bounded to durable inbox
// persistence. Grupo OLX documents a 30-second timeout without retries, so all
// canonical/legacy annotations are reconciled asynchronously after the 2xx ACK.
func (repo Repository) StartImportReportWorker(ctx context.Context, logger *slog.Logger) {
	if !repo.importReportWorkerEnabled {
		return
	}
	if logger == nil {
		logger = slog.Default()
	}
	go func() {
		ticker := time.NewTicker(repo.importReportWorkerInterval)
		defer ticker.Stop()
		repo.runImportReportWorkerBatch(ctx, logger)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				repo.runImportReportWorkerBatch(ctx, logger)
			case <-importReportWorkerWake:
				repo.runImportReportWorkerBatch(ctx, logger)
			}
		}
	}()
}

func (repo Repository) runImportReportWorkerBatch(ctx context.Context, logger *slog.Logger) {
	for index := 0; index < repo.importReportWorkerBatch; index++ {
		processed, err := repo.processNextImportReport(ctx)
		if err != nil {
			if !errors.Is(err, context.Canceled) {
				var itemError *importReportWorkerError
				if errors.As(err, &itemError) {
					logger.Error("Grupo OLX import report annotation failed",
						"error", itemError.Cause,
						"report_id", itemError.ReportID,
						"integration_id", itemError.IntegrationID,
						"attempt", itemError.Attempt,
					)
				} else {
					logger.Error("Grupo OLX import report annotation failed", "error", err)
				}
			}
			if !processed {
				return
			}
			continue
		}
		if !processed {
			return
		}
	}
	wakeImportReportWorker()
}

type importReportWorkerError struct {
	ReportID      string
	IntegrationID string
	Attempt       int
	Cause         error
}

func (err *importReportWorkerError) Error() string {
	return "Grupo OLX import report processing failed: " + err.Cause.Error()
}
func (err *importReportWorkerError) Unwrap() error { return err.Cause }

func (repo Repository) processNextImportReport(ctx context.Context) (bool, error) {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)

	var rowID, reportID, integrationID, status string
	var attempts int
	var receivedAt time.Time
	var rawPayload []byte
	err = tx.QueryRow(ctx, `
		select report.id::text, report.report_id, report.integration_id::text,
		       report.status, report.annotation_attempts, report.created_at, report.raw_body
		from public.portal_import_reports report
		where report.portal = 'grupo_olx'
		  and report.annotation_status in ('pending', 'retry')
		  and report.annotation_next_attempt_at <= clock_timestamp()
		order by report.created_at, report.id
		limit 1
		for update skip locked
	`).Scan(&rowID, &reportID, &integrationID, &status, &attempts, &receivedAt, &rawPayload)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	fail := func(processErr error) (bool, error) {
		_ = tx.Rollback(ctx)
		if errors.Is(processErr, context.Canceled) || errors.Is(processErr, context.DeadlineExceeded) {
			return false, processErr
		}
		repo.markImportReportAnnotationFailure(ctx, integrationID, reportID, processErr)
		return true, &importReportWorkerError{ReportID: reportID, IntegrationID: integrationID, Attempt: attempts + 1, Cause: processErr}
	}
	dead := func(code string, processErr error) (bool, error) {
		if _, updateErr := tx.Exec(ctx, `
			update public.portal_import_reports
			set annotation_status = 'dead',
			    annotation_attempts = 12,
			    annotation_last_error = $2,
			    annotation_processed_at = clock_timestamp()
			where id = $1::uuid
		`, rowID, code); updateErr != nil {
			return fail(updateErr)
		}
		if commitErr := tx.Commit(ctx); commitErr != nil {
			return fail(commitErr)
		}
		return true, &importReportWorkerError{ReportID: reportID, IntegrationID: integrationID, Attempt: 12, Cause: processErr}
	}
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended('grupo_olx_import:' || $1, 0))`, integrationID); err != nil {
		return fail(err)
	}
	if _, err := tx.Exec(ctx, `
		update public.portal_integrations
		set last_import_report_at = greatest(coalesce(last_import_report_at, '-infinity'::timestamptz), $2::timestamptz),
		    updated_at = clock_timestamp()
		where id = $1::uuid
	`, integrationID, receivedAt); err != nil {
		return fail(err)
	}

	decoded, decodeErr := decodePortalJSONUseNumber(rawPayload)
	if decodeErr != nil {
		return dead("invalid_raw_payload", decodeErr)
	}
	body, ok := decoded.(map[string]any)
	if !ok {
		return dead("invalid_report_schema", errors.New("invalid Grupo OLX import report schema"))
	}
	if !validGrupoOLXImportReportPayload(body) {
		return dead("invalid_report_schema", errors.New("invalid Grupo OLX import report schema"))
	}
	details := objectValue(body["details"])
	if len(details) == 0 {
		details = body
	}
	reportOccurredAt := parsePortalReportTimestamp(firstValue(details, "date"))
	if reportOccurredAt != nil && reportOccurredAt.After(receivedAt) {
		clamped := receivedAt.UTC()
		reportOccurredAt = &clamped
	}
	errorIssues, err := reportListingIssues(body["errors"], "errorMessage")
	if err != nil {
		return dead("listing_limit_exceeded", err)
	}
	warningIssues, err := reportListingIssues(body["warnings"], "message")
	if err != nil {
		return dead("listing_limit_exceeded", err)
	}
	providerFeedback := normalizeProviderFeedback(errorIssues, warningIssues)
	summary := map[string]any{
		"company":           truncatePortalRunes(firstText(body, "company"), 200),
		"type":              "FEEDS_INTEGRATION_REPORT",
		"date":              firstValue(details, "date"),
		"total":             firstValue(details, "total", "totalListings"),
		"created":           firstValue(details, "created", "createdListings"),
		"updated":           firstValue(details, "updated", "updatedListings"),
		"deleted":           firstValue(details, "deleted"),
		"unchanged":         firstValue(details, "unchanged"),
		"errors":            firstValue(details, "error", "errors", "errorCount"),
		"warnings":          firstValue(details, "warning", "warnings", "warningCount"),
		"link":              truncatePortalRunes(firstText(body, "link"), 2048),
		"provider_feedback": providerFeedback,
	}
	status = normalizeReportStatus(firstText(body, "status", "importStatus"))
	if numericValue(summary["errors"]) > 0 {
		status = "error"
	} else if numericValue(summary["warnings"]) > 0 {
		status = "warning"
	} else if status == "received" {
		status = "success"
	}
	summaryJSON, err := json.Marshal(summary)
	if err != nil {
		return fail(err)
	}
	if _, err := tx.Exec(ctx, `
		update public.portal_import_reports
		set status = $2,
		    summary = $3::jsonb,
		    provider_occurred_at = $4::timestamptz
		where id = $1::uuid
	`, rowID, status, string(summaryJSON), nullablePortalTime(reportOccurredAt)); err != nil {
		return fail(err)
	}
	if err := repo.applyReportIssues(ctx, tx, integrationID, errorIssues, true, reportOccurredAt); err != nil {
		return fail(err)
	}
	if err := repo.applyReportIssues(ctx, tx, integrationID, warningIssues, false, reportOccurredAt); err != nil {
		return fail(err)
	}
	description := truncatePortalRunes(firstText(body, "description"), 4000)
	if description == "" && status == "error" {
		description = "O Grupo OLX reportou erros na importacao de imoveis."
	}
	if _, err := tx.Exec(ctx, `
		update public.portal_integrations
		set last_sync_status = $2,
		    status = case
		      when is_active and status <> 'paused' then case when $2 = 'error' then 'error' else 'connected' end
		      else status
		    end,
		    last_error = case when $2 = 'error' then nullif($3, '') else null end,
		    updated_at = clock_timestamp()
		where id = $1::uuid
		  and not exists (
		    select 1
		    from public.portal_import_reports newer
		    where newer.integration_id = $1::uuid
		      and newer.annotation_status = 'succeeded'
		      and (
		        coalesce(newer.provider_occurred_at, newer.created_at), newer.created_at, newer.id
		      ) > (
		        coalesce($6::timestamptz, $4::timestamptz), $4::timestamptz, $5::uuid
		      )
		  )
	`, integrationID, status, description, receivedAt, rowID, nullablePortalTime(reportOccurredAt)); err != nil {
		return fail(err)
	}
	if _, err := tx.Exec(ctx, `
		update public.portal_import_reports
		set annotation_status = 'succeeded',
		    annotation_last_error = null,
		    annotation_processed_at = clock_timestamp()
		where id = $1::uuid
	`, rowID); err != nil {
		return fail(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fail(err)
	}
	return true, nil
}

type normalizedProviderFeedback struct {
	ListingID string   `json:"listing_id"`
	Severity  string   `json:"severity"`
	Messages  []string `json:"messages"`
}

func normalizeProviderFeedback(errorIssues map[string][]string, warningIssues map[string][]string) []normalizedProviderFeedback {
	const maxProviderFeedbackMessages = 1000
	listingIDs := map[string]bool{}
	for listingID := range errorIssues {
		listingIDs[listingID] = true
	}
	for listingID := range warningIssues {
		listingIDs[listingID] = true
	}
	ordered := make([]string, 0, len(listingIDs))
	for listingID := range listingIDs {
		ordered = append(ordered, listingID)
	}
	sort.Strings(ordered)
	result := make([]normalizedProviderFeedback, 0, len(ordered))
	messageCount := 0
	for _, listingID := range ordered {
		if messageCount >= maxProviderFeedbackMessages {
			break
		}
		severity := "warning"
		messages := warningIssues[listingID]
		if len(errorIssues[listingID]) > 0 {
			severity = "error"
			messages = append(append([]string{}, errorIssues[listingID]...), messages...)
		}
		for index := range messages {
			messages[index] = truncatePortalRunes(messages[index], 1000)
		}
		messages = uniqueNonEmptyStrings(messages)
		remaining := maxProviderFeedbackMessages - messageCount
		if len(messages) > remaining {
			messages = messages[:remaining]
		}
		if len(messages) == 0 {
			continue
		}
		result = append(result, normalizedProviderFeedback{ListingID: listingID, Severity: severity, Messages: messages})
		messageCount += len(messages)
	}
	return result
}

func nullablePortalTime(value *time.Time) any {
	if value == nil {
		return nil
	}
	return *value
}
