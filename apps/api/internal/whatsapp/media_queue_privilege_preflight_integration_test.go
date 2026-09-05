package whatsapp

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestWhatsAppMediaWorkerPrivilegePreflightUsesConnectedPrincipal(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)

	if err := ValidateMediaWorkerDatabasePrivileges(ctx, postgres); err != nil {
		t.Fatalf("connected DATABASE_URL principal failed media worker preflight: %v", err)
	}

	tx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	if _, err := tx.Exec(ctx, `set local role service_role`); err != nil {
		t.Fatalf("set test role service_role: %v", err)
	}

	err = validateMediaWorkerDatabasePrivileges(ctx, tx)
	if err == nil {
		t.Fatal("service_role unexpectedly passed the final media worker privilege preflight")
	}
	errorText := err.Error()
	for _, required := range []string{
		`database principal "service_role"`,
		"public.media_jobs",
		"private.whatsapp_media_worker_state",
		"private.claim_whatsapp_media_job",
		"private.renew_whatsapp_media_job",
	} {
		if !strings.Contains(errorText, required) {
			t.Fatalf("preflight error %q does not contain %q", errorText, required)
		}
	}
}
