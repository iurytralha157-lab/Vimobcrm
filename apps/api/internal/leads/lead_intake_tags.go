package leads

import "fmt"

// Both create flows combine explicit tags with routing tags without discarding
// either source. Reentries append this union to the stored tags.
func leadIntakeTagIDs(input createInput, intakeTagIDs []string) ([]string, error) {
	merged := make([]string, 0, len(input.TagIDs)+len(intakeTagIDs))
	seen := make(map[string]bool)
	for _, group := range [][]string{input.TagIDs, intakeTagIDs} {
		for _, raw := range group {
			id, ok := normalizeUUID(raw)
			if !ok {
				return nil, ErrInvalidReference
			}
			if seen[id] {
				continue
			}
			seen[id] = true
			merged = append(merged, id)
			if len(merged) > 50 {
				return nil, fmt.Errorf("%w: As tags informadas e da fila automática somam mais de 50 tags. Revise as tags antes de tentar novamente.", ErrInvalidInput)
			}
		}
	}
	return merged, nil
}
