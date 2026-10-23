package leads

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// These adapters retain the pre-existing transaction-fake coverage for policy,
// candidate reload and cursor behavior. Production uses an independently
// committed transaction per candidate; PostgreSQL integration tests exercise it.
func (repo Repository) processRedistributionWarnings(ctx context.Context, tx pgx.Tx) error {
	jobs, err := repo.listWarningRedistributionJobs(ctx, tx)
	if err != nil {
		return err
	}
	for _, job := range jobs {
		version := job.RowVersion
		if err := repo.processRedistributionWarning(ctx, tx, job, &version); err != nil {
			return err
		}
	}
	return nil
}

func (repo Repository) processDueRedistributions(ctx context.Context, tx pgx.Tx) error {
	jobs, err := repo.listDueRedistributionJobs(ctx, tx)
	if err != nil {
		return err
	}
	for _, job := range jobs {
		version := job.RowVersion
		if err := repo.processDueRedistribution(ctx, tx, job, &version); err != nil {
			return err
		}
	}
	return nil
}

func (repo Repository) refreshPendingRedistributionPolicies(ctx context.Context, tx pgx.Tx) error {
	jobs, err := repo.listPendingRedistributionPolicyJobs(ctx, tx)
	if err != nil {
		return err
	}
	for _, job := range jobs {
		version := job.RowVersion
		if err := repo.processRedistributionPolicy(ctx, tx, job, &version); err != nil {
			return err
		}
	}
	return nil
}
