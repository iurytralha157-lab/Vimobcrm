package leads

import "math"

// Allocated only on the Repository value captured by one sequential worker
// closure. Handler/manual repositories keep nil; replicas do not share cursors.
// Offsets provide progress past busy pages, not a strict ordering or an SLA.
type redistributionBatchCursors struct {
	policy, warning, due int64
}

type redistributionBatchPage uint8

const (
	redistributionPolicyPage redistributionBatchPage = iota
	redistributionWarningPage
	redistributionDuePage
)

func (repo Repository) redistributionBatchCursor(page redistributionBatchPage) *int64 {
	if repo.redistributionCursors == nil {
		return nil
	}
	switch page {
	case redistributionPolicyPage:
		return &repo.redistributionCursors.policy
	case redistributionWarningPage:
		return &repo.redistributionCursors.warning
	case redistributionDuePage:
		return &repo.redistributionCursors.due
	default:
		return nil
	}
}

func redistributionBatchOffset(cursor *int64) int64 {
	if cursor == nil {
		return 0
	}
	return *cursor
}

// Advance after a successful scan, including pages whose jobs are all busy.
// A later transaction rollback does not lose jobs: database eligibility remains
// unchanged, and the next wrap revisits them. Concurrent list shifts can delay
// a job until the wrap rather than retaining a lock or changing its deadline.
func advanceRedistributionBatchCursor(cursor *int64, count int) {
	if cursor == nil {
		return
	}
	if count < leadRedistributionBatchLimit || *cursor > math.MaxInt64-leadRedistributionBatchLimit {
		*cursor = 0
		return
	}
	*cursor += leadRedistributionBatchLimit
}
