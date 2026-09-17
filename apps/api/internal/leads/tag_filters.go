package leads

import (
	"fmt"
	"strings"
)

const maxLeadTagFilterIDs = 50

func splitLeadTagFilterValues(values []string) []string {
	items := make([]string, 0, len(values))
	for _, value := range values {
		items = append(items, strings.Split(value, ",")...)
	}
	return items
}

func normalizeLeadTagFilterIDs(tagID string, tagIDs []string) (string, []string, error) {
	legacyTagID := strings.TrimSpace(tagID)
	normalized := make([]string, 0, len(tagIDs)+1)
	seen := make(map[string]struct{}, len(tagIDs)+1)

	appendTagID := func(raw string, field string) error {
		value := strings.TrimSpace(raw)
		if value == "" {
			return nil
		}

		canonical, ok := normalizeUUID(value)
		if !ok {
			if field == "tagId" {
				return fmt.Errorf("%w: tagId is invalid", ErrInvalidInput)
			}
			return fmt.Errorf("%w: tagIds contains an invalid uuid", ErrInvalidInput)
		}
		if _, exists := seen[canonical]; exists {
			return nil
		}
		if len(normalized) >= maxLeadTagFilterIDs {
			return fmt.Errorf("%w: tagIds can contain at most %d items", ErrInvalidInput, maxLeadTagFilterIDs)
		}

		seen[canonical] = struct{}{}
		normalized = append(normalized, canonical)
		return nil
	}

	if legacyTagID != "" {
		if err := appendTagID(legacyTagID, "tagId"); err != nil {
			return "", nil, err
		}
		legacyTagID = normalized[0]
	}
	for _, value := range tagIDs {
		if err := appendTagID(value, "tagIds"); err != nil {
			return "", nil, err
		}
	}

	return legacyTagID, normalized, nil
}
