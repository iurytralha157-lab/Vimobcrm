package leads

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestLeadFeedbackLostCommitResponseReplaysWithoutOverwritingNewerFeedback(t *testing.T) {
	f, actor := newFeedbackFixture()
	f.lostCommit = true
	first, err := submitFeedback(t, f, actor, attachmentTestLead, attachmentTestKey, "First synthetic feedback")
	if err == nil || first.receipt.ActivityID != "" || len(f.receipts) != 1 || len(f.activities) != 1 {
		t.Fatal("ambiguous commit must preserve its receipt but return no ACK")
	}
	old := f.receipts[actor.OrganizationID+":"+actor.UserID+":"+attachmentTestKey].receipt
	newer, err := submitFeedback(t, f, actor, attachmentTestLead, moveRevisionDestination, "Newer synthetic feedback")
	if err != nil || newer.receipt.ActivityID == old.ActivityID {
		t.Fatal("new command must append a different note")
	}
	delete(f.activities, old.ActivityID)
	replay, err := submitFeedback(t, f, actor, attachmentTestLead, attachmentTestKey, "First synthetic feedback")
	if err != nil || replay.receipt != old || len(f.receipts) != 2 || len(f.activities) != 1 || f.updates != 2 || f.audits != 2 {
		t.Fatal("retry repeated an effect or changed its canonical ACK after activity deletion")
	}
	if f.leads[actor.OrganizationID+":"+attachmentTestLead].feedback != "Newer synthetic feedback" {
		t.Fatal("old retry overwrote a newer feedback")
	}
	raw, _ := json.Marshal(replay.receipt)
	var body map[string]any
	_ = json.Unmarshal(raw, &body)
	if len(body) != 4 || body["commandId"] == nil || body["leadId"] == nil || body["activityId"] == nil || body["recordedAt"] == nil {
		t.Fatal("receipt DTO changed")
	}
}

func TestLeadFeedbackCommandIdentityConflictsOnlyWithinActorAndOrganization(t *testing.T) {
	f, actor := newFeedbackFixture()
	if _, err := submitFeedback(t, f, actor, attachmentTestLead, attachmentTestKey, "Synthetic feedback"); err != nil {
		t.Fatal(err)
	}
	if _, err := submitFeedback(t, f, actor, attachmentTestLead, attachmentTestKey, "Different feedback"); !errors.Is(err, ErrLeadFeedbackConflict) {
		t.Fatal("reused identity accepted different content")
	}
	otherLead := "30000000-0000-4000-8000-000000000002"
	f.leads[actor.OrganizationID+":"+otherLead] = feedbackFixtureLead{owner: actor.UserID}
	if _, err := submitFeedback(t, f, actor, otherLead, attachmentTestKey, "Synthetic feedback"); !errors.Is(err, ErrLeadFeedbackConflict) {
		t.Fatal("reused identity accepted a different lead")
	}
	other := actor
	other.OrganizationID = "10000000-0000-4000-8000-000000000002"
	f.leads[other.OrganizationID+":"+otherLead] = feedbackFixtureLead{owner: other.UserID}
	if _, err := submitFeedback(t, f, other, otherLead, attachmentTestKey, "Synthetic feedback"); err != nil {
		t.Fatal("same UUID must be independently scoped in another organization")
	}
	other = actor
	other.UserID = "20000000-0000-4000-8000-000000000002"
	f.leads[actor.OrganizationID+":"+otherLead] = feedbackFixtureLead{owner: other.UserID}
	if _, err := submitFeedback(t, f, other, otherLead, attachmentTestKey, "Synthetic feedback"); err != nil {
		t.Fatal("same UUID must be independently scoped to another actor")
	}
	if len(f.receipts) != 3 || len(f.activities) != 3 {
		t.Fatal("receipt scopes crossed identities")
	}
}

func TestLeadFeedbackEqualTextWithANewCommandRemainsALegitimateNote(t *testing.T) {
	f, actor := newFeedbackFixture()
	for _, key := range []string{attachmentTestKey, moveRevisionDestination} {
		if _, err := submitFeedback(t, f, actor, attachmentTestLead, key, "Same legitimate note"); err != nil {
			t.Fatal(err)
		}
	}
	if len(f.receipts) != 2 || len(f.activities) != 2 || f.updates != 2 || f.audits != 1 {
		t.Fatal("text equality must not deduplicate distinct commands or invent audit changes")
	}
}

func TestLeadFeedbackConcurrentIdenticalCommandsAppendOnce(t *testing.T) {
	f, actor := newFeedbackFixture()
	var wg sync.WaitGroup
	results := make(chan leadFeedbackResult, 2)
	failures := make(chan error, 2)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			result, err := submitFeedback(t, f, actor, attachmentTestLead, attachmentTestKey, "Concurrent synthetic note")
			results <- result
			failures <- err
		}()
	}
	wg.Wait()
	close(results)
	close(failures)
	for err := range failures {
		if err != nil {
			t.Fatal("identical concurrent command failed")
		}
	}
	var original LeadFeedbackReceipt
	for result := range results {
		if original.ActivityID == "" {
			original = result.receipt
		} else if result.receipt != original {
			t.Fatal("concurrent commands returned different receipts")
		}
	}
	if len(f.activities) != 1 || len(f.receipts) != 1 || f.updates != 1 || f.audits != 1 {
		t.Fatal("concurrent replay duplicated a durable effect")
	}
}

func TestLeadFeedbackRejectsCurrentAccessLossBeforeReceiptReplay(t *testing.T) {
	for _, name := range []string{"owner changed", "permission denied", "foreign organization", "pool", "lead deleted"} {
		t.Run(name, func(t *testing.T) {
			f, actor := newFeedbackFixture()
			if _, err := submitFeedback(t, f, actor, attachmentTestLead, attachmentTestKey, "Synthetic note"); err != nil {
				t.Fatal(err)
			}
			key := actor.OrganizationID + ":" + attachmentTestLead
			lead := f.leads[key]
			switch name {
			case "owner changed":
				lead.owner = "other-owner"
				f.leads[key] = lead
			case "permission denied":
				actor.Permissions = nil
			case "foreign organization":
				actor.OrganizationID = moveRevisionOrg
			case "pool":
				access := false
				lead.pool = &access
				f.leads[key] = lead
			case "lead deleted":
				delete(f.leads, key)
			}
			if _, err := submitFeedback(t, f, actor, attachmentTestLead, attachmentTestKey, "Synthetic note"); err == nil {
				t.Fatal("receipt became a privilege to replay an inaccessible lead")
			}
			if len(f.receipts) != 1 || len(f.activities) != 1 || f.updates != 1 {
				t.Fatal("rejected replay changed durable effects")
			}
		})
	}
}

func TestLeadFeedbackRollsBackEveryPartialFailureAndFailsClosedWithoutStorage(t *testing.T) {
	for _, name := range []string{"lead", "audit", "activity", "receipt", "missing table", "commit", "zero update", "incomplete receipt"} {
		t.Run(name, func(t *testing.T) {
			f, actor := newFeedbackFixture()
			f.failAt = name
			switch name {
			case "missing table":
				f.missingTable = true
			case "commit":
				f.commitFailure = true
			case "zero update":
				f.zeroUpdate = true
			case "incomplete receipt":
				f.receipts[actor.OrganizationID+":"+actor.UserID+":"+attachmentTestKey] = feedbackFixtureReceipt{receipt: LeadFeedbackReceipt{CommandID: attachmentTestKey, LeadID: attachmentTestLead}, digest: feedbackCommandDigest(attachmentTestLead, "Synthetic note")}
			}
			_, err := submitFeedback(t, f, actor, attachmentTestLead, attachmentTestKey, "Synthetic note")
			if err == nil {
				t.Fatal("partial failure returned an ACK")
			}
			if (name == "missing table" || name == "receipt" || name == "incomplete receipt") && !errors.Is(err, ErrLeadFeedbackStorageUnavailable) {
				t.Fatal("unavailable receipt must not fall back to a legacy write")
			}
			expectedReceipts := 0
			if name == "incomplete receipt" {
				expectedReceipts = 1
			}
			if len(f.receipts) != expectedReceipts || len(f.activities) != 0 || f.updates != 0 || f.audits != 0 || f.leads[actor.OrganizationID+":"+attachmentTestLead].feedback != "" {
				t.Fatal("partial command left durable effects")
			}
		})
	}
}

func TestLeadFeedbackValidationAndStablePublicErrors(t *testing.T) {
	for _, request := range []LeadFeedbackRequest{{}, {CommandID: "bad", Content: "note"}, {CommandID: attachmentTestKey, Content: " "}, {CommandID: attachmentTestKey, Content: strings.Repeat("é", 2001)}} {
		if _, err := request.Validate(); !errors.Is(err, ErrInvalidInput) {
			t.Fatal("invalid feedback was accepted")
		}
	}
	input, err := (LeadFeedbackRequest{CommandID: strings.ToUpper(attachmentTestKey), Content: "  " + strings.Repeat("é", 2000) + "  "}).Validate()
	if err != nil || len([]rune(input.content)) != 2000 {
		t.Fatal("content boundary must count Unicode code points and trim only edges")
	}
	f, actor := newFeedbackFixture()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := (Repository{}).recordFeedbackWithBegin(ctx, actor, attachmentTestLead, input, f.begin); !errors.Is(err, context.Canceled) || len(f.activities) != 0 {
		t.Fatal("cancelled request must not begin a mutation")
	}
	for _, test := range []struct {
		err    error
		status int
		code   string
	}{{ErrLeadFeedbackConflict, 409, "lead_feedback_command_conflict"}, {feedbackReceiptStorageError(&pgconn.PgError{Code: "42P01", Message: "synthetic SQL detail"}), 503, "lead_feedback_storage_unavailable"}, {tenant.ErrOrganizationAccessDenied, 403, "permission_denied"}} {
		response := httptest.NewRecorder()
		writeLeadError(response, httptest.NewRequest(http.MethodPost, "/v1/leads/synthetic/feedback", nil), fmt.Errorf("synthetic internal detail: %w", test.err))
		if response.Code != test.status || !strings.Contains(response.Body.String(), `"code":"`+test.code+`"`) || strings.Contains(response.Body.String(), "synthetic") {
			t.Fatal("public feedback error lost its stable contract or exposed internal detail")
		}
	}
	if !errors.Is(feedbackReceiptStorageError(pgx.ErrNoRows), ErrLeadFeedbackStorageUnavailable) {
		t.Fatal("missing receipt must fail closed")
	}
}
