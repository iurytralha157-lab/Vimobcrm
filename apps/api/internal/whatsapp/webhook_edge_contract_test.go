package whatsapp

import (
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"
)

func TestEvolutionGoEdgeManagedDistributionFailsClosedAndRetries(t *testing.T) {
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to locate Edge Function contract test")
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

	for _, fragment := range []string{
		"boundSessionId !== sessionId",
		`["deleted", "disabled"].includes(resolvedSessionStatus)`,
	} {
		if !strings.Contains(source, fragment) {
			t.Fatalf("Edge Function managed distribution contract is missing %q", fragment)
		}
	}

	for _, pattern := range []string{
		`(?s)inbound rule lookup failed; durable delivery will retry.*?throw error;`,
		`(?s)lead resolution failed; durable delivery will retry.*?throw error;`,
	} {
		if !regexp.MustCompile(pattern).MatchString(source) {
			t.Fatalf("Edge Function must propagate operational failure matching %q", pattern)
		}
	}
}
