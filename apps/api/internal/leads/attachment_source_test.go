package leads

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type attachmentSourceQueryFixture struct {
	actor                                            tenant.Context
	queries                                          []string
	messageOrg, messageLead, messagePath, messageURL string
	visible                                          map[string]bool
	messageReady                                     bool
	revokeVisibilityOnMessage                        bool
}

func (fixture *attachmentSourceQueryFixture) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	fixture.queries = append(fixture.queries, query)
	if strings.Contains(query, "select exists") {
		return attachmentTestRow{scan: func(dest ...any) error {
			*dest[0].(*bool) = args[0] == fixture.actor.OrganizationID && fixture.visible[args[4].(string)]
			return nil
		}}
	}
	if strings.Contains(query, "whatsapp_messages") {
		return attachmentTestRow{scan: func(dest ...any) error {
			if args[0] != fixture.messageOrg || args[2] != fixture.messageLead || !fixture.messageReady {
				return pgx.ErrNoRows
			}
			*dest[0].(*pgtype.Text) = pgtype.Text{String: fixture.messagePath, Valid: fixture.messagePath != ""}
			*dest[1].(*pgtype.Text) = pgtype.Text{String: fixture.messageURL, Valid: true}
			*dest[2].(*pgtype.Text) = pgtype.Text{String: "application/pdf", Valid: true}
			*dest[3].(*pgtype.Int8) = pgtype.Int8{Int64: 24, Valid: true}
			*dest[4].(*pgtype.Text) = pgtype.Text{String: "servidor.pdf", Valid: true}
			if fixture.revokeVisibilityOnMessage {
				fixture.visible[fixture.messageLead] = false
			}
			return nil
		}}
	}
	return attachmentTestRow{scan: func(...any) error { return errors.New("unexpected query") }}
}

type attachmentFakeTransport func(*http.Request) (*http.Response, error)

func (transport attachmentFakeTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

func TestAttachmentMessageSourceIgnoresBrowserURLAndEnforcesImmutableAttribution(t *testing.T) {
	actor, input, _ := attachmentUploadTestInput()
	actor.EnabledModules = []string{"whatsapp"}
	actor.Permissions = append(actor.Permissions, permissions.WhatsAppView)
	messageID := "60000000-0000-4000-8000-000000000001"
	input.MessageID = &messageID
	input.FileURL = "https://attacker.invalid/known-other-document.pdf"
	input.FileName = "forged.html"
	fixture := &attachmentSourceQueryFixture{actor: actor, messageOrg: actor.OrganizationID, messageLead: input.LeadID, messagePath: "orgs/" + actor.OrganizationID + "/messages/media.pdf", messageReady: true}
	repo := Repository{storage: storageClient{projectURL: "https://project.invalid"}}
	resolved, path, err := repo.resolveAttachmentMessage(context.Background(), fixture, actor, input, true)
	if err != nil || path != fixture.messagePath || !strings.Contains(resolved.FileURL, "/messages/media.pdf") || resolved.FileName != "servidor.pdf" || resolved.FileSize == nil || *resolved.FileSize != 24 {
		t.Fatalf("browser selected the source: %#v path=%s err=%v", resolved, path, err)
	}
	query := fixture.queries[0]
	for _, required := range []string{"wm.organization_id=$1::uuid", "wm.lead_id=$3::uuid", "wm.capture_state is distinct from 'suppressed'", "wm.unlinked_retention_scrubbed_at is null", "wm.media_status='ready'", "wc.organization_id=wm.organization_id"} {
		if !strings.Contains(query, required) {
			t.Fatalf("source query lost %s", required)
		}
	}
	for _, scenario := range []string{"other organization", "other immutable lead", "not ready", "foreign path", "no WhatsApp permission"} {
		t.Run(scenario, func(t *testing.T) {
			changed := *fixture
			viewer := actor
			switch scenario {
			case "other organization":
				changed.messageOrg = "10000000-0000-4000-8000-000000000002"
			case "other immutable lead":
				changed.messageLead = "30000000-0000-4000-8000-000000000002"
			case "not ready":
				changed.messageReady = false
			case "foreign path":
				changed.messagePath = "orgs/10000000-0000-4000-8000-000000000002/messages/private.pdf"
			case "no WhatsApp permission":
				viewer.Permissions = []string{permissions.LeadOperate}
			}
			if _, _, err := repo.resolveAttachmentMessage(context.Background(), &changed, viewer, input, true); err == nil {
				t.Fatal("unauthorized source resolved")
			}
		})
	}
}

func TestAttachmentDocumentPathRequiresExactTenantAndLeadNamespace(t *testing.T) {
	base := "orgs/" + attachmentTestOrg + "/leads/" + attachmentTestLead + "/docs/a.pdf"
	if attachmentDocumentLeadID(base, attachmentTestOrg) != attachmentTestLead {
		t.Fatal("valid document was not resolved")
	}
	for _, value := range []string{"orgs/10000000-0000-4000-8000-000000000002/leads/" + attachmentTestLead + "/docs/a.pdf", "orgs/" + attachmentTestOrg + "/leads/not-a-uuid/docs/a.pdf", "orgs/" + attachmentTestOrg + "/messages/a.pdf", base + "/../b.pdf"} {
		if attachmentDocumentLeadID(value, attachmentTestOrg) != "" {
			t.Fatalf("unsafe document accepted: %s", value)
		}
	}
	for _, value := range []string{"javascript:fixture", "data:fixture", "https://user:secret@example.invalid/file"} {
		if safeAttachmentExternalURL(value) != "" {
			t.Fatal("unsafe external URL accepted")
		}
	}
}

func TestAttachmentSigningFailureAndDeniedOriginsNeverReturnPublicFallback(t *testing.T) {
	actor, _, _ := attachmentUploadTestInput()
	for _, scenario := range []string{"signing failure", "foreign lead", "foreign tenant", "unregistered external URL", "valid signed URL", "authorized external message", "transferred external message"} {
		t.Run(scenario, func(t *testing.T) {
			fixture := &attachmentSourceQueryFixture{actor: actor, visible: map[string]bool{attachmentTestLead: true}}
			path := "orgs/" + actor.OrganizationID + "/leads/" + attachmentTestLead + "/docs/fixture.pdf"
			requests := 0
			repo := Repository{storage: storageClient{projectURL: "https://project.invalid", apiKey: "synthetic", httpClient: &http.Client{Transport: attachmentFakeTransport(func(*http.Request) (*http.Response, error) {
				requests++
				status := http.StatusServiceUnavailable
				body := "{}"
				if scenario == "valid signed URL" {
					status = 200
					body = `{"signedURL":"/object/sign/whatsapp-media/fixture.pdf?token=synthetic"}`
				}
				return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body))}, nil
			})}}}
			attachment := LeadAttachment{ID: attachmentTestID, LeadID: attachmentTestLead, FileURL: repo.storage.publicURL(leadAttachmentBucket, path)}
			switch scenario {
			case "foreign lead":
				attachment.FileURL = repo.storage.publicURL(leadAttachmentBucket, "orgs/"+actor.OrganizationID+"/leads/30000000-0000-4000-8000-000000000002/docs/private.pdf")
			case "foreign tenant":
				attachment.FileURL = repo.storage.publicURL(leadAttachmentBucket, "orgs/10000000-0000-4000-8000-000000000002/leads/"+attachmentTestLead+"/docs/private.pdf")
			case "unregistered external URL":
				attachment.FileURL = "https://attacker.invalid/fake.pdf"
			case "authorized external message", "transferred external message":
				messageID := "60000000-0000-4000-8000-000000000001"
				attachment.MessageID = &messageID
				fixture.messageOrg = actor.OrganizationID
				fixture.messageLead = attachmentTestLead
				fixture.messageURL = "https://media.example.invalid/persisted.pdf"
				fixture.messageReady = true
				fixture.revokeVisibilityOnMessage = scenario == "transferred external message"
			}
			repo.signLeadAttachmentURLWithQueryer(context.Background(), fixture, actor, &attachment)
			if scenario == "authorized external message" {
				if attachment.Availability != "ready" || attachment.FileURL != fixture.messageURL || requests != 0 {
					t.Fatal("authorized persisted external source was not returned")
				}
				return
			}
			if scenario == "valid signed URL" {
				if attachment.Availability != "ready" || !strings.Contains(attachment.FileURL, "object/sign") {
					t.Fatal("successful signing was not returned")
				}
				return
			}
			payload, _ := json.Marshal(attachment)
			if attachment.FileURL != "" || attachment.Availability != "signing_unavailable" || !strings.Contains(string(payload), `"file_url":null`) {
				t.Fatalf("private fallback exposed: %s", payload)
			}
			if scenario != "signing failure" && requests != 0 {
				t.Fatal("an unauthorized source reached service signing")
			}
		})
	}
}

func TestSensitiveProfileReadsAuthorizationAndValuesInOneScopedStatement(t *testing.T) {
	actor, _, _ := attachmentUploadTestInput()
	calls := 0
	q := sensitiveProfileFixture{query: func(query string, args []any) pgx.Row {
		calls++
		if args[0] != attachmentTestOrg || args[2] != attachmentTestActor || args[4] != attachmentTestLead {
			t.Fatal("profile query lost actor/tenant/lead")
		}
		for _, required := range []string{"l.organization_id=$1::uuid", "l.id=$5::uuid", "l.assigned_user_id=$3::uuid", "any($6::text[])"} {
			if !strings.Contains(query, required) {
				t.Fatalf("missing boundary %s", required)
			}
		}
		return attachmentTestRow{scan: func(dest ...any) error {
			*dest[0].(*pgtype.Text) = pgtype.Text{String: "11122233344", Valid: true}
			*dest[1].(*pgtype.Text) = pgtype.Text{String: "synthetic-rg", Valid: true}
			return nil
		}}
	}}
	profile, err := loadSensitiveLeadProfile(context.Background(), q, actor, attachmentTestLead)
	if err != nil || calls != 1 || profile.CPF != "11122233344" {
		t.Fatalf("profile read=%#v calls=%d err=%v", profile, calls, err)
	}
	actor.Permissions = []string{permissions.LeadViewOwn}
	if _, err := loadSensitiveLeadProfile(context.Background(), q, actor, attachmentTestLead); !errors.Is(err, tenant.ErrOrganizationAccessDenied) || calls != 1 {
		t.Fatal("profile query ran without operate")
	}
	actor.Permissions = append(actor.Permissions, permissions.LeadOperate)
	actor.OrganizationID = "10000000-0000-4000-8000-000000000002"
	foreign := sensitiveProfileFixture{query: func(string, []any) pgx.Row {
		return attachmentTestRow{scan: func(...any) error { return pgx.ErrNoRows }}
	}}
	if result, err := loadSensitiveLeadProfile(context.Background(), foreign, actor, attachmentTestLead); !errors.Is(err, ErrLeadNotFound) || result.CPF != "" {
		t.Fatal("foreign profile was exposed")
	}
}

type sensitiveProfileFixture struct{ query func(string, []any) pgx.Row }

func (f sensitiveProfileFixture) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	return f.query(query, args)
}

type attachmentDocumentFixtureTx struct {
	pgx.Tx
	query   string
	record  LeadAttachment
	queries int
}

func (tx *attachmentDocumentFixtureTx) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	tx.query = query
	tx.queries++
	return attachmentTestRow{scan: func(dest ...any) error { return scanAttachmentFixture(tx.record, dest) }}
}
func TestAttachmentDocumentRegistrationUsesPersistedAttributesAndRejectsExternalOrigin(t *testing.T) {
	actor, input, _ := attachmentUploadTestInput()
	repo := Repository{storage: storageClient{projectURL: "https://project.invalid"}}
	originID := "30000000-0000-4000-8000-000000000002"
	path := "orgs/" + actor.OrganizationID + "/leads/" + originID + "/docs/server.pdf"
	input.FileURL = repo.storage.publicURL(leadAttachmentBucket, path)
	input.FileName = "browser-forged.html"
	kind := "pdf"
	size := int64(24)
	tx := &attachmentDocumentFixtureTx{record: LeadAttachment{ID: attachmentTestID, LeadID: originID, FileName: "server.pdf", FileType: &kind, FileSize: &size}}
	resolved, actualPath, actualOrigin, err := repo.resolveAttachmentDocument(context.Background(), tx, actor, input, leadAttachmentColumns{})
	if err != nil || actualPath != path || actualOrigin != originID || resolved.FileName != "server.pdf" || resolved.FileType == nil || *resolved.FileType != "pdf" || resolved.FileSize == nil || *resolved.FileSize != 24 {
		t.Fatalf("browser attributes/origin were trusted: %#v err=%v", resolved, err)
	}
	if !strings.Contains(tx.query, "l.organization_id=$1::uuid") || !strings.Contains(tx.query, "la.lead_id=$2::uuid") {
		t.Fatal("document lookup lost source scope")
	}
	input.FileURL = "https://attacker.invalid/arbitrary.pdf"
	if _, _, _, err := repo.resolveAttachmentDocument(context.Background(), tx, actor, input, leadAttachmentColumns{}); !errors.Is(err, ErrInvalidReference) || tx.queries != 1 {
		t.Fatal("arbitrary external URL reached a source query")
	}
}
