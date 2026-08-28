package meta

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"
)

var marketingSyncAdAccountPattern = regexp.MustCompile(`^\d+$`)

// Sync imports paid and organic Meta Marketing facts for one organization.
// The caller must already have authenticated the user and verified an
// organization owner/admin role. All database statements remain scoped by the
// same organization id as a second tenant-isolation layer.
func (service *MarketingSyncService) Sync(ctx context.Context, request MarketingSyncRequest) (MarketingSyncResult, error) {
	dateRange, err := parseMarketingSyncRequest(request)
	if err != nil {
		return MarketingSyncResult{Errors: []string{marketingSyncErrorCode(err)}}, err
	}
	if service == nil || service.db == nil {
		err := newMarketingSyncFailure("marketing_database_unavailable", http.StatusServiceUnavailable, nil)
		return MarketingSyncResult{Errors: []string{err.Code}}, err
	}

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

	targets, err := service.loadMarketingSyncTargets(syncCtx, strings.TrimSpace(request.OrganizationID))
	if err != nil {
		return MarketingSyncResult{Errors: []string{marketingSyncErrorCode(err)}}, err
	}
	if len(targets) == 0 {
		err := newMarketingSyncFailure("no_connected_meta_integration", http.StatusNotFound, nil)
		return MarketingSyncResult{Errors: []string{err.Code}}, err
	}

	graphSemaphore := make(chan struct{}, marketingSyncGraphConcurrency)
	results := marketingSyncMapLimited(syncCtx, targets, marketingSyncAccountConcurrency, func(ctx context.Context, target marketingSyncTarget, _ int) marketingSyncAggregate {
		return service.syncMarketingIntegration(ctx, target, dateRange, strings.TrimSpace(request.UserID), deadline, graphSemaphore)
	})
	aggregate := marketingSyncAggregate{}
	for _, result := range results {
		aggregate.Synced += result.Synced
		aggregate.MediaSynced += result.MediaSynced
		aggregate.SocialSynced += result.SocialSynced
		aggregate.Errors = append(aggregate.Errors, result.Errors...)
	}
	if errors.Is(syncCtx.Err(), context.DeadlineExceeded) {
		aggregate.Errors = append(aggregate.Errors, "sync_runtime_exceeded")
	}
	aggregate.Errors = deduplicateMarketingSyncErrors(aggregate.Errors)
	return MarketingSyncResult{
		Success:      len(aggregate.Errors) == 0,
		Synced:       aggregate.Synced,
		MediaSynced:  aggregate.MediaSynced,
		SocialSynced: aggregate.SocialSynced,
		Errors:       aggregate.Errors,
	}, nil
}

func (service *MarketingSyncService) syncMarketingIntegration(ctx context.Context, target marketingSyncTarget, dateRange marketingSyncDateRange, userID string, deadline time.Time, graphSemaphore chan struct{}) marketingSyncAggregate {
	runID, err := service.createMarketingSyncRun(ctx, target, dateRange, userID)
	if err != nil {
		return marketingSyncAggregate{Errors: []string{marketingSyncScopedError(target.IntegrationID, err)}}
	}
	result := marketingSyncAggregate{}
	accountIDs := selectedMarketingSyncAccountIDs(target)
	accountResults := marketingSyncMapLimited(ctx, accountIDs, marketingSyncAccountConcurrency, func(ctx context.Context, accountID string, _ int) marketingSyncAccountResult {
		return service.syncMarketingAdAccount(ctx, target, accountID, dateRange, deadline, graphSemaphore)
	})
	for _, account := range accountResults {
		result.Synced += account.Synced
		result.MediaSynced += account.MediaSynced
		result.Errors = append(result.Errors, account.Errors...)
	}

	social := service.syncMarketingInstagram(ctx, target, dateRange, deadline, graphSemaphore)
	result.SocialSynced += social.SocialSynced
	result.MediaSynced += social.MediaSynced
	result.Errors = append(result.Errors, social.Errors...)
	if len(accountIDs) == 0 && strings.TrimSpace(target.InstagramBusinessAccountID) == "" {
		result.Errors = append(result.Errors, target.IntegrationID+":no_marketing_account_selected")
	}
	if err := ctx.Err(); err != nil {
		result.Errors = append(result.Errors, target.IntegrationID+":sync_runtime_exceeded")
	}
	result.Errors = deduplicateMarketingSyncErrors(result.Errors)

	finishCtx, finishCancel := closeMarketingSyncRunContext(ctx)
	defer finishCancel()
	if err := service.finishMarketingSyncRun(finishCtx, runID, target, result); err != nil {
		result.Errors = append(result.Errors, marketingSyncScopedError(target.IntegrationID, err))
	}
	if err := service.updateMarketingSyncIntegrationStatus(finishCtx, target, result); err != nil {
		result.Errors = append(result.Errors, marketingSyncScopedError(target.IntegrationID, err))
	}
	result.Errors = deduplicateMarketingSyncErrors(result.Errors)
	return result
}

func (service *MarketingSyncService) syncMarketingAdAccount(ctx context.Context, target marketingSyncTarget, accountID string, dateRange marketingSyncDateRange, deadline time.Time, graphSemaphore chan struct{}) marketingSyncAccountResult {
	graph := service.newMarketingSyncGraphClient(target.AccessToken, deadline, graphSemaphore)
	account, err := graph.object(ctx, accountID, map[string]any{
		"fields": "id,account_id,name,account_status,currency,timezone_name,business_name",
	})
	if err != nil {
		code := marketingSyncScopedError(accountID, err)
		_ = service.recordMarketingSyncAccountError(ctx, target, accountID, code)
		return marketingSyncAccountResult{Errors: []string{code}}
	}
	now := service.now().UTC()
	accountStatus := marketingSyncText(account["account_status"])
	active := true
	if status := marketingSyncNullableNumber(account["account_status"]); status != nil {
		active = *status == 1
	}
	accountRow := marketingSyncAccountRow{
		OrganizationID: target.OrganizationID, IntegrationID: target.IntegrationID,
		ExternalAccountID: accountID, Name: marketingSyncText(account["name"]),
		Currency: marketingSyncText(account["currency"]), TimezoneName: marketingSyncText(account["timezone_name"]),
		AccountStatus: accountStatus, IsActive: active, SyncedAt: now,
	}
	if err := service.upsertMarketingSyncAccount(ctx, accountRow); err != nil {
		return marketingSyncAccountResult{Errors: []string{marketingSyncScopedError(accountID, err)}}
	}

	catalog := fetchMarketingSyncEntityCatalog(ctx, graph, accountID)
	errorsList := make([]string, 0, len(catalog.Errors))
	for _, item := range catalog.Errors {
		errorsList = append(errorsList, accountID+":"+item)
	}
	levels := []string{"account", "campaign", "adset", "ad"}
	insights := marketingSyncMapLimited(ctx, levels, len(levels), func(ctx context.Context, level string, _ int) marketingSyncInsightResult {
		return fetchMarketingSyncInsights(ctx, graph, accountID, level, dateRange)
	})
	performance := make([]marketingSyncPerformanceRow, 0)
	completeSnapshots := make(map[string][]marketingSyncPerformanceRow, len(levels))
	for index, insightResult := range insights {
		level := levels[index]
		if insightResult.Err != nil {
			errorsList = append(errorsList, marketingSyncScopedError(accountID+"_"+level, insightResult.Err))
			continue
		}
		if insightResult.Warning != "" {
			errorsList = append(errorsList, accountID+"_"+level+":"+insightResult.Warning)
		}
		levelRows := make([]marketingSyncPerformanceRow, 0, len(insightResult.Items))
		for _, insight := range insightResult.Items {
			row, ok := marketingSyncPerformanceRowFromInsight(insight, level, target, accountID, account, catalog, now)
			if ok {
				performance = append(performance, row)
				levelRows = append(levelRows, row)
			}
		}
		if marketingSyncInsightSnapshotComplete(insightResult, len(levelRows)) {
			completeSnapshots[level] = levelRows
		}
	}

	synced, err := service.upsertMarketingSyncPerformance(ctx, performance)
	if err != nil {
		errorsList = append(errorsList, marketingSyncScopedError(accountID, err))
	} else {
		// Reconcile only after the complete replacement set is durable. Levels
		// with a Graph error, cursor/page truncation, or mapping loss are omitted
		// from completeSnapshots and therefore cannot delete existing facts.
		for _, level := range levels {
			rows, complete := completeSnapshots[level]
			if !complete {
				continue
			}
			if _, reconcileErr := service.reconcileMarketingSyncPerformance(ctx, target, accountID, level, dateRange, rows); reconcileErr != nil {
				errorsList = append(errorsList, marketingSyncScopedError(accountID+"_"+level, reconcileErr))
			}
		}
	}
	mediaSynced := 0
	_, adSnapshotComplete := completeSnapshots["ad"]
	if adSnapshotComplete {
		mediaRows := buildMarketingSyncPaidMedia(target, accountID, catalog, performance, now)
		mediaSynced, err = service.upsertMarketingSyncMedia(ctx, mediaRows)
		if err != nil {
			errorsList = append(errorsList, marketingSyncScopedError(accountID+"_media", err))
		}
	}

	errorsList = deduplicateMarketingSyncErrors(errorsList)
	accountRow.LastError = ""
	if len(errorsList) > 0 {
		accountRow.LastError = errorsList[0]
	}
	if err := service.upsertMarketingSyncAccount(ctx, accountRow); err != nil {
		errorsList = append(errorsList, accountID+":marketing_accounts_write_failed")
	}
	return marketingSyncAccountResult{Synced: synced, MediaSynced: mediaSynced, Errors: deduplicateMarketingSyncErrors(errorsList)}
}

func selectedMarketingSyncAccountIDs(target marketingSyncTarget) []string {
	result := make([]string, 0)
	seen := make(map[string]struct{})
	for _, value := range target.SelectedAdAccounts {
		candidate := value
		if record := marketingSyncRecord(value); record != nil {
			candidate = marketingSyncFirstValue(record["id"], record["account_id"], record["accountId"])
		}
		if accountID := normalizeMarketingSyncAccountID(candidate); accountID != "" {
			if _, ok := seen[accountID]; !ok {
				seen[accountID] = struct{}{}
				result = append(result, accountID)
			}
		}
	}
	if len(result) == 0 {
		if accountID := normalizeMarketingSyncAccountID(target.AdAccountID); accountID != "" {
			result = append(result, accountID)
		}
	}
	return result
}

func normalizeMarketingSyncAccountID(value any) string {
	raw := strings.TrimSpace(marketingSyncText(value))
	raw = strings.TrimPrefix(strings.TrimPrefix(raw, "act_"), "ACT_")
	if !marketingSyncAdAccountPattern.MatchString(raw) {
		return ""
	}
	return "act_" + raw
}
