package whatsapp

import "testing"

func TestEvolutionWebhookAutomatedReplyRequiresLiveLane(t *testing.T) {
	tests := []struct {
		name string
		lane string
		want bool
	}{
		{name: "live", lane: evolutionWebhookLaneLive, want: true},
		{name: "backlog", lane: evolutionWebhookLaneBacklog, want: false},
		{name: "missing lane fails closed", lane: "", want: false},
		{name: "unknown lane fails closed", lane: "replay", want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := evolutionWebhookAllowsAutomatedReply(pendingEvolutionWebhook{ProcessingLane: test.lane})
			if got != test.want {
				t.Fatalf("evolutionWebhookAllowsAutomatedReply(%q) = %t, want %t", test.lane, got, test.want)
			}
		})
	}
}
