package leads

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
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
		Name:          "Ana Silva",
		Email:         "ana@example.com",
		Source:        "",
		InterestValue: &interestValue,
		DealStatus:    "won",
		PropertyID:    "11111111-1111-1111-1111-111111111111",
		InterestPropertyIDs: []string{
			"11111111-1111-1111-1111-111111111111",
			"55555555-5555-4555-8555-555555555555",
		},
		ConversationID:   "22222222-2222-2222-2222-222222222222",
		TeamID:           "44444444-4444-4444-4444-444444444444",
		TagIDs:           []string{"33333333-3333-3333-3333-333333333333", "33333333-3333-3333-3333-333333333333"},
		RendaFamiliar:    "12000",
		FaixaValorImovel: "500k-700k",
		Profile: &LeadProfileRequest{
			PersonType: "individual",
			Gender:     "female",
			SocialName: "Ana",
			BirthDate:  "1990-04-10",
			CPF:        "123.456.789-01",
			RG:         "12.345.678-9",
		},
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
	if input.DealStatus != "won" || input.PropertyID == nil || input.ConversationID == nil || input.TeamID == nil {
		t.Fatalf("Validate() new fields = %#v", input)
	}
	if len(input.TagIDs) != 1 || input.TagIDs[0] != "33333333-3333-3333-3333-333333333333" {
		t.Fatalf("Validate() tag ids = %#v", input.TagIDs)
	}
	if len(input.InterestPropertyIDs) != 2 || input.InterestPropertyIDs[1] != "55555555-5555-4555-8555-555555555555" {
		t.Fatalf("Validate() interest property ids = %#v", input.InterestPropertyIDs)
	}
	profile, ok := input.Metadata["profile"].(LeadMetadata)
	if !ok || profile["personType"] != "individual" || profile["cpf"] != "12345678901" {
		t.Fatalf("Validate() profile metadata = %#v", input.Metadata)
	}
}

func TestCreateRequestRejectsInvalidValues(t *testing.T) {
	invalidInterestValue := "abc"
	tests := []CreateRequest{
		{Name: "A"},
		{Name: "Ana", Email: "not-email"},
		{Name: "Ana", PipelineID: "not-a-uuid"},
		{Name: "Ana", TeamID: "not-a-uuid"},
		{Name: "Ana", InterestValue: &invalidInterestValue},
		{Name: "Ana", DealStatus: "archived"},
		{Name: "Ana", DealStatus: "lost"},
		{Name: "Ana", TagIDs: []string{"not-a-uuid"}},
		{Name: "Ana", InterestPropertyIDs: []string{"not-a-uuid"}},
		{Name: "Ana", Profile: &LeadProfileRequest{PersonType: "person"}},
		{Name: "Ana", Profile: &LeadProfileRequest{CPF: "123"}},
		{Name: "Ana", Profile: &LeadProfileRequest{CNPJ: "123"}},
		{Name: "Ana", Profile: &LeadProfileRequest{BirthDate: "2035-01-01"}},
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
		"teamId": "44444444-4444-4444-8444-444444444444",
		"stageId": "11111111-1111-1111-1111-111111111111",
		"interestPropertyIds": ["55555555-5555-4555-8555-555555555555", "55555555-5555-4555-8555-555555555555"],
		"interestValue": 450000,
		"dealStatus": "open",
		"isOwnResource": true,
		"profile": {
			"personType": "company",
			"cnpj": "12.345.678/0001-90",
			"corporateName": "Vimob Negocios Imobiliarios"
		}
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
	if input.TeamID.Value == nil || *input.TeamID.Value != "44444444-4444-4444-8444-444444444444" {
		t.Fatalf("Validate() team id = %#v", input.TeamID)
	}
	if len(input.InterestPropertyIDs.Value) != 1 || !input.MetadataSet {
		t.Fatalf("Validate() interest properties = %#v", input.InterestPropertyIDs)
	}
	profile, ok := input.Metadata["profile"].(LeadMetadata)
	if !ok || profile["personType"] != "company" || profile["cnpj"] != "12345678000190" {
		t.Fatalf("Validate() profile metadata = %#v", input.Metadata)
	}
}

func TestLeadProfileSensitiveFieldsAreNotExposed(t *testing.T) {
	fields := LeadMetadata{}
	mergeLeadProfileMetadata(fields, []byte(`{
		"profile": {
			"personType": "individual",
			"gender": "female",
			"cpf": "12345678901",
			"rg": "123456789"
		}
	}`))

	if _, exists := fields["cpf"]; exists {
		t.Fatal("CPF must not be exposed in the regular lead payload")
	}
	if _, exists := fields["rg"]; exists {
		t.Fatal("RG must not be exposed in the regular lead payload")
	}
	if fields["hasCPF"] != true || fields["hasRG"] != true {
		t.Fatalf("sensitive field flags = %#v", fields)
	}
	if fields["personType"] != "individual" || fields["gender"] != "female" {
		t.Fatalf("non-sensitive profile fields = %#v", fields)
	}
}

func TestSensitiveProfileAuditIsRedacted(t *testing.T) {
	current := map[string]any{
		"metadata": map[string]any{
			"profile": map[string]any{
				"cpf":        "12345678901",
				"rg":         "123456789",
				"personType": "individual",
			},
		},
	}
	requested := map[string]any{
		"cpf":         "98765432100",
		"rg":          nil,
		"person_type": "individual",
	}

	oldData, newData := changedLeadAuditData(current, requested)
	if oldData["cpf"] != "Protegido" || newData["cpf"] != "Protegido" {
		t.Fatalf("CPF audit values must be redacted: old=%#v new=%#v", oldData, newData)
	}
	if oldData["rg"] != "Protegido" || newData["rg"] != nil {
		t.Fatalf("RG audit values must be redacted: old=%#v new=%#v", oldData, newData)
	}
	if _, exists := newData["person_type"]; exists {
		t.Fatalf("unchanged profile value should not be audited: %#v", newData)
	}
}

func TestContactMetadataSanitizesSensitiveProfile(t *testing.T) {
	sanitized := sanitizedLeadMetadataJSON(pgtype.Text{
		String: `{"profile":{"cpf":"12345678901","rg":"123456789","socialName":"Cliente QA"}}`,
		Valid:  true,
	})
	if sanitized == nil {
		t.Fatal("sanitized metadata is nil")
	}
	if strings.Contains(*sanitized, "12345678901") || strings.Contains(*sanitized, "123456789") {
		t.Fatalf("sensitive values leaked in contact metadata: %s", *sanitized)
	}
	if !strings.Contains(*sanitized, `"hasCPF":true`) || !strings.Contains(*sanitized, `"hasRG":true`) {
		t.Fatalf("sensitive field flags missing in contact metadata: %s", *sanitized)
	}
}

func TestUpdateRequestRejectsInvalidValues(t *testing.T) {
	tests := []string{
		`{}`,
		`{"name":"A"}`,
		`{"email":"not-email"}`,
		`{"stageId":"not-a-uuid"}`,
		`{"teamId":"not-a-uuid"}`,
		`{"interestPropertyIds":["not-a-uuid"]}`,
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

func TestMoveStageRequestValidatesBoardOrderAt(t *testing.T) {
	boardOrderAt := time.Date(2026, time.July, 12, 15, 30, 0, 0, time.UTC)
	request := MoveStageRequest{
		StageID:      "11111111-1111-1111-1111-111111111111",
		BoardOrderAt: &boardOrderAt,
	}

	input, err := request.Validate()
	if err != nil {
		t.Fatalf("Validate() returned error: %v", err)
	}
	if input.BoardOrderAt == nil || !input.BoardOrderAt.Equal(boardOrderAt) {
		t.Fatalf("Validate() board order = %#v", input.BoardOrderAt)
	}
	if input.StageEnteredAt != nil {
		t.Fatalf("Validate() legacy stage entered at = %#v, want nil", input.StageEnteredAt)
	}
}

func TestMoveStageRequestRejectsZeroBoardOrderAt(t *testing.T) {
	zero := time.Time{}
	request := MoveStageRequest{
		StageID:      "11111111-1111-1111-1111-111111111111",
		BoardOrderAt: &zero,
	}

	if _, err := request.Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("Validate() error = %v, want ErrInvalidInput", err)
	}
}

func TestValidateLostReasonContractAllowsExistingLostLeadUpdatesWithoutReason(t *testing.T) {
	status := "lost"
	stageID := "11111111-1111-1111-1111-111111111111"
	input := updateInput{
		DealStatus: patchString{Set: true, Value: &status},
		LostReason: patchString{Set: true, Value: nil},
		StageID:    patchString{Set: true, Value: &stageID},
	}
	current := leadSnapshot{
		DealStatus: "lost",
		LostReason: "",
	}

	if err := validateLostReasonContract(current, input); err != nil {
		t.Fatalf("validateLostReasonContract() returned error: %v", err)
	}
}

func TestValidateLostReasonContractRequiresReasonWhenMovingToLost(t *testing.T) {
	status := "lost"
	input := updateInput{
		DealStatus: patchString{Set: true, Value: &status},
	}
	current := leadSnapshot{
		DealStatus: "open",
	}

	if err := validateLostReasonContract(current, input); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("validateLostReasonContract() error = %v, want ErrInvalidInput", err)
	}
}

func TestValidateLostReasonContractRejectsClearingLostReason(t *testing.T) {
	reason := " "
	input := updateInput{
		LostReason: patchString{Set: true, Value: &reason},
	}
	current := leadSnapshot{
		DealStatus: "lost",
		LostReason: "Nao respondeu",
	}

	if err := validateLostReasonContract(current, input); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("validateLostReasonContract() error = %v, want ErrInvalidInput", err)
	}
}

func TestWonPropertyUnavailableMessage(t *testing.T) {
	tests := []struct {
		name        string
		status      string
		wantBlocked bool
		wantText    string
	}{
		{name: "active is available", status: "active"},
		{name: "empty defaults to available", status: ""},
		{name: "available in portuguese is available", status: " disponivel "},
		{name: "reserved blocks won", status: "reserved", wantBlocked: true, wantText: "ja esta reservado"},
		{name: "reserved portuguese blocks won", status: "Reservado", wantBlocked: true, wantText: "ja esta reservado"},
		{name: "sold blocks won", status: "sold", wantBlocked: true, wantText: "ja esta vendido"},
		{name: "sold portuguese blocks won", status: "vendido", wantBlocked: true, wantText: "ja esta vendido"},
		{name: "rented blocks won", status: "rented", wantBlocked: true, wantText: "ja esta alugado"},
		{name: "rented portuguese blocks won", status: "alugado", wantBlocked: true, wantText: "ja esta alugado"},
		{name: "leased synonym blocks won", status: "locado", wantBlocked: true, wantText: "ja esta alugado"},
		{name: "archived blocks won", status: "arquivado", wantBlocked: true, wantText: "nao esta disponivel"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			message := wonPropertyUnavailableMessage(test.status)
			if test.wantBlocked && message == "" {
				t.Fatalf("wonPropertyUnavailableMessage(%q) returned empty message", test.status)
			}
			if !test.wantBlocked && message != "" {
				t.Fatalf("wonPropertyUnavailableMessage(%q) = %q, want empty", test.status, message)
			}
			if test.wantText != "" && !strings.Contains(message, test.wantText) {
				t.Fatalf("wonPropertyUnavailableMessage(%q) = %q, want text %q", test.status, message, test.wantText)
			}
		})
	}
}

func TestLeadPropertyUnavailableErrorMessage(t *testing.T) {
	message := "Este imovel ja esta reservado. Consulte o administrador antes de marcar o lead como ganho."
	err := fmt.Errorf("%w: %s", ErrLeadPropertyUnavailable, message)

	if !errors.Is(err, ErrLeadPropertyUnavailable) {
		t.Fatalf("wrapped error should match ErrLeadPropertyUnavailable")
	}
	if got := leadErrorMessage(err, ErrLeadPropertyUnavailable); got != message {
		t.Fatalf("leadErrorMessage() = %q, want %q", got, message)
	}
}

func TestStoragePathFromPublicURL(t *testing.T) {
	projectURL := "https://example.supabase.co"
	publicURL := "https://example.supabase.co/storage/v1/object/public/whatsapp-media/orgs/org-1/leads/lead-1/docs/70.png"
	if got := storagePathFromPublicURL(publicURL, projectURL); got != "orgs/org-1/leads/lead-1/docs/70.png" {
		t.Fatalf("storagePathFromPublicURL(public) = %q", got)
	}

	signedURL := "https://example.supabase.co/storage/v1/object/sign/whatsapp-media/orgs/org-1/leads/lead-1/docs/70.png?token=abc"
	if got := storagePathFromPublicURL(signedURL, projectURL); got != "orgs/org-1/leads/lead-1/docs/70.png" {
		t.Fatalf("storagePathFromPublicURL(signed) = %q", got)
	}

	externalURL := "https://cdn.example.com/files/70.png"
	if got := storagePathFromPublicURL(externalURL, projectURL); got != "" {
		t.Fatalf("storagePathFromPublicURL(external) = %q, want empty", got)
	}
}

func TestLeadPermissionHelpers(t *testing.T) {
	manager := tenant.Context{UserID: "manager-1", MemberRole: "manager", OrganizationID: "org-1", Permissions: []string{"lead_view_all", "lead_operate", "lead_create"}}
	if !canViewAllLeads(manager) || !canManageLeads(manager) || !canCreateLeads(manager) {
		t.Fatal("manager should view all leads, manage leads and create leads")
	}

	viewAll := tenant.Context{Permissions: []string{"lead_view_all"}}
	if !canViewAllLeads(viewAll) {
		t.Fatal("lead_view_all permission should view all leads")
	}
	if canManageLeads(viewAll) {
		t.Fatal("lead_view_all permission should not manage leads")
	}

	manage := tenant.Context{Permissions: []string{"lead_view_all", "lead_operate"}}
	if !canManageLeads(manage) {
		t.Fatal("lead view-all and operate permissions should manage leads")
	}

	regular := tenant.Context{UserID: "user-1", OrganizationID: "org-1", MemberRole: "user", Permissions: []string{"lead_create"}}
	if !canCreateLeads(regular) {
		t.Fatal("regular organization users should create leads")
	}
	if canManageLeads(regular) {
		t.Fatal("regular organization users should not receive full lead management access")
	}

	if canCreateLeads(tenant.Context{UserID: "user-1", MemberRole: "user"}) {
		t.Fatal("users without organization context should not create leads")
	}

	createPermission := tenant.Context{UserID: "user-1", OrganizationID: "org-1", Permissions: []string{"lead_create"}}
	if !canCreateLeads(createPermission) {
		t.Fatal("lead_create permission should create leads")
	}
}
