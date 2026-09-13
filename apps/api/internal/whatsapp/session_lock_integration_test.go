package whatsapp

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestWhatsAppLifecycleLocksSerializeAcrossDatabasePools(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	openReadOnlyPool := func() *dbpkg.Postgres {
		t.Helper()
		postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
			URL:           databaseURL,
			MaxConns:      2,
			ForceReadOnly: true,
			HealthTimeout: 3 * time.Second,
		})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(postgres.Close)
		return postgres
	}

	repoA := Repository{db: openReadOnlyPool()}
	repoB := Repository{db: openReadOnlyPool()}
	const (
		organizationID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
		sessionAID     = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
		sessionBID     = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
	)

	assertBlockedUntilRelease := func(
		name string,
		firstKeys []string,
		secondKeys []string,
	) {
		t.Helper()
		firstPermit := make(chan struct{}, 1)
		secondPermit := make(chan struct{}, 1)
		unlockFirst, acquired, err := repoA.acquireWhatsAppAdvisoryLocksWithPermit(ctx, firstKeys, true, firstPermit)
		if err != nil || !acquired {
			t.Fatalf("%s: first lock acquired=%t err=%v", name, acquired, err)
		}

		type lockResult struct {
			unlock   func()
			acquired bool
			err      error
		}
		resultCh := make(chan lockResult, 1)
		go func() {
			unlock, locked, lockErr := repoB.acquireWhatsAppAdvisoryLocksWithPermit(ctx, secondKeys, true, secondPermit)
			resultCh <- lockResult{unlock: unlock, acquired: locked, err: lockErr}
		}()

		select {
		case result := <-resultCh:
			unlockFirst()
			if result.unlock != nil {
				result.unlock()
			}
			t.Fatalf("%s: competing replica escaped advisory lock: acquired=%t err=%v", name, result.acquired, result.err)
		case <-time.After(200 * time.Millisecond):
		}

		unlockFirst()
		select {
		case result := <-resultCh:
			if result.err != nil || !result.acquired {
				t.Fatalf("%s: competing replica did not acquire after release: acquired=%t err=%v", name, result.acquired, result.err)
			}
			result.unlock()
		case <-ctx.Done():
			t.Fatalf("%s: competing replica stayed blocked after release: %v", name, ctx.Err())
		}
	}

	assertBlockedUntilRelease(
		"create versus delete or recreate for the same session",
		whatsappSessionCreateAdvisoryLockKeys(organizationID, sessionAID),
		[]string{whatsappSessionAdvisoryLockKey(sessionAID)},
	)
	assertBlockedUntilRelease(
		"quota admission for two creates in the same organization",
		whatsappSessionCreateAdvisoryLockKeys(organizationID, sessionAID),
		whatsappSessionCreateAdvisoryLockKeys(organizationID, sessionBID),
	)
}

func TestWhatsAppSessionCreateLockUsesLifecycleSessionKey(t *testing.T) {
	const (
		organizationID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
		sessionID      = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	)
	keys := whatsappSessionCreateAdvisoryLockKeys(organizationID, sessionID)
	if len(keys) != 2 {
		t.Fatalf("create lock key count = %d, want 2", len(keys))
	}
	if got, want := keys[1], whatsappSessionAdvisoryLockKey(sessionID); got != want {
		t.Fatalf("create session key = %q, lifecycle key = %q", got, want)
	}
	if got, want := whatsappSessionAdvisoryLockKey(strings.ToUpper(sessionID)), keys[1]; got != want {
		t.Fatalf("UUID spelling changed lock identity: uppercase key = %q, canonical key = %q", got, want)
	}
}
