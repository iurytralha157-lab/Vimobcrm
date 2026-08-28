package billing

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestReconciliationClaimsExcludeInactiveOrDeletingOrganizations(t *testing.T) {
	t.Parallel()

	source := reconciliationWorkerSource(t)
	claimJobs := reconciliationWorkerFunction(t, source, "func (reconciler *Reconciler) claimJobs")
	for _, required := range []string{
		"join public.organizations organization_row",
		"organization_row.is_active = true",
		"from private.billing_organization_asaas_cleanup_claims cleanup",
		"cleanup.completed_at is null",
		"for update of job skip locked",
	} {
		if !strings.Contains(claimJobs, required) {
			t.Fatalf("reconciliation claim cleanup fence is missing %q", required)
		}
	}
}

func TestReconciliationRevalidatesDurableJobBeforeProviderCalls(t *testing.T) {
	t.Parallel()

	source := reconciliationWorkerSource(t)
	processJob := reconciliationWorkerFunction(t, source, "func (reconciler *Reconciler) processJob")
	authorizeIndex := strings.Index(processJob, "reconciliationJobProviderMutationAuthorized")
	fetchIndex := strings.Index(processJob, "fetchSnapshot")
	putIndex := strings.Index(processJob, "ensureCustomerNotificationsDisabled")
	if authorizeIndex < 0 || fetchIndex < 0 || putIndex < 0 ||
		authorizeIndex > fetchIndex || authorizeIndex > putIndex {
		t.Fatal("reconciliation must validate its durable processing marker before any provider request")
	}

	authorize := reconciliationWorkerFunction(
		t,
		source,
		"func (reconciler *Reconciler) reconciliationJobProviderMutationAuthorized",
	)
	for _, required := range []string{
		"organization_row.is_active = true",
		"job.status = 'processing'",
		"job.locked_by = $3",
		"job.locked_at >= now()",
		"from private.billing_organization_asaas_cleanup_claims cleanup",
		"cleanup.completed_at is null",
	} {
		if !strings.Contains(authorize, required) {
			t.Fatalf("reconciliation provider authorization is missing %q", required)
		}
	}
}

func reconciliationWorkerSource(t *testing.T) string {
	t.Helper()
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("could not locate reconciliation cleanup contract test")
	}
	sourcePath := filepath.Join(filepath.Dir(currentFile), "reconciler.go")
	source, err := os.ReadFile(sourcePath)
	if err != nil {
		t.Fatalf("read reconciliation worker source: %v", err)
	}
	return string(source)
}

func reconciliationWorkerFunction(t *testing.T, source string, signature string) string {
	t.Helper()
	start := strings.Index(source, signature)
	if start < 0 {
		t.Fatalf("reconciliation worker function %q was not found", signature)
	}
	remainder := source[start+len(signature):]
	end := strings.Index(remainder, "\nfunc ")
	if end < 0 {
		return source[start:]
	}
	return source[start : start+len(signature)+end]
}
