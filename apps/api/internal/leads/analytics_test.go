package leads

import (
	"testing"

	"github.com/jackc/pgx/v5"
)

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
