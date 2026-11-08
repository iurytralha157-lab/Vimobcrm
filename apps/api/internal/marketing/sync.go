package marketing

import (
	"context"
	"net/http"
	"strings"
)

// SyncInstagram is one Instagram account chosen in a connection.
type SyncInstagram struct {
	ID       string
	Username string
	PageID   string
}

// SyncTarget is what a connection exposes to the sync. It is loaded on the
// server only and never leaves the API.
type SyncTarget struct {
	AccessToken string
	AdAccounts  []string
	Instagram   []SyncInstagram
}

type SyncInput struct {
	SyncTarget
	OrganizationID string
	UserID         string
	DateStart      string
	DateStop       string
}

type SyncResult struct {
	Success      bool     `json:"success"`
	Synced       int      `json:"synced"`
	MediaSynced  int      `json:"media_synced"`
	SocialSynced int      `json:"social_synced"`
	Errors       []string `json:"errors"`
}

// Syncer imports the facts. Implemented outside this package to keep it free
// from the Meta lead intake code.
type Syncer interface {
	Sync(ctx context.Context, input SyncInput) (SyncResult, error)
}

func (service *Service) Sync(ctx context.Context, organizationID string, userID string, connectionID string, dateStart string, dateStop string) (SyncResult, error) {
	if err := service.requireEnabled(organizationID); err != nil {
		return SyncResult{}, err
	}
	if service.syncer == nil {
		return SyncResult{}, newFailure("marketing_sync_unavailable", http.StatusServiceUnavailable)
	}
	target, err := service.store.LoadSyncTarget(ctx, organizationID, connectionID)
	if err != nil {
		return SyncResult{}, err
	}
	if len(target.AdAccounts) == 0 && len(target.Instagram) == 0 {
		return SyncResult{}, newFailure("marketing_no_assets_selected", http.StatusBadRequest)
	}
	result, err := service.syncer.Sync(ctx, SyncInput{
		SyncTarget:     target,
		OrganizationID: organizationID,
		UserID:         userID,
		DateStart:      dateStart,
		DateStop:       dateStop,
	})
	if err != nil {
		return result, err
	}
	status, lastError := connectionHealth(result)
	if markErr := service.store.MarkSyncResult(ctx, organizationID, connectionID, status, lastError); markErr != nil {
		result.Errors = append(result.Errors, failureOf(markErr).Code)
	}
	return result, nil
}

// connectionHealth only ever describes this connection.
func connectionHealth(result SyncResult) (string, string) {
	lastError := ""
	if len(result.Errors) > 0 {
		lastError = result.Errors[0]
	}
	for _, item := range result.Errors {
		if strings.Contains(item, "meta_access_token_invalid") {
			return "expired", item
		}
	}
	if len(result.Errors) > 0 && result.Synced == 0 && result.SocialSynced == 0 {
		return "error", lastError
	}
	return "active", lastError
}
