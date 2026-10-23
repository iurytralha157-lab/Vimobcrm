package leads

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

type conversationRevisionRow struct{ revision time.Time }

func (row conversationRevisionRow) Scan(dest ...any) error {
	if len(dest) != 24 {
		return fmt.Errorf("conversation projection must include its revision")
	}
	for index, value := range dest {
		switch target := value.(type) {
		case *string:
			*target = "synthetic"
		case *time.Time:
			*target = row.revision
		case *pgtype.Text:
			*target = pgtype.Text{}
			if index == 21 {
				*target = pgtype.Text{String: "[]", Valid: true}
			}
		case *pgtype.Float8:
			*target = pgtype.Float8{}
		default:
			return fmt.Errorf("unexpected conversation destination %T", value)
		}
	}
	return nil
}

func TestConversationDetailKeepsExactRevisionForTransfer(t *testing.T) {
	revision := time.Date(2026, 10, 16, 12, 0, 0, 123456000, time.UTC)
	detail, err := scanConversationLeadDetail(conversationRevisionRow{revision})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(detail)
	if err != nil {
		t.Fatal(err)
	}
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		t.Fatal(err)
	}
	if data["updated_at"] != revision.Format(time.RFC3339Nano) {
		t.Fatalf("transfer revision rounded: %v", data["updated_at"])
	}
}
