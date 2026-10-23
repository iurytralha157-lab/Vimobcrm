package teams

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestAvailabilitySaveRequiresObservedRevisionBeforeOpeningTransaction(t *testing.T) {
	for _, revision := range []*int64{nil, int64Pointer(0), int64Pointer(-1), int64Pointer(maxTeamRevision + 1)} {
		repo := Repository{beginMutationTx: func(context.Context) (pgx.Tx, error) { t.Fatal("invalid revision opened transaction"); return nil, nil }}
		request := completeAvailabilityWeek()[1]
		request.TeamMemberID = testTeamMemberID
		request.ExpectedRevision = revision
		if _, err := repo.UpsertAvailability(context.Background(), tenant.Context{}, request); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("PATCH error = %v", err)
		}
		if _, err := repo.ReplaceAvailability(context.Background(), tenant.Context{}, testTeamMemberID, completeAvailabilityWeek(), revision); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("PUT error = %v", err)
		}
	}
}

func TestAvailabilityPatchValidatesActiveWindowOnServer(t *testing.T) {
	for _, test := range []struct {
		name, start, end string
		valid            bool
	}{
		{"missing clocks", "", "", false}, {"missing end", "08:00", "", false},
		{"equal clocks", "08:00:00", "08:00", false}, {"malformed", "24:00", "18:00", false},
		{"overnight", "22:00", "06:00", true}, {"daytime", "08:00", "18:00", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := normalizeAvailabilityRequest(AvailabilityRequest{TeamMemberID: testTeamMemberID, DayOfWeek: 1, StartTime: &test.start, EndTime: &test.end})
			if (err == nil) != test.valid {
				t.Fatalf("valid=%t error=%v", test.valid, err)
			}
		})
	}
}

func TestAvailabilityInactiveDaysRejectMalformedProvidedClocks(t *testing.T) {
	inactive, malformed := false, "invalid"
	if _, err := normalizeAvailabilityRequest(AvailabilityRequest{TeamMemberID: testTeamMemberID, DayOfWeek: 1, IsActive: &inactive, StartTime: &malformed}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("malformed inactive clock error=%v", err)
	}
	if _, err := normalizeAvailabilityRequest(AvailabilityRequest{TeamMemberID: testTeamMemberID, DayOfWeek: 1, IsActive: &inactive}); err != nil {
		t.Fatalf("inactive day without clocks rejected: %v", err)
	}
}

func TestAvailabilitySaveRejectsStaleRevisionWithoutChildWrites(t *testing.T) {
	for _, mutation := range []string{"PATCH", "PUT"} {
		t.Run(mutation, func(t *testing.T) {
			tx := &availabilitySaveTestTx{}
			repo := Repository{beginMutationTx: func(context.Context) (pgx.Tx, error) { return tx, nil }}
			actor := availabilityTestActor()
			request := completeAvailabilityWeek()[1]
			request.TeamMemberID = testTeamMemberID
			request.ExpectedRevision = int64Pointer(2)
			var err error
			if mutation == "PATCH" {
				_, err = repo.UpsertAvailability(context.Background(), actor, request)
			} else {
				_, err = repo.ReplaceAvailability(context.Background(), actor, testTeamMemberID, completeAvailabilityWeek(), request.ExpectedRevision)
			}
			if !errors.Is(err, ErrTeamRevisionConflict) {
				t.Fatalf("error=%v", err)
			}
			if tx.writtenDays != 0 || tx.commitCalls != 0 || tx.rollbackCalls != 1 {
				t.Fatalf("writes=%d commits=%d rollbacks=%d", tx.writtenDays, tx.commitCalls, tx.rollbackCalls)
			}
		})
	}
}

func TestAvailabilityReadbackFailureRollsBackAllSevenWrites(t *testing.T) {
	readbackError := errors.New("availability readback failed")
	tx := &availabilitySaveTestTx{availabilityReadbackErr: readbackError}
	repo := Repository{beginMutationTx: func(context.Context) (pgx.Tx, error) { return tx, nil }}
	_, err := repo.ReplaceAvailability(context.Background(), availabilityTestActor(), testTeamMemberID, completeAvailabilityWeek(), int64Pointer(1))
	if !errors.Is(err, readbackError) {
		t.Fatalf("error=%v", err)
	}
	if tx.writtenDays != 7 || tx.commitCalls != 0 || tx.rollbackCalls != 1 {
		t.Fatalf("writes=%d commits=%d rollbacks=%d", tx.writtenDays, tx.commitCalls, tx.rollbackCalls)
	}
}

func TestAvailabilityLeaderOverrideDeniesSaveBeforeMemberLookup(t *testing.T) {
	actor := availabilityTestActor()
	actor.MemberRole = "user"
	actor.IsTeamLeader = true
	actor.LedTeamIDs = []string{transactionTestTeamID}
	actor.Permissions = []string{permissions.TeamView}
	if err := (Repository{}).ensureCanManageAvailability(context.Background(), nil, actor, testTeamMemberID); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("revoked permission error=%v", err)
	}
}

func TestAssignTeamPipelineReadbackFailureRollsBackLink(t *testing.T) {
	readbackError := errors.New("pipeline link readback failed")
	tx := &availabilitySaveTestTx{pipelineReadbackErr: readbackError}
	repo := Repository{beginMutationTx: func(context.Context) (pgx.Tx, error) { return tx, nil }}
	_, err := repo.AssignPipelineToTeam(context.Background(), availabilityTestActor(), AssignPipelineRequest{TeamID: transactionTestTeamID, PipelineID: testTeamMemberID})
	if !errors.Is(err, readbackError) {
		t.Fatalf("error=%v", err)
	}
	if !containsSQL(tx.execSQL, "insert into public.team_pipelines") || tx.commitCalls != 0 || tx.rollbackCalls != 1 {
		t.Fatalf("commits=%d rollbacks=%d sql=%v", tx.commitCalls, tx.rollbackCalls, tx.execSQL)
	}
}

func TestTeamHistoryPaginationRejectsInvalidOffsets(t *testing.T) {
	for _, value := range []string{"-1", "1000001", "invalid"} {
		if _, err := parseTeamHistoryOffset(value); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("offset=%q error=%v", value, err)
		}
	}
	for _, value := range []string{"", "0", "50", "1000000"} {
		if _, err := parseTeamHistoryOffset(value); err != nil {
			t.Fatalf("offset=%q error=%v", value, err)
		}
	}
}

func TestTeamRosterSaveLocksQueueDomainBeforeTeamAndChildren(t *testing.T) {
	readbackError := errors.New("stop after verifying write order")
	tx := &orderedTeamSaveTx{}
	tx.readbackErr = readbackError
	repo := Repository{beginMutationTx: func(context.Context) (pgx.Tx, error) { return tx, nil }}
	_, err := repo.Update(context.Background(), availabilityTestActor(), transactionTestTeamID, UpdateTeamRequest{
		ExpectedRevision: int64Pointer(1), ExpectedMemberIDs: []string{}, Members: []TeamMemberInput{},
	})
	if !errors.Is(err, readbackError) {
		t.Fatalf("error=%v", err)
	}
	position := func(fragment string) int {
		for index, statement := range tx.statements {
			if strings.Contains(statement, fragment) {
				return index
			}
		}
		t.Fatalf("missing lock/write step %q", fragment)
		return -1
	}
	domain := position("round_robin_conditions:")
	team := position("for no key update")
	parents := position("for update of queue")
	roster := position("for no key update of u")
	children := position("delete from public.team_members")
	if !(domain < team && team < parents && parents < roster && roster < children) {
		t.Fatalf("unsafe lock order: domain=%d team=%d parents=%d roster=%d children=%d", domain, team, parents, roster, children)
	}
}

type orderedTeamSaveTx struct {
	teamMutationTestTx
	statements []string
}

func (tx *orderedTeamSaveTx) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	tx.statements = append(tx.statements, strings.ToLower(sql))
	return tx.teamMutationTestTx.Exec(ctx, sql, args...)
}
func (tx *orderedTeamSaveTx) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	tx.statements = append(tx.statements, strings.ToLower(sql))
	return tx.teamMutationTestTx.QueryRow(ctx, sql, args...)
}
func (tx *orderedTeamSaveTx) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	tx.statements = append(tx.statements, strings.ToLower(sql))
	return tx.teamMutationTestTx.Query(ctx, sql, args...)
}

func availabilityTestActor() tenant.Context {
	return tenant.Context{OrganizationID: transactionTestOrganizationID, UserID: transactionTestUserID, MemberRole: "admin"}
}
func int64Pointer(value int64) *int64 { return &value }

type availabilitySaveTestTx struct {
	teamMutationTestTx
	availabilityReadbackErr error
	pipelineReadbackErr     error
	writtenDays             int
}

func (tx *availabilitySaveTestTx) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	if strings.Contains(sql, "from public.member_availability ma") && tx.availabilityReadbackErr != nil {
		return nil, tx.availabilityReadbackErr
	}
	return tx.teamMutationTestTx.Query(context.Background(), sql, args...)
}

func (tx *availabilitySaveTestTx) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	if strings.Contains(sql, "select team_id::text") {
		return teamMutationStringRow(transactionTestTeamID)
	}
	if strings.Contains(sql, "select tm.id::text") && strings.Contains(sql, "for update of tm") {
		return teamMutationStringRow(testTeamMemberID)
	}
	if strings.Contains(sql, "insert into public.member_availability") {
		tx.writtenDays++
		return availabilitySaveRow{}
	}
	if strings.Contains(sql, "from public.team_pipelines tp") && tx.pipelineReadbackErr != nil {
		return teamMutationErrorRow{err: tx.pipelineReadbackErr}
	}
	return tx.teamMutationTestTx.QueryRow(ctx, sql, args...)
}

type availabilitySaveRow struct{}

func (availabilitySaveRow) Scan(dest ...any) error {
	if len(dest) != 9 {
		return errors.New("unexpected availability destinations")
	}
	*(dest[0].(*string)) = testTeamMemberID
	*(dest[1].(*string)) = testTeamMemberID
	*(dest[2].(*int)) = 1
	*(dest[3].(*pgtype.Text)) = pgtype.Text{String: "08:00:00", Valid: true}
	*(dest[4].(*pgtype.Text)) = pgtype.Text{String: "18:00:00", Valid: true}
	*(dest[5].(*bool)) = false
	*(dest[6].(*bool)) = true
	*(dest[7].(*string)) = "2026-10-12T00:00:00Z"
	*(dest[8].(*string)) = "2026-10-12T00:00:00Z"
	return nil
}
