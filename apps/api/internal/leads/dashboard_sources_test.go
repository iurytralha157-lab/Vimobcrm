package leads

import (
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestDashboardSourcesDefaultToCardCountsAndOptInToEntries(t *testing.T) {
	viewer := tenant.Context{
		OrganizationID: "11111111-1111-4111-8111-111111111111",
		UserID:         "22222222-2222-4222-8222-222222222222",
		MemberRole:     "admin",
	}
	from := time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC)
	to := from.AddDate(0, 0, 27)
	filter := DashboardFilter{
		DateFrom: &from, DateTo: &to,
		PipelineID: "33333333-3333-4333-8333-333333333333",
		Source:     "meta", PageID: "page-1", CampaignID: "campaign-1",
	}
	repo := Repository{}
	cardQuery, _, err := repo.buildDashboardSourcesQuery(viewer, filter)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(cardQuery, "from public.leads l") ||
		!strings.Contains(cardQuery, "l.created_at >=") ||
		!strings.Contains(cardQuery, "group by coalesce(nullif(l.source, ''), 'manual')") ||
		strings.Contains(cardQuery, "from entries entry") {
		t.Fatalf("legacy source query must keep card counts: %s", cardQuery)
	}

	filter.CountEntries = true
	entryQuery, entryArgs, err := repo.buildDashboardSourcesQuery(viewer, filter)
	if err != nil {
		t.Fatal(err)
	}
	cte, entryWhere, expectedArgs, err := repo.buildDashboardEntriesCTE(viewer, filter)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(entryQuery, cte) || !strings.Contains(entryQuery, "from entries entry") ||
		!strings.Contains(entryQuery, "where "+entryWhere) ||
		!strings.Contains(entryQuery, "group by coalesce(nullif(btrim(entry.source), ''), '')") ||
		strings.Contains(entryQuery, "group by coalesce(nullif(btrim(entry.source), ''), 'manual')") {
		t.Fatalf("entry source query must share the KPI cohort and keep unknown origins separate: %s", entryQuery)
	}
	if !reflect.DeepEqual(entryArgs, expectedArgs) {
		t.Fatalf("source query arguments diverged from entry KPI: %#v != %#v", entryArgs, expectedArgs)
	}
}

func TestDashboardEntrySourceWithoutOriginIsNotManual(t *testing.T) {
	unknown := dashboardSourcePoint("", 3, true)
	if unknown.Name != "Não informada" || unknown.RawSource != "" || unknown.Value != 3 {
		t.Fatalf("unknown entry source was mislabeled: %#v", unknown)
	}
	manual := dashboardSourcePoint("manual", 2, true)
	if manual.Name != "manual" || manual.RawSource != "manual" {
		t.Fatalf("manual entry source was changed: %#v", manual)
	}
}
