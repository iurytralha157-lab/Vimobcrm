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
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestLeadContactOutcomeLostCommitACKReplaysWithoutRecreatingEditedOrDeletedActivity(t *testing.T) {
	for _, channel := range []string{"call", "email"} {
		t.Run(channel, func(t *testing.T) {
			f, actor := newContactOutcomeFixture()
			request := contactOutcomeRequest()
			if channel == "email" {
				request.Channel, request.Outcome = "email", "replied"
			}
			f.lostCommit = true
			first, err := submitContactOutcome(t, f, actor, contactOutcomeLead, request)
			if err == nil || first.ActivityID != "" || len(f.receipts) != 1 || len(f.activities) != 1 {
				t.Fatal("lost COMMIT ACK must return no receipt after one durable effect")
			}
			original := f.receipts[actor.OrganizationID+":"+actor.UserID+":"+request.CommandID].receipt
			activity := f.activities[original.ActivityID]
			if activity.channel != channel || activity.org != actor.OrganizationID || activity.actor != actor.UserID || activity.lead != contactOutcomeLead || activity.metadata["notes"] != request.Notes {
				t.Fatal("activity lost its canonical channel, notes or authorization scope")
			}
			if channel == "call" && activity.content != "Tentativa de ligação" || channel == "email" && activity.content != "Email enviado" {
				t.Fatal("existing outcome presentation changed")
			}
			activity.content = "Edited synthetic activity"
			f.activities[original.ActivityID] = activity
			replay, err := submitContactOutcome(t, f, actor, contactOutcomeLead, request)
			if err != nil || replay != original || f.activities[original.ActivityID].content != activity.content {
				t.Fatal("replay overwrote an edited activity")
			}
			delete(f.activities, original.ActivityID)
			replay, err = submitContactOutcome(t, f, actor, contactOutcomeLead, request)
			if err != nil || replay != original || len(f.activities) != 0 || len(f.receipts) != 1 {
				t.Fatal("replay recreated a deleted activity or changed its ACK")
			}
			raw, _ := json.Marshal(replay)
			var payload map[string]any
			_ = json.Unmarshal(raw, &payload)
			if len(payload) != 5 || payload["commandId"] == nil || payload["leadId"] == nil || payload["channel"] != channel || payload["activityId"] == nil || payload["recordedAt"] == nil {
				t.Fatal("canonical receipt DTO changed")
			}
		})
	}
}

func TestLeadContactOutcomeCommandBindsEveryInputAndLeavesNewGesturesIndependent(t *testing.T) {
	for _, field := range []string{"lead", "channel", "outcome", "notes"} {
		t.Run(field, func(t *testing.T) {
			f, actor := newContactOutcomeFixture()
			request := contactOutcomeRequest()
			if _, err := submitContactOutcome(t, f, actor, contactOutcomeLead, request); err != nil {
				t.Fatal(err)
			}
			leadID := contactOutcomeLead
			switch field {
			case "lead":
				leadID = contactOutcomeOther
				f.leads[actor.OrganizationID+":"+leadID] = contactOutcomeFixtureLead{owner: actor.UserID}
			case "channel":
				request.Channel, request.Outcome = "email", "replied"
			case "outcome":
				request.Outcome = "busy"
			case "notes":
				request.Notes = "Different synthetic notes"
			}
			if _, err := submitContactOutcome(t, f, actor, leadID, request); !errors.Is(err, ErrLeadContactOutcomeConflict) || len(f.activities) != 1 || len(f.receipts) != 1 {
				t.Fatal("a reused command accepted changed lead/payload")
			}
		})
	}
	f, actor := newContactOutcomeFixture()
	request := contactOutcomeRequest()
	first, err := submitContactOutcome(t, f, actor, contactOutcomeLead, request)
	if err != nil {
		t.Fatal(err)
	}
	request.CommandID = contactOutcomeOther
	second, err := submitContactOutcome(t, f, actor, contactOutcomeLead, request)
	if err != nil || first.ActivityID == second.ActivityID || len(f.activities) != 2 || len(f.receipts) != 2 {
		t.Fatal("equal text/outcome must not collapse two legitimate gestures")
	}
}

func TestLeadContactOutcomeConcurrentRetriesAndConflictingPayloadsAreSerialized(t *testing.T) {
	for _, different := range []bool{false, true} {
		t.Run(fmt.Sprint(different), func(t *testing.T) {
			f, actor := newContactOutcomeFixture()
			var wg sync.WaitGroup
			results := make(chan LeadContactOutcomeReceipt, 2)
			failures := make(chan error, 2)
			for index := range 2 {
				wg.Add(1)
				go func(index int) {
					defer wg.Done()
					request := contactOutcomeRequest()
					if different && index == 1 {
						request.Notes = "Another payload"
					}
					receipt, err := submitContactOutcome(t, f, actor, contactOutcomeLead, request)
					results <- receipt
					failures <- err
				}(index)
			}
			wg.Wait()
			close(results)
			close(failures)
			conflicts := 0
			for err := range failures {
				if errors.Is(err, ErrLeadContactOutcomeConflict) {
					conflicts++
				} else if err != nil {
					t.Fatal(err)
				}
			}
			if different && conflicts != 1 || !different && conflicts != 0 {
				t.Fatal("concurrent payload conflict contract failed")
			}
			var original LeadContactOutcomeReceipt
			for result := range results {
				if result.ActivityID == "" {
					continue
				}
				if original.ActivityID == "" {
					original = result
				} else if result != original {
					t.Fatal("concurrent retries returned different ACKs")
				}
			}
			if len(f.activities) != 1 || len(f.receipts) != 1 {
				t.Fatal("concurrent command duplicated an effect")
			}
		})
	}
}

func TestLeadContactOutcomeSameCommandIsIndependentAcrossOrganizationsAndActors(t *testing.T) {
	f, actor := newContactOutcomeFixture()
	if _, err := submitContactOutcome(t, f, actor, contactOutcomeLead, contactOutcomeRequest()); err != nil {
		t.Fatal(err)
	}
	other := actor
	other.OrganizationID = contactOutcomeOther
	f.leads[other.OrganizationID+":"+contactOutcomeLead] = contactOutcomeFixtureLead{owner: other.UserID}
	if _, err := submitContactOutcome(t, f, other, contactOutcomeLead, contactOutcomeRequest()); err != nil {
		t.Fatal(err)
	}
	other = actor
	other.UserID = contactOutcomeOther
	f.leads[other.OrganizationID+":"+contactOutcomeLead] = contactOutcomeFixtureLead{owner: other.UserID}
	if _, err := submitContactOutcome(t, f, other, contactOutcomeLead, contactOutcomeRequest()); err != nil {
		t.Fatal(err)
	}
	if len(f.receipts) != 3 || len(f.activities) != 3 {
		t.Fatal("command identity crossed org/actor boundaries")
	}
}

func TestLeadContactOutcomeCurrentAccessIsRequiredEvenForCommittedReplay(t *testing.T) {
	for _, scenario := range []string{"transfer", "permission", "foreign org", "pool visible", "pool hidden", "deleted lead", "no member"} {
		t.Run(scenario, func(t *testing.T) {
			f, actor := newContactOutcomeFixture()
			if _, err := submitContactOutcome(t, f, actor, contactOutcomeLead, contactOutcomeRequest()); err != nil {
				t.Fatal(err)
			}
			key := actor.OrganizationID + ":" + contactOutcomeLead
			lead := f.leads[key]
			switch scenario {
			case "transfer":
				lead.owner = contactOutcomeOther
				f.leads[key] = lead
			case "permission":
				actor.Permissions = nil
			case "foreign org":
				actor.OrganizationID = contactOutcomeOther
			case "pool visible", "pool hidden":
				access := scenario == "pool visible"
				lead.pool = &access
				f.leads[key] = lead
			case "deleted lead":
				delete(f.leads, key)
			case "no member":
				actor.UserID = ""
			}
			receipt, err := submitContactOutcome(t, f, actor, contactOutcomeLead, contactOutcomeRequest())
			if err == nil || receipt.ActivityID != "" || len(f.activities) != 1 || len(f.receipts) != 1 {
				t.Fatal("receipt became authority to replay an inaccessible lead")
			}
		})
	}
}

func TestLeadContactOutcomeCanonicalLeaderScopeAndAdminArePreserved(t *testing.T) {
	for _, scenario := range []string{"own", "admin", "led team", "foreign team", "unled user"} {
		t.Run(scenario, func(t *testing.T) {
			f, actor := newContactOutcomeFixture()
			lead := f.leads[actor.OrganizationID+":"+contactOutcomeLead]
			if scenario == "admin" {
				actor.MemberRole = "admin"
				lead.owner = contactOutcomeOther
			}
			if scenario == "led team" || scenario == "foreign team" || scenario == "unled user" {
				actor.Permissions = []string{permissions.LeadOperate, permissions.LeadViewTeam}
				actor.IsTeamLeader, actor.LedTeamIDs, actor.LedUserIDs = true, []string{contactOutcomeCommand}, []string{contactOutcomeOther}
				lead.owner, lead.team = contactOutcomeOther, contactOutcomeCommand
				if scenario == "foreign team" {
					lead.team = contactOutcomeOther
				}
				if scenario == "unled user" {
					actor.LedUserIDs = nil
				}
			}
			f.leads[actor.OrganizationID+":"+contactOutcomeLead] = lead
			_, err := submitContactOutcome(t, f, actor, contactOutcomeLead, contactOutcomeRequest())
			denied := scenario == "foreign team" || scenario == "unled user"
			if denied && (!errors.Is(err, tenant.ErrOrganizationAccessDenied) || len(f.activities) != 0) || !denied && (err != nil || len(f.activities) != 1) {
				t.Fatalf("canonical scope changed: %v", err)
			}
		})
	}
}

func TestLeadContactOutcomePartialFailureRollsBackAndStorageNeverFallsBack(t *testing.T) {
	for _, phase := range []string{"begin", "lock", "pool", "claim", "read receipt", "activity", "invalid activity", "complete", "complete storage", "commit", "cancel"} {
		t.Run(phase, func(t *testing.T) {
			f, actor := newContactOutcomeFixture()
			f.failAt = phase
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if phase == "cancel" {
				f.cancelAfterLock = cancel
			}
			input, _ := contactOutcomeRequest().Validate()
			receipt, err := (Repository{}).recordContactOutcomeWithBegin(ctx, actor, contactOutcomeLead, input, f.begin)
			if err == nil || receipt.ActivityID != "" || len(f.activities) != 0 || len(f.receipts) != 0 {
				t.Fatal("partial failure acknowledged or committed an effect")
			}
			f.failAt, f.cancelAfterLock = "", nil
			if _, err := submitContactOutcome(t, f, actor, contactOutcomeLead, contactOutcomeRequest()); err != nil || len(f.activities) != 1 {
				t.Fatal("rollback failed to release the lead lock or command")
			}
		})
	}
	for _, code := range []string{"42P01", "3F000", "42703", "42501"} {
		f, actor := newContactOutcomeFixture()
		f.storageCode = code
		if _, err := submitContactOutcome(t, f, actor, contactOutcomeLead, contactOutcomeRequest()); !errors.Is(err, ErrLeadContactOutcomeStorageUnavailable) || len(f.activities) != 0 || len(f.receipts) != 0 {
			t.Fatal("unavailable storage fell back to legacy activity")
		}
	}
}

func TestLeadContactOutcomeIncompleteOrCorruptReceiptsFailClosed(t *testing.T) {
	for _, corrupt := range []string{"incomplete", "activity only", "time only", "bad activity", "channel"} {
		t.Run(corrupt, func(t *testing.T) {
			f, actor := newContactOutcomeFixture()
			input, _ := contactOutcomeRequest().Validate()
			receipt := LeadContactOutcomeReceipt{CommandID: input.commandID, LeadID: contactOutcomeLead, Channel: "call"}
			switch corrupt {
			case "activity only":
				receipt.ActivityID = contactOutcomeOther
			case "time only":
				receipt.RecordedAt = time.Now()
			case "bad activity":
				receipt.ActivityID, receipt.RecordedAt = "invalid", time.Now()
			case "channel":
				receipt.Channel = "email"
			}
			f.receipts[actor.OrganizationID+":"+actor.UserID+":"+input.commandID] = contactOutcomeFixtureReceipt{receipt, contactOutcomeCommandDigest(contactOutcomeLead, input)}
			_, err := submitContactOutcome(t, f, actor, contactOutcomeLead, contactOutcomeRequest())
			want := ErrLeadContactOutcomeStorageUnavailable
			if corrupt == "channel" {
				want = ErrLeadContactOutcomeConflict
			}
			if !errors.Is(err, want) || len(f.activities) != 0 {
				t.Fatal("corrupt receipt permitted an effect or ACK")
			}
		})
	}
}

func TestLeadContactOutcomeValidationDigestAndPublicErrors(t *testing.T) {
	for _, pair := range [][2]string{{"call", "answered"}, {"call", "not_answered"}, {"call", "invalid_number"}, {"call", "busy"}, {"call", "scheduled"}, {"email", "replied"}, {"email", "not_replied"}, {"email", "bounced"}} {
		request := contactOutcomeRequest()
		request.Channel, request.Outcome, request.Notes = pair[0], pair[1], "  "+strings.Repeat("é", 2000)+"  "
		input, err := request.Validate()
		if err != nil || len([]rune(input.notes)) != 2000 {
			t.Fatal("real UI option or Unicode boundary rejected")
		}
	}
	for _, mutate := range []func(*LeadContactOutcomeRequest){
		func(r *LeadContactOutcomeRequest) { r.CommandID = "bad" }, func(r *LeadContactOutcomeRequest) { r.Channel = "message" },
		func(r *LeadContactOutcomeRequest) { r.Outcome = "replied" }, func(r *LeadContactOutcomeRequest) { r.Channel, r.Outcome = "email", "answered" },
		func(r *LeadContactOutcomeRequest) { r.Notes = strings.Repeat("é", 2001) }, func(r *LeadContactOutcomeRequest) { r.Notes = string([]byte{0xff}) },
		func(r *LeadContactOutcomeRequest) { r.Notes = "synthetic\x00note" },
	} {
		request := contactOutcomeRequest()
		mutate(&request)
		if _, err := request.Validate(); !errors.Is(err, ErrInvalidInput) {
			t.Fatal("invalid outcome accepted")
		}
	}
	request := contactOutcomeRequest()
	request.CommandID = strings.ToUpper(request.CommandID)
	request.Notes = "  Synthetic notes  "
	canonical, _ := contactOutcomeRequest().Validate()
	normalized, _ := request.Validate()
	if normalized != canonical || contactOutcomeCommandDigest(contactOutcomeLead, normalized) != contactOutcomeCommandDigest(contactOutcomeLead, canonical) {
		t.Fatal("command normalization changed replay identity")
	}
	for _, item := range []struct {
		err    error
		status int
		code   string
	}{
		{ErrLeadContactOutcomeConflict, 409, "lead_contact_outcome_command_conflict"}, {ErrLeadContactOutcomeStorageUnavailable, 503, "lead_contact_outcome_storage_unavailable"},
	} {
		response := httptest.NewRecorder()
		writeLeadError(response, httptest.NewRequest(http.MethodPost, "/synthetic", nil), fmt.Errorf("SQL private details: %w", item.err))
		if response.Code != item.status || !strings.Contains(response.Body.String(), item.code) || strings.Contains(response.Body.String(), "SQL") {
			t.Fatal("stable public error exposed internals")
		}
	}
	if !errors.Is(contactOutcomeReceiptStorageError(pgx.ErrNoRows), ErrLeadContactOutcomeStorageUnavailable) {
		t.Fatal("missing receipt did not fail closed")
	}
	if !errors.Is(contactOutcomeReceiptStorageError(&pgconn.PgError{Code: "42501"}), ErrLeadContactOutcomeStorageUnavailable) {
		t.Fatal("receipt privileges did not fail closed")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	f, actor := newContactOutcomeFixture()
	if _, err := (Repository{}).recordContactOutcomeWithBegin(ctx, actor, contactOutcomeLead, canonical, f.begin); !errors.Is(err, context.Canceled) {
		t.Fatal("cancelled mutation began")
	}
	if _, err := (Repository{}).RecordContactOutcome(context.Background(), actor, contactOutcomeLead, canonical); !errors.Is(err, ErrLeadContactOutcomeStorageUnavailable) {
		t.Fatal("missing database silently selected another writer")
	}
}
