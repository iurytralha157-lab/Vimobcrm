package leads

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

type canonicalTagsRow struct {
	raw string
	err error
}

func (row canonicalTagsRow) Scan(destinations ...any) error {
	if row.err != nil {
		return row.err
	}
	*destinations[0].(*string) = "lead-a"
	*destinations[len(destinations)-1].(*[]byte) = []byte(row.raw)
	return nil
}

func TestCanonicalLeadTagsOmittedEmptyAndPresentJSON(t *testing.T) {
	name := "Fixture"
	color := "#123456"
	empty := LeadTags{}
	present := LeadTags{{ID: "tag-a", Name: &name, Color: &color}}
	for _, tc := range []struct {
		name string
		tags *LeadTags
		want string
	}{
		{"not loaded", nil, ""},
		{"canonical empty", &empty, "[]"},
		{"canonical present", &present, `[{"id":"tag-a","name":"Fixture","color":"#123456"}]`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			encoded, err := json.Marshal(Lead{Tags: tc.tags})
			if err != nil {
				t.Fatal(err)
			}
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(encoded, &fields); err != nil {
				t.Fatal(err)
			}
			if string(fields["tags"]) != tc.want {
				t.Fatalf("tags = %s, want %s", fields["tags"], tc.want)
			}
		})
	}
}

func TestCanonicalLeadTagsRowAppendsColumnAndPreservesEmpty(t *testing.T) {
	for _, raw := range []string{"[]", `[{"id":"tag-a","name":"Fixture","color":null}]`} {
		var leadID string
		var tags LeadTags
		row := leadDetailTagsRow{row: canonicalTagsRow{raw: raw}, tags: &tags}
		if err := row.Scan(&leadID); err != nil {
			t.Fatal(err)
		}
		if leadID != "lead-a" || tags == nil {
			t.Fatalf("row = %q, %#v", leadID, tags)
		}
		encoded, _ := json.Marshal(tags)
		if string(encoded) != raw {
			t.Fatalf("tags = %s, want %s", encoded, raw)
		}
	}
}

func TestCanonicalLeadTagsWrapperUsesUnchangedLeadScanner(t *testing.T) {
	var tags LeadTags
	lead, err := scanLead(leadDetailTagsRow{
		row: canonicalTagsRow{raw: `[{"id":"tag-a","name":"Fixture","color":null}]`}, tags: &tags,
	})
	if err != nil {
		t.Fatal(err)
	}
	if lead.ID != "lead-a" || len(tags) != 1 || tags[0].ID != "tag-a" {
		t.Fatalf("scanner/extra column = %#v, %#v", lead, tags)
	}
}

func TestCanonicalLeadTagsRowDoesNotFabricateEmptyOnErrors(t *testing.T) {
	queryErr := errors.New("synthetic scan failure")
	var tags LeadTags
	var leadID string
	if err := (leadDetailTagsRow{row: canonicalTagsRow{err: queryErr}, tags: &tags}).Scan(&leadID); !errors.Is(err, queryErr) {
		t.Fatalf("scan error = %v", err)
	}
	for _, raw := range []string{"null", "invalid", "{}"} {
		if err := (leadDetailTagsRow{row: canonicalTagsRow{raw: raw}, tags: &tags}).Scan(&leadID); err == nil {
			t.Fatalf("accepted %q", raw)
		}
		if tags != nil {
			t.Fatalf("fabricated tags after invalid result: %#v", tags)
		}
	}
}

func TestCanonicalLeadTagsSQLScopedToSelectedLeadAndOrganization(t *testing.T) {
	for _, required := range []string{"lt.organization_id = l.organization_id", "t.organization_id = l.organization_id", "lt.lead_id = l.id", "'[]'::jsonb", "order by lt.created_at asc, t.id asc"} {
		if !strings.Contains(leadDetailTagsSQL, required) {
			t.Fatalf("missing scope/contract: %s", required)
		}
	}
}
