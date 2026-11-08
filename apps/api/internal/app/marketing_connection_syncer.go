package app

import (
	"context"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/marketing"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/meta"
)

// marketingConnectionSyncer reuses the Marketing facts importer of the meta
// package and keeps the marketing package free from the lead intake code.
type marketingConnectionSyncer struct {
	service *meta.MarketingSyncService
}

func (syncer marketingConnectionSyncer) Sync(ctx context.Context, input marketing.SyncInput) (marketing.SyncResult, error) {
	instagram := make([]meta.MarketingConnectionInstagram, 0, len(input.Instagram))
	for _, profile := range input.Instagram {
		instagram = append(instagram, meta.MarketingConnectionInstagram{
			ID: profile.ID, Username: profile.Username, PageID: profile.PageID,
		})
	}
	result, err := syncer.service.SyncConnection(ctx, meta.MarketingConnectionSyncRequest{
		MarketingSyncRequest: meta.MarketingSyncRequest{
			OrganizationID: input.OrganizationID,
			UserID:         input.UserID,
			DateFrom:       input.DateStart,
			DateTo:         input.DateStop,
		},
		AccessToken: input.AccessToken,
		AdAccounts:  input.AdAccounts,
		Instagram:   instagram,
	})
	return marketing.SyncResult{
		Success:      result.Success,
		Synced:       result.Synced,
		MediaSynced:  result.MediaSynced,
		SocialSynced: result.SocialSynced,
		Errors:       result.Errors,
	}, err
}
