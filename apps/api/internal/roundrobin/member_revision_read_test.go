package roundrobin

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// Enforce the SQL/scan boundary, including nested eligibility expressions.
// This reproduces the actual 12-column/13-destination failure on queue create.
func memberProjectionColumnCount(query string) int {
	start := strings.Index(query, "select") + len("select")
	end := strings.Index(query, "from public.round_robin_members rrm")
	if start < len("select") || end < start {
		return 0
	}
	projection := query[start:end]
	count, depth := 1, 0
	quoted := false
	for index := 0; index < len(projection); index++ {
		character := projection[index]
		if character == '\'' {
			if quoted && index+1 < len(projection) && projection[index+1] == '\'' {
				index++
				continue
			}
			quoted = !quoted
			continue
		}
		if quoted {
			continue
		}
		switch character {
		case '(':
			depth++
		case ')':
			depth--
		case ',':
			if depth == 0 {
				count++
			}
		}
	}
	return count
}

type memberRevisionRow struct{ query string }

func (row memberRevisionRow) Scan(destinations ...any) error {
	if columns := memberProjectionColumnCount(row.query); columns != len(destinations) {
		return fmt.Errorf("member SQL has %d fields for %d scan destinations", columns, len(destinations))
	}
	values := hardeningRow{testScopeUserID, testScopeQueueID, testScopeUserID, nil, 0, nil, true,
		testScopeUserID, "Synthetic member", "member@queue.local.test", nil, int64(7), int64(42)}
	for index, destination := range destinations {
		if weight, ok := destination.(*pgtype.Int4); ok {
			*weight = pgtype.Int4{Int32: 1, Valid: true}
			continue
		}
		if err := (hardeningRow{values[index]}).Scan(destination); err != nil {
			return err
		}
	}
	return nil
}

type memberRevisionRows struct {
	pgx.Rows
	query string
	read  bool
}

func (rows *memberRevisionRows) Close()     {}
func (rows *memberRevisionRows) Err() error { return nil }
func (rows *memberRevisionRows) Next() bool {
	if rows.read {
		return false
	}
	rows.read = true
	return true
}
func (rows *memberRevisionRows) Scan(destinations ...any) error {
	return (memberRevisionRow{query: rows.query}).Scan(destinations...)
}

type memberRevisionQueryer struct{}

func (memberRevisionQueryer) Query(_ context.Context, query string, _ ...any) (pgx.Rows, error) {
	return &memberRevisionRows{query: query}, nil
}
func (memberRevisionQueryer) QueryRow(_ context.Context, query string, _ ...any) pgx.Row {
	return memberRevisionRow{query: query}
}
func (memberRevisionQueryer) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, errors.New("member reads must not mutate")
}

func TestMemberReadsReturnQueueRevisionWithMatchingSQLProjection(t *testing.T) {
	queueID := testScopeQueueID
	members, err := listMembersWithQueryer(context.Background(), memberRevisionQueryer{}, testScopeOrganizationID, &queueID)
	if err != nil {
		t.Fatalf("list queue members: %v", err)
	}
	if len(members) != 1 || members[0].QueueRevision != 42 || members[0].LeadsCount != 7 {
		t.Fatalf("member list lost its queue revision or distribution count: %+v", members)
	}
	member, err := getMemberWithQueryer(context.Background(), memberRevisionQueryer{}, testScopeOrganizationID, testScopeUserID)
	if err != nil {
		t.Fatalf("read one member: %v", err)
	}
	if member.QueueRevision != 42 || member.LeadsCount != 7 {
		t.Fatalf("member read lost its queue revision or distribution count: %+v", member)
	}
}
