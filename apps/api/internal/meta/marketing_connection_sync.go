package meta

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"
)

var marketingSyncInsertTable = regexp.MustCompile(`insert into public\.(\w+)`)

// marketingSyncScopeSQL keeps every lead intake statement byte-identical. Only
// a Marketing connection, which has no integration, gets the NULL form, and it
// must not clear the integration link of a fact already imported by one.
func marketingSyncScopeSQL(query string, integrationID string) string {
	if strings.TrimSpace(integrationID) != "" {
		return query
	}
	query = strings.ReplaceAll(query, "integration_id = $2::uuid", "integration_id is null and $2 = ''")
	query = strings.ReplaceAll(query, "integration_id = $3::uuid", "integration_id is null and $3 = ''")
	if match := marketingSyncInsertTable.FindStringSubmatch(query); match != nil {
		query = strings.ReplaceAll(query,
			"integration_id = excluded.integration_id",
			"integration_id = coalesce(excluded.integration_id, "+match[1]+".integration_id)")
	}
	return query
}

// MarketingConnectionInstagram is one professional account chosen in a
// read-only Marketing connection.
type MarketingConnectionInstagram struct {
	ID       string
	Username string
	PageID   string
}

// MarketingConnectionSyncRequest carries everything the sync needs from a
// Marketing connection, so this path never reads public.meta_integrations.
type MarketingConnectionSyncRequest struct {
	MarketingSyncRequest
	AccessToken string
	AdAccounts  []string
	Instagram   []MarketingConnectionInstagram
}

// SyncConnection imports Marketing facts through a read-only connection. Facts
// are written with no integration_id. Unlike Sync, it never updates
// meta_integrations, so its result cannot change the state of the lead intake.
func (service *MarketingSyncService) SyncConnection(ctx context.Context, request MarketingConnectionSyncRequest) (MarketingSyncResult, error) {
	dateRange, err := parseMarketingSyncRequest(request.MarketingSyncRequest)
	if err != nil {
		return MarketingSyncResult{Errors: []string{marketingSyncErrorCode(err)}}, err
	}
	if service == nil || service.db == nil {
		err := newMarketingSyncFailure("marketing_database_unavailable", http.StatusServiceUnavailable, nil)
		return MarketingSyncResult{Errors: []string{err.Code}}, err
	}
	organizationID := strings.TrimSpace(request.OrganizationID)
	runtimeLimit := service.runtimeLimit
	if runtimeLimit <= 0 {
		runtimeLimit = marketingSyncRuntimeLimit
	}
	syncCtx, cancel := context.WithTimeout(ctx, runtimeLimit)
	defer cancel()
	deadline := service.now().Add(runtimeLimit)
	if parentDeadline, ok := syncCtx.Deadline(); ok && parentDeadline.Before(deadline) {
		deadline = parentDeadline
	}

	releaseLocal, acquired := service.tryAcquireLocalMarketingSync(organizationID)
	if !acquired {
		err := newMarketingSyncFailure("marketing_sync_in_progress", http.StatusConflict, nil)
		return MarketingSyncResult{Errors: []string{err.Code}}, err
	}
	defer releaseLocal()
	if service.acquireOrganizationLock == nil {
		err := newMarketingSyncFailure("marketing_sync_lock_unavailable", http.StatusServiceUnavailable, nil)
		return MarketingSyncResult{Errors: []string{err.Code}}, err
	}
	releaseOrganization, acquired, lockErr := service.acquireOrganizationLock(syncCtx, organizationID)
	if lockErr != nil {
		err := newMarketingSyncFailure("marketing_sync_lock_unavailable", http.StatusServiceUnavailable, lockErr)
		return MarketingSyncResult{Errors: []string{err.Code}}, err
	}
	if !acquired {
		err := newMarketingSyncFailure("marketing_sync_in_progress", http.StatusConflict, nil)
		return MarketingSyncResult{Errors: []string{err.Code}}, err
	}
	defer releaseOrganization()

	base := marketingSyncTarget{
		OrganizationID: organizationID,
		AccessToken:    request.AccessToken,
		AccountWide:    true,
	}
	userID := strings.TrimSpace(request.UserID)
	runID, err := service.createMarketingSyncRun(syncCtx, base, dateRange, userID)
	if err != nil {
		return MarketingSyncResult{Errors: []string{marketingSyncErrorCode(err)}}, err
	}

	graphSemaphore := make(chan struct{}, marketingSyncGraphConcurrency)
	result := marketingSyncAggregate{}
	accounts := marketingSyncMapLimited(syncCtx, normalizeConnectionAccounts(request.AdAccounts), marketingSyncAccountConcurrency, func(ctx context.Context, accountID string, _ int) marketingSyncAccountResult {
		return service.syncMarketingAdAccount(ctx, base, accountID, dateRange, deadline, graphSemaphore)
	})
	for _, account := range accounts {
		result.Synced += account.Synced
		result.MediaSynced += account.MediaSynced
		result.Errors = append(result.Errors, account.Errors...)
	}
	for _, profile := range request.Instagram {
		target := base
		target.InstagramBusinessAccountID = profile.ID
		target.InstagramUsername = profile.Username
		target.PageID = profile.PageID
		social := service.syncMarketingInstagram(syncCtx, target, dateRange, deadline, graphSemaphore)
		result.SocialSynced += social.SocialSynced
		result.MediaSynced += social.MediaSynced
		result.Errors = append(result.Errors, social.Errors...)
	}
	if errors.Is(syncCtx.Err(), context.DeadlineExceeded) {
		result.Errors = append(result.Errors, "sync_runtime_exceeded")
	}
	result.Errors = deduplicateMarketingSyncErrors(result.Errors)

	finishCtx, finishCancel := closeMarketingSyncRunContext(syncCtx)
	defer finishCancel()
	if err := service.finishMarketingSyncRun(finishCtx, runID, base, result); err != nil {
		result.Errors = append(result.Errors, marketingSyncErrorCode(err))
	}
	return MarketingSyncResult{
		Success:      len(result.Errors) == 0,
		Synced:       result.Synced,
		MediaSynced:  result.MediaSynced,
		SocialSynced: result.SocialSynced,
		Errors:       result.Errors,
	}, nil
}

func normalizeConnectionAccounts(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		accountID := normalizeMarketingSyncAccountID(value)
		if _, ok := seen[accountID]; accountID == "" || ok {
			continue
		}
		seen[accountID] = struct{}{}
		result = append(result, accountID)
	}
	return result
}
