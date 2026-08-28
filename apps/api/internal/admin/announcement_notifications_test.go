package admin

import (
	"os"
	"strings"
	"testing"
	"time"
)

func TestAnnouncementNotificationFanoutQueryContract(t *testing.T) {
	required := []string{
		"from public.announcements",
		"join public.organization_members member",
		"member.is_active is true",
		"join public.users app_user",
		"app_user.is_active is true",
		"announcement.target_type = 'all'",
		"announcement.target_type = 'specific'",
		"member.user_id = any(announcement.target_user_ids)",
		"announcement.target_type = 'organizations'",
		"member.organization_id = any(announcement.target_organization_ids)",
		"announcement.target_type = 'admins'",
		"in ('owner', 'admin')",
		"announcement.target_type = 'brokers'",
		"= 'user'",
		"insert into public.notifications",
		"'system'",
		"'in_app'",
		"'/inicio'",
		"'event_key', 'announcement_published'",
		"'dedupe_key', concat_ws(",
		"announcement.id::text",
		"recipient.organization_id::text",
		"recipient.user_id::text",
		"on conflict do nothing",
	}
	for _, fragment := range required {
		if !strings.Contains(announcementNotificationFanoutQuery, fragment) {
			t.Fatalf("announcement notification fan-out query is missing %q", fragment)
		}
	}
}

func TestAnnouncementCreationUsesOneTransactionAndNotificationFlag(t *testing.T) {
	source, err := os.ReadFile("announcement_notifications.go")
	if err != nil {
		t.Fatalf("read announcement notification source: %v", err)
	}
	text := string(source)
	required := []string{
		"repo.db.Pool().Begin(ctx)",
		"defer tx.Rollback(ctx)",
		"tx.QueryRow(ctx",
		"insert into public.announcements",
		"if announcementNotificationIsDue(item, time.Now())",
		"tx.Exec(ctx, announcementNotificationFanoutQuery, announcementID)",
		"tx.Commit(ctx)",
	}
	for _, fragment := range required {
		if !strings.Contains(text, fragment) {
			t.Fatalf("atomic announcement creation is missing %q", fragment)
		}
	}

	begin := strings.Index(text, "repo.db.Pool().Begin(ctx)")
	insert := strings.Index(text, "tx.QueryRow(ctx")
	gate := strings.Index(text, "if announcementNotificationIsDue(item, time.Now())")
	fanout := strings.Index(text, "tx.Exec(ctx, announcementNotificationFanoutQuery, announcementID)")
	commit := strings.Index(text, "tx.Commit(ctx)")
	if !(begin < insert && insert < gate && gate < fanout && fanout < commit) {
		t.Fatal("announcement insert and notification fan-out must commit in one ordered transaction")
	}

	if boolValue(false) {
		t.Fatal("send_notification=false must not enable announcement fan-out")
	}
	if !boolValue(true) {
		t.Fatal("send_notification=true must enable announcement fan-out")
	}
}

func TestCreateTableRowKeepsAnnouncementPublishingSuperAdminOnly(t *testing.T) {
	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read admin repository source: %v", err)
	}
	text := string(source)
	start := strings.Index(text, "func (repo Repository) CreateTableRow")
	end := strings.Index(text[start:], "func (repo Repository) UpdateTableRow")
	if start < 0 || end < 0 {
		t.Fatal("CreateTableRow source not found")
	}
	method := text[start : start+end]
	authorization := strings.Index(method, "if !tenantContext.IsSuperAdmin")
	announcementBranch := strings.Index(method, `strings.TrimSpace(table) == "announcements"`)
	if authorization < 0 || announcementBranch < 0 || authorization > announcementBranch {
		t.Fatal("announcement publishing must remain behind the superadmin authorization check")
	}
	if !strings.Contains(method, "repo.createAnnouncementWithNotifications(ctx, payload)") {
		t.Fatal("announcements must use the atomic publishing path")
	}
}
func TestAnnouncementNotificationIsDueOnlyWhileActive(t *testing.T) {
	now := time.Date(2026, time.August, 10, 12, 0, 0, 0, time.UTC)
	active := map[string]any{
		"send_notification": true,
		"is_active":         true,
	}
	if !announcementNotificationIsDue(active, now) {
		t.Fatal("active immediate announcement should fan out")
	}

	for name, item := range map[string]map[string]any{
		"notification disabled": {
			"send_notification": false,
			"is_active":         true,
		},
		"inactive": {
			"send_notification": true,
			"is_active":         false,
		},
		"scheduled": {
			"send_notification": true,
			"is_active":         true,
			"starts_at":         now.Add(time.Hour).Format(time.RFC3339),
		},
		"expired": {
			"send_notification": true,
			"is_active":         true,
			"ends_at":           now.Add(-time.Hour).Format(time.RFC3339),
		},
	} {
		t.Run(name, func(t *testing.T) {
			if announcementNotificationIsDue(item, now) {
				t.Fatalf("announcement should not fan out: %#v", item)
			}
		})
	}
}

func TestNormalizeAnnouncementPayloadRejectsUnsafeContent(t *testing.T) {
	valid := map[string]any{
		"message":     " Comunicado seguro ",
		"button_text": " Ver detalhes ",
		"button_url":  "/inicio",
		"target_type": "all",
	}
	if err := normalizeAnnouncementPayload(valid); err != nil {
		t.Fatalf("valid announcement rejected: %v", err)
	}
	if valid["message"] != "Comunicado seguro" {
		t.Fatalf("message was not normalized: %#v", valid["message"])
	}

	for name, payload := range map[string]map[string]any{
		"empty message": {"message": "", "target_type": "all"},
		"long message": {
			"message":     strings.Repeat("a", 501),
			"target_type": "all",
		},
		"unsafe URL": {
			"message":     "Comunicado",
			"button_url":  "javascript:alert(1)",
			"target_type": "all",
		},
		"unsupported audience": {
			"message":     "Comunicado",
			"target_type": "brokers",
		},
	} {
		t.Run(name, func(t *testing.T) {
			if err := normalizeAnnouncementPayload(payload); err != ErrInvalidInput {
				t.Fatalf("error = %v, want ErrInvalidInput", err)
			}
		})
	}
}
