package app

import (
	"context"
	"errors"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type postgresActiveSessionChecker struct {
	database *dbpkg.Postgres
}

func (checker postgresActiveSessionChecker) IsActive(ctx context.Context, userID, sessionID string) (bool, error) {
	if checker.database == nil || checker.database.Pool() == nil {
		return false, errors.New("auth session database is unavailable")
	}

	var active bool
	err := checker.database.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from auth.sessions
			where id = $1::uuid
			  and user_id = $2::uuid
		)
	`, sessionID, userID).Scan(&active)
	if err != nil {
		return false, err
	}
	return active, nil
}
