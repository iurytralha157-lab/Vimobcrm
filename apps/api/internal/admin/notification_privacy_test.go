package admin

import (
	"os"
	"strings"
	"testing"
)

func TestGenericAdminMutationsRejectNotificationOutbox(t *testing.T) {
	t.Parallel()
	if isAllowedAdminTable("notifications") {
		t.Fatal("the notification outbox contains capabilities and PII and must not be generic CRUD")
	}
	if !isAllowedAdminReadTable("notifications") {
		t.Fatal("the admin may retain only the dedicated redacted notification summary")
	}
}

func TestNotificationAdminSummaryNeverSelectsMetadataOrRecipientData(t *testing.T) {
	t.Parallel()
	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, `if strings.TrimSpace(table) == "notifications"`)
	if start < 0 {
		t.Fatal("dedicated notification summary query is missing")
	}
	end := strings.Index(source[start:], "identifier := pgx.Identifier")
	if end < 0 {
		t.Fatal("dedicated notification summary query is missing")
	}
	scope := source[start : start+end]
	for _, secret := range []string{"metadata", "content", "body", "user_id", "organization_id", "to_jsonb", "select *"} {
		if strings.Contains(scope, secret) {
			t.Fatalf("redacted notification summary exposes %q", secret)
		}
	}
	if !strings.Contains(scope, "'[redigido]'") {
		t.Fatal("notification title must be redacted")
	}
}
