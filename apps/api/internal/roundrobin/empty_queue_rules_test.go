package roundrobin

import (
	"encoding/json"
	"testing"
)

func TestQueueRuleMergeRetainsEmptyJSONArray(t *testing.T) {
	for _, input := range [][]Rule{nil, {}} {
		merged := mergeMissingMetaFormLinkRules(input, nil)
		if merged == nil || len(merged) != 0 {
			t.Fatalf("empty queue rules must be a non-nil empty slice: %#v", merged)
		}
		encoded, err := json.Marshal(merged)
		if err != nil || string(encoded) != "[]" {
			t.Fatalf("empty queue rules JSON = %q, error = %v", encoded, err)
		}
	}
	original := []Rule{{ID: "source-rule", MatchType: "source", MatchValue: "synthetic"}}
	merged := mergeMissingMetaFormLinkRules(original, nil)
	if len(merged) != 1 || merged[0].ID != original[0].ID {
		t.Fatalf("existing rule lost during merge: %#v", merged)
	}
	merged[0].MatchValue = "changed"
	if original[0].MatchValue != "synthetic" {
		t.Fatal("merged rules must not alias the caller's rule slice")
	}
}
