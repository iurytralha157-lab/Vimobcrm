package leads

import (
	"errors"
	"fmt"
	"net/url"
	"reflect"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	leadTagFilterIDOne   = "11111111-1111-4111-8111-111111111111"
	leadTagFilterIDTwo   = "22222222-2222-4222-8222-222222222222"
	leadTagFilterIDThree = "33333333-3333-4333-8333-333333333333"
)

func TestContactAndDashboardTagFiltersAcceptLegacyAndCSV(t *testing.T) {
	values := url.Values{
		"tagId":  {"  " + strings.ToUpper(leadTagFilterIDOne) + "  "},
		"tagIds": {leadTagFilterIDTwo + ", " + leadTagFilterIDOne, leadTagFilterIDThree},
	}
	want := []string{leadTagFilterIDOne, leadTagFilterIDTwo, leadTagFilterIDThree}

	contactFilter, err := ParseContactListFilter(values)
	if err != nil {
		t.Fatalf("ParseContactListFilter() error = %v", err)
	}
	if contactFilter.TagID != leadTagFilterIDOne {
		t.Fatalf("contact legacy tagId = %q, want %q", contactFilter.TagID, leadTagFilterIDOne)
	}
	if !reflect.DeepEqual(contactFilter.TagIDs, want) {
		t.Fatalf("contact tagIds = %#v, want %#v", contactFilter.TagIDs, want)
	}

	dashboardFilter, err := ParseDashboardFilter(values)
	if err != nil {
		t.Fatalf("ParseDashboardFilter() error = %v", err)
	}
	if dashboardFilter.TagID != leadTagFilterIDOne {
		t.Fatalf("dashboard legacy tagId = %q, want %q", dashboardFilter.TagID, leadTagFilterIDOne)
	}
	if !reflect.DeepEqual(dashboardFilter.TagIDs, want) {
		t.Fatalf("dashboard tagIds = %#v, want %#v", dashboardFilter.TagIDs, want)
	}
}

func TestContactAndDashboardTagFiltersRejectInvalidOrTooManyCSVValues(t *testing.T) {
	tooMany := make([]string, maxLeadTagFilterIDs+1)
	for index := range tooMany {
		tooMany[index] = fmt.Sprintf("%08x-0000-4000-8000-%012x", index+1, index+1)
	}

	testCases := map[string]url.Values{
		"invalid uuid": {
			"tagIds": {leadTagFilterIDOne + ",not-a-uuid"},
		},
		"more than fifty unique tags": {
			"tagIds": {strings.Join(tooMany, ",")},
		},
	}

	for name, values := range testCases {
		t.Run(name, func(t *testing.T) {
			if _, err := ParseContactListFilter(values); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("ParseContactListFilter() error = %v, want ErrInvalidInput", err)
			}
			if _, err := ParseDashboardFilter(values); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("ParseDashboardFilter() error = %v, want ErrInvalidInput", err)
			}
		})
	}
}

func TestContactAndDashboardTagPredicatesUseAnySemantics(t *testing.T) {
	tenantContext := tenant.Context{
		OrganizationID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		UserID:         "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
		MemberRole:     "admin",
	}
	wantTagIDs := []string{leadTagFilterIDOne, leadTagFilterIDTwo}

	contactWhere, contactArgs, err := buildContactWhere(tenantContext, ContactListFilter{
		TagID:  leadTagFilterIDOne,
		TagIDs: []string{leadTagFilterIDTwo, leadTagFilterIDOne},
	})
	if err != nil {
		t.Fatalf("buildContactWhere() error = %v", err)
	}
	assertLeadTagAnyPredicate(t, strings.Join(contactWhere, "\n"), "lt", contactArgs, wantTagIDs)

	dashboardWhere, dashboardArgs, err := (Repository{}).buildDashboardLeadWhere(
		tenantContext,
		DashboardFilter{
			TagID:  leadTagFilterIDOne,
			TagIDs: []string{leadTagFilterIDTwo, leadTagFilterIDOne},
		},
		dashboardLeadWhereOptions{},
	)
	if err != nil {
		t.Fatalf("buildDashboardLeadWhere() error = %v", err)
	}
	assertLeadTagAnyPredicate(t, strings.Join(dashboardWhere, "\n"), "dlt", dashboardArgs, wantTagIDs)
}

func assertLeadTagAnyPredicate(t *testing.T, query string, alias string, args []any, wantTagIDs []string) {
	t.Helper()

	predicate := alias + ".tag_id = any($"
	if !strings.Contains(query, predicate) || !strings.Contains(query, "::uuid[])") {
		t.Fatalf("tag predicate must use ANY(uuid[]) for OR semantics:\n%s", query)
	}
	if strings.Count(query, "from public.lead_tags") != 1 {
		t.Fatalf("tag predicate must use one EXISTS subquery:\n%s", query)
	}
	if len(args) == 0 {
		t.Fatal("tag predicate did not append an argument")
	}
	gotTagIDs, ok := args[len(args)-1].([]string)
	if !ok {
		t.Fatalf("tag predicate argument type = %T, want []string", args[len(args)-1])
	}
	if !reflect.DeepEqual(gotTagIDs, wantTagIDs) {
		t.Fatalf("tag predicate argument = %#v, want %#v", gotTagIDs, wantTagIDs)
	}
}
