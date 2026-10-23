package pipelines

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const maxStageKeyLength = 80

func boundStageKey(value string, length int) string {
	runes := []rune(value)
	if len(runes) > length {
		return string(runes[:length])
	}
	return value
}

// Reserve space for the full numeric suffix rather than growing past the
// transport contract. Existing aliases are only read, never normalized here.
func uniqueStageKeyCandidate(base string, used map[string]struct{}) string {
	base = strings.TrimSpace(base)
	if base == "" {
		base = "coluna"
	}
	base = boundStageKey(base, maxStageKeyLength)
	if _, exists := used[base]; !exists {
		return base
	}
	for number := 2; ; number++ {
		suffix := "_" + strconv.Itoa(number)
		candidate := boundStageKey(base, maxStageKeyLength-len(suffix)) + suffix
		if _, exists := used[candidate]; !exists {
			return candidate
		}
	}
}

func readPipelineStageKeys(ctx context.Context, tx pgx.Tx, organizationID, pipelineID string) (map[string]struct{}, error) {
	rows, err := tx.Query(ctx, `
		select stage_key
		from public.stages
		where organization_id = $1::uuid
		  and pipeline_id = $2::uuid
		  and stage_key is not null
	`, organizationID, pipelineID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	used := map[string]struct{}{}
	for rows.Next() {
		var key pgtype.Text
		if err := rows.Scan(&key); err != nil {
			return nil, err
		}
		if key.Valid {
			used[key.String] = struct{}{}
		}
	}
	return used, rows.Err()
}

func assignReorderedStageKeys(ctx context.Context, tx pgx.Tx, organizationID, pipelineID string, input reorderStagesInput) ([]stageOrderItem, error) {
	used, err := readPipelineStageKeys(ctx, tx, organizationID, pipelineID)
	if err != nil {
		return nil, err
	}
	stages := append([]stageOrderItem(nil), input.Stages...)
	for index := range stages {
		key := strings.TrimSpace(stages[index].StageKey)
		if len([]rune(key)) > maxStageKeyLength {
			return nil, fmt.Errorf("%w: stage key must have at most %d characters", ErrInvalidInput, maxStageKeyLength)
		}
		if !stages[index].IsNew {
			if input.PreserveStageKeys {
				key = ""
			} else if key != "" {
				used[key] = struct{}{}
			}
		}
		stages[index].StageKey = key
	}
	for index := range stages {
		if !stages[index].IsNew {
			continue
		}
		base := stages[index].StageKey
		if base == "" {
			base = buildStageKey(stages[index].Name)
		}
		key := uniqueStageKeyCandidate(base, used)
		stages[index].StageKey = key
		used[key] = struct{}{}
	}
	return stages, nil
}
