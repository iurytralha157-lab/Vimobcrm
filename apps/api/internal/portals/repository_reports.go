package portals

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/jsonvalue"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) ListGrupoOLXImportReports(ctx context.Context, tenantContext tenant.Context) ([]map[string]any, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select jsonb_build_object(
		  'id', report.id::text,
		  'report_id', report.report_id,
		  'status', report.status,
		  'annotation_status', report.annotation_status,
		  'annotation_attempts', report.annotation_attempts,
		  'annotation_next_attempt_at', report.annotation_next_attempt_at,
		  'annotation_processed_at', report.annotation_processed_at,
		  'annotation_last_error', report.annotation_last_error,
		  'provider_occurred_at', report.provider_occurred_at,
		  'created_at', report.created_at
		)
		from public.portal_import_reports report
		join public.portal_integrations integration on integration.id = report.integration_id
		where integration.organization_id = $1::uuid
		  and integration.portal = 'grupo_olx'
		order by case when report.annotation_status = 'succeeded' then 1 else 0 end,
		         report.created_at desc, report.id desc
		limit 100
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanJSONRows(rows)
}

func (repo Repository) ReplayGrupoOLXImportReport(ctx context.Context, tenantContext tenant.Context, reportID string) (map[string]any, error) {
	reportID = strings.TrimSpace(reportID)
	var reportUUID pgtype.UUID
	if err := reportUUID.Scan(reportID); err != nil || !reportUUID.Valid {
		return nil, ErrNotFound
	}
	var raw []byte
	err := repo.db.Pool().QueryRow(ctx, `
		update public.portal_import_reports report
		set annotation_status = 'pending',
		    annotation_attempts = 0,
		    annotation_next_attempt_at = clock_timestamp(),
		    annotation_processed_at = null,
		    annotation_last_error = null
		from public.portal_integrations integration
		where report.id = $1::uuid
		  and report.integration_id = integration.id
		  and integration.organization_id = $2::uuid
		  and integration.portal = 'grupo_olx'
		  and report.annotation_status = 'dead'
		returning jsonb_build_object(
		  'id', report.id::text,
		  'report_id', report.report_id,
		  'status', report.status,
		  'annotation_status', report.annotation_status,
		  'annotation_attempts', report.annotation_attempts,
		  'created_at', report.created_at
		)
	`, reportID, tenantContext.OrganizationID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	item, err := jsonvalue.DecodeObjectAllowBlank(raw)
	if err != nil {
		return nil, err
	}
	wakeImportReportWorker()
	return item, nil
}

func (repo Repository) ReceiveGrupoOLXImportReport(ctx context.Context, token string, authorization string, payload []byte) (map[string]any, error) {
	if !validWebhookAuthorization(authorization, repo.webhookSecret) {
		return nil, ErrUnauthorized
	}
	integration, err := repo.integrationByPublicToken(ctx, token, "webhook_token", false)
	if err != nil {
		return nil, err
	}
	if !json.Valid(payload) {
		return nil, ErrInvalidInput
	}
	decoded, err := decodePortalJSONUseNumber(payload)
	if err != nil {
		return nil, ErrInvalidInput
	}
	body, _ := decoded.(map[string]any)
	reportID := normalizeGrupoOLXReportID(firstText(body, "id", "reportId", "importId"), payload)
	var raw []byte
	err = repo.db.Pool().QueryRow(ctx, `
		insert into public.portal_import_reports (
			integration_id,
			organization_id,
			portal,
			report_id,
			status,
			summary,
			raw_payload,
			raw_body,
			error,
			annotation_status,
			annotation_attempts,
			annotation_next_attempt_at
		)
		values ($1::uuid, $2::uuid, 'grupo_olx', $3, 'received', '{}'::jsonb, '{}'::jsonb, $4::bytea, null, 'pending', 0, now())
		on conflict (integration_id, report_id) where report_id is not null
		do update set report_id = portal_import_reports.report_id
		returning jsonb_build_object(
		  'id', id::text,
		  'report_id', report_id,
		  'status', status,
		  'annotation_status', annotation_status,
		  'annotation_attempts', annotation_attempts,
		  'created_at', created_at
		)
	`, integration.ID, integration.OrganizationID, reportID, payload).Scan(&raw)
	if err != nil {
		return nil, err
	}
	// The inbox INSERT above is already committed and must never be rolled back
	// by telemetry contention. Refresh the panel immediately on a separate,
	// bounded best-effort statement; the worker also reconciles this timestamp.
	receiptCtx, cancelReceipt := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Second)
	_, _ = repo.db.Pool().Exec(receiptCtx, `
		update public.portal_integrations
		set last_import_report_at = greatest(coalesce(last_import_report_at, '-infinity'::timestamptz), clock_timestamp()),
		    updated_at = clock_timestamp()
		where id = $1::uuid
	`, integration.ID)
	cancelReceipt()
	item, err := jsonvalue.DecodeObjectAllowBlank(raw)
	if err != nil {
		return nil, err
	}
	wakeImportReportWorker()
	return item, nil
}

func (repo Repository) markImportReportAnnotationFailure(ctx context.Context, integrationID string, reportID string, cause error) {
	if cause == nil {
		return
	}
	markCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	_, _ = repo.db.Pool().Exec(markCtx, `
		update public.portal_import_reports
		set annotation_attempts = least(annotation_attempts + 1, 12),
		    annotation_status = case when annotation_attempts + 1 >= 12 then 'dead' else 'retry' end,
		    annotation_next_attempt_at = case
		      when annotation_attempts + 1 >= 12 then clock_timestamp()
		      else clock_timestamp() + least(
		        interval '10 seconds' * power(2::double precision, least(annotation_attempts, 9)::double precision),
		        interval '1 hour'
		      )
		    end,
		    annotation_processed_at = case when annotation_attempts + 1 >= 12 then clock_timestamp() else null end,
		    annotation_last_error = left($3, 4000)
		where integration_id = $1::uuid
		  and report_id = $2
		  and annotation_status in ('pending', 'retry')
	`, integrationID, reportID, "annotation_processing_failed")
}

func importReportRetryDelay(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	delay := 10 * time.Second
	for current := 1; current < attempt && delay < time.Hour; current++ {
		delay *= 2
	}
	if delay > time.Hour {
		return time.Hour
	}
	return delay
}

func (repo Repository) applyReportIssues(
	ctx context.Context,
	tx pgx.Tx,
	integrationID string,
	issues map[string][]string,
	asError bool,
	reportOccurredAt *time.Time,
) error {
	if len(issues) == 0 || reportOccurredAt == nil {
		// Without a provider timestamp there is no safe fence against a later
		// legacy re-export. Raw/provider feedback remains available in the inbox.
		return nil
	}
	normalized := make(map[string][]string, len(issues))
	for listingID, issueMessages := range issues {
		messages := uniqueNonEmptyStrings(issueMessages)
		for index := range messages {
			messages[index] = truncatePortalRunes(messages[index], 1000)
		}
		messages = uniqueNonEmptyStrings(messages)
		if len(messages) > 0 {
			normalized[listingID] = messages
		}
	}
	if len(normalized) == 0 {
		return nil
	}
	issuesJSON, err := json.Marshal(normalized)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		update public.portal_listing_publications publication
		set status = case when $4::boolean then 'error' else publication.status end,
		    validation_errors = (
		      select coalesce(jsonb_agg(message order by message), '[]'::jsonb)
		      from (
		        select distinct jsonb_array_elements_text(coalesce(publication.validation_errors, '[]'::jsonb)) as message
		        union
		        select distinct jsonb_array_elements_text(issue.messages) as message
		      ) merged
		    ),
		    last_error = case when $4::boolean then issue.messages->>0 else publication.last_error end,
		    updated_at = clock_timestamp()
		from jsonb_each($2::jsonb) as issue(listing_id, messages)
		where publication.integration_id = $1::uuid
		  and publication.client_listing_id = issue.listing_id
		  and (publication.last_exported_at is null or publication.last_exported_at <= $3::timestamptz)
		  and not exists (
		    select 1
		    from public.property_channel_publications canonical
		    where canonical.channel = 'grupo_olx'
		      and canonical.channel_account_key = $1
		      and canonical.provider_listing_id = issue.listing_id
		  )
	`, integrationID, string(issuesJSON), *reportOccurredAt, asError)
	return err
}

type portalPublicationCheck struct {
	Code     string  `json:"code"`
	Label    string  `json:"label"`
	Severity string  `json:"severity"`
	Resolved bool    `json:"resolved"`
	Message  *string `json:"message,omitempty"`
}

func reportCanAnnotateCanonical(reportOccurredAt *time.Time, currentPublishedAt time.Time) bool {
	if reportOccurredAt == nil || currentPublishedAt.IsZero() {
		return false
	}
	return !reportOccurredAt.Before(currentPublishedAt)
}

func parsePortalReportTimestamp(value any) *time.Time {
	if value == nil {
		return nil
	}
	if raw, ok := value.(string); ok {
		raw = strings.TrimSpace(raw)
		// Grupo OLX's official example omits an offset. Interpret that layout as
		// UTC only for the conservative annotation fence: this can defer an
		// annotation, but cannot shift a Brazilian local time into the future and
		// accidentally annotate a newer publication version. Raw inbox storage is
		// independent from this best-effort timestamp.
		for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02 15:04:05Z07:00", "2006-01-02T15:04:05", "2006-01-02 15:04:05"} {
			parsed, err := time.Parse(layout, raw)
			if err == nil {
				parsed = parsed.UTC()
				return &parsed
			}
		}
		numeric, err := strconv.ParseFloat(raw, 64)
		if err != nil {
			return nil
		}
		return portalEpochTimestamp(numeric)
	}
	switch typed := value.(type) {
	case float64:
		return portalEpochTimestamp(typed)
	case float32:
		return portalEpochTimestamp(float64(typed))
	case int:
		return portalEpochTimestamp(float64(typed))
	case int64:
		return portalEpochTimestamp(float64(typed))
	case json.Number:
		numeric, err := typed.Float64()
		if err == nil {
			return portalEpochTimestamp(numeric)
		}
	}
	return nil
}

func portalEpochTimestamp(numeric float64) *time.Time {
	if numeric <= 0 {
		return nil
	}
	seconds := int64(numeric)
	if seconds > 10_000_000_000 {
		seconds /= 1000
	}
	parsed := time.Unix(seconds, 0).UTC()
	return &parsed
}

func decodeStrictPortalChecks(raw []byte) []portalPublicationCheck {
	var candidates []json.RawMessage
	if err := json.Unmarshal(raw, &candidates); err != nil {
		return []portalPublicationCheck{}
	}
	checks := make([]portalPublicationCheck, 0, len(candidates))
	for _, candidate := range candidates {
		var check portalPublicationCheck
		if err := json.Unmarshal(candidate, &check); err != nil {
			continue
		}
		if strings.TrimSpace(check.Code) == "" || strings.TrimSpace(check.Label) == "" ||
			(check.Severity != "info" && check.Severity != "warning" && check.Severity != "error") {
			continue
		}
		if check.Message != nil {
			message := truncatePortalRunes(*check.Message, 1000)
			check.Message = &message
		}
		checks = append(checks, check)
	}
	return checks
}

func mergePortalIssueChecks(
	checks []portalPublicationCheck,
	messages []string,
	severity string,
	codePrefix string,
	label string,
) []portalPublicationCheck {
	existing := make(map[string]bool, len(checks))
	for _, check := range checks {
		existing[check.Severity+"\x00"+strings.TrimSpace(pointerString(check.Message))] = true
	}
	for _, message := range uniqueNonEmptyStrings(messages) {
		message = truncatePortalRunes(message, 1000)
		if message == "" {
			continue
		}
		key := severity + "\x00" + message
		if existing[key] {
			continue
		}
		digest := sha256.Sum256([]byte(key))
		messageCopy := message
		checks = append(checks, portalPublicationCheck{
			Code:     codePrefix + "_" + hex.EncodeToString(digest[:6]),
			Label:    label,
			Severity: severity,
			Resolved: false,
			Message:  &messageCopy,
		})
		existing[key] = true
	}
	return checks
}

func uniqueNonEmptyStrings(values []string) []string {
	result := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func pointerString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func truncatePortalRunes(value string, maximum int) string {
	value = strings.ReplaceAll(value, "\x00", "")
	value = strings.TrimSpace(value)
	if maximum < 1 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= maximum {
		return value
	}
	return strings.TrimSpace(string(runes[:maximum]))
}

func normalizeGrupoOLXReportID(value string, payload []byte) string {
	value = strings.TrimSpace(value)
	if value == "" || strings.ContainsRune(value, '\x00') || !utf8.ValidString(value) ||
		utf8.RuneCountInString(value) > maxGrupoOLXProviderIDRunes {
		return payloadHash(payload)
	}
	return value
}

const (
	maxGrupoOLXReportListings           = 50000
	maxGrupoOLXReportMessagesPerListing = 20
)

func reportListingIssues(value any, messageKey string) (map[string][]string, error) {
	result := map[string][]string{}
	items, ok := value.([]any)
	if !ok {
		return result, nil
	}
	for _, rawItem := range items {
		item := objectValue(rawItem)
		message := strings.TrimSpace(firstText(item, messageKey, "message", "errorMessage"))
		if message == "" {
			continue
		}
		externalIDs, ok := item["externalIds"].([]any)
		if !ok {
			continue
		}
		for _, rawID := range externalIDs {
			listingID := truncatePortalRunes(fmt.Sprint(rawID), maxGrupoOLXProviderIDRunes)
			if listingID == "" {
				continue
			}
			if _, exists := result[listingID]; !exists && len(result) >= maxGrupoOLXReportListings {
				return nil, fmt.Errorf("grupo olx report exceeds %d unique ListingIDs", maxGrupoOLXReportListings)
			}
			if len(result[listingID]) < maxGrupoOLXReportMessagesPerListing {
				result[listingID] = append(result[listingID], message)
			}
		}
	}
	for listingID, messages := range result {
		result[listingID] = uniqueNonEmptyStrings(messages)
	}
	return result, nil
}

func normalizeReportStatus(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	switch normalized {
	case "success", "sucesso", "ok", "done", "completed":
		return "success"
	case "warning", "warnings", "aviso":
		return "warning"
	case "error", "errors", "erro", "failed", "failure":
		return "error"
	default:
		return "received"
	}
}

func validGrupoOLXImportReportPayload(body map[string]any) bool {
	if body == nil || !strings.EqualFold(strings.TrimSpace(firstText(body, "type")), "FEEDS_INTEGRATION_REPORT") {
		return false
	}
	details := objectValue(body["details"])
	if len(details) == 0 || parsePortalReportTimestamp(firstValue(details, "date")) == nil {
		return false
	}
	for _, aliases := range [][]string{
		{"total", "totalListings"}, {"created", "createdListings"},
		{"updated", "updatedListings"}, {"deleted"}, {"unchanged"},
		{"error", "errors", "errorCount"}, {"warning", "warnings", "warningCount"},
	} {
		value := firstValue(details, aliases...)
		if _, valid := grupoOLXReportCount(value); !valid {
			return false
		}
	}
	return true
}

func grupoOLXReportCount(value any) (int64, bool) {
	var number float64
	switch typed := value.(type) {
	case float64:
		number = typed
	case float32:
		number = float64(typed)
	case int:
		return int64(typed), typed >= 0
	case int32:
		return int64(typed), typed >= 0
	case int64:
		return typed, typed >= 0
	case json.Number:
		parsed, err := typed.Int64()
		return parsed, err == nil && parsed >= 0
	default:
		return 0, false
	}
	if math.IsNaN(number) || math.IsInf(number, 0) || number < 0 || math.Trunc(number) != number || number > math.MaxInt64 {
		return 0, false
	}
	return int64(number), true
}
