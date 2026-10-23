package properties

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
)

type propertySavepointFake struct {
	pgx.Tx
	child         *propertySavepointFake
	rolledBack    bool
	committed     bool
	rollbackError error
}

func (tx *propertySavepointFake) Begin(context.Context) (pgx.Tx, error) { return tx.child, nil }
func (tx *propertySavepointFake) Commit(context.Context) error          { tx.committed = true; return nil }
func (tx *propertySavepointFake) Rollback(context.Context) error {
	tx.rolledBack = true
	return tx.rollbackError
}

func TestOptionalPropertySQLFailureRecoversSavepoint(t *testing.T) {
	child := &propertySavepointFake{}
	parent := &propertySavepointFake{child: child}
	statementError := errors.New("synthetic SQL constraint")
	err := optionalPropertyTransaction(context.Background(), parent, func(pgx.Tx) error { return statementError })
	if !errors.Is(err, statementError) || !child.rolledBack || child.committed || parent.rolledBack {
		t.Fatalf("savepoint not recovered: %v %#v", err, child)
	}
}

func TestOptionalPropertyRollbackFailureIsFatal(t *testing.T) {
	child := &propertySavepointFake{rollbackError: errors.New("connection lost")}
	err := optionalPropertyTransaction(context.Background(), &propertySavepointFake{child: child}, func(pgx.Tx) error { return errors.New("SQL failure") })
	if !errors.Is(err, errPropertySavepointFailed) {
		t.Fatalf("rollback failure must abort primary work: %v", err)
	}
}
