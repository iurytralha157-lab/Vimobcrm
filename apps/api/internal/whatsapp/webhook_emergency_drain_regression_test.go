package whatsapp

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"
)

func TestNativeOutboundDeviceSentDestinationIdentity(t *testing.T) {
	tests := []struct {
		name string
		info map[string]any
		raw  map[string]any
		want string
	}{
		{
			name: "uppercase destination fallback",
			info: map[string]any{
				"DeviceSentMeta": map[string]any{"DestinationJID": "5511999991111@s.whatsapp.net"},
			},
			want: "5511999991111",
		},
		{
			name: "lowercase destination fallback",
			info: map[string]any{
				"deviceSentMeta": map[string]any{"destinationJID": "5511888882222@s.whatsapp.net"},
			},
			want: "5511888882222",
		},
		{
			name: "existing raw recipient keeps precedence",
			info: map[string]any{
				"DeviceSentMeta": map[string]any{"DestinationJID": "5511777773333@s.whatsapp.net"},
			},
			raw:  map[string]any{"recipient": "5511666664444@s.whatsapp.net"},
			want: "5511666664444",
		},
		{
			name: "existing info recipient keeps precedence",
			info: map[string]any{
				"RecipientPN":    "5511555556666@s.whatsapp.net",
				"DeviceSentMeta": map[string]any{"DestinationJID": "5511444447777@s.whatsapp.net"},
			},
			raw:  map[string]any{"recipient": "5511333338888@s.whatsapp.net"},
			want: "5511555556666",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			info := map[string]any{
				"ID":       "provider-outbound-device-sent",
				"Chat":     "987654321012345@lid",
				"IsFromMe": true,
			}
			for key, value := range test.info {
				info[key] = value
			}
			raw := map[string]any{
				"Info":    info,
				"Message": map[string]any{"conversation": "Mensagem enviada"},
			}
			for key, value := range test.raw {
				raw[key] = value
			}

			message, ok := normalizeNativeEvolutionMessage(raw)
			if !ok {
				t.Fatal("outbound message was not normalized")
			}
			if message.ContactPhone != test.want || message.RemoteJID != test.want+"@s.whatsapp.net" {
				t.Fatalf("outbound identity = phone:%q jid:%q, want phone %q", message.ContactPhone, message.RemoteJID, test.want)
			}
			if !stringIn("987654321012345@lid", message.RemoteAliases...) {
				t.Fatalf("original LID alias was not preserved: %#v", message.RemoteAliases)
			}
		})
	}
}

func TestNativeAliasLeadResolutionFailsClosed(t *testing.T) {
	leadID, err := nativeSingleEvolutionAliasLeadID([]string{"lead-a", "lead-a"})
	if err != nil || leadID != "lead-a" {
		t.Fatalf("one distinct alias lead = %q, %v", leadID, err)
	}
	if _, err := nativeSingleEvolutionAliasLeadID([]string{"lead-a", "lead-b"}); !errors.Is(err, errNativeEvolutionAliasLeadAmbiguous) {
		t.Fatalf("conflicting alias leads error = %v", err)
	}

	source := readEmergencyDrainSource(t, "webhook_native_processor.go")
	queryPattern := `(?s)select distinct alias\.lead_id::text.*?from public\.whatsapp_contact_identity_aliases alias.*?alias\.organization_id = \$1::uuid.*?alias\.session_id = \$2::uuid.*?alias\.alias_jid = any\(\$3::text\[\]\).*?limit 2`
	if !regexp.MustCompile(queryPattern).MatchString(source) {
		t.Fatal("alias lead lookup must be scoped by organization, session and exact aliases, with at most two distinct matches")
	}
	precedencePattern := `(?s)lead, err = findSingleNativeEvolutionAliasLead\(ctx, tx, session, aliases\).*?if lead\.ID == "" && quarantineReason == "" \{\s*lead, err = findSingleNativeEvolutionLead\(`
	if !regexp.MustCompile(precedencePattern).MatchString(source) {
		t.Fatal("exact alias lead lookup must run before the phone fallback")
	}
}

func TestEvolutionEdgeStatusEventsDoNotEnterMessagePipeline(t *testing.T) {
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to locate emergency drain regression test")
	}
	edgePath := filepath.Clean(filepath.Join(
		filepath.Dir(sourceFile),
		"..", "..", "..", "..",
		"supabase", "functions", "evolution-go-webhook", "index.ts",
	))
	raw, err := os.ReadFile(edgePath)
	if err != nil {
		t.Fatalf("read Edge Function: %v", err)
	}
	source := string(raw)
	pattern := `(?s)const isMessageStatusEvent = event\.includes\("status"\) \|\| event\.includes\("receipt"\) \|\| event\.includes\("ack"\);\s*const statusUpdated = isMessageStatusEvent\s*\? await handleMessageStatus\(resolved\.session, payload\)\s*:\s*0;\s*const messageResult = isMessageStatusEvent\s*\? \{ processed: 0, duplicates: 0, inProgress: 0 \}\s*:\s*await handleMessages\(`
	if !regexp.MustCompile(pattern).MatchString(source) {
		t.Fatal("receipt/status/ack events must update status without entering handleMessages")
	}
	if calls := strings.Count(source, "await handleMessages("); calls != 1 {
		t.Fatalf("Edge Function has %d handleMessages call sites, want exactly the guarded call", calls)
	}
}

func readEmergencyDrainSource(t *testing.T, name string) string {
	t.Helper()
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to locate emergency drain regression test")
	}
	raw, err := os.ReadFile(filepath.Join(filepath.Dir(sourceFile), name))
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	return string(raw)
}
