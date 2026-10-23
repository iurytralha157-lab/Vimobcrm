package automations

import (
	"errors"
	"net/http/httptest"
	"testing"
)

func TestExecutionFilterAppliesStatusDateAndPagination(t *testing.T) {
	request := httptest.NewRequest("GET", "/v1/automation-executions?status=failed&offset=100&dateFrom=2026-10-01T00:00:00Z&dateTo=2026-10-02T23:59:59Z", nil)
	filter, err := parseExecutionListFilter(request)
	if err != nil || filter.Status != "failed" || filter.Offset != 100 || filter.DateFrom == nil || filter.DateTo == nil {
		t.Fatalf("filter: %#v error: %v", filter, err)
	}
	statuses, ok := executionStatusFilterValues("running")
	if !ok || len(statuses) != 3 {
		t.Fatalf("running states: %v", statuses)
	}
	for _, query := range []string{"status=unknown", "offset=-1", "dateFrom=bad", "dateFrom=2026-10-02T00:00:00Z&dateTo=2026-10-01T00:00:00Z"} {
		if _, err := parseExecutionListFilter(httptest.NewRequest("GET", "/v1/automation-executions?"+query, nil)); err == nil {
			t.Fatalf("accepted %s", query)
		}
	}
}

func TestParseExecutionListFilterSupportsLeadActiveScope(t *testing.T) {
	request := httptest.NewRequest("GET", "/v1/automation-executions?leadId=4f38daef-50b7-4f52-9e5f-1fbe99596d70&activeOnly=true&limit=5", nil)

	filter, err := parseExecutionListFilter(request)
	if err != nil {
		t.Fatalf("parseExecutionListFilter() error = %v", err)
	}
	if filter.LeadID != "4f38daef-50b7-4f52-9e5f-1fbe99596d70" {
		t.Fatalf("LeadID = %q", filter.LeadID)
	}
	if !filter.ActiveOnly {
		t.Fatal("ActiveOnly = false, want true")
	}
	if filter.Limit != 5 {
		t.Fatalf("Limit = %d, want 5", filter.Limit)
	}
}

func TestParseExecutionListFilterRejectsInvalidActiveOnly(t *testing.T) {
	request := httptest.NewRequest("GET", "/v1/automation-executions?activeOnly=sometimes", nil)

	_, err := parseExecutionListFilter(request)
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("parseExecutionListFilter() error = %v, want ErrInvalidInput", err)
	}
}
