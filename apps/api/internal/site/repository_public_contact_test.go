package site

import (
	"errors"
	"os"
	"strings"
	"testing"
)

func TestPublicContactMissingSessionUsesSubmissionScopedAnalyticsFallback(t *testing.T) {
	t.Parallel()

	const submissionID = "submission-12345678"
	sessionID, analyticsSessionID, err := resolvePublicContactSessionIDs(nil, submissionID)
	if err != nil {
		t.Fatalf("resolve missing session: %v", err)
	}
	if sessionID != nil || optionalText(sessionID) != nil {
		t.Fatalf("missing visitor session must remain unassociated: %#v", sessionID)
	}
	if analyticsSessionID != publicContactSubmissionSessionPrefix+submissionID {
		t.Fatalf("unexpected analytics fallback: %q", analyticsSessionID)
	}
	if len([]rune(analyticsSessionID)) > maxPublicContactSessionIDRunes {
		t.Fatalf("analytics fallback exceeds the session limit: %d", len([]rune(analyticsSessionID)))
	}

	_, repeated, err := resolvePublicContactSessionIDs(nil, submissionID)
	if err != nil || repeated != analyticsSessionID {
		t.Fatalf("fallback must be deterministic: value=%q err=%v", repeated, err)
	}
	_, other, err := resolvePublicContactSessionIDs(nil, "submission-87654321")
	if err != nil {
		t.Fatalf("resolve other submission: %v", err)
	}
	if other == analyticsSessionID {
		t.Fatal("different submissions must not share an analytics session")
	}
	blank := "  "
	blankSessionID, blankAnalyticsSessionID, err := resolvePublicContactSessionIDs(&blank, submissionID)
	if err != nil || blankSessionID != nil || blankAnalyticsSessionID != analyticsSessionID {
		t.Fatalf("blank session must follow the missing-session contract: session=%v analytics=%q err=%v", blankSessionID, blankAnalyticsSessionID, err)
	}

	raw, err := os.ReadFile("../../../../supabase/migrations/20260722000000_production_public_private_baseline.sql")
	if err != nil {
		t.Fatalf("read local database baseline: %v", err)
	}
	schema := string(raw)
	start := strings.Index(schema, `CREATE TABLE IF NOT EXISTS "public"."site_analytics_events" (`)
	if start < 0 {
		t.Fatal("site analytics table is missing from the local database baseline")
	}
	end := strings.Index(schema[start:], ");")
	if end < 0 {
		t.Fatal("could not isolate the site analytics table definition")
	}
	if table := schema[start : start+end]; !strings.Contains(table, `"session_id" "text" NOT NULL`) {
		t.Fatal("regression test requires the local session_id NOT NULL contract")
	}
}

func TestPublicContactSessionIDIsNormalizedAndBounded(t *testing.T) {
	t.Parallel()

	provided := "  session-123  "
	sessionID, analyticsSessionID, err := resolvePublicContactSessionIDs(&provided, "submission-12345678")
	if err != nil {
		t.Fatalf("resolve provided session: %v", err)
	}
	if sessionID == nil || *sessionID != "session-123" || analyticsSessionID != "session-123" {
		t.Fatalf("provided session was not normalized consistently: session=%v analytics=%q", sessionID, analyticsSessionID)
	}

	oversized := strings.Repeat("s", maxPublicContactSessionIDRunes+1)
	if _, _, err := resolvePublicContactSessionIDs(&oversized, "submission-12345678"); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("oversized session error = %v, want ErrInvalidInput", err)
	}

	for _, reserved := range []string{
		publicContactSubmissionSessionPrefix + "forged",
		"  " + publicContactSubmissionSessionPrefix + "forged",
	} {
		if _, _, err := resolvePublicContactSessionIDs(&reserved, "submission-12345678"); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("reserved session %q error = %v, want ErrInvalidInput", reserved, err)
		}
	}
}

func TestValidatePublicContactRequestMatchesThePublicContract(t *testing.T) {
	t.Parallel()

	if !validatePublicContactRequest(validPublicContactRequestForTest()) {
		t.Fatal("valid public contact request was rejected")
	}
	emptyEmail := validPublicContactRequestForTest()
	emptyEmail.Email = publicContactStringPointer("")
	if !validatePublicContactRequest(emptyEmail) {
		t.Fatal("optional empty email was rejected")
	}

	tests := []struct {
		name   string
		mutate func(*PublicContactRequest)
	}{
		{
			name: "short message",
			mutate: func(request *PublicContactRequest) {
				request.Message = publicContactStringPointer("a")
			},
		},
		{
			name: "short submission id",
			mutate: func(request *PublicContactRequest) {
				request.SubmissionID = "short"
			},
		},
		{
			name: "display name email",
			mutate: func(request *PublicContactRequest) {
				request.Email = publicContactStringPointer("André <andre@example.com>")
			},
		},
		{
			name: "oversized best time",
			mutate: func(request *PublicContactRequest) {
				request.BestTime = publicContactStringPointer(strings.Repeat("x", 81))
			},
		},
		{
			name: "oversized privacy url",
			mutate: func(request *PublicContactRequest) {
				request.PrivacyURL = publicContactStringPointer(strings.Repeat("x", 301))
			},
		},
		{
			name: "oversized property code",
			mutate: func(request *PublicContactRequest) {
				request.PropertyCode = publicContactStringPointer(strings.Repeat("x", 81))
			},
		},
		{
			name: "blank explicit session",
			mutate: func(request *PublicContactRequest) {
				request.SessionID = publicContactStringPointer("  ")
			},
		},
		{
			name: "reserved synthetic session prefix",
			mutate: func(request *PublicContactRequest) {
				request.SessionID = publicContactStringPointer(publicContactSubmissionSessionPrefix + "forged")
			},
		},
		{
			name: "oversized landing page",
			mutate: func(request *PublicContactRequest) {
				request.LandingPage = publicContactStringPointer(strings.Repeat("x", 501))
			},
		},
		{
			name: "oversized referrer",
			mutate: func(request *PublicContactRequest) {
				request.Referrer = publicContactStringPointer(strings.Repeat("x", 1001))
			},
		},
		{
			name: "oversized attribution",
			mutate: func(request *PublicContactRequest) {
				request.UTMSource = publicContactStringPointer(strings.Repeat("x", 301))
			},
		},
		{
			name: "oversized honeypot",
			mutate: func(request *PublicContactRequest) {
				request.Website = publicContactStringPointer(strings.Repeat("x", 201))
			},
		},
		{
			name: "blank property id",
			mutate: func(request *PublicContactRequest) {
				request.PropertyID = publicContactStringPointer("")
			},
		},
		{
			name: "privacy not accepted",
			mutate: func(request *PublicContactRequest) {
				request.PrivacyAccepted = false
			},
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			request := validPublicContactRequestForTest()
			testCase.mutate(&request)
			if validatePublicContactRequest(request) {
				t.Fatal("invalid public contact request was accepted")
			}
		})
	}
}

func validPublicContactRequestForTest() PublicContactRequest {
	return PublicContactRequest{
		OrganizationID:  "11111111-1111-4111-8111-111111111111",
		Name:            "André Silva",
		Email:           publicContactStringPointer("andre@example.com"),
		Phone:           "+55 (11) 99999-9999",
		Message:         publicContactStringPointer("Quero conhecer o imóvel."),
		BestTime:        publicContactStringPointer("09h as 10h"),
		PrivacyAccepted: true,
		PrivacyURL:      publicContactStringPointer("/politica-de-privacidade"),
		PropertyID:      publicContactStringPointer("22222222-2222-4222-8222-222222222222"),
		PropertyCode:    publicContactStringPointer("AP-123"),
		SessionID:       publicContactStringPointer("session-123"),
		SubmissionID:    "submission-12345678",
		Website:         publicContactStringPointer(""),
		LandingPage:     publicContactStringPointer("/imoveis/AP-123"),
		Referrer:        publicContactStringPointer("https://partner.example/path"),
		UTMSource:       publicContactStringPointer("meta"),
	}
}

func publicContactStringPointer(value string) *string { return &value }

func TestPublicContactTransactionUsesResolvedSessionValues(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("repository_public_contact.go")
	if err != nil {
		t.Fatalf("read public contact repository: %v", err)
	}
	repository := string(raw)
	start := strings.Index(repository, "func (repo Repository) CreatePublicContact(")
	if start < 0 {
		t.Fatal("could not find CreatePublicContact")
	}
	end := strings.Index(repository[start:], "func phoneDigits(")
	if end < 0 {
		t.Fatal("could not isolate CreatePublicContact")
	}
	createContact := repository[start : start+end]

	for _, required := range []string{
		"resolvePublicContactSessionIDs(request.SessionID, submissionID)",
		"sessionValue := optionalText(sessionID)",
		"organizationID, analyticsSessionID, optionalText(request.LandingPage)",
		"ensurePublicSessionStart(ctx, tx",
		"metadata, created_at",
		"clock_timestamp()",
	} {
		if !strings.Contains(createContact, required) {
			t.Fatalf("public contact session contract is missing %q", required)
		}
	}
	for _, forbidden := range []string{
		"optionalText(request.SessionID)",
		"strings.TrimSpace(*request.SessionID)",
	} {
		if strings.Contains(createContact, forbidden) {
			t.Fatalf("public contact still binds the unnormalized request session through %q", forbidden)
		}
	}
	sessionStartIndex := strings.Index(createContact, "ensurePublicSessionStart(ctx, tx")
	conversionIndex := strings.Index(createContact, "insert into public.site_analytics_events")
	if sessionStartIndex < 0 || conversionIndex < 0 || sessionStartIndex >= conversionIndex {
		t.Fatal("public contact must guarantee session_start before inserting form_submit")
	}
}
