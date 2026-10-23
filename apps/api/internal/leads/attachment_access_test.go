package leads

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestAttachmentMetadataListOptionDefaultsToSignedAndRejectsInvalidValues(t *testing.T) {
	for _, option := range []string{"", "&metadataOnly=true", "&metadataOnly=false"} {
		values, _ := url.ParseQuery("leadId=" + attachmentTestLead + option)
		filter, err := ParseLeadAttachmentListFilter(values)
		if err != nil || filter.LeadID != attachmentTestLead || filter.MetadataOnly != strings.HasSuffix(option, "=true") {
			t.Fatalf("option %q: %#v %v", option, filter, err)
		}
	}
	for _, value := range []string{"leadId=invalid", "leadId=" + attachmentTestLead + "&metadataOnly=", "leadId=" + attachmentTestLead + "&metadataOnly=perhaps"} {
		values, _ := url.ParseQuery(value)
		if _, err := ParseLeadAttachmentListFilter(values); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("invalid option accepted: %s %v", value, err)
		}
	}
}

func TestAttachmentMetadataListNeverSignsOrExposesStoredURLs(t *testing.T) {
	attachments := []LeadAttachment{{ID: attachmentTestID, LeadID: attachmentTestLead, FileName: "documento.pdf", FileURL: "https://private.invalid/stable", StoragePath: "private/path", StorageBucket: "private-bucket"}}
	prepareLeadAttachmentList(attachments, true, func(*LeadAttachment) { t.Fatal("metadata listing attempted signing") })
	payload, err := json.Marshal(attachments)
	if err != nil || attachments[0].Availability != "not_requested" || attachments[0].FileName != "documento.pdf" {
		t.Fatalf("metadata changed: %s %v", payload, err)
	}
	for _, private := range []string{"https://private.invalid", "private/path", "private-bucket"} {
		if strings.Contains(string(payload), private) {
			t.Fatalf("metadata exposed stored access: %s", payload)
		}
	}
	if !strings.Contains(string(payload), `"file_url":null`) {
		t.Fatalf("missing nullable URL: %s", payload)
	}
	calls := 0
	prepareLeadAttachmentList(attachments, false, func(attachment *LeadAttachment) {
		calls++
		attachment.FileURL = "https://signed.invalid/temporary"
		attachment.Availability = "ready"
	})
	if calls != 1 || attachments[0].Availability != "ready" {
		t.Fatal("default consumer signing changed")
	}
}

type attachmentAccessQuery struct {
	query    string
	args     []any
	rowError error
}

func (fixture *attachmentAccessQuery) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	fixture.query, fixture.args = query, args
	return attachmentTestRow{scan: func(dest ...any) error {
		if fixture.rowError != nil {
			return fixture.rowError
		}
		if args[0] != attachmentTestOrg || args[4] != attachmentTestLead || args[5] != attachmentTestID {
			return pgx.ErrNoRows
		}
		*dest[0].(*string) = attachmentTestID
		*dest[1].(*string) = attachmentTestLead
		*dest[2].(*string) = "documento.pdf"
		*dest[3].(*string) = "https://project.invalid/storage/v1/object/public/whatsapp-media/orgs/" + attachmentTestOrg + "/leads/" + attachmentTestLead + "/docs/documento.pdf"
		*dest[4].(*pgtype.Text) = pgtype.Text{String: "application/pdf", Valid: true}
		*dest[5].(*pgtype.Int8) = pgtype.Int8{Int64: 128, Valid: true}
		*dest[6].(*pgtype.Text) = pgtype.Text{String: attachmentTestActor, Valid: true}
		*dest[7].(*pgtype.Text) = pgtype.Text{}
		*dest[8].(*pgtype.Text) = pgtype.Text{String: leadAttachmentBucket, Valid: true}
		*dest[9].(*pgtype.Text) = pgtype.Text{}
		*dest[10].(*time.Time) = time.Date(2026, 10, 18, 10, 0, 0, 0, time.UTC)
		return nil
	}}
}

func TestAttachmentAccessLoadsExactTenantLeadAndAttachmentWithCurrentVisibility(t *testing.T) {
	actor := tenant.Context{OrganizationID: attachmentTestOrg, UserID: attachmentTestActor, Permissions: []string{permissions.LeadViewOwn}}
	for _, organizationColumn := range []bool{false, true} {
		fixture := &attachmentAccessQuery{}
		attachment, err := loadLeadAttachmentAccess(context.Background(), fixture, actor, attachmentTestLead, attachmentTestID, leadAttachmentColumns{OrganizationID: organizationColumn, FileURL: true})
		if err != nil || attachment.ID != attachmentTestID || attachment.LeadID != attachmentTestLead || attachment.FileSize == nil || *attachment.FileSize != 128 {
			t.Fatalf("access metadata %#v %v", attachment, err)
		}
		for _, boundary := range []string{"join public.leads l on l.id = la.lead_id", "l.organization_id = $1::uuid", "la.lead_id = $5::uuid", "la.id = $6::uuid", "l.assigned_user_id = $3::uuid"} {
			if !strings.Contains(fixture.query, boundary) {
				t.Fatalf("access query lost %s: %s", boundary, fixture.query)
			}
		}
		if strings.Contains(fixture.query, "la.organization_id = $1::uuid") != organizationColumn {
			t.Fatal("attachment tenant boundary not compatible with discovered schema")
		}
		if len(fixture.args) != 6 || fixture.args[2] != actor.UserID || fixture.args[1] != false || fixture.args[3] != false {
			t.Fatalf("access query lost actor/capability scope: %v", fixture.args)
		}
	}
}

func TestAttachmentAccessDeniesWrongTenantLeadAttachmentAndRevokedRead(t *testing.T) {
	for _, scenario := range []string{"tenant", "lead", "attachment", "revoked"} {
		t.Run(scenario, func(t *testing.T) {
			actor := tenant.Context{OrganizationID: attachmentTestOrg, UserID: attachmentTestActor}
			leadID, attachmentID := attachmentTestLead, attachmentTestID
			fixture := &attachmentAccessQuery{}
			switch scenario {
			case "tenant":
				actor.OrganizationID = "10000000-0000-4000-8000-000000000099"
			case "lead":
				leadID = "30000000-0000-4000-8000-000000000099"
			case "attachment":
				attachmentID = "40000000-0000-4000-8000-000000000099"
			case "revoked":
				fixture.rowError = pgx.ErrNoRows
			}
			attachment, err := loadLeadAttachmentAccess(context.Background(), fixture, actor, leadID, attachmentID, leadAttachmentColumns{})
			if !errors.Is(err, ErrLeadNotFound) || attachment.FileURL != "" {
				t.Fatalf("scope miss returned access: %#v %v", attachment, err)
			}
		})
	}
	fixture := &attachmentAccessQuery{rowError: context.DeadlineExceeded}
	if _, err := loadLeadAttachmentAccess(context.Background(), fixture, tenant.Context{}, attachmentTestLead, attachmentTestID, leadAttachmentColumns{}); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("database error was hidden as access")
	}
}

func TestAttachmentAccessReauthorizesDocumentOriginAfterScopedLoad(t *testing.T) {
	actor := tenant.Context{OrganizationID: attachmentTestOrg, UserID: attachmentTestActor, Permissions: []string{permissions.LeadViewOwn}}
	attachment, err := loadLeadAttachmentAccess(context.Background(), &attachmentAccessQuery{}, actor, attachmentTestLead, attachmentTestID, leadAttachmentColumns{FileURL: true})
	if err != nil {
		t.Fatal(err)
	}
	// Ownership changes after metadata was read. The existing signer must fail
	// closed before attempting Storage, even for this new access route.
	scope := &attachmentSourceQueryFixture{actor: actor, visible: map[string]bool{attachmentTestLead: false}}
	repo := Repository{storage: storageClient{projectURL: "https://project.invalid", apiKey: "synthetic", httpClient: &http.Client{Transport: attachmentFakeTransport(func(*http.Request) (*http.Response, error) {
		t.Fatal("revoked lead reached Storage")
		return nil, errors.New("unexpected Storage call")
	})}}}
	repo.signLeadAttachmentURLWithQueryer(context.Background(), scope, actor, &attachment)
	if attachment.FileURL != "" || attachment.Availability != "signing_unavailable" {
		t.Fatalf("revoked lead exposed URL: %#v", attachment)
	}
}

func TestAttachmentReadHandlersRejectInvalidRequestsBeforeDatabaseAccess(t *testing.T) {
	actor := tenant.Context{OrganizationID: attachmentTestOrg, UserID: attachmentTestActor}
	for _, scenario := range []string{"missing organization", "invalid lead", "invalid attachment", "invalid list option"} {
		t.Run(scenario, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, "/v1/lead-attachments?leadId="+attachmentTestLead+"&metadataOnly=invalid", nil)
			request.SetPathValue("id", attachmentTestLead)
			request.SetPathValue("attachmentId", attachmentTestID)
			if scenario != "missing organization" {
				request = request.WithContext(tenant.ContextWithTenant(request.Context(), actor))
			}
			switch scenario {
			case "invalid lead":
				request.SetPathValue("id", "invalid")
			case "invalid attachment":
				request.SetPathValue("attachmentId", "invalid")
			}
			if scenario == "invalid list option" {
				(Handler{}).ListLeadAttachments(recorder, request)
			} else {
				(Handler{}).ShowLeadAttachmentAccess(recorder, request)
			}
			wantStatus := http.StatusBadRequest
			if scenario == "missing organization" {
				wantStatus = http.StatusForbidden
			}
			if recorder.Code != wantStatus {
				t.Fatalf("response %d: %s", recorder.Code, recorder.Body.String())
			}
		})
	}
}
