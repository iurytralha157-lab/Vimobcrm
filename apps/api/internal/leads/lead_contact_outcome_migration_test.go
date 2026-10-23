package leads

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLeadContactOutcomeMigrationKeepsReceiptsPrivateAndDurable(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "supabase", "migrations", "20261019214356_add_lead_contact_outcome_command_receipts.sql"))
	if err != nil {
		t.Fatal("read prepared contact outcome migration")
	}
	source := strings.ToLower(string(raw))
	for _, required := range []string{
		"create table private.lead_contact_outcome_command_receipts",
		"primary key (organization_id, actor_id, command_id)",
		"channel in ('call', 'email')",
		"payload_sha256 ~ '^[0-9a-f]{64}$'",
		"activity_id is null and recorded_at is null",
		"activity_id is not null and recorded_at is not null",
		"owner to postgres",
		"enable row level security",
		"from public, anon, authenticated, service_role",
	} {
		if !strings.Contains(source, required) {
			t.Fatal("contact outcome receipt security or transaction constraint is missing")
		}
	}
	if strings.Contains(source, "references public.") || strings.Contains(source, "on delete cascade") || strings.Contains(source, "grant all") || strings.Contains(source, "security definer") {
		t.Fatal("receipt must neither follow mutable resources nor expose a privileged API")
	}
}
