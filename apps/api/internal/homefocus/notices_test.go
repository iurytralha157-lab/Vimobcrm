package homefocus

import (
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestHomeNoticeQueriesAreTenantSafeAndReadOnly(t *testing.T) {
	billingQuery := strings.ToLower(billingNoticeStateSQL)
	for _, required := range []string{
		"where o.id = $1::uuid",
		"p.organization_id = o.id",
		"from public.asaas_payments",
		"limit 1",
	} {
		if !strings.Contains(billingQuery, required) {
			t.Errorf("billing notice SQL is missing %q", required)
		}
	}

	announcementQuery := strings.ToLower(activeAnnouncementNoticesSQL)
	for _, required := range []string{
		"coalesce(a.is_active, false) = true",
		"coalesce(a.show_banner, false) = true",
		"to_jsonb(announcement) as record",
		"a.record->>'starts_at'",
		"a.record->>'ends_at'",
		"nullif($2, '')::uuid = any(coalesce(a.target_user_ids",
		"nullif($1, '')::uuid = any(coalesce(a.target_organization_ids",
		"a.target_type = 'admins' and $3::boolean",
		"a.target_type = 'brokers' and $4::boolean",
		"order by a.created_at desc nulls last, a.id desc",
		"limit 30",
	} {
		if !strings.Contains(announcementQuery, required) {
			t.Errorf("announcement notice SQL is missing %q", required)
		}
	}
	if strings.Index(announcementQuery, "order by a.created_at") > strings.Index(announcementQuery, "limit 30") {
		t.Fatal("announcement ordering must happen before the limit")
	}

	for name, query := range map[string]string{
		"billing":      billingQuery,
		"announcement": announcementQuery,
	} {
		for _, mutation := range []string{"insert into", "update public.", "delete from"} {
			if strings.Contains(query, mutation) {
				t.Errorf("%s notice GET contains mutation %q", name, mutation)
			}
		}
		if strings.Contains(query, "public.notifications") {
			t.Errorf("%s notice GET must not create or read notification side effects", name)
		}
	}
}

func TestBuildBillingNoticeCriticalStates(t *testing.T) {
	now := time.Date(2026, time.August, 10, 12, 0, 0, 0, homeNoticeLocation)
	for _, status := range []string{"blocked", "suspended", "cancelled", "pending_payment"} {
		t.Run(status, func(t *testing.T) {
			notice := buildBillingNotice(billingNoticeState{
				OrganizationID:     "20000000-0000-4000-8000-000000000001",
				SubscriptionStatus: status,
			}, now, false)
			if notice == nil || notice.Source != "billing" || notice.Severity != "critical" {
				t.Fatalf("notice = %#v", notice)
			}
			if notice.ActionLabel != nil || notice.ActionURL != nil {
				t.Fatalf("billing CTA leaked without permission: %#v", notice)
			}
		})
	}
}

func TestBuildBillingNoticeCountsOverdueAndGraceDates(t *testing.T) {
	now := time.Date(2026, time.August, 10, 12, 0, 0, 0, homeNoticeLocation)
	dueDate := time.Date(2026, time.August, 8, 0, 0, 0, 0, time.UTC)
	nextBillingDate := time.Date(2026, time.August, 15, 0, 0, 0, 0, time.UTC)
	graceUntil := time.Date(2026, time.August, 13, 23, 59, 0, 0, homeNoticeLocation)
	notice := buildBillingNotice(billingNoticeState{
		OrganizationID:     "20000000-0000-4000-8000-000000000001",
		SubscriptionStatus: "overdue",
		SubscriptionType:   "paid",
		NextBillingDate:    &nextBillingDate,
		BillingGraceUntil:  &graceUntil,
		PaymentDueDate:     &dueDate,
		PaymentStatus:      "OVERDUE",
	}, now, true)
	if notice == nil {
		t.Fatal("overdue notice is nil")
	}
	if notice.Title != "Sua assinatura venceu h\u00e1 2 dias" {
		t.Fatalf("title = %q", notice.Title)
	}
	if notice.Description != "O acesso ser\u00e1 bloqueado em 3 dias." {
		t.Fatalf("description = %q", notice.Description)
	}
	if notice.ActionLabel == nil || *notice.ActionLabel != "Regularizar assinatura" {
		t.Fatalf("action label = %#v", notice.ActionLabel)
	}
	if notice.ActionURL == nil || *notice.ActionURL != "/settings?tab=subscription" {
		t.Fatalf("action URL = %#v", notice.ActionURL)
	}
}

func TestBuildBillingNoticeWarnsOnlyWithinFiveDays(t *testing.T) {
	now := time.Date(2026, time.August, 10, 12, 0, 0, 0, homeNoticeLocation)
	confirmedOldDue := time.Date(2026, time.August, 1, 0, 0, 0, 0, time.UTC)
	fiveDays := time.Date(2026, time.August, 15, 0, 0, 0, 0, time.UTC)
	notice := buildBillingNotice(billingNoticeState{
		OrganizationID:     "20000000-0000-4000-8000-000000000001",
		SubscriptionStatus: "active",
		SubscriptionType:   "paid",
		NextBillingDate:    &fiveDays,
		PaymentDueDate:     &confirmedOldDue,
		PaymentStatus:      "CONFIRMED",
	}, now, true)
	if notice == nil || notice.Severity != "warning" || notice.Title != "Sua assinatura vence em 5 dias" {
		t.Fatalf("notice = %#v", notice)
	}

	sixDays := time.Date(2026, time.August, 16, 0, 0, 0, 0, time.UTC)
	if got := buildBillingNotice(billingNoticeState{
		OrganizationID:     "20000000-0000-4000-8000-000000000001",
		SubscriptionStatus: "active",
		SubscriptionType:   "paid",
		NextBillingDate:    &sixDays,
	}, now, true); got != nil {
		t.Fatalf("unexpected notice outside five-day window: %#v", got)
	}
}

func TestBuildBillingNoticeDoesNotFlagHealthyTrialOrFreeTenant(t *testing.T) {
	now := time.Date(2026, time.August, 10, 12, 0, 0, 0, homeNoticeLocation)
	for _, state := range []billingNoticeState{
		{SubscriptionStatus: "trial", SubscriptionType: "trial"},
		{SubscriptionStatus: "active", SubscriptionType: "free"},
	} {
		if notice := buildBillingNotice(state, now, true); notice != nil {
			t.Fatalf("healthy tenant received billing notice: %#v", notice)
		}
	}
}

func TestListNoticesSkipsBillingForSuperAdminContract(t *testing.T) {
	source, err := os.ReadFile("notices.go")
	if err != nil {
		t.Fatalf("read notices.go: %v", err)
	}
	if !strings.Contains(string(source), "if !tenantContext.IsSuperAdmin {") {
		t.Fatal("ListNotices no longer skips billing projection for superadmin")
	}
}
func TestBuildAnnouncementNoticeQuarantinesInvalidOptionalContent(t *testing.T) {
	notice, ok := buildAnnouncementNotice(
		"30000000-0000-4000-8000-000000000001",
		" Comunicado válido ",
		strings.Repeat("a", 49),
		"javascript:alert(1)",
		pgtype.Int4{Int32: 1, Valid: true},
		pgtype.Timestamptz{},
		pgtype.Timestamptz{},
	)
	if !ok {
		t.Fatal("valid message was discarded because of optional content")
	}
	if notice.Description != "Comunicado válido" {
		t.Fatalf("description = %q", notice.Description)
	}
	if notice.ActionLabel != nil || notice.ActionURL != nil {
		t.Fatalf("unsafe optional action leaked: %#v", notice)
	}
	if notice.DisplayDurationSeconds != nil {
		t.Fatalf("invalid display duration leaked: %#v", notice.DisplayDurationSeconds)
	}

	if _, ok := buildAnnouncementNotice(
		"30000000-0000-4000-8000-000000000002",
		strings.Repeat("a", 501),
		"",
		"",
		pgtype.Int4{},
		pgtype.Timestamptz{},
		pgtype.Timestamptz{},
	); ok {
		t.Fatal("oversized announcement should be discarded without affecting billing notices")
	}
}
