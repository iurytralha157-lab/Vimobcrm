package leads

import (
	"encoding/json"
	"net/url"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestParseListFilter(t *testing.T) {
	values := url.Values{
		"limit":      {"25"},
		"offset":     {"10"},
		"search":     {" Maria "},
		"dealStatus": {"open"},
	}

	filter, err := ParseListFilter(values)
	if err != nil {
		t.Fatalf("ParseListFilter() returned error: %v", err)
	}

	if filter.Limit != 25 || filter.Offset != 10 || filter.Search != "Maria" || filter.DealStatus != "open" {
		t.Fatalf("ParseListFilter() = %#v", filter)
	}
}

func TestParseListFilterRejectsInvalidValues(t *testing.T) {
	tests := []url.Values{
		{"limit": {"999"}},
		{"offset": {"-1"}},
		{"dealStatus": {"archived"}},
		{"stageId": {"not-a-uuid"}},
	}

	for _, values := range tests {
		if _, err := ParseListFilter(values); err == nil {
			t.Fatalf("ParseListFilter(%v) expected error", values)
		}
	}
}

func TestCreateRequestValidate(t *testing.T) {
	interestValue := "450000.00"
	request := CreateRequest{
		Name:             "Ana Silva",
		Email:            "ana@example.com",
		Source:           "",
		InterestValue:    &interestValue,
		DealStatus:       "won",
		PropertyID:       "11111111-1111-1111-1111-111111111111",
		ConversationID:   "22222222-2222-2222-2222-222222222222",
		TagIDs:           []string{"33333333-3333-3333-3333-333333333333", "33333333-3333-3333-3333-333333333333"},
		RendaFamiliar:    "12000",
		FaixaValorImovel: "500k-700k",
	}

	input, err := request.Validate()
	if err != nil {
		t.Fatalf("Validate() returned error: %v", err)
	}

	if input.Name != "Ana Silva" || input.Source != "manual" {
		t.Fatalf("Validate() = %#v", input)
	}
	if input.InterestValue == nil || *input.InterestValue != interestValue {
		t.Fatalf("Validate() interest value = %#v", input.InterestValue)
	}
	if input.DealStatus != "won" || input.PropertyID == nil || input.ConversationID == nil {
		t.Fatalf("Validate() new fields = %#v", input)
	}
	if len(input.TagIDs) != 1 || input.TagIDs[0] != "33333333-3333-3333-3333-333333333333" {
		t.Fatalf("Validate() tag ids = %#v", input.TagIDs)
	}
}

func TestCreateRequestRejectsInvalidValues(t *testing.T) {
	invalidInterestValue := "abc"
	tests := []CreateRequest{
		{Name: "A"},
		{Name: "Ana", Email: "not-email"},
		{Name: "Ana", PipelineID: "not-a-uuid"},
		{Name: "Ana", InterestValue: &invalidInterestValue},
		{Name: "Ana", DealStatus: "archived"},
		{Name: "Ana", TagIDs: []string{"not-a-uuid"}},
	}

	for _, request := range tests {
		if _, err := request.Validate(); err == nil {
			t.Fatalf("Validate(%#v) expected error", request)
		}
	}
}

func TestUpdateRequestValidate(t *testing.T) {
	request := UpdateRequest{}
	payload := []byte(`{
		"name": "Ana Atualizada",
		"assignedUserId": null,
		"stageId": "11111111-1111-1111-1111-111111111111",
		"interestValue": 450000,
		"dealStatus": "open",
		"isOwnResource": true
	}`)

	if err := json.Unmarshal(payload, &request); err != nil {
		t.Fatalf("json.Unmarshal() returned error: %v", err)
	}

	input, err := request.Validate()
	if err != nil {
		t.Fatalf("Validate() returned error: %v", err)
	}

	if !input.AssignedUserID.Set || input.AssignedUserID.Value != nil {
		t.Fatalf("Validate() assigned user patch = %#v", input.AssignedUserID)
	}
	if input.StageID.Value == nil || *input.StageID.Value != "11111111-1111-1111-1111-111111111111" {
		t.Fatalf("Validate() stage id = %#v", input.StageID)
	}
	if input.InterestValue.Value == nil || *input.InterestValue.Value != "450000" {
		t.Fatalf("Validate() interest value = %#v", input.InterestValue)
	}
	if input.IsOwnResource.Value == nil || !*input.IsOwnResource.Value {
		t.Fatalf("Validate() is own resource = %#v", input.IsOwnResource)
	}
}

func TestUpdateRequestRejectsInvalidValues(t *testing.T) {
	tests := []string{
		`{}`,
		`{"name":"A"}`,
		`{"email":"not-email"}`,
		`{"stageId":"not-a-uuid"}`,
		`{"dealStatus":"archived"}`,
		`{"interestValue":"abc"}`,
	}

	for _, payload := range tests {
		var request UpdateRequest
		if err := json.Unmarshal([]byte(payload), &request); err != nil {
			t.Fatalf("json.Unmarshal(%s) returned error: %v", payload, err)
		}
		if _, err := request.Validate(); err == nil {
			t.Fatalf("Validate(%s) expected error", payload)
		}
	}
}

func TestLeadPermissionHelpers(t *testing.T) {
	manager := tenant.Context{MemberRole: "manager"}
	if !canViewAllLeads(manager) || !canManageLeads(manager) {
		t.Fatal("manager should view all leads and manage leads")
	}

	viewAll := tenant.Context{Permissions: []string{"lead_view_all"}}
	if !canViewAllLeads(viewAll) {
		t.Fatal("lead_view_all permission should view all leads")
	}
	if canManageLeads(viewAll) {
		t.Fatal("lead_view_all permission should not manage leads")
	}

	manage := tenant.Context{Permissions: []string{"lead_manage"}}
	if !canManageLeads(manage) {
		t.Fatal("lead_manage permission should manage leads")
	}
}
