package leads

import (
	"net/url"
	"testing"
)

func TestNotificationFiltersNormalizeCategoriesBeforePagination(t *testing.T) {
	f, err := parseNotificationListFilters(url.Values{"unreadOnly": {"true"}, "categories": {"tasks,leads", "tasks"}})
	if err != nil {
		t.Fatal(err)
	}
	if !f.UnreadOnly || len(f.Categories) != 2 || f.Categories[0] != "tasks" {
		t.Fatalf("unexpected filters: %#v", f)
	}
	for _, query := range []url.Values{{"categories": {"unknown"}}, {"unreadOnly": {"maybe"}}} {
		if _, err := parseNotificationListFilters(query); err == nil {
			t.Fatalf("invalid query accepted: %#v", query)
		}
	}
}
