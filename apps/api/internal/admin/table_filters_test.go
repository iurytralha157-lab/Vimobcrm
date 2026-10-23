package admin

import (
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	"net/url"
	"strings"
	"testing"
)

func TestAdminTableSearchIsParameterizedBeforePagination(t *testing.T) {
	f, err := parseAdminTableFilter(url.Values{"search": {"João %"}, "limit": {"120"}, "offset": {"240"}})
	if err != nil {
		t.Fatal(err)
	}
	sql, args, err := adminTablePageSQL(tenant.Context{IsSuperAdmin: true}, "audit_logs", f)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(sql, "João") || args[0] != 121 || args[1] != 240 || len(args) != 3 {
		t.Fatalf("unexpected bound search: %#v", args)
	}
	if strings.Index(sql, "where") > strings.Index(sql, "limit") || !strings.Contains(sql, "order by") {
		t.Fatal("search/order must precede pagination")
	}
	if _, _, err := adminTablePageSQL(tenant.Context{}, "audit_logs", f); err == nil {
		t.Fatal("non-admin access must stay rejected")
	}
	if _, _, err := adminTablePageSQL(tenant.Context{IsSuperAdmin: true}, "audit_logs;drop table users", f); err == nil {
		t.Fatal("unlisted table must stay rejected")
	}
}

func TestAdminNotificationSearchPreservesRedaction(t *testing.T) {
	sql, _, err := adminTablePageSQL(tenant.Context{IsSuperAdmin: true}, "notifications", AdminTableFilter{Search: "billing", Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sql, "'[redigido]'") || strings.Contains(sql, "to_jsonb(t)->>'content'") || strings.Contains(sql, "to_jsonb(t)->>'title'") {
		t.Fatal("search cannot recover redacted notification text")
	}
}

func TestAdminTableFiltersRejectInvalidBounds(t *testing.T) {
	for _, values := range []url.Values{{"limit": {"201"}}, {"offset": {"-1"}}, {"search": {strings.Repeat("x", 181)}}, {"search": {"a\x00b"}}} {
		if _, err := parseAdminTableFilter(values); err == nil {
			t.Fatalf("expected invalid query: %#v", values)
		}
	}
	if _, _, err := adminTablePageSQL(tenant.Context{IsSuperAdmin: true}, "audit_logs", AdminTableFilter{Search: "a\x00b", Limit: 100}); err == nil {
		t.Fatal("direct repository input must reject NUL")
	}
}
