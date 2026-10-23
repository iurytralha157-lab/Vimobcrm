package roundrobin

import (
	"context"
	"errors"
	"strconv"
	"strings"
)

var ErrRevisionRequired = errors.New("round robin revision required")
var ErrRevisionConflict = errors.New("round robin revision conflict")

func checkExpectedRevision(expected *int64, actual int64) error {
	if expected == nil {
		return ErrRevisionRequired
	}
	if *expected < 1 || *expected != actual {
		return ErrRevisionConflict
	}
	return nil
}

func parseRevisionHeader(value string) (*int64, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, ErrRevisionRequired
	}
	if len(value) < 3 || value[0] != '"' || value[len(value)-1] != '"' {
		return nil, ErrInvalidInput
	}
	revision, err := strconv.ParseInt(value[1:len(value)-1], 10, 64)
	if err != nil || revision < 1 {
		return nil, ErrInvalidInput
	}
	return &revision, nil
}

func requireQueueRevision(ctx context.Context, q queryer, organizationID, queueID string, expected *int64) error {
	if expected == nil {
		return ErrRevisionRequired
	}
	var revision int64
	if err := q.QueryRow(ctx, `select revision from public.round_robins where organization_id = $1::uuid and id = $2::uuid and deleted_at is null for update`, organizationID, queueID).Scan(&revision); err != nil {
		return err
	}
	return checkExpectedRevision(expected, revision)
}

func readQueueRevision(ctx context.Context, q queryer, organizationID, queueID string) (int64, error) {
	var revision int64
	err := q.QueryRow(ctx, `select revision from public.round_robins where organization_id = $1::uuid and id = $2::uuid`, organizationID, queueID).Scan(&revision)
	return revision, err
}
