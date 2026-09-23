package leads

import (
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestLeadHistoryDoesNotExposeManagedMessageFingerprint(t *testing.T) {
	source, err := os.ReadFile("analytics.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{
		"'metadata', e.metadata - 'message_fingerprint'",
		"coalesce(e.metadata, '{}'::jsonb) - 'message_fingerprint'",
		"'metadata', e.metadata - 'message_fingerprint'",
		"'payload', e.payload - 'message_fingerprint'",
	} {
		if !strings.Contains(string(source), required) {
			t.Fatalf("lead history query lost fingerprint redaction: %s", required)
		}
	}
}

type historyJSONRow struct {
	raw []byte
}

func (row historyJSONRow) Scan(dest ...any) error {
	*dest[0].(*[]byte) = row.raw
	return nil
}

func TestHistoryBatchQueuesQueries(t *testing.T) {
	t.Parallel()

	batch := &pgx.Batch{}
	if _, err := queueHistoryJSONArray(batch, "select '[]'::jsonb"); err != nil {
		t.Fatalf("queueHistoryJSONArray() error = %v", err)
	}
	if _, err := queueHistoryJSONObject(batch, "select '{}'::jsonb"); err != nil {
		t.Fatalf("queueHistoryJSONObject() error = %v", err)
	}
	if batch.Len() != 2 {
		t.Fatalf("batch.Len() = %d, want 2", batch.Len())
	}
}

func TestScanHistoryJSON(t *testing.T) {
	t.Parallel()

	items, err := scanHistoryJSONArray(historyJSONRow{raw: []byte(`[{"type":"status_change"}]`)})
	if err != nil {
		t.Fatalf("scanHistoryJSONArray() error = %v", err)
	}
	if len(items) != 1 || items[0]["type"] != "status_change" {
		t.Fatalf("scanHistoryJSONArray() = %#v", items)
	}

	object, err := scanHistoryJSONObject(historyJSONRow{raw: []byte(`{"creative_url":"https://example.test/creative.jpg"}`)})
	if err != nil {
		t.Fatalf("scanHistoryJSONObject() error = %v", err)
	}
	if object["creative_url"] != "https://example.test/creative.jpg" {
		t.Fatalf("scanHistoryJSONObject() = %#v", object)
	}
}
