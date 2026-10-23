package leads

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestLeadHistoryAttachmentMetadataReadModelsRedactLegacyURLsRecursively(t *testing.T) {
	fixture := `{"metadata":{"file_url":"https://private.invalid/origin-denied","file_name":"Contrato.pdf","file_type":"pdf","file_size":24,"attachment_id":"reference","nested":[{"fileURL":"https://private.invalid/signed?token=synthetic"}]},"creative_url":"https://public.invalid/ad"}`
	object, err := scanHistoryJSONObject(historyJSONRow{raw: []byte(fixture)})
	if err != nil {
		t.Fatal(err)
	}
	array, err := scanHistoryJSONArray(historyJSONRow{raw: []byte("[" + fixture + "]")})
	if err != nil {
		t.Fatal(err)
	}
	for _, result := range []any{object, array} {
		raw, err := json.Marshal(result)
		if err != nil || strings.Contains(string(raw), "private.invalid") || !strings.Contains(string(raw), "Contrato.pdf") || !strings.Contains(string(raw), "public.invalid/ad") {
			t.Fatalf("legacy URL survived or display data changed: %s %v", raw, err)
		}
	}
}

func TestLeadHistoryAttachmentMetadataPagedReadPreservesEventAndReference(t *testing.T) {
	row := historyPageTestRow(2, 1, historyPageTestCursor().OccurredAt)
	row.Data["content"] = "Documento anexado: Contrato.pdf"
	row.Data["metadata"] = map[string]any{"file_url": "https://private.invalid/denied", "attachment_id": "attachment-reference", "file_name": "Contrato.pdf", "nested": []any{map[string]any{"fileUrl": "https://private.invalid/nested"}}}
	response, err := reconstructLeadHistoryPage(leadHistoryPageResult{Events: []leadHistoryPageRow{row}, Lead: map[string]any{"id": historyPageTestLead}}, historyPageTestOrg, historyPageTestLead, historyPageTestCursor().SnapshotAt, 100)
	if err != nil {
		t.Fatal(err)
	}
	event := response.Data["activityEvents"].([]map[string]any)[0]
	metadata := event["metadata"].(map[string]any)
	if metadata["file_url"] != nil || metadata["attachment_id"] != "attachment-reference" || metadata["file_name"] != "Contrato.pdf" || event["content"] != "Documento anexado: Contrato.pdf" {
		t.Fatalf("paged event changed identity or exposed direct access: %v", event)
	}
	raw, _ := json.Marshal(response)
	if strings.Contains(string(raw), "private.invalid") {
		t.Fatal("nested URL survived")
	}
}

func TestLeadHistoryAttachmentMetadataActivitiesCannotReturnLegacyURL(t *testing.T) {
	row := historyScopeRow{scan: func(dest ...any) error {
		*dest[0].(*string) = "activity-id"
		*dest[1].(*string) = historyPageTestOrg
		*dest[2].(*string) = historyPageTestLead
		*dest[4].(*string) = "note"
		*dest[5].(*pgtype.Text) = pgtype.Text{String: "Documento anexado: Contrato.pdf", Valid: true}
		*dest[6].(*string) = `{"file_url":"https://private.invalid/denied","file_name":"Contrato.pdf","nested":{"fileURL":"https://private.invalid/nested"}}`
		return nil
	}}
	activity, err := scanActivity(row)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(activity)
	if strings.Contains(string(raw), "private.invalid") || activity.Metadata["file_name"] != "Contrato.pdf" || activity.Content == nil {
		t.Fatalf("activity read leaked access or lost presentation: %s", raw)
	}
}

type historyAttachmentWriteTx struct {
	pgx.Tx
	metadata map[string]any
	content  string
}

func (tx *historyAttachmentWriteTx) QueryRow(context.Context, string, ...any) pgx.Row {
	return historyScopeRow{scan: func(dest ...any) error {
		*dest[0].(*string) = attachmentTestID
		*dest[1].(*string) = attachmentTestLead
		*dest[2].(*string) = "Contrato.pdf"
		*dest[3].(*string) = "https://private.invalid/external"
		*dest[10].(*time.Time) = time.Unix(1, 0)
		return nil
	}}
}

func (tx *historyAttachmentWriteTx) Exec(_ context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	if !strings.Contains(query, "insert into public.activities") {
		panic("unexpected write")
	}
	tx.content = args[3].(string)
	err := json.Unmarshal([]byte(args[4].(string)), &tx.metadata)
	return pgconn.NewCommandTag("INSERT 0 1"), err
}

func TestLeadHistoryAttachmentMetadataWriteUsesAttachmentReference(t *testing.T) {
	tx := &historyAttachmentWriteTx{}
	input := leadAttachmentCreateInput{LeadID: attachmentTestLead, FileName: "Contrato.pdf", FileURL: "https://private.invalid/external"}
	attachment, err := (Repository{}).insertLeadAttachment(context.Background(), tx, tenant.Context{OrganizationID: attachmentTestOrg, UserID: attachmentTestActor}, input, leadAttachmentColumns{}, "")
	if err != nil || tx.metadata["attachment_id"] != attachment.ID || tx.metadata["file_name"] != input.FileName || tx.metadata["file_url"] != nil || tx.content != "Documento anexado: Contrato.pdf" {
		t.Fatalf("attachment activity persisted a URL or lost its identity: metadata=%v content=%q err=%v", tx.metadata, tx.content, err)
	}
}
