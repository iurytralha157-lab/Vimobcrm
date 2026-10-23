package whatsapp

import "testing"

func TestNativeEvolutionAuxiliaryKindsKeepMessagesOnNativeMessagePath(t *testing.T) {
	tests := []struct {
		name           string
		event          string
		payload        map[string]any
		labels, groups bool
	}{
		{
			name: "label callback", event: "labels.update",
			payload: map[string]any{"data": map[string]any{"labels": []any{map[string]any{"id": "one"}}}},
			labels:  true,
		},
		{
			name: "group callback", event: "groups.update",
			payload: map[string]any{"data": map[string]any{"groups": []any{map[string]any{"id": "123@g.us"}}}},
			groups:  true,
		},
		{
			name: "message event name", event: "messages.labels.update",
			payload: map[string]any{"data": map[string]any{"labels": []any{map[string]any{"id": "one"}}}},
		},
		{
			name: "mixed real message", event: "labels.update",
			payload: map[string]any{"data": map[string]any{
				"labels":   []any{map[string]any{"id": "one"}},
				"messages": []any{map[string]any{"Info": map[string]any{"ID": "real"}}},
			}},
		},
		{
			name: "mixed message snapshot", event: "groups.update",
			payload: map[string]any{
				"data": map[string]any{"groups": []any{map[string]any{"id": "123@g.us"}}},
				"__vimob_ingress": map[string]any{"routing_snapshot": map[string]any{
					"messages": []any{map[string]any{"provider_message_id": "real"}},
				}},
			},
		},
		{
			name: "empty routing snapshot is harmless", event: "groups.update",
			payload: map[string]any{
				"data":            map[string]any{"groups": []any{map[string]any{"id": "123@g.us"}}},
				"__vimob_ingress": map[string]any{"routing_snapshot": map[string]any{"messages": []any{}}},
			},
			groups: true,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			labels, groups := nativeEvolutionAuxiliaryKinds(test.payload, test.event)
			if labels != test.labels || groups != test.groups {
				t.Fatalf("auxiliary classification = labels=%t groups=%t; want labels=%t groups=%t",
					labels, groups, test.labels, test.groups)
			}
		})
	}
}

func TestNativeEvolutionAuxiliaryProviderShapes(t *testing.T) {
	payload := map[string]any{
		"Labels": map[string]any{"ID": "first"},
		"Data":   map[string]any{"Label": map[string]any{"labelId": "second"}},
	}
	labels := nativeEvolutionNamedObjects(payload, "labels", "label")
	if len(labels) != 2 {
		t.Fatalf("named objects = %d, want 2", len(labels))
	}
	for _, test := range []struct {
		name  string
		label map[string]any
		want  *int32
	}{
		{name: "numeric index", label: map[string]any{"colorIndex": "7"}, want: int32Pointer(7)},
		{name: "decimal number", label: map[string]any{"color": float64(12)}, want: int32Pointer(12)},
		{name: "hex is not a provider index", label: map[string]any{"color": "#ff4529"}},
		{name: "partial decimal is invalid", label: map[string]any{"color": "7junk"}},
		{name: "overflow is invalid", label: map[string]any{"color": "2147483648"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := nativeEvolutionLabelColor(test.label)
			if (got == nil) != (test.want == nil) || (got != nil && *got != *test.want) {
				t.Fatalf("color = %v, want %v", got, test.want)
			}
		})
	}
	if got := nativeEvolutionAuxiliaryJID("120363012345@g.us", true); got != "120363012345@g.us" {
		t.Fatalf("group JID = %q", got)
	}
	if got := nativeEvolutionAuxiliaryJID("120363012345", true); got != "120363012345@g.us" {
		t.Fatalf("digits group JID = %q", got)
	}
}

func int32Pointer(value int32) *int32 { return &value }
