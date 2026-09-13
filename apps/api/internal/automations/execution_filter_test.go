package automations

import (
	"errors"
	"net/http/httptest"
	"testing"
)

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
