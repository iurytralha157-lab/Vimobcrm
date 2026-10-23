package admin

import (
	"os"
	"strings"
	"testing"
)

func TestOrganizationPurgeExcludesAccountOwnedPushDevices(t *testing.T) {
	raw, err := os.ReadFile("organization_deletion.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func organizationScopedDeletionPlan(")
	if start < 0 {
		t.Fatal("organization purge discovery not found")
	}
	if !strings.Contains(source[start:], `table.key() == "public.push_tokens"`) {
		t.Fatal("organization metadata must not classify user-owned push devices as tenant-owned purge rows")
	}
}
