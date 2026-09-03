package roundrobin

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type autoTagValidationQueryer struct {
	query      string
	args       []any
	matchCount int
	queryCalls int
}

func (*autoTagValidationQueryer) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	panic("unexpected Exec call")
}

func (*autoTagValidationQueryer) Query(context.Context, string, ...any) (pgx.Rows, error) {
	panic("unexpected Query call")
}

func (queryer *autoTagValidationQueryer) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	queryer.query = query
	queryer.args = args
	queryer.queryCalls++
	return autoTagCountRow{count: queryer.matchCount}
}

type autoTagCountRow struct {
	count int
}

func (row autoTagCountRow) Scan(dest ...any) error {
	if len(dest) != 1 {
		return fmt.Errorf("unexpected destination count: %d", len(dest))
	}
	value, ok := dest[0].(*int)
	if !ok {
		return fmt.Errorf("unexpected destination type: %T", dest[0])
	}
	*value = row.count
	return nil
}

func TestValidateAutoTagIDsIsTenantScoped(t *testing.T) {
	const organizationID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	tagIDs := []string{
		"11111111-1111-4111-8111-111111111111",
		"22222222-2222-4222-8222-222222222222",
	}
	queryer := &autoTagValidationQueryer{matchCount: len(tagIDs)}

	if err := (Repository{}).validateAutoTagIDs(context.Background(), queryer, organizationID, tagIDs); err != nil {
		t.Fatalf("validateAutoTagIDs() error = %v", err)
	}
	for _, fragment := range []string{
		"with locked_tags as materialized",
		"from public.tags",
		"organization_id = $1::uuid",
		"id = any($2::uuid[])",
		"order by tag.id",
		"select count(*)::int",
		"from locked_tags",
	} {
		if !strings.Contains(queryer.query, fragment) {
			t.Errorf("validation query does not contain %q", fragment)
		}
	}
	if strings.Contains(strings.ToLower(queryer.query), "for key share") {
		t.Fatal("auto-tag validation must not lock tags after the queue lock")
	}
	if fmt.Sprint(queryer.args) != fmt.Sprint([]any{organizationID, tagIDs}) {
		t.Fatalf("unexpected validation args: %#v", queryer.args)
	}
}

func TestValidateAutoTagIDsRejectsUnknownOrForeignTag(t *testing.T) {
	queryer := &autoTagValidationQueryer{matchCount: 1}
	err := (Repository{}).validateAutoTagIDs(
		context.Background(),
		queryer,
		"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		[]string{
			"11111111-1111-4111-8111-111111111111",
			"22222222-2222-4222-8222-222222222222",
		},
	)
	if !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("expected ErrInvalidReference, got %v", err)
	}
}

func TestAddedQueueAutoTagIDsDoesNotBlockRemovingStaleIDs(t *testing.T) {
	const existingTagID = "11111111-1111-4111-8111-111111111111"
	const staleTagID = "22222222-2222-4222-8222-222222222222"
	const newTagID = "33333333-3333-4333-8333-333333333333"
	current := map[string]any{
		autoTagIDsSettingKey: []any{existingTagID, staleTagID},
	}

	removedStale := addedQueueAutoTagIDs(current, map[string]any{
		autoTagIDsSettingKey: []string{existingTagID},
	})
	if len(removedStale) != 0 {
		t.Fatalf("removing a stale ID must not require it to validate again: %#v", removedStale)
	}

	withNewTag := addedQueueAutoTagIDs(current, map[string]any{
		autoTagIDsSettingKey: []string{existingTagID, newTagID},
	})
	if len(withNewTag) != 1 || withNewTag[0] != newTagID {
		t.Fatalf("expected only the newly added tag to require validation, got %#v", withNewTag)
	}
}

func TestValidateAutoTagIDsSkipsDatabaseWhenSelectionIsEmpty(t *testing.T) {
	queryer := &autoTagValidationQueryer{}
	if err := (Repository{}).validateAutoTagIDs(context.Background(), queryer, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", nil); err != nil {
		t.Fatalf("validateAutoTagIDs() error = %v", err)
	}
	if queryer.queryCalls != 0 {
		t.Fatalf("expected no database query, got %d", queryer.queryCalls)
	}
}
