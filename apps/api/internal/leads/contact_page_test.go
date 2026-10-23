package leads

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type contactPageTestTx struct {
	pgx.Tx
	total       int64
	version     string
	readError   error
	commitError error
	sequence    []string
	query       string
	args        []any
}
type contactPageTestRow struct{ tx *contactPageTestTx }

func (row contactPageTestRow) Scan(dest ...any) error {
	if row.tx.readError != nil {
		return row.tx.readError
	}
	*dest[0].(*int64) = row.tx.total
	if len(dest) > 1 {
		*dest[1].(*string) = row.tx.version
	}
	return nil
}

type contactPageEmptyRows struct{ pgx.Rows }

func (contactPageEmptyRows) Next() bool { return false }
func (contactPageEmptyRows) Err() error { return nil }
func (contactPageEmptyRows) Close()     {}
func (tx *contactPageTestTx) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	tx.sequence = append(tx.sequence, "set")
	tx.query, tx.args = query, args
	return contactPageTestRow{tx}
}
func (tx *contactPageTestTx) Query(context.Context, string, ...any) (pgx.Rows, error) {
	tx.sequence = append(tx.sequence, "page")
	return contactPageEmptyRows{}, nil
}
func (tx *contactPageTestTx) Commit(context.Context) error {
	tx.sequence = append(tx.sequence, "commit")
	return tx.commitError
}

func TestContactPageEmptyPageRetainsTotalAndSameSnapshotVersion(t *testing.T) {
	ctx := context.Background()
	viewer := tenant.Context{OrganizationID: importDistributionOrganizationID, UserID: importDistributionActorID, Permissions: []string{permissions.LeadViewOwn}}
	for _, mode := range []string{"compact", "full"} {
		t.Run(mode, func(t *testing.T) {
			tx := &contactPageTestTx{total: 60, version: strings.Repeat("a", 64)}
			page, err := (Repository{}).readContactsPageInSnapshot(ctx, tx, viewer, ContactListFilter{Mode: mode, Page: 3, Limit: 50})
			if err != nil || page.Total != 60 || len(page.Data) != 0 || page.Page != 3 {
				t.Fatalf("empty page lost total: %#v %v", page, err)
			}
			if mode == "full" && !validContactExportVersion(page.ExportVersion) {
				t.Fatal("empty export page needs a set version")
			}
			if strings.Join(tx.sequence, ",") != "set,page,commit" {
				t.Fatalf("page/count did not use one snapshot: %v", tx.sequence)
			}
		})
	}
}

func TestContactExportVersionIgnoresPaginationButRejectsDriftBeforePage(t *testing.T) {
	ctx := context.Background()
	viewer := tenant.Context{OrganizationID: importDistributionOrganizationID, UserID: importDistributionActorID, Permissions: []string{permissions.LeadViewOwn}}
	filter := ContactListFilter{Mode: "full", Page: 1, Limit: 500, SortBy: "created_at", SortDir: "desc"}
	first, err := (Repository{}).readContactsPageInSnapshot(ctx, &contactPageTestTx{total: 1000, version: strings.Repeat("a", 64)}, viewer, filter)
	if err != nil {
		t.Fatal(err)
	}
	filter.Page = 2
	filter.ExpectedExportVersion = first.ExportVersion
	filter.ResponseMode = "page"
	unchanged := &contactPageTestTx{total: 1000, version: strings.Repeat("a", 64)}
	if _, err := (Repository{}).readContactsPageInSnapshot(ctx, unchanged, viewer, filter); err != nil {
		t.Fatalf("pagination changed stable version: %v", err)
	}
	drift := &contactPageTestTx{total: 1000, version: strings.Repeat("b", 64)}
	if _, err := (Repository{}).readContactsPageInSnapshot(ctx, drift, viewer, filter); !errors.Is(err, ErrContactsExportChanged) {
		t.Fatalf("same count data drift result %v", err)
	}
	if strings.Join(drift.sequence, ",") != "set" {
		t.Fatalf("changed set must not read/commit a page: %v", drift.sequence)
	}
	other := viewer
	other.OrganizationID = "99999999-9999-4999-8999-999999999999"
	if _, err := (Repository{}).readContactsPageInSnapshot(ctx, &contactPageTestTx{total: 1000, version: strings.Repeat("a", 64)}, other, filter); !errors.Is(err, ErrContactsExportChanged) {
		t.Fatalf("version crossed organizations: %v", err)
	}
}

func TestContactExportFingerprintIncludesFullSourceAndReferenceLabels(t *testing.T) {
	query := contactExportSetQuery([]string{"l.organization_id=$1::uuid"})
	for _, required := range []string{"sha256", "to_jsonb(l)", "'pipeline_name', p.name", "'stage_name', s.name", "'assignee_name', u.name", "to_jsonb(lm)", "mci.campaign_name", "coalesce(tags.tags", "order by l.created_at desc, l.id desc", "t.organization_id = l.organization_id", "lm.organization_id = l.organization_id"} {
		if !strings.Contains(query, required) {
			t.Fatalf("fingerprint omits %q", required)
		}
	}
	if strings.Contains(query, "offset") || strings.Contains(query, "max(l.updated_at)") {
		t.Fatal("fingerprint must include the whole set, not a page or max timestamp")
	}
	for _, irrelevant := range []string{"to_jsonb(u)", "to_jsonb(p)", "to_jsonb(s)", "t.color"} {
		if strings.Contains(query, irrelevant) {
			t.Fatalf("non-export reference fields cause false drift: %s", irrelevant)
		}
	}
}

func TestContactPageValidationAndFormattedPhoneSearch(t *testing.T) {
	for _, search := range []string{"(11) 99999-9999", "+55 (11) 99999-9999"} {
		where, args, err := buildContactWhere(tenant.Context{OrganizationID: importDistributionOrganizationID, UserID: importDistributionActorID}, ContactListFilter{Search: search})
		if err != nil || !strings.Contains(strings.Join(where, " "), "regexp_replace(coalesce(l.phone") {
			t.Fatalf("formatted phone missed normalized fallback: %v", err)
		}
		if args[len(args)-1] != "%"+contactPhoneSearchDigits(search)+"%" {
			t.Fatal("phone fallback was not parameterized")
		}
	}
	for _, search := range []string{"Ana 1234", "ana1234@example.test", "12", "%1234_"} {
		if contactPhoneSearchDigits(search) != "" {
			t.Fatalf("text/short search %q became broad phone search", search)
		}
	}
	for _, query := range []url.Values{{"responseMode": {"unknown"}}, {"mode": {"compact"}, "responseMode": {"page"}, "expectedExportVersion": {strings.Repeat("a", 64)}}, {"mode": {"export"}, "expectedExportVersion": {"invalid"}}} {
		if _, err := ParseContactListFilter(query); err == nil {
			t.Fatalf("invalid page contract accepted: %v", query)
		}
	}
}
