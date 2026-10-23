package settings

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/realtime"
)

const profileAvatarAudienceTimeout = 2 * time.Second

const profileAvatarAudienceSQL = `
	select coalesce(array_agg(distinct membership.organization_id::text
	                         order by membership.organization_id::text), array[]::text[])
	from public.organization_members membership
	join public.users usr on usr.id = membership.user_id
	where membership.user_id = $1::uuid
	  and membership.is_active = true
	  and membership.deleted_at is null
	  and coalesce(usr.is_active, false) = true
`

type profileAvatarAudienceQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func (repo Repository) profileAvatarOrganizations(ctx context.Context, userID string) ([]string, error) {
	if repo.db == nil || repo.db.Pool() == nil {
		return nil, errors.New("profile avatar realtime audience is unavailable")
	}
	return loadProfileAvatarOrganizations(ctx, repo.db.Pool(), userID)
}

// Profile photos belong to users, so an upload refreshes each active membership
// rather than assuming the organization selected during upload is the only one.
func loadProfileAvatarOrganizations(ctx context.Context, queryer profileAvatarAudienceQueryer, userID string) ([]string, error) {
	normalizedUserID, valid := normalizeUUID(userID)
	if !valid {
		return nil, ErrInvalidInput
	}
	ctx, cancel := context.WithTimeout(ctx, profileAvatarAudienceTimeout)
	defer cancel()
	var organizations []string
	if err := queryer.QueryRow(ctx, profileAvatarAudienceSQL, normalizedUserID).Scan(&organizations); err != nil {
		return nil, err
	}
	return organizations, nil
}

func (handler Handler) publishProfileAvatarChanged(userID string, organizationIDs []string) {
	normalizedUserID, valid := normalizeUUID(userID)
	if !valid || handler.publisher == nil {
		return
	}
	seen := make(map[string]struct{}, len(organizationIDs))
	for _, organizationID := range organizationIDs {
		normalizedOrganizationID, valid := normalizeUUID(organizationID)
		if !valid {
			continue
		}
		if _, duplicate := seen[normalizedOrganizationID]; duplicate {
			continue
		}
		seen[normalizedOrganizationID] = struct{}{}
		handler.publisher.Publish(realtime.NewEvent(
			realtime.EventOrganizationUsersChanged,
			normalizedOrganizationID,
			normalizedUserID,
			map[string]any{"targetUserId": normalizedUserID, "changeKind": "avatar_updated"},
		))
	}
}
