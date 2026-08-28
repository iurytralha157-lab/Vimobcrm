package admin

import (
	"context"
	"errors"
	"testing"
)

type organizationProvisioningContextKey struct{}

func TestRunOrganizationProvisioningPreservesPrincipalForEveryPersistenceFailure(t *testing.T) {
	t.Parallel()

	stages := []string{
		"begin transaction",
		"insert organization",
		"insert public user",
		"insert organization membership",
		"commit transaction",
	}

	for _, stage := range stages {
		stage := stage
		t.Run(stage, func(t *testing.T) {
			t.Parallel()

			persistenceErr := errors.New(stage + " failed")
			requestContext := context.WithValue(context.Background(), organizationProvisioningContextKey{}, stage)
			requestContext, cancelRequest := context.WithCancel(requestContext)
			cancelRequest()

			err := runOrganizationProvisioningForNewAuthUser(
				requestContext,
				func(persistContext context.Context) error {
					if !errors.Is(persistContext.Err(), context.Canceled) {
						t.Fatalf("persistence context error = %v, want canceled request context", persistContext.Err())
					}
					if persistContext.Value(organizationProvisioningContextKey{}) != stage {
						t.Fatal("persistence context did not preserve request values")
					}
					return persistenceErr
				},
			)

			if !errors.Is(err, persistenceErr) {
				t.Fatalf("error = %v, want persistence error", err)
			}
		})
	}
}

func TestRunOrganizationProvisioningReturnsPersistenceFailure(t *testing.T) {
	t.Parallel()

	persistenceErr := errors.New("commit failed")

	err := runOrganizationProvisioningForNewAuthUser(
		context.Background(),
		func(context.Context) error { return persistenceErr },
	)

	if !errors.Is(err, persistenceErr) {
		t.Fatalf("error = %v, want persistence error", err)
	}
}

func TestRunOrganizationProvisioningReturnsSuccessAfterCommit(t *testing.T) {
	t.Parallel()

	err := runOrganizationProvisioningForNewAuthUser(
		context.Background(),
		func(context.Context) error { return nil },
	)

	if err != nil {
		t.Fatalf("provisioning error = %v", err)
	}
}
