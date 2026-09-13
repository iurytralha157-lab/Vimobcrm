package roundrobin

import (
	"context"
	"fmt"
)

const validateAutoTagIDsQuery = `
	with locked_tags as materialized (
		select tag.id
		from public.tags as tag
		where tag.organization_id = $1::uuid
		  and tag.id = any($2::uuid[])
		order by tag.id
	)
	select count(*)::int
	from locked_tags
`

func (repo Repository) validateAutoTagIDs(ctx context.Context, q queryer, organizationID string, tagIDs []string) error {
	if len(tagIDs) == 0 {
		return nil
	}

	var matchingTags int
	if err := q.QueryRow(ctx, validateAutoTagIDsQuery, organizationID, tagIDs).Scan(&matchingTags); err != nil {
		return err
	}
	if matchingTags != len(tagIDs) {
		return fmt.Errorf("%w: %s must reference tags from this organization", ErrInvalidReference, autoTagIDsSettingKey)
	}
	return nil
}

func addedQueueAutoTagIDs(currentSettings map[string]any, nextSettings map[string]any) []string {
	currentTagIDs := queueAutoTagIDs(currentSettings)
	currentSet := make(map[string]struct{}, len(currentTagIDs))
	for _, tagID := range currentTagIDs {
		currentSet[tagID] = struct{}{}
	}

	added := make([]string, 0)
	for _, tagID := range queueAutoTagIDs(nextSettings) {
		if _, exists := currentSet[tagID]; exists {
			continue
		}
		added = append(added, tagID)
	}
	return added
}

func queueAutoTagIDs(settings map[string]any) []string {
	raw, ok := settings[autoTagIDsSettingKey]
	if !ok {
		return nil
	}

	var rawTagIDs []any
	switch typed := raw.(type) {
	case []any:
		rawTagIDs = typed
	case []string:
		rawTagIDs = make([]any, len(typed))
		for index := range typed {
			rawTagIDs[index] = typed[index]
		}
	default:
		return nil
	}

	tagIDs := make([]string, 0, len(rawTagIDs))
	seen := make(map[string]struct{}, len(rawTagIDs))
	for _, rawTagID := range rawTagIDs {
		value, ok := rawTagID.(string)
		if !ok {
			continue
		}
		tagID, ok := normalizeUUID(value)
		if !ok {
			continue
		}
		if _, exists := seen[tagID]; exists {
			continue
		}
		seen[tagID] = struct{}{}
		tagIDs = append(tagIDs, tagID)
	}
	return tagIDs
}
