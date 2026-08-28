package automations

import (
	"os"
	"strings"
	"testing"
)

func TestAutomationConnectionWritesDefaultMissingBranches(t *testing.T) {
	t.Parallel()

	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository.go: %v", err)
	}

	const defaultedBranch = "coalesce($5, 'default')"
	if got := strings.Count(string(source), defaultedBranch); got != 3 {
		t.Fatalf(
			"automation connection writes using %q = %d, want 3 (create, duplicate and save flow)",
			defaultedBranch,
			got,
		)
	}
}
