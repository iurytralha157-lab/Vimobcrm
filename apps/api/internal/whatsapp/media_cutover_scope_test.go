package whatsapp

import (
	"reflect"
	"testing"
)

func TestWhatsAppMediaScopeHonorsDurableCutoverWithoutBroadeningLegacy(t *testing.T) {
	for _, tc := range []struct {
		name, mode                string
		configured, cutover, want []string
	}{
		{"edge uses cutover only", webhookProcessorEdge, []string{"*", "legacy"}, []string{"native"}, []string{"native"}},
		{"edge without cutover never claims", webhookProcessorEdge, []string{"*"}, nil, []string{}},
		{"native merges deduplicated scopes", webhookProcessorNative, []string{"native", " legacy "}, []string{"native"}, []string{"native", "legacy"}},
		{"native wildcard stays explicit", webhookProcessorNativeFallback, []string{"*"}, []string{"native"}, []string{"native", "*"}},
		{"native empty config still owns cutover", webhookProcessorNative, nil, []string{"native"}, []string{"native"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := whatsappMediaWorkerScope(functionsClient{webhookProcessorMode: tc.mode, webhookRolloutSessionIDs: tc.configured}, tc.cutover)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("scope = %v, want %v", got, tc.want)
			}
		})
	}
}
