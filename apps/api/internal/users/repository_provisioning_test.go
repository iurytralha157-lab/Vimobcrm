package users

import (
	"context"
	"errors"
	"testing"
)

func TestPersistCreatedAuthUserCompensatesAndPreservesPersistenceError(t *testing.T) {
	t.Parallel()

	persistenceErr := errors.New("database write failed")
	cleanupErr := errors.New("auth cleanup failed")
	const authUserID = "11111111-1111-4111-8111-111111111111"

	requestContext, cancel := context.WithCancel(context.Background())
	cancel()

	cleanupCalled := false
	err := persistCreatedAuthUser(
		requestContext,
		authUserID,
		func(context.Context) error {
			return persistenceErr
		},
		func(cleanupContext context.Context, receivedUserID string) error {
			cleanupCalled = true
			if receivedUserID != authUserID {
				t.Fatalf("cleanup user id = %q, want %q", receivedUserID, authUserID)
			}
			if cleanupContext.Err() != nil {
				t.Fatalf("cleanup context inherited canceled request: %v", cleanupContext.Err())
			}
			return cleanupErr
		},
	)

	if !cleanupCalled {
		t.Fatal("expected Auth cleanup to be attempted")
	}
	if err != persistenceErr {
		t.Fatalf("error = %v, want original persistence error %v", err, persistenceErr)
	}
	if errors.Is(err, cleanupErr) {
		t.Fatalf("cleanup error replaced or was joined with persistence error: %v", err)
	}
}

func TestPersistCreatedAuthUserDoesNotCleanupAfterSuccessfulPersistence(t *testing.T) {
	t.Parallel()

	cleanupCalled := false
	err := persistCreatedAuthUser(
		context.Background(),
		"11111111-1111-4111-8111-111111111111",
		func(context.Context) error {
			return nil
		},
		func(context.Context, string) error {
			cleanupCalled = true
			return nil
		},
	)

	if err != nil {
		t.Fatalf("persistCreatedAuthUser() error = %v", err)
	}
	if cleanupCalled {
		t.Fatal("Auth cleanup must not run after successful persistence")
	}
}
