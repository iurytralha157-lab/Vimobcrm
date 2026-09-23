package meta

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	recoveryGraphPageSize = 100
	recoveryGraphMaxPages = 10
)

var (
	errRecoveryInvalidInput        = errors.New("invalid Meta lead recovery input")
	errRecoveryRouteUnavailable    = errors.New("active Meta lead form route unavailable")
	errRecoveryWrongOrganization   = errors.New("Meta lead form belongs to another organization")
	errRecoveryProviderUnavailable = errors.New("Meta lead retrieval unavailable")
	errRecoveryRateLimited         = errors.New("Meta lead retrieval rate limited")
	errRecoveryCollectionTooLarge  = errors.New("Meta lead recovery collection exceeded limit")
	errRecoveryLeadMismatch        = errors.New("Meta lead does not match the selected form or date")
	errRecoveryAlreadyPresentAlias = errors.New("Meta lead submission already exists under another provider identifier")
)

type LeadRecoveryRequest struct {
	OrganizationID string
	PageID         string
	FormID         string
	Date           string
	LeadgenID      string
}

type LeadRecoveryPreviewItem struct {
	LeadgenID  string `json:"leadgenId"`
	OccurredAt string `json:"occurredAt"`
	Status     string `json:"status"`
}

type LeadRecoveryPreview struct {
	Date  string                    `json:"date"`
	Items []LeadRecoveryPreviewItem `json:"items"`
}

type LeadRecoveryResult struct {
	Status    string `json:"status"`
	Reentry   bool   `json:"reentry"`
	LeadID    string `json:"-"`
	LeadgenID string `json:"-"`
}

type recoveryCandidate struct {
	change     leadgenChange
	details    map[string]any
	lead       leadData
	occurredAt time.Time
}

type recoveryQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func (repo Repository) PreviewLeadRecovery(ctx context.Context, request LeadRecoveryRequest) (LeadRecoveryPreview, error) {
	day, location, err := validateRecoveryRequest(request, false, time.Now())
	if err != nil {
		return LeadRecoveryPreview{}, err
	}
	integration, formConfig, err := repo.recoveryRoute(ctx, request)
	if err != nil {
		return LeadRecoveryPreview{}, err
	}
	details, err := repo.listRecoveryLeads(ctx, request.FormID, *integration.AccessToken)
	if err != nil {
		return LeadRecoveryPreview{}, err
	}

	items := make([]LeadRecoveryPreviewItem, 0)
	for _, detail := range details {
		candidate, err := prepareRecoveryCandidate(request, integration, formConfig, detail)
		if err != nil {
			return LeadRecoveryPreview{}, err
		}
		if candidate.occurredAt.In(location).Format("2006-01-02") != day.Format("2006-01-02") {
			continue
		}
		status, err := repo.recoveryCandidateStatus(ctx, candidate, integration.OrganizationID)
		if err != nil {
			return LeadRecoveryPreview{}, err
		}
		items = append(items, LeadRecoveryPreviewItem{
			LeadgenID:  candidate.change.LeadgenID,
			OccurredAt: candidate.occurredAt.Format(time.RFC3339),
			Status:     status,
		})
	}
	// Recover in provider submission order so queue rotation is reproducible.
	sort.Slice(items, func(left, right int) bool {
		if items[left].OccurredAt == items[right].OccurredAt {
			return items[left].LeadgenID < items[right].LeadgenID
		}
		return items[left].OccurredAt < items[right].OccurredAt
	})
	return LeadRecoveryPreview{Date: request.Date, Items: items}, nil
}

func (repo Repository) RecoverLead(ctx context.Context, request LeadRecoveryRequest) (LeadRecoveryResult, error) {
	day, location, err := validateRecoveryRequest(request, true, time.Now())
	if err != nil {
		return LeadRecoveryResult{}, err
	}
	integration, formConfig, err := repo.recoveryRoute(ctx, request)
	if err != nil {
		return LeadRecoveryResult{}, err
	}
	details, err := repo.metaGraphGet(ctx, request.LeadgenID, *integration.AccessToken, metaLeadDetailsFields)
	if err != nil {
		return LeadRecoveryResult{}, errRecoveryProviderUnavailable
	}
	candidate, err := prepareRecoveryCandidate(request, integration, formConfig, details)
	if err != nil {
		return LeadRecoveryResult{}, err
	}
	if candidate.occurredAt.In(location).Format("2006-01-02") != day.Format("2006-01-02") {
		return LeadRecoveryResult{}, errRecoveryLeadMismatch
	}
	status, err := repo.recoveryCandidateStatus(ctx, candidate, integration.OrganizationID)
	if err != nil {
		return LeadRecoveryResult{}, err
	}
	if status != "ready" && status != "possible_reentry" {
		return LeadRecoveryResult{Status: status}, nil
	}

	result := repo.processLeadgenChange(ctx, map[string]any{"recovery_origin": "meta_graph"}, candidate.change)
	switch result.Status {
	case "processed":
		return LeadRecoveryResult{Status: "processed", Reentry: result.Reentry, LeadID: result.LeadID, LeadgenID: candidate.change.LeadgenID}, nil
	case "duplicate":
		return LeadRecoveryResult{Status: "already_ingested"}, nil
	case "already_present_alias":
		return LeadRecoveryResult{Status: "already_present_alias"}, nil
	case "skipped":
		if result.DetailsPending {
			return LeadRecoveryResult{Status: "incomplete"}, nil
		}
		return LeadRecoveryResult{}, errRecoveryRouteUnavailable
	default:
		// Internal and provider errors must not expose lead data or credentials.
		return LeadRecoveryResult{}, errRecoveryProviderUnavailable
	}
}

func validateRecoveryRequest(request LeadRecoveryRequest, requireLeadID bool, now time.Time) (time.Time, *time.Location, error) {
	if strings.TrimSpace(request.OrganizationID) == "" ||
		!validRecoveryMetaID(request.PageID) || !validRecoveryMetaID(request.FormID) ||
		(requireLeadID && !validRecoveryMetaID(request.LeadgenID)) {
		return time.Time{}, nil, errRecoveryInvalidInput
	}
	location, err := time.LoadLocation("America/Sao_Paulo")
	if err != nil {
		return time.Time{}, nil, errRecoveryProviderUnavailable
	}
	day, err := time.ParseInLocation("2006-01-02", request.Date, location)
	if err != nil || day.Format("2006-01-02") != request.Date {
		return time.Time{}, nil, errRecoveryInvalidInput
	}
	today, _ := time.ParseInLocation("2006-01-02", now.In(location).Format("2006-01-02"), location)
	if day.After(today) || day.Before(today.AddDate(0, 0, -7)) {
		return time.Time{}, nil, errRecoveryInvalidInput
	}
	return day, location, nil
}

func validRecoveryMetaID(value string) bool {
	if len(value) < 5 || len(value) > 32 {
		return false
	}
	for _, digit := range value {
		if digit < '0' || digit > '9' {
			return false
		}
	}
	return true
}

func recoveryRouteMatchesExpectedOrganization(change leadgenChange, resolvedOrganizationID string) bool {
	return !change.Recovery ||
		(change.RecoveryOrganizationID != "" && change.RecoveryOrganizationID == resolvedOrganizationID)
}

func recoveryAliasGuardEnabled(change leadgenChange, lead leadData) bool {
	return change.Recovery &&
		((lead.Phone != nil && strings.TrimSpace(*lead.Phone) != "") ||
			(lead.Email != nil && strings.TrimSpace(*lead.Email) != ""))
}

func parseRecoveryCreatedTime(raw string) (time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Time{}, errRecoveryLeadMismatch
	}
	if seconds, err := strconv.ParseInt(raw, 10, 64); err == nil {
		if len(raw) == 13 {
			seconds /= 1000
		}
		if seconds > 0 {
			return time.Unix(seconds, 0).UTC(), nil
		}
	}
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04:05-0700", "2006-01-02T15:04:05.000-0700"} {
		if parsed, err := time.Parse(layout, raw); err == nil {
			return parsed.UTC(), nil
		}
	}
	return time.Time{}, errRecoveryLeadMismatch
}

func prepareRecoveryCandidate(request LeadRecoveryRequest, integration metaIntegration, formConfig metaFormConfig, details map[string]any) (recoveryCandidate, error) {
	canonicalID := textFromAny(details["id"])
	if !validRecoveryMetaID(canonicalID) || textFromAny(details["form_id"]) != request.FormID {
		return recoveryCandidate{}, errRecoveryLeadMismatch
	}
	occurredAt, err := parseRecoveryCreatedTime(textFromAny(details["created_time"]))
	if err != nil {
		return recoveryCandidate{}, err
	}
	change := leadgenChange{
		PageID:                 request.PageID,
		FormID:                 request.FormID,
		LeadgenID:              canonicalID,
		CreatedTime:            strconv.FormatInt(occurredAt.Unix(), 10),
		Raw:                    cloneObject(details),
		Recovery:               true,
		RecoveryOrganizationID: request.OrganizationID,
	}
	return recoveryCandidate{
		change:     change,
		details:    details,
		lead:       mapLeadData(details, change, integration, formConfig),
		occurredAt: occurredAt,
	}, nil
}

func (repo Repository) recoveryRoute(ctx context.Context, request LeadRecoveryRequest) (metaIntegration, metaFormConfig, error) {
	integration, formConfig, err := repo.findLeadgenRoute(ctx, request.PageID, request.FormID)
	if errors.Is(err, pgx.ErrNoRows) {
		return metaIntegration{}, metaFormConfig{}, errRecoveryRouteUnavailable
	}
	if err != nil {
		return metaIntegration{}, metaFormConfig{}, err
	}
	if integration.OrganizationID != request.OrganizationID {
		return metaIntegration{}, metaFormConfig{}, errRecoveryWrongOrganization
	}
	if integration.AccessToken == nil || strings.TrimSpace(*integration.AccessToken) == "" {
		return metaIntegration{}, metaFormConfig{}, errRecoveryProviderUnavailable
	}
	return integration, formConfig, nil
}

func (repo Repository) recoveryCandidateStatus(ctx context.Context, candidate recoveryCandidate, organizationID string) (string, error) {
	switch classifyMetaLeadIntake(candidate.details, candidate.change.Raw, candidate.lead) {
	case metaLeadIntakeIgnoreTest:
		return "test_lead", nil
	case metaLeadIntakeWaitForIdentity:
		return "incomplete", nil
	}
	match, err := repo.findLeadByMetaLeadID(ctx, organizationID, candidate.change.LeadgenID)
	if err != nil {
		return "", err
	}
	if match.LeadID != "" && !match.DetailsPending {
		return "already_ingested", nil
	}
	alias, err := recoveryAliasExists(ctx, repo.db.Pool(), organizationID, candidate.change.FormID, candidate.occurredAt, candidate.change.LeadgenID, candidate.lead.Phone, candidate.lead.Email)
	if err != nil {
		return "", err
	}
	if alias {
		return "already_present_alias", nil
	}
	contact, err := recoveryContactExists(ctx, repo.db.Pool(), organizationID, candidate.lead.Phone, candidate.lead.Email)
	if err != nil {
		return "", err
	}
	if contact {
		return "possible_reentry", nil
	}
	return "ready", nil
}

func recoveryAliasExists(ctx context.Context, queryer recoveryQueryer, organizationID, formID string, occurredAt time.Time, providerEventID string, phone, email *string) (bool, error) {
	if (phone == nil || strings.TrimSpace(*phone) == "") && (email == nil || strings.TrimSpace(*email) == "") {
		return false, nil
	}
	var exists bool
	err := queryer.QueryRow(ctx, `
		select exists (
			select 1
			from public.lead_entry_events as entry
			join public.leads as lead
			  on lead.organization_id = entry.organization_id
			 and lead.id = entry.lead_id
			where entry.organization_id = $1::uuid
			  and entry.provider = 'meta'
			  and entry.is_countable = true
			  and entry.form_id = $2
			  and entry.occurred_at = $3
			  and entry.provider_event_id <> $4
			  and ($5::text is null or normalize_phone(lead.phone) = normalize_phone($5))
			  and ($6::text is null or lower(btrim(lead.email)) = lower(btrim($6)))
		)
	`, organizationID, formID, occurredAt, providerEventID, nullablePointer(phone), nullablePointer(email)).Scan(&exists)
	return exists, err
}

func recoveryContactExists(ctx context.Context, queryer recoveryQueryer, organizationID string, phone, email *string) (bool, error) {
	if (phone == nil || strings.TrimSpace(*phone) == "") && (email == nil || strings.TrimSpace(*email) == "") {
		return false, nil
	}
	var exists bool
	err := queryer.QueryRow(ctx, `
		select exists (
			select 1
			from public.leads as lead
			where lead.organization_id = $1::uuid
			  and (
			    ($2::text is not null and normalize_phone(lead.phone) = normalize_phone($2))
			    or ($3::text is not null and lower(btrim(lead.email)) = lower(btrim($3)))
			  )
		)
	`, organizationID, nullablePointer(phone), nullablePointer(email)).Scan(&exists)
	return exists, err
}

func (repo Repository) listRecoveryLeads(ctx context.Context, formID, accessToken string) ([]map[string]any, error) {
	endpoint, err := url.Parse(strings.TrimRight(repo.config.GraphBaseURL, "/") + "/" + strings.Trim(repo.config.GraphVersion, "/") + "/" + url.PathEscape(formID) + "/leads")
	if err != nil {
		return nil, errRecoveryProviderUnavailable
	}
	baseQuery := endpoint.Query()
	baseQuery.Set("fields", metaLeadDetailsFields)
	baseQuery.Set("limit", strconv.Itoa(recoveryGraphPageSize))
	if strings.TrimSpace(repo.config.AppSecret) != "" {
		baseQuery.Set("appsecret_proof", oauthAppSecretProof(repo.config.AppSecret, accessToken))
	}
	items := make([]map[string]any, 0)
	seenCursors := make(map[string]struct{})
	after := ""
	for page := 0; page < recoveryGraphMaxPages; page++ {
		pageURL := *endpoint
		query := url.Values{}
		for key, values := range baseQuery {
			query[key] = append([]string(nil), values...)
		}
		if after != "" {
			query.Set("after", after)
		}
		pageURL.RawQuery = query.Encode()
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, pageURL.String(), nil)
		if err != nil {
			return nil, errRecoveryProviderUnavailable
		}
		request.Header.Set("Accept", "application/json")
		request.Header.Set("Authorization", "Bearer "+accessToken)
		response, err := repo.client.Do(request)
		if err != nil {
			return nil, errRecoveryProviderUnavailable
		}
		var payload struct {
			Data   []map[string]any `json:"data"`
			Paging struct {
				Next    string `json:"next"`
				Cursors struct {
					After string `json:"after"`
				} `json:"cursors"`
			} `json:"paging"`
		}
		decodeErr := json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&payload)
		response.Body.Close()
		if response.StatusCode == http.StatusTooManyRequests {
			return nil, errRecoveryRateLimited
		}
		if response.StatusCode < 200 || response.StatusCode >= 300 || decodeErr != nil {
			return nil, errRecoveryProviderUnavailable
		}
		items = append(items, payload.Data...)
		if strings.TrimSpace(payload.Paging.Next) == "" {
			return items, nil
		}
		cursor := strings.TrimSpace(payload.Paging.Cursors.After)
		if cursor == "" {
			return nil, errRecoveryProviderUnavailable
		}
		if _, repeated := seenCursors[cursor]; repeated {
			return nil, errRecoveryProviderUnavailable
		}
		if page == recoveryGraphMaxPages-1 {
			return nil, errRecoveryCollectionTooLarge
		}
		seenCursors[cursor] = struct{}{}
		after = cursor
	}
	return nil, errRecoveryCollectionTooLarge
}
