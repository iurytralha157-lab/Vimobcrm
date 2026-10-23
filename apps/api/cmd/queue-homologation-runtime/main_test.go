package main

import (
	"context"
	"log/slog"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestWorkerModeRejectsOnceBeforeOpeningAnyTarget(t *testing.T) {
	if err := run(context.Background(), "", true, true); err == nil || err.Error() != "choose either once or the production worker" {
		t.Fatalf("incompatible modes must fail before manifest or database access: %v", err)
	}
}

func TestActualWorkerLoggerRedactsDatabaseErrors(t *testing.T) {
	attribute := safeRuntimeLogAttribute(nil, slog.Any("error", &pgconn.PgError{Code: "XX000", Message: "postgresql://synthetic:password@127.0.0.1/db", Detail: "secret detail"}))
	if attribute.Value.String() != "SQLSTATE XX000: database message omitted" {
		t.Fatalf("worker diagnostic exposed raw error: %v", attribute)
	}
}

func TestCycleDiagnosticsNeverPrintURLsOrCredentialMessages(t *testing.T) {
	for _, message := range []string{"postgresql://postgres:synthetic@127.0.0.1/db", "password synthetic"} {
		got := safeCycleError(&pgconn.PgError{Code: "XX000", Message: message})
		if got != "SQLSTATE XX000: database message omitted" {
			t.Fatalf("unsafe diagnostic: %q", got)
		}
	}
	if got := safeCycleError(context.DeadlineExceeded); got != "context_deadline_exceeded" {
		t.Fatalf("unexpected deadline classification: %q", got)
	}
}

func TestLocalRuntimeRequiresTheApprovedDisposableTarget(t *testing.T) {
	valid := localManifest{Kind: "vimob-queue-homologation-v1", RunID: "11111111-1111-4111-8111-111111111111", ProjectID: approvedProject,
		DatabaseURL: "postgresql://postgres:synthetic-only@127.0.0.1:57422/postgres?sslmode=disable", SupabaseURL: "http://127.0.0.1:57421"}
	if err := validateLocalManifest(valid); err != nil {
		t.Fatal(err)
	}
	for _, mutation := range []func(*localManifest){
		func(value *localManifest) { value.ProjectID = "other-project" },
		func(value *localManifest) { value.RunID = "unverified" },
		func(value *localManifest) {
			value.DatabaseURL = "postgresql://postgres:synthetic-only@external.invalid:57422/postgres"
		},
		func(value *localManifest) {
			value.DatabaseURL = "postgresql://postgres:synthetic-only@127.0.0.1:5432/postgres"
		},
		func(value *localManifest) {
			value.DatabaseURL = "postgresql://postgres:synthetic-only@127.0.0.1:57422/another"
		},
		func(value *localManifest) { value.DatabaseURL += "&options=-csearch_path%3Dpublic" },
	} {
		changed := valid
		mutation(&changed)
		if err := validateLocalManifest(changed); err == nil {
			t.Fatal("an unapproved target was accepted")
		}
	}
}
