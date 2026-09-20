package admin

import (
	"context"
	"errors"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// ADMIN_INVITATION_TEST_DATABASE_URL must point to a disposable loopback
// PostgreSQL database. This test proves the session lock used before Auth
// password mutation is shared across independent pooled connections.
func TestInvitationIdentityLockSerializesConcurrentAcceptances(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("ADMIN_INVITATION_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set ADMIN_INVITATION_TEST_DATABASE_URL to run the local PostgreSQL lock contract")
	}
	parsedURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse ADMIN_INVITATION_TEST_DATABASE_URL: %v", err)
	}
	host := parsedURL.Hostname()
	if host != "127.0.0.1" && host != "localhost" && host != "::1" {
		t.Fatalf("ADMIN_INVITATION_TEST_DATABASE_URL must use a loopback host, got %q", host)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:           databaseURL,
		MaxConns:      4,
		HealthTimeout: 3 * time.Second,
	})
	if err != nil {
		t.Fatalf("connect disposable PostgreSQL: %v", err)
	}
	defer database.Close()
	repo := Repository{db: database}

	releaseFirst, err := repo.acquireInvitationIdentityLock(ctx, "person@example.com")
	if err != nil {
		t.Fatalf("acquire first invitation identity lock: %v", err)
	}
	firstReleased := false
	defer func() {
		if !firstReleased {
			releaseFirst()
		}
	}()

	type lockResult struct {
		release func()
		err     error
	}
	secondResult := make(chan lockResult, 1)
	go func() {
		release, acquireErr := repo.acquireInvitationIdentityLock(ctx, "person@example.com")
		secondResult <- lockResult{release: release, err: acquireErr}
	}()

	select {
	case result := <-secondResult:
		if result.release != nil || !errors.Is(result.err, ErrInvitationInProgress) {
			t.Fatalf(
				"concurrent acceptance release_present=%t error=%v, want fail-fast conflict",
				result.release != nil,
				result.err,
			)
		}
	case <-time.After(time.Second):
		t.Fatal("concurrent acceptance waited while holding or requesting a pool connection")
	}

	releaseFirst()
	firstReleased = true
	releaseSecond, err := repo.acquireInvitationIdentityLock(ctx, "person@example.com")
	if err != nil {
		t.Fatalf("acquire second invitation identity lock after release: %v", err)
	}
	releaseSecond()
}

func TestInvitationIdentityLockReservesAQueryConnectionWithTwoConnectionPool(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("ADMIN_INVITATION_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set ADMIN_INVITATION_TEST_DATABASE_URL to run the local PostgreSQL lock contract")
	}
	parsedURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse ADMIN_INVITATION_TEST_DATABASE_URL: %v", err)
	}
	host := parsedURL.Hostname()
	if host != "127.0.0.1" && host != "localhost" && host != "::1" {
		t.Fatalf("ADMIN_INVITATION_TEST_DATABASE_URL must use a loopback host, got %q", host)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:           databaseURL,
		MaxConns:      2,
		HealthTimeout: 3 * time.Second,
	})
	if err != nil {
		t.Fatalf("connect disposable PostgreSQL: %v", err)
	}
	defer database.Close()
	repo := Repository{db: database}

	releaseFirst, err := repo.acquireInvitationIdentityLock(ctx, "first@example.com")
	if err != nil {
		t.Fatalf("acquire first invitation identity lock: %v", err)
	}
	firstReleased := false
	defer func() {
		if !firstReleased {
			releaseFirst()
		}
	}()

	startedAt := time.Now()
	releaseSecond, err := repo.acquireInvitationIdentityLock(ctx, "second@example.com")
	if releaseSecond != nil || !errors.Is(err, ErrInvitationInProgress) {
		t.Fatalf(
			"second identity release_present=%t error=%v, want fail-fast conflict",
			releaseSecond != nil,
			err,
		)
	}
	if elapsed := time.Since(startedAt); elapsed >= time.Second {
		t.Fatalf("second identity waited %v instead of preserving a query connection", elapsed)
	}

	var one int
	if err := database.Pool().QueryRow(ctx, `select 1`).Scan(&one); err != nil || one != 1 {
		t.Fatalf("query through reserved connection = (%d, %v), want (1, nil)", one, err)
	}

	releaseFirst()
	firstReleased = true
	releaseSecond, err = repo.acquireInvitationIdentityLock(ctx, "second@example.com")
	if err != nil {
		t.Fatalf("acquire second identity after release: %v", err)
	}
	releaseSecond()
}
