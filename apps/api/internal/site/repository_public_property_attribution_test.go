package site

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type publicContactPropertyTestQueryer struct {
	row   pgx.Row
	query string
	args  []any
}

func (queryer *publicContactPropertyTestQueryer) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	queryer.query = query
	queryer.args = append([]any(nil), args...)
	return queryer.row
}

type publicContactPropertyTestRow struct {
	id         string
	code       *string
	matchCount int
	err        error
}

func (row publicContactPropertyTestRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	if len(dest) != 3 {
		return errors.New("unexpected public contact property scan")
	}
	propertyID, ok := dest[0].(*string)
	if !ok {
		return errors.New("unexpected property id destination")
	}
	propertyCode, ok := dest[1].(*pgtype.Text)
	if !ok {
		return errors.New("unexpected property code destination")
	}
	matchCount, ok := dest[2].(*int)
	if !ok {
		return errors.New("unexpected match count destination")
	}
	*propertyID = row.id
	if row.code == nil {
		*propertyCode = pgtype.Text{}
	} else {
		*propertyCode = pgtype.Text{String: *row.code, Valid: true}
	}
	*matchCount = row.matchCount
	return nil
}

func TestResolvePublicContactPropertyByIDUsesCanonicalCode(t *testing.T) {
	t.Parallel()

	const (
		organizationID = "11111111-1111-4111-8111-111111111111"
		propertyID     = "22222222-2222-4222-8222-222222222222"
	)
	canonicalCode := "AP-123"
	untrustedCode := "FORGED-999"
	queryer := &publicContactPropertyTestQueryer{row: publicContactPropertyTestRow{
		id:         propertyID,
		code:       &canonicalCode,
		matchCount: 1,
	}}

	resolved, err := resolvePublicContactProperty(
		context.Background(),
		queryer,
		organizationID,
		publicContactStringPointer(propertyID),
		&untrustedCode,
	)
	if err != nil {
		t.Fatalf("resolve property by id: %v", err)
	}
	if resolved == nil || resolved.ID != propertyID || resolved.Code == nil || *resolved.Code != canonicalCode {
		t.Fatalf("unexpected canonical property: %#v", resolved)
	}
	if len(queryer.args) != 2 || queryer.args[0] != organizationID || queryer.args[1] != propertyID {
		t.Fatalf("unexpected property lookup args: %#v", queryer.args)
	}
	for _, argument := range queryer.args {
		if argument == untrustedCode {
			t.Fatalf("untrusted property code reached the id lookup: %#v", queryer.args)
		}
	}
	if !strings.Contains(queryer.query, "p.id = $2::uuid") {
		t.Fatalf("property id lookup does not use the canonical id: %s", queryer.query)
	}
	assertPublicPropertyLookupIsFailClosed(t, queryer.query)
}

func TestResolvePublicContactPropertyByCodeRequiresAnEligibleCanonicalMatch(t *testing.T) {
	t.Parallel()

	const (
		organizationID = "11111111-1111-4111-8111-111111111111"
		propertyID     = "22222222-2222-4222-8222-222222222222"
	)
	canonicalCode := "AP-123"
	requestedCode := "  ap-123  "
	queryer := &publicContactPropertyTestQueryer{row: publicContactPropertyTestRow{
		id:         propertyID,
		code:       &canonicalCode,
		matchCount: 1,
	}}

	resolved, err := resolvePublicContactProperty(
		context.Background(),
		queryer,
		organizationID,
		nil,
		&requestedCode,
	)
	if err != nil {
		t.Fatalf("resolve property by code: %v", err)
	}
	if resolved == nil || resolved.ID != propertyID || resolved.Code == nil || *resolved.Code != canonicalCode {
		t.Fatalf("unexpected canonical property: %#v", resolved)
	}
	if len(queryer.args) != 2 || queryer.args[0] != organizationID || queryer.args[1] != "ap-123" {
		t.Fatalf("unexpected property lookup args: %#v", queryer.args)
	}
	if !strings.Contains(queryer.query, "lower(btrim(p.code)) = lower(btrim($2::text))") {
		t.Fatalf("property code lookup is not tenant-scoped and normalized: %s", queryer.query)
	}
	assertPublicPropertyLookupIsFailClosed(t, queryer.query)
}

func TestResolvePublicContactPropertyRejectsUnknownOrInvalidSelectors(t *testing.T) {
	t.Parallel()

	const organizationID = "11111111-1111-4111-8111-111111111111"
	unknownCode := "UNKNOWN"
	queryer := &publicContactPropertyTestQueryer{row: publicContactPropertyTestRow{err: pgx.ErrNoRows}}
	if _, err := resolvePublicContactProperty(context.Background(), queryer, organizationID, nil, &unknownCode); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("unknown property code error = %v, want ErrInvalidInput", err)
	}

	invalidID := "not-a-uuid"
	queryer = &publicContactPropertyTestQueryer{row: publicContactPropertyTestRow{err: errors.New("must not query")}}
	if _, err := resolvePublicContactProperty(context.Background(), queryer, organizationID, &invalidID, nil); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("invalid property id error = %v, want ErrInvalidInput", err)
	}
	if queryer.query != "" {
		t.Fatalf("invalid property id reached the database: %s", queryer.query)
	}

	blankCode := "  "
	queryer = &publicContactPropertyTestQueryer{row: publicContactPropertyTestRow{err: errors.New("must not query")}}
	resolved, err := resolvePublicContactProperty(context.Background(), queryer, organizationID, nil, &blankCode)
	if err != nil || resolved != nil || queryer.query != "" {
		t.Fatalf("blank optional property selector must stay unassociated: resolved=%#v query=%q err=%v", resolved, queryer.query, err)
	}
}

func TestResolvePublicContactPropertyRejectsAmbiguousCode(t *testing.T) {
	t.Parallel()

	canonicalCode := "AP-123"
	queryer := &publicContactPropertyTestQueryer{row: publicContactPropertyTestRow{
		id:         "22222222-2222-4222-8222-222222222222",
		code:       &canonicalCode,
		matchCount: 2,
	}}
	if _, err := resolvePublicContactProperty(
		context.Background(),
		queryer,
		"11111111-1111-4111-8111-111111111111",
		nil,
		&canonicalCode,
	); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("ambiguous property code error = %v, want ErrInvalidInput", err)
	}
	if !strings.Contains(queryer.query, "count(*) over()::int") {
		t.Fatalf("property code lookup does not prove uniqueness: %s", queryer.query)
	}
}

func TestPublicPropertyActiveSQLIsStrictForPublicIngress(t *testing.T) {
	t.Parallel()

	activeSQL := publicPropertyActiveSQL()
	for _, required := range []string{
		"lower(",
		"coalesce(p.status, '')",
		"in ('active', 'ativo')",
	} {
		if !strings.Contains(activeSQL, required) {
			t.Fatalf("active-property SQL is missing strict allowlist fragment %q: %s", required, activeSQL)
		}
	}
	for _, failOpen := range []string{
		"coalesce(p.status, 'active')",
		"not in",
		"sold",
		"rented",
		"inactive",
	} {
		if strings.Contains(strings.ToLower(activeSQL), failOpen) {
			t.Fatalf("active-property SQL remains fail-open through %q: %s", failOpen, activeSQL)
		}
	}

	for _, path := range []string{"repository_public_contact.go", "repository_tracking.go"} {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		source := string(raw)
		if !strings.Contains(source, "publicPropertyActiveSQL()") {
			t.Fatalf("%s does not share the strict active-property allowlist", path)
		}
		if strings.Contains(source, "coalesce(p.status, 'active') not in") {
			t.Fatalf("%s retains the fail-open property status blacklist", path)
		}
	}
}

func TestPublicContactCreateAndReentryPersistOnlyResolvedPropertyCode(t *testing.T) {
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

	if strings.Contains(createContact, "optionalText(request.PropertyCode)") {
		t.Fatal("public contact still persists the client-supplied property code")
	}
	for _, required := range []string{
		"resolvedProperty, err := resolvePublicContactProperty(",
		"propertyCode = optionalText(resolvedProperty.Code)",
		"phone, propertyCode, message, sessionValue",
	} {
		if !strings.Contains(createContact, required) {
			t.Fatalf("public contact canonical property contract is missing %q", required)
		}
	}
	if strings.Count(createContact, "phone, propertyCode, message, sessionValue") != 2 {
		t.Fatal("both lead creation and reentry must persist the resolved property code")
	}
}

func assertPublicPropertyLookupIsFailClosed(t *testing.T, query string) {
	t.Helper()
	for _, required := range []string{
		"p.organization_id = $1::uuid",
		"public.property_channel_publications",
		"publication.desired_state = 'published'",
		publicPropertyActiveSQL(),
	} {
		if !strings.Contains(query, required) {
			t.Fatalf("public property lookup is missing %q: %s", required, query)
		}
	}
}
