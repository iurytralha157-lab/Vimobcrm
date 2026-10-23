package leads

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestManagedImportReceiptReplayPreservesEveryCompletedOutcome(t *testing.T) {
	for _, outcome := range []CreateDistributionOutcome{
		CreateDistributionOutcomeAssigned, CreateDistributionOutcomeAlreadyAssigned,
		CreateDistributionOutcomeNoMatchingQueue, CreateDistributionOutcomeNoAvailableMembers,
		CreateDistributionOutcomeSkipped, CreateDistributionOutcomeReentryPreserved,
		CreateDistributionOutcomePooled, CreateDistributionOutcomeQueueClosed,
		CreateDistributionOutcomeQueueWaiting, CreateDistributionOutcomeQueueLimitReached,
		CreateDistributionOutcomeQueueProtected,
	} {
		t.Run(string(outcome), func(t *testing.T) {
			actor := tenant.Context{OrganizationID: creationOrganizationID, UserID: importDistributionActorID}
			key, digest := "99999999-9999-4999-8999-999999999999", strings.Repeat("a", 64)
			lead := creationFixture()
			tx := &importReceiptTestTx{digest: digest, receipt: leadImportReceipt{LeadID: lead.ID, Outcome: outcome, Completed: true}, leadRow: leadCreationRow{lead: lead}}
			receipt, err := claimLeadImportRequest(context.Background(), tx, actor, &leadImportRequest{tx: tx, key: key, digest: digest})
			if err != nil || receipt.Outcome != outcome {
				t.Fatalf("receipt outcome lost: %+v %v", receipt, err)
			}
			result, err := replayLeadImportReceipt(context.Background(), tx, actor, receipt)
			if err != nil || !result.Replayed || result.DistributionOutcome != outcome {
				t.Fatalf("replay changed outcome: %+v %v", result, err)
			}
			if strings.Join(tx.sequence, ",") != "claim,lock,snapshot,commit" {
				t.Fatalf("replay repeated mutation: %v", tx.sequence)
			}
			completion := &importReceiptTestTx{leadRow: leadCreationRow{lead: lead}}
			if _, err := commitLeadImportCreation(context.Background(), completion, actor, lead.ID, &leadImportRequest{key: key, digest: digest}, false, outcome); err != nil {
				t.Fatalf("valid completion rejected: %s %v", outcome, err)
			}
			if strings.Join(completion.sequence, ",") != "snapshot,complete,commit" || completion.args[1][5] != string(outcome) {
				t.Fatalf("completion changed outcome: %v %v", completion.sequence, completion.args)
			}
		})
	}
}

func TestImportReceiptRejectsUnknownAndTransientOutcomesBeforeCompletion(t *testing.T) {
	for _, value := range []CreateDistributionOutcome{"", "queue_busy", "config_changed", "processing", "future_outcome", "ASSIGNED"} {
		tx := &importReceiptTestTx{}
		_, err := commitLeadImportCreation(context.Background(), tx, tenant.Context{}, creationLeadID, &leadImportRequest{}, false, value)
		if !errors.Is(err, ErrLeadImportIdempotencyUnavailable) || len(tx.sequence) != 0 {
			t.Fatalf("invalid outcome reached completion: %q %v %v", value, err, tx.sequence)
		}
	}
}
