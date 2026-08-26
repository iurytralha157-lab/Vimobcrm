package leads

import "testing"

func TestIsManagedWhatsAppMessageDistributionLead(t *testing.T) {
	tests := []struct {
		name string
		data map[string]any
		want bool
	}{
		{
			name: "boolean marker",
			data: map[string]any{
				"metadata": map[string]any{"managed_whatsapp_message_distribution": true},
			},
			want: true,
		},
		{
			name: "serialized marker",
			data: map[string]any{
				"metadata": map[string]any{"managed_whatsapp_message_distribution": "true"},
			},
			want: true,
		},
		{
			name: "ordinary lead",
			data: map[string]any{
				"metadata": map[string]any{"managed_whatsapp_message_distribution": false},
			},
		},
		{name: "missing metadata", data: map[string]any{}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isManagedWhatsAppMessageDistributionLead(test.data); got != test.want {
				t.Fatalf("isManagedWhatsAppMessageDistributionLead() = %v, want %v", got, test.want)
			}
		})
	}
}
