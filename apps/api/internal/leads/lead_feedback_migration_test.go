package leads

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLeadFeedbackMigrationKeepsReceiptsPrivateAndDurable(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "supabase", "migrations", "20261017053625_add_lead_feedback_command_receipts.sql"))
	if err != nil {
		t.Fatal("read prepared feedback migration")
	}
	source := strings.ToLower(string(raw))
	for _, required := range []string{
		"create table private.lead_feedback_command_receipts",
		"primary key (organization_id, actor_id, command_id)",
		"payload_sha256 text not null",
		"activity_id is null and recorded_at is null",
		"activity_id is not null and recorded_at is not null",
		"owner to postgres",
		"enable row level security",
		"from public, anon, authenticated, service_role",
	} {
		if !strings.Contains(source, required) {
			t.Fatal("feedback receipt security or transaction constraint is missing")
		}
	}
	if strings.Contains(source, "references public.") || strings.Contains(source, "on delete cascade") || strings.Contains(source, "grant all") || strings.Contains(source, "security definer") {
		t.Fatal("receipt must neither follow mutable resources nor expose a privileged API")
	}
}
