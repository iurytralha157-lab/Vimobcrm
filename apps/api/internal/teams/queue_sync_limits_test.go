package teams

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const queueLimitNextUser = "55555555-5555-4555-8555-555555555555"

func TestTeamQueueSyncBoundsRealGrowthAndPreservesLegacyCounts(t *testing.T) {
	for _, scenario := range []struct {
		name                                   string
		initialCount                           int
		keepOld, directCollision, secondLegacy bool
		wantCount                              int
		blocked                                bool
	}{
		{"one place remains", 499, true, false, false, 500, false},
		{"new materialized participant exceeds cap", 500, true, false, false, 501, true},
		{"replacement frees a place before final validation", 500, false, false, true, 499, false},
		{"direct conflict adds no participant", 500, false, true, false, 500, false},
		{"oversized legacy replacement has no growth", 501, false, false, false, 501, false},
		{"oversized legacy growth is blocked", 501, true, false, false, 502, true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			tx := &legacyBindingTestTx{participants: []legacyTestParticipant{{ID: "legacy", TeamID: transactionTestTeamID, UserID: transactionTestUserID, Position: 4, Weight: 13, Active: false}}}
			if scenario.directCollision {
				tx.participants = append(tx.participants, legacyTestParticipant{ID: "direct", UserID: queueLimitNextUser, Position: 9, Weight: 23, Active: false})
			}
			if scenario.secondLegacy {
				tx.participants = append(tx.participants, legacyTestParticipant{ID: "removed", TeamID: transactionTestTeamID, UserID: "66666666-6666-4666-8666-666666666666", Position: 6, Weight: 17, Active: true})
			}
			tx.outsideEntries = scenario.initialCount - len(tx.participants)
			keep := []string{queueLimitNextUser}
			if scenario.keepOld {
				keep = append(keep, transactionTestUserID)
			}
			err := syncRoundRobinWithTeamPreserving(context.Background(), tx, transactionTestOrganizationID, transactionTestTeamID, []string{queueLimitNextUser}, keep)
			if errors.Is(err, ErrTeamQueueSyncBlocked) != scenario.blocked || (err != nil && !scenario.blocked) {
				t.Fatalf("sync error=%v, want blocked=%t", err, scenario.blocked)
			}
			if count := tx.outsideEntries + len(tx.participants); count != scenario.wantCount {
				t.Fatalf("effective count=%d, want %d", count, scenario.wantCount)
			}
			if scenario.directCollision && tx.countReads != 1 {
				t.Fatalf("no INSERT must not be treated as growth: count reads=%d", tx.countReads)
			}
			for _, participant := range tx.participants {
				if participant.ID == "direct" && (participant.Weight != 23 || participant.Position != 9 || participant.Active || participant.TeamID != "") {
					t.Fatalf("direct participant/settings changed: %#v", participant)
				}
			}
		})
	}
	if distribution.MaxQueueParticipants != 500 {
		t.Fatalf("shared cap=%d", distribution.MaxQueueParticipants)
	}
}

func TestTeamQueueSyncDoesNotRejectOversizedLegacyWithoutInsertion(t *testing.T) {
	tx := &legacyBindingTestTx{outsideEntries: 500, participants: []legacyTestParticipant{{ID: "legacy", TeamID: transactionTestTeamID, UserID: transactionTestUserID, Position: 4, Weight: 13, Active: false}}}
	if err := syncRoundRobinWithTeamPreserving(context.Background(), tx, transactionTestOrganizationID, transactionTestTeamID, []string{transactionTestUserID}, []string{transactionTestUserID}); err != nil {
		t.Fatal(err)
	}
	if tx.countReads != 0 || tx.insertAttempts != 0 || len(tx.participants) != 1 || tx.participants[0].Active {
		t.Fatalf("unchanged legacy queue was treated as growth: %#v", tx)
	}
}

func TestTeamQueueSyncInt32PositionIgnoresDirectConflicts(t *testing.T) {
	for _, scenario := range []struct {
		name                      string
		position                  int
		direct, addAfterCollision bool
		blocked                   bool
		attempts                  int
	}{
		{"no append position", int(maxQueueParticipantPosition), false, false, true, 0},
		{"direct user needs no append position", int(maxQueueParticipantPosition), true, false, false, 0},
		{"failed insertion does not consume last position", int(maxQueueParticipantPosition - 1), true, true, false, 2},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			tx := &legacyBindingTestTx{participants: []legacyTestParticipant{{ID: "legacy", TeamID: transactionTestTeamID, UserID: transactionTestUserID, Position: scenario.position, Weight: 13, Active: true}}}
			if scenario.direct {
				tx.participants = append(tx.participants, legacyTestParticipant{ID: "direct", UserID: queueLimitNextUser, Position: 9, Weight: 23, Active: false})
			}
			selected := []string{queueLimitNextUser}
			const finalUser = "66666666-6666-4666-8666-666666666666"
			if scenario.addAfterCollision {
				selected = append(selected, finalUser)
			}
			err := syncRoundRobinWithTeamPreserving(context.Background(), tx, transactionTestOrganizationID, transactionTestTeamID, selected, selected)
			if errors.Is(err, ErrTeamQueueSyncBlocked) != scenario.blocked || (err != nil && !scenario.blocked) {
				t.Fatalf("error=%v, want blocked=%t", err, scenario.blocked)
			}
			if tx.insertAttempts != scenario.attempts {
				t.Fatalf("INSERT attempts=%d, want %d", tx.insertAttempts, scenario.attempts)
			}
			for _, participant := range tx.participants {
				if int64(participant.Position) > maxQueueParticipantPosition {
					t.Fatalf("invalid position was sent to INSERT: %#v", participant)
				}
				if participant.UserID == finalUser && int64(participant.Position) != maxQueueParticipantPosition {
					t.Fatalf("direct collision consumed last position: %#v", participant)
				}
			}
		})
	}
}

func TestTeamQueueSyncFailsClosedWhenCountCannotBeRead(t *testing.T) {
	for _, failAt := range []int{1, 2} {
		t.Run(fmt.Sprintf("count=%d", failAt), func(t *testing.T) {
			tx := &legacyBindingTestTx{countErrAt: failAt, participants: []legacyTestParticipant{{ID: "legacy", TeamID: transactionTestTeamID, UserID: transactionTestUserID, Position: 4, Weight: 13, Active: true}}}
			err := syncRoundRobinWithTeamPreserving(context.Background(), tx, transactionTestOrganizationID, transactionTestTeamID, []string{queueLimitNextUser}, []string{queueLimitNextUser})
			if err == nil || !strings.Contains(err.Error(), "participant count unavailable") {
				t.Fatalf("missing authoritative count must stop save: %v", err)
			}
		})
	}
}

func TestTeamQueueSyncLimitRollsBackTeamSaveAndUsesConflictContract(t *testing.T) {
	tx := &teamMutationTestTx{roundRobinQueryErr: ErrTeamQueueSyncBlocked}
	repo := Repository{beginMutationTx: func(context.Context) (pgx.Tx, error) { return tx, nil }}
	revision := int64(1)
	_, err := repo.Update(context.Background(), tenant.Context{OrganizationID: transactionTestOrganizationID, UserID: transactionTestUserID, MemberRole: "admin"}, transactionTestTeamID,
		UpdateTeamRequest{ExpectedRevision: &revision, ExpectedMemberIDs: []string{}, Members: []TeamMemberInput{}})
	if !errors.Is(err, ErrTeamQueueSyncBlocked) || tx.commitCalls != 0 || tx.rollbackCalls != 1 || !containsSQL(tx.execSQL, "delete from public.team_members") {
		t.Fatalf("limit error must roll back earlier roster writes: err=%v commit=%d rollback=%d", err, tx.commitCalls, tx.rollbackCalls)
	}
	request := httptest.NewRequest(http.MethodPatch, "/v1/teams/"+transactionTestTeamID, nil)
	response := httptest.NewRecorder()
	writeTeamError(response, request, fmt.Errorf("sync: %w", err))
	var payload struct {
		Error struct{ Code, Message string }
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusConflict || payload.Error.Code != "team_queue_sync_blocked" || !strings.Contains(payload.Error.Message, "Reduza os participantes ou revise o vínculo") {
		t.Fatalf("missing operational conflict guidance: status=%d body=%s", response.Code, response.Body)
	}
}
