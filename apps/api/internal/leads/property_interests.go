package leads

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type leadPropertyInterestsChange struct {
	Before, After  []string
	Added, Removed int
	OperationID    string
}

// Normalize only a property command, after its lead snapshot was locked and
// authorized. A quick primary selection preserves every existing interest;
// an explicit collection is the user's replacement/reordering of that list.
func normalizeLeadPropertyInterests(current leadSnapshot, input *updateInput) (*leadPropertyInterestsChange, error) {
	if input == nil || (!input.PropertyID.Set && !input.InterestPropertyID.Set && !input.InterestPropertyIDs.Set) {
		return nil, nil
	}
	if input.PropertyID.Set && input.InterestPropertyID.Set &&
		nullablePatchString(input.PropertyID) != nullablePatchString(input.InterestPropertyID) {
		return nil, fmt.Errorf("%w: propertyId and interestPropertyId must identify the same primary property", ErrInvalidInput)
	}
	before := leadInterestPropertyIDs(current)
	primary := selectedLeadPropertyID(current, *input)
	if input.InterestPropertyID.Set && input.InterestPropertyID.Value != nil {
		primary = *input.InterestPropertyID.Value
	} else if input.PropertyID.Set && input.PropertyID.Value != nil {
		primary = *input.PropertyID.Value
	}
	var after []string
	if input.InterestPropertyIDs.Set {
		after = uniqueLeadPropertyIDs(input.InterestPropertyIDs.Value)
		explicitPrimary := input.InterestPropertyID
		if !explicitPrimary.Set {
			explicitPrimary = input.PropertyID
		}
		if explicitPrimary.Set && explicitPrimary.Value != nil {
			primary = *explicitPrimary.Value
		} else {
			primary = ""
			if len(after) > 0 {
				if input.PropertyID.Set && input.InterestPropertyID.Set {
					return nil, fmt.Errorf("%w: a cleared primary property requires an empty interestPropertyIds collection", ErrInvalidInput)
				}
				primary = after[0]
			}
		}
		after = prependLeadPropertyID(primary, after)
	} else if primary != "" {
		after = prependLeadPropertyID(primary, before)
	} else {
		// Both effective links were explicitly cleared. Do not leave a hidden
		// first interest for a later editor to promote back into the primary.
		after = []string{}
	}
	if len(after) > 20 {
		return nil, fmt.Errorf("%w: interestPropertyIds can contain at most 20 items; remove an interest before selecting another primary property", ErrInvalidInput)
	}

	// Keep aliases coherent on a new primary without rewriting an unchanged
	// legacy alias during secondary-only edits (especially a reserved won lead).
	// A one-alias null PATCH retains the other effective link as before.
	if primary != selectedLeadPropertyID(current, updateInput{}) || (input.PropertyID.Set && input.InterestPropertyID.Set) {
		input.PropertyID = patchString{Set: true, Value: optionalString(primary, 36)}
		input.InterestPropertyID = input.PropertyID
	}
	input.InterestPropertyIDs = patchStringSlice{Set: true, Value: after}
	metadata := LeadMetadata{}
	for key, value := range input.Metadata {
		metadata[key] = value
	}
	metadata["interestPropertyIds"] = after
	input.Metadata, input.MetadataSet = metadata, true
	if sameLeadPropertyIDs(before, after) {
		return nil, nil
	}
	operationID, err := newLeadPropertyOperationID()
	if err != nil {
		return nil, err
	}
	change := &leadPropertyInterestsChange{Before: before, After: after, OperationID: operationID}
	for _, id := range after {
		if !containsLeadPropertyID(before, id) {
			change.Added++
		}
	}
	for _, id := range before {
		if !containsLeadPropertyID(after, id) {
			change.Removed++
		}
	}
	return change, nil
}

func leadInterestPropertyIDs(current leadSnapshot) []string {
	metadata, _ := current.Data["metadata"].(map[string]any)
	if named, ok := current.Data["metadata"].(LeadMetadata); ok {
		metadata = named
	}
	ids := leadPropertyIDsFromValue(metadata["interestPropertyIds"])
	if current.PropertyID != "" {
		ids = prependLeadPropertyID(current.PropertyID, ids)
	}
	return prependLeadPropertyID(selectedLeadPropertyID(current, updateInput{}), ids)
}

func leadPropertyIDsFromValue(value any) []string {
	ids := []string{}
	switch values := value.(type) {
	case []string:
		ids = append(ids, values...)
	case []any:
		for _, value := range values {
			if id, ok := value.(string); ok {
				ids = append(ids, id)
			}
		}
	}
	return uniqueLeadPropertyIDs(ids)
}

func uniqueLeadPropertyIDs(values []string) []string {
	ids := make([]string, 0, len(values))
	for _, value := range values {
		if id, ok := normalizeUUID(value); ok && !containsLeadPropertyID(ids, id) {
			ids = append(ids, id)
		}
	}
	return ids
}

func prependLeadPropertyID(primary string, values []string) []string {
	ids := make([]string, 0, len(values)+1)
	if primary != "" {
		ids = append(ids, primary)
	}
	for _, id := range values {
		if id != primary {
			ids = append(ids, id)
		}
	}
	return ids
}

func containsLeadPropertyID(values []string, id string) bool {
	for _, value := range values {
		if value == id {
			return true
		}
	}
	return false
}

func sameLeadPropertyIDs(left, right []string) bool {
	return strings.Join(left, ",") == strings.Join(right, ",")
}

func newLeadPropertyOperationID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	value[6] = value[6]&0x0f | 0x40
	value[8] = value[8]&0x3f | 0x80
	raw := hex.EncodeToString(value[:])
	return raw[:8] + "-" + raw[8:12] + "-" + raw[12:16] + "-" + raw[16:20] + "-" + raw[20:], nil
}

func (repo Repository) insertLeadPropertyInterestsActivity(ctx context.Context, tx pgx.Tx, actor tenant.Context, leadID string, change *leadPropertyInterestsChange) error {
	if change == nil {
		return nil
	}
	// Names and IDs are deliberately absent from the public history payload:
	// preserving a lead's existing interest does not grant property visibility.
	return repo.insertActivity(ctx, tx, actor.OrganizationID, leadID, actor.UserID,
		"property_interests_changed", "Imóveis de interesse atualizados", map[string]any{
			"operation_id": change.OperationID, "added_count": change.Added, "removed_count": change.Removed,
			"previous_count": len(change.Before), "current_count": len(change.After), "origin": "lead_update",
		})
}
