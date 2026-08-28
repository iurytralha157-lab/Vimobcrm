package meta

import (
	"errors"
	"strings"
	"testing"
)

func TestRequireUniquePageIntegration(t *testing.T) {
	t.Run("keeps a unique connected integration routable", func(t *testing.T) {
		if err := requireUniquePageIntegration("page-123", 1); err != nil {
			t.Fatalf("requireUniquePageIntegration() error = %v, want nil", err)
		}
	})

	t.Run("fails closed when a page is connected more than once", func(t *testing.T) {
		err := requireUniquePageIntegration("page-123", 2)
		if !errors.Is(err, ErrAmbiguousPageIntegration) {
			t.Fatalf("requireUniquePageIntegration() error = %v, want ErrAmbiguousPageIntegration", err)
		}
		if !strings.Contains(err.Error(), "page-123") || !strings.Contains(err.Error(), "2 active integrations") {
			t.Fatalf("requireUniquePageIntegration() error = %q, want page and match count context", err)
		}
	})
}

func TestFindIntegrationByPageQueryCountsBeforeChoosingCandidate(t *testing.T) {
	normalizedQuery := strings.Join(strings.Fields(findIntegrationByPageQuery), " ")
	for _, contract := range []string{
		"count(*) over () as matching_integrations",
		"where mi.page_id = $1",
		"coalesce(mi.is_connected, true) = true",
		"limit 1",
	} {
		if !strings.Contains(normalizedQuery, contract) {
			t.Fatalf("findIntegrationByPageQuery must contain %q; query = %q", contract, normalizedQuery)
		}
	}
}
