package admin

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestWhatsAppNotificationResetScopeRequiresExplicitTarget(t *testing.T) {
	t.Parallel()
	const org = "20000000-0000-4000-8000-000000000001"
	for _, item := range []struct{ scope, organization string }{
		{"", ""}, {"", org}, {"all", org}, {"organization", ""},
		{"organization", "invalid"}, {"global", ""},
	} {
		if _, _, err := normalizeWhatsAppNotificationResetScope(item.scope, item.organization); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("scope=%q organization=%q: got %v", item.scope, item.organization, err)
		}
	}
	if scope, organization, err := normalizeWhatsAppNotificationResetScope("organization", org); err != nil || scope != "organization" || organization != org {
		t.Fatalf("valid organization target failed: %q %q %v", scope, organization, err)
	}
	if scope, organization, err := normalizeWhatsAppNotificationResetScope("all", ""); err != nil || scope != "all" || organization != "" {
		t.Fatalf("explicit global target failed: %q %q %v", scope, organization, err)
	}
}

func TestWhatsAppNotificationResetRequiresConfirmationReasonAndTimestamp(t *testing.T) {
	t.Parallel()
	request := ResetWhatsAppNotificationsRequest{
		Scope: "all", CutoffAt: "2026-10-15T15:30:00-03:00", Reason: "  ajuste da fila  ", Confirmation: "RESETAR",
	}
	got, cutoff, err := normalizeWhatsAppNotificationReset(request)
	if err != nil || got.Reason != "ajuste da fila" || cutoff.Format(time.RFC3339) != "2026-10-15T18:30:00Z" {
		t.Fatalf("valid request failed: %#v %v %v", got, cutoff, err)
	}
	for _, mutate := range []func(*ResetWhatsAppNotificationsRequest){
		func(item *ResetWhatsAppNotificationsRequest) { item.Confirmation = "" },
		func(item *ResetWhatsAppNotificationsRequest) { item.Confirmation = "resetar" },
		func(item *ResetWhatsAppNotificationsRequest) { item.Reason = "  " },
		func(item *ResetWhatsAppNotificationsRequest) { item.Reason = strings.Repeat("ç", 1001) },
		func(item *ResetWhatsAppNotificationsRequest) { item.CutoffAt = "2026-10-15" },
		func(item *ResetWhatsAppNotificationsRequest) { item.CutoffAt = "" },
	} {
		invalid := request
		mutate(&invalid)
		if _, _, err := normalizeWhatsAppNotificationReset(invalid); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("invalid request accepted: %#v, err=%v", invalid, err)
		}
	}
	request.Reason = strings.Repeat("ç", 1000)
	if _, _, err := normalizeWhatsAppNotificationReset(request); err != nil {
		t.Fatal("reason must count Unicode characters like existing replay validation", err)
	}
}

func TestWhatsAppNotificationResetRejectsFutureAndExpiredCutoffs(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 10, 15, 18, 30, 0, 0, time.UTC)
	for _, elapsed := range []time.Duration{0, time.Minute, notificationResetPreviewValidity} {
		if !notificationResetCutoffIsFresh(now.Add(-elapsed), now) {
			t.Errorf("valid cutoff rejected at age %s", elapsed)
		}
	}
	for _, cutoff := range []time.Time{now.Add(time.Nanosecond), now.Add(-notificationResetPreviewValidity - time.Nanosecond)} {
		if notificationResetCutoffIsFresh(cutoff, now) {
			t.Errorf("unsafe cutoff accepted: %v", cutoff)
		}
	}
}

func TestWhatsAppNotificationResetRepositoryRejectsUnauthorizedBeforeDatabase(t *testing.T) {
	t.Parallel()
	repo := Repository{}
	for _, actor := range []tenant.Context{{}, {UserRole: "user", MemberRole: "owner"}, {MemberRole: "admin"}} {
		if _, err := repo.PreviewWhatsAppNotificationReset(context.Background(), actor, "all", ""); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
			t.Fatalf("preview must reject non-superadmin: %v", err)
		}
		if _, err := repo.ResetWhatsAppNotifications(context.Background(), actor, ResetWhatsAppNotificationsRequest{}); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
			t.Fatalf("reset must reject non-superadmin: %v", err)
		}
	}
	actor := tenant.Context{IsSuperAdmin: true}
	if _, err := repo.PreviewWhatsAppNotificationReset(context.Background(), actor, "all", "invalid"); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("preview must validate scope before database: %v", err)
	}
	if _, err := repo.ResetWhatsAppNotifications(context.Background(), actor, ResetWhatsAppNotificationsRequest{}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("reset must validate request before database: %v", err)
	}
}

func TestWhatsAppNotificationResetHandlersRejectUnauthorizedAndInvalidInput(t *testing.T) {
	t.Parallel()
	handler := NewHandler(Repository{})
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		for _, actor := range []tenant.Context{{}, {MemberRole: "owner"}} {
			r := httptest.NewRequest(method, "/?scope=all", strings.NewReader(`{}`))
			r = r.WithContext(tenant.ContextWithTenant(r.Context(), actor))
			w := httptest.NewRecorder()
			if method == http.MethodGet {
				handler.PreviewWhatsAppNotificationReset(w, r)
			} else {
				handler.ResetWhatsAppNotifications(w, r)
			}
			if w.Code != http.StatusForbidden {
				t.Errorf("%s non-superadmin status=%d", method, w.Code)
			}
		}
	}
	for _, body := range []string{`{}`, `{"scope":"all","confirmation":"RESETAR","cutoffAt":"bad","reason":"reason"}`, `{"scope":"all","unexpected":true}`} {
		r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
		r = r.WithContext(tenant.ContextWithTenant(r.Context(), tenant.Context{IsSuperAdmin: true}))
		w := httptest.NewRecorder()
		handler.ResetWhatsAppNotifications(w, r)
		if w.Code != http.StatusBadRequest {
			t.Errorf("invalid body %s status=%d", body, w.Code)
		}
	}
}
