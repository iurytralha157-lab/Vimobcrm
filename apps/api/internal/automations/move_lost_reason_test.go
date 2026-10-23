package automations

import (
	"strings"
	"testing"
)

func TestMoveLeadLostReasonContract(t *testing.T) {
	for _, reason := range []any{nil, "", "Synthetic reason", strings.Repeat("á", 300)} {
		if err := validateMoveLostReason(map[string]any{"lost_reason": reason}); err != nil {
			t.Fatal(err)
		}
	}
	for _, reason := range []any{true, 1, []string{"invalid"}, strings.Repeat("á", 301)} {
		if validateMoveLostReason(map[string]any{"lost_reason": reason}) == nil {
			t.Fatalf("invalid reason accepted: %T", reason)
		}
	}
}
