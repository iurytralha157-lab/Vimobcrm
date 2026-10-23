package leads

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestTagRevisionRequiresOneValidRevision(t *testing.T) {
	for _, value := range []string{"", "*", "W/\"2026-10-12T10:00:00Z\"", "bad", "\"2026-10-12T10:00:00Z\",\"2026-10-12T11:00:00Z\""} {
		if _, err := parseTagRevision(value); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("revision %q error = %v", value, err)
		}
	}
	for _, value := range []string{"2026-10-12T10:00:00.123456Z", "\"2026-10-12T10:00:00.123456Z\""} {
		if _, err := parseTagRevision(value); err != nil {
			t.Fatalf("valid revision rejected: %v", err)
		}
	}
}

func TestTagManagementConflictsHaveStableHTTPContracts(t *testing.T) {
	for _, item := range []struct {
		err  error
		code string
	}{
		{normalizeTagMutationError(&pgconn.PgError{Code: "23505", ConstraintName: "tags_org_normalized_name_key"}), "tag_already_exists"},
		{ErrTagChanged, "tag_changed"},
		{normalizeTagMutationError(&pgconn.PgError{Code: "23503", ConstraintName: "tags_management_dependency_guard"}), "tag_in_use"},
	} {
		response := httptest.NewRecorder()
		writeLeadError(response, httptest.NewRequest(http.MethodDelete, "/v1/tags/tag", nil), item.err)
		if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), `"code":"`+item.code+`"`) {
			t.Fatalf("response = %d %s", response.Code, response.Body.String())
		}
	}
	unrelated := &pgconn.PgError{Code: "23505", ConstraintName: "another_unique"}
	if normalizeTagMutationError(unrelated) != unrelated {
		t.Fatal("unrelated errors must not become tag conflicts")
	}
}

func TestTagUpdateRejectsMissingRevisionAndUnauthorizedTenantBeforeDatabase(t *testing.T) {
	id := "11111111-1111-4111-8111-111111111111"
	repo := Repository{}
	viewer := tenant.Context{OrganizationID: "22222222-2222-4222-8222-222222222222", Permissions: []string{"tag_manage"}}
	if _, err := repo.UpdateTag(context.Background(), viewer, id, tagMutationInput{Name: "Quente", Color: "#ffffff"}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("missing revision error = %v", err)
	}
	viewer.Permissions = nil
	if _, err := repo.UpdateTag(context.Background(), viewer, id, tagMutationInput{}); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("unauthorized error = %v", err)
	}
}

func TestTagDeletionRechecksDependenciesAndRevisionBeforeAnyWrite(t *testing.T) {
	revision := time.Date(2026, 10, 12, 10, 0, 0, 0, time.UTC)
	for _, item := range []struct {
		name     string
		revision time.Time
		usages   []TagUsageItem
		expected error
	}{
		{"changed", revision.Add(time.Second), nil, ErrTagChanged},
		{"distribution", revision, []TagUsageItem{{Kind: "distribution_rule", Count: 1}}, ErrTagInUse},
		{"automation", revision, []TagUsageItem{{Kind: "automation_execution", Count: 1}}, ErrTagInUse},
		{"unreferenced", revision, nil, nil},
	} {
		t.Run(item.name, func(t *testing.T) {
			store := &tagManagementStore{organizationID: "org-a", actual: item.revision, usages: item.usages}
			err := deleteTagWithQueryer(context.Background(), store, "org-a", "tag-a", revision)
			if !errors.Is(err, item.expected) {
				t.Fatalf("delete error = %v, want %v", err, item.expected)
			}
			if item.expected != nil && store.writes != 0 {
				t.Fatalf("blocked deletion wrote %d statements", store.writes)
			}
			if item.expected == nil && store.writes != 2 {
				t.Fatalf("unreferenced deletion wrote %d statements", store.writes)
			}
		})
	}
	store := &tagManagementStore{organizationID: "org-a", actual: revision}
	if err := deleteTagWithQueryer(context.Background(), store, "org-b", "tag-a", revision); !errors.Is(err, ErrInvalidReference) || store.writes != 0 {
		t.Fatalf("other tenant deletion = %v, writes %d", err, store.writes)
	}
}

type tagManagementStore struct {
	organizationID string
	actual         time.Time
	usages         []TagUsageItem
	reads, writes  int
}

func (store *tagManagementStore) QueryRow(_ context.Context, _ string, args ...any) pgx.Row {
	store.reads++
	if args[0] != store.organizationID {
		return tagManagementRow{err: pgx.ErrNoRows}
	}
	return tagManagementRow{actual: store.actual, count: 7}
}
func (store *tagManagementStore) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return &tagManagementRows{items: store.usages}, nil
}
func (store *tagManagementStore) Exec(_ context.Context, _ string, args ...any) (pgconn.CommandTag, error) {
	if args[1] != store.organizationID {
		return pgconn.CommandTag{}, errors.New("write escaped tenant")
	}
	store.writes++
	return pgconn.NewCommandTag("DELETE 1"), nil
}

type tagManagementRow struct {
	actual time.Time
	count  int64
	err    error
}

func (row tagManagementRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	*dest[0].(*time.Time) = row.actual
	if len(dest) > 1 {
		*dest[1].(*int64) = row.count
	}
	return nil
}

type tagManagementRows struct {
	items    []TagUsageItem
	position int
}

func (rows *tagManagementRows) Next() bool {
	if rows.position >= len(rows.items) {
		return false
	}
	rows.position++
	return true
}
func (rows *tagManagementRows) Scan(dest ...any) error {
	item := rows.items[rows.position-1]
	*dest[0].(*string) = item.Kind
	*dest[1].(*int64) = item.Count
	return nil
}
func (*tagManagementRows) Close()                                       {}
func (*tagManagementRows) Err() error                                   { return nil }
func (*tagManagementRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (*tagManagementRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (*tagManagementRows) Values() ([]any, error)                       { return nil, nil }
func (*tagManagementRows) RawValues() [][]byte                          { return nil }
func (*tagManagementRows) Conn() *pgx.Conn                              { return nil }
