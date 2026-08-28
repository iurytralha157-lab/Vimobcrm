package admin

import (
	"database/sql"
	"os"
	"strings"
	"testing"
	"time"
)

func TestClassifyPublicSignupAttemptClaim(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.August, 4, 2, 0, 0, 0, time.UTC)
	tests := []struct {
		name    string
		status  string
		lease   sql.NullTime
		want    publicSignupAttemptClaimOutcome
		wantErr bool
	}{
		{name: "new retry", status: "retryable", want: publicSignupAttemptClaimAcquired},
		{
			name:   "concurrent processing lease",
			status: "processing",
			lease:  sql.NullTime{Time: now.Add(time.Minute), Valid: true},
			want:   publicSignupAttemptClaimBusy,
		},
		{
			name:   "expired processing lease",
			status: "processing",
			lease:  sql.NullTime{Time: now.Add(-time.Nanosecond), Valid: true},
			want:   publicSignupAttemptClaimAcquired,
		},
		{
			name:   "concurrent compensation lease",
			status: "compensating",
			lease:  sql.NullTime{Time: now.Add(time.Second), Valid: true},
			want:   publicSignupAttemptClaimBusy,
		},
		{
			name:   "expired compensation lease",
			status: "compensating",
			lease:  sql.NullTime{Time: now, Valid: true},
			want:   publicSignupAttemptClaimAcquired,
		},
		{name: "completed replay", status: "completed", want: publicSignupAttemptClaimCompleted},
		{name: "corrupt status", status: "unknown", want: publicSignupAttemptClaimBusy, wantErr: true},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			got, err := classifyPublicSignupAttemptClaim(test.status, test.lease, now)
			if (err != nil) != test.wantErr {
				t.Fatalf("classify error = %v, wantErr %v", err, test.wantErr)
			}
			if got != test.want {
				t.Fatalf("classify outcome = %v, want %v", got, test.want)
			}
		})
	}
}

func TestPublicSignupFencesExternalAuthBeforeDatabaseProvisioning(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile("onboarding.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) PublicOnboardingSignup(")
	end := strings.Index(source[start:], "func (repo Repository) publicSignupResultForAttempt(")
	if start < 0 || end < 0 {
		t.Fatal("could not isolate public onboarding signup")
	}
	signup := source[start : start+end]

	claim := strings.Index(signup, "repo.claimPublicSignupAttempt(")
	auth := strings.Index(signup, "repo.createPublicSignupAuthUser(")
	attach := strings.Index(signup, "repo.attachPublicSignupAuthUser(")
	begin := strings.Index(signup, "repo.db.Pool().Begin(ctx)")
	fence := strings.Index(signup, "fencePublicSignupAttemptForProvisioning(")
	organization := strings.Index(signup, "insert into public.organizations (")
	complete := strings.Index(signup, "completePublicSignupAttempt(")
	commit := strings.Index(signup, "tx.Commit(ctx)")
	if claim < 0 || auth < 0 || attach < 0 || begin < 0 || fence < 0 || organization < 0 || complete < 0 || commit < 0 {
		t.Fatalf(
			"signup lease sequence is incomplete: claim=%d auth=%d attach=%d begin=%d fence=%d organization=%d complete=%d commit=%d",
			claim,
			auth,
			attach,
			begin,
			fence,
			organization,
			complete,
			commit,
		)
	}
	if !(claim < auth && auth < attach && attach < begin && begin < fence && fence < organization && organization < complete && complete < commit) {
		t.Fatalf(
			"unsafe signup lease sequence: claim=%d auth=%d attach=%d begin=%d fence=%d organization=%d complete=%d commit=%d",
			claim,
			auth,
			attach,
			begin,
			fence,
			organization,
			complete,
			commit,
		)
	}
	provisioningTransaction := signup[begin:commit]
	if count := strings.Count(provisioningTransaction, "repo.db.Pool()"); count != 1 {
		t.Fatalf("provisioning transaction must use only its own pooled connection; found %d pool accesses", count)
	}
	for _, forbidden := range []string{
		"repo.createPublicSignupAuthUser(",
		"repo.deleteAuthUser(",
		"repo.httpClient.Do(",
	} {
		if strings.Contains(provisioningTransaction, forbidden) {
			t.Fatalf("provisioning transaction contains external work through %q", forbidden)
		}
	}
}
