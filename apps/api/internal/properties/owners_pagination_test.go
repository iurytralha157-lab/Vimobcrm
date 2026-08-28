package properties

import (
	"errors"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
)

func TestParseOwnerListFilterKeepsLegacyCallsUnbounded(t *testing.T) {
	filter, err := parseOwnerListFilter(url.Values{})
	if err != nil {
		t.Fatalf("parse owner list filter: %v", err)
	}
	if filter.Paginated || filter.Limit != 0 || filter.Cursor != nil || filter.Search != "" {
		t.Fatalf("legacy filter = %#v, want unpaginated empty filter", filter)
	}
}

func TestParseOwnerListFilterBoundsPageAndSearch(t *testing.T) {
	filter, err := parseOwnerListFilter(url.Values{
		"limit":  {"75"},
		"search": {"  Maria Silva  "},
	})
	if err != nil {
		t.Fatalf("parse owner list filter: %v", err)
	}
	if !filter.Paginated || filter.Limit != 75 || filter.Search != "Maria Silva" {
		t.Fatalf("filter = %#v", filter)
	}

	for _, values := range []url.Values{
		{"limit": {"0"}},
		{"limit": {"101"}},
		{"limit": {"not-a-number"}},
		{"search": {strings.Repeat("a", ownerSearchMaxLength+1)}},
	} {
		if _, err := parseOwnerListFilter(values); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("parseOwnerListFilter(%v) error = %v, want ErrInvalidInput", values, err)
		}
	}
}

func TestOwnerCursorRoundTripPreservesStableTieBreakers(t *testing.T) {
	want := ownerCursor{
		NameKey:   "maria da silva",
		CreatedAt: time.Date(2026, 8, 16, 14, 30, 45, 123456000, time.UTC),
		ID:        "11111111-1111-4111-8111-111111111111",
	}
	raw, err := encodeOwnerCursor(want)
	if err != nil {
		t.Fatalf("encode owner cursor: %v", err)
	}
	got, err := decodeOwnerCursor(raw)
	if err != nil {
		t.Fatalf("decode owner cursor: %v", err)
	}
	if got.NameKey != want.NameKey || !got.CreatedAt.Equal(want.CreatedAt) || got.ID != want.ID {
		t.Fatalf("decoded cursor = %#v, want %#v", got, want)
	}

	filter, err := parseOwnerListFilter(url.Values{"cursor": {raw}})
	if err != nil {
		t.Fatalf("parse cursor filter: %v", err)
	}
	if filter.Limit != ownerPageDefaultLimit || filter.Cursor == nil || filter.Cursor.ID != want.ID {
		t.Fatalf("cursor filter = %#v", filter)
	}
}

func TestOwnerCursorRejectsMalformedOrOversizedValues(t *testing.T) {
	for _, raw := range []string{
		"not-base64",
		strings.Repeat("a", ownerCursorMaxLength+1),
	} {
		if _, err := decodeOwnerCursor(raw); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("decodeOwnerCursor(%q) error = %v, want ErrInvalidInput", raw, err)
		}
	}
}

func TestOwnerPageQueryKeepsTenantSearchAndKeysetGuards(t *testing.T) {
	raw, err := os.ReadFile("owners.go")
	if err != nil {
		t.Fatalf("read owners.go: %v", err)
	}
	source := string(raw)
	for _, required := range []string{
		"where po.organization_id = $1::uuid",
		"$5::boolean",
		"page_owners as materialized",
		"po.owner_sort_name > $9::text",
		"po.created_at < $10::timestamptz",
		"po.id < $11::uuid",
		"limit $12",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("owner page query is missing %q", required)
		}
	}
	if strings.Index(source, "page_owners as materialized") > strings.Index(source, "left join lateral") {
		t.Fatal("owner page must be materialized before per-owner property aggregates")
	}
}
