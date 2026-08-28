package admin

import (
	"os"
	"strings"
	"testing"
)

func TestSignupAndSuperadminCreationShareCanonicalDocumentLock(t *testing.T) {
	t.Parallel()
	for _, file := range []string{"onboarding.go", "organization_creation.go"} {
		raw, err := os.ReadFile(file)
		if err != nil {
			t.Fatalf("read %s: %v", file, err)
		}
		source := string(raw)
		lock := strings.Index(source, "public-signup-document:")
		duplicateCheck := strings.Index(source, "regexp_replace(coalesce(existing.cnpj")
		insert := strings.Index(source, "insert into public.organizations")
		if lock < 0 || duplicateCheck < 0 || insert < 0 || !(lock < duplicateCheck && duplicateCheck < insert) {
			t.Fatalf("%s must lock the shared canonical document key, reject duplicates, then insert", file)
		}
		if !strings.Contains(source, "pg_advisory_xact_lock") || !strings.Contains(source, "billing_tax_id") {
			t.Fatalf("%s is missing the race-safe CPF/CNPJ contract", file)
		}
	}
}

