package teams

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestAvailabilityReadsRespectNegativeViewBeforeDatabaseAccess(t *testing.T) {
	actor := tenant.Context{OrganizationID: transactionTestOrganizationID, UserID: transactionTestUserID, MemberRole: "user", IsTeamLeader: true, LedTeamIDs: []string{transactionTestTeamID}}
	repo := Repository{beginMutationTx: func(context.Context) (pgx.Tx, error) { t.Fatal("denied read opened transaction"); return nil, nil }}
	_, err := repo.GetAvailabilitySnapshot(context.Background(), actor, testTeamMemberID)
	if !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("snapshot error=%v", err)
	}
	_, err = repo.ListAvailability(context.Background(), actor, []string{testTeamMemberID})
	if !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("bulk error=%v", err)
	}
	actor.Permissions = []string{permissions.TeamView}
	actor.LedTeamIDs = []string{"44444444-4444-4444-8444-444444444444"}
	tx := &availabilitySaveTestTx{}
	repo.beginMutationTx = func(context.Context) (pgx.Tx, error) { return tx, nil }
	_, err = repo.GetAvailabilitySnapshot(context.Background(), actor, testTeamMemberID)
	if !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("foreign-team snapshot error=%v", err)
	}
	if tx.commitCalls != 0 {
		t.Fatal("out-of-scope read committed")
	}
}

func TestTeamReadResolutionMatchesLegacyCompositeGrantAndIgnoredOverride(t *testing.T) {
	// Resolve expands composite role grants, but only canonical/simple aliases
	// are valid overrides today. The SQL reader must preserve that distinction.
	resolved := permissions.Resolve("user", false, []string{"settings_manage"}, map[string]bool{"settings_manage": false})
	for _, key := range []string{permissions.TeamManage, permissions.PipelineManage, permissions.TeamView} {
		if !permissions.Has(resolved, key) {
			t.Fatalf("legacy role grant/ignored override must preserve %s: %v", key, resolved)
		}
	}
	resolved = permissions.Resolve("user", false, []string{"settings_manage"}, map[string]bool{
		"settings_manage":          false,
		permissions.TeamManage:     false,
		permissions.PipelineManage: false,
	})
	if permissions.Has(resolved, permissions.TeamView) {
		t.Fatalf("canonical management denials must remove implied team read: %v", resolved)
	}
	resolved = permissions.Resolve("user", false, nil, map[string]bool{"settings_manage": true})
	if permissions.Has(resolved, permissions.TeamView) {
		t.Fatalf("unknown composite override must not create team read: %v", resolved)
	}
}

func TestSuspendedCoLeaderDoesNotBlockVisibleLeadershipPreservation(t *testing.T) {
	const hiddenLeader = "44444444-4444-4444-8444-444444444444"
	tx := &visibleLeaderTestTx{hiddenLeader: hiddenLeader}
	repo := Repository{}
	leaders, err := repo.currentLeaderMap(context.Background(), tx, transactionTestTeamID)
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := leaders[hiddenLeader]; exists {
		t.Fatal("globally suspended leader remained in the required visible payload")
	}
	if !preservesCurrentLeaders(leaders, []TeamMemberInput{{UserID: transactionTestUserID}}) {
		t.Fatal("active leader cannot preserve visible leadership")
	}
	// The hidden leader is not an instruction to delete it. replaceMembers uses
	// account activity to replace only visible rows, so it remains for reactivation.
	sourceVisible := strings.Contains(tx.lastQuery, "coalesce(u.is_active, false) = true")
	if !sourceVisible {
		t.Fatal("leader map differs from visible roster predicate")
	}
}

type visibleLeaderTestTx struct {
	teamMutationTestTx
	hiddenLeader, lastQuery string
}

func (tx *visibleLeaderTestTx) Query(_ context.Context, sql string, _ ...any) (pgx.Rows, error) {
	tx.lastQuery = sql
	rows := [][]any{{transactionTestUserID, true}}
	if !strings.Contains(sql, "coalesce(u.is_active, false) = true") {
		rows = append(rows, []any{tx.hiddenLeader, true})
	}
	return &teamRegressionRows{rows: rows}, nil
}

func TestLegacyTeamBindingSurvivesEmptyRosterAndLaterReinclusion(t *testing.T) {
	for _, initialActive := range []bool{true, false} {
		t.Run(fmt.Sprintf("active=%t", initialActive), func(t *testing.T) {
			tx := &legacyBindingTestTx{participants: []legacyTestParticipant{{ID: "legacy", TeamID: transactionTestTeamID, UserID: transactionTestUserID, Position: 4, Weight: 13, Active: initialActive}, {ID: "direct", UserID: "55555555-5555-4555-8555-555555555555", Position: 9, Weight: 23, Active: false}}}
			if err := syncRoundRobinWithTeamPreserving(context.Background(), tx, transactionTestOrganizationID, transactionTestTeamID, nil, nil); err != nil {
				t.Fatal(err)
			}
			if len(tx.participants) != 2 || tx.participants[0].UserID != "" || tx.participants[0].TeamID != transactionTestTeamID || tx.participants[0].Weight != 13 || tx.participants[0].Position != 4 || tx.participants[0].Active != initialActive {
				t.Fatalf("lost team anchor/settings: %#v", tx.participants)
			}
			newUser := "66666666-6666-4666-8666-666666666666"
			if err := syncRoundRobinWithTeamPreserving(context.Background(), tx, transactionTestOrganizationID, transactionTestTeamID, []string{newUser}, []string{newUser}); err != nil {
				t.Fatal(err)
			}
			if len(tx.participants) != 2 || tx.participants[0].UserID != "" {
				t.Fatalf("logical binding must expand new roster without materializing duplicates: %#v", tx.participants)
			}
			direct := tx.participants[1]
			if direct.ID != "direct" || direct.TeamID != "" || direct.Weight != 23 || direct.Position != 9 || direct.Active {
				t.Fatalf("direct participant changed: %#v", direct)
			}
		})
	}
}

func TestExistingLogicalTeamAnchorIsNotDuplicatedOrReactivated(t *testing.T) {
	tx := &legacyBindingTestTx{participants: []legacyTestParticipant{{ID: "logical", TeamID: transactionTestTeamID, Position: 2, Weight: 19, Active: false}, {ID: "legacy", TeamID: transactionTestTeamID, UserID: transactionTestUserID, Position: 4, Weight: 13, Active: true}}}
	if err := syncRoundRobinWithTeamPreserving(context.Background(), tx, transactionTestOrganizationID, transactionTestTeamID, nil, nil); err != nil {
		t.Fatal(err)
	}
	if len(tx.participants) != 1 || tx.participants[0].ID != "logical" || tx.participants[0].Active || tx.participants[0].Weight != 19 || tx.participants[0].Position != 2 {
		t.Fatalf("logical participant changed: %#v", tx.participants)
	}
}

func TestLegacyTeamBindingUsesEffectiveRosterWrites(t *testing.T) {
	const nextUser = "55555555-5555-4555-8555-555555555555"
	for _, scenario := range []struct {
		name                    string
		newMembers, keepMembers []string
		direct                  bool
	}{
		{"hidden member absent from queue", nil, []string{nextUser}, false},
		{"replacement collides with direct participant", []string{nextUser}, []string{nextUser}, true},
		{"replacement inserts a real legacy participant", []string{nextUser}, []string{nextUser}, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			tx := &legacyBindingTestTx{participants: []legacyTestParticipant{{ID: "legacy", TeamID: transactionTestTeamID, UserID: transactionTestUserID, Position: 4, Weight: 13, Active: true}}}
			if scenario.direct {
				tx.participants = append(tx.participants, legacyTestParticipant{ID: "direct", UserID: nextUser, Position: 9, Weight: 23, Active: false})
			}
			if err := syncRoundRobinWithTeamPreserving(context.Background(), tx, transactionTestOrganizationID, transactionTestTeamID, scenario.newMembers, scenario.keepMembers); err != nil {
				t.Fatal(err)
			}
			teamCount := 0
			for _, member := range tx.participants {
				if member.TeamID == transactionTestTeamID {
					teamCount++
					if len(scenario.newMembers) == 0 || scenario.direct {
						if member.ID != "legacy" || member.UserID != "" || member.Weight != 13 || member.Position != 4 {
							t.Fatalf("anchor/settings lost: %#v", member)
						}
					} else if member.UserID != nextUser {
						t.Fatalf("successful insertion needs no extra anchor: %#v", member)
					}
				}
				if member.ID == "direct" && (member.TeamID != "" || member.Weight != 23 || member.Position != 9 || member.Active) {
					t.Fatalf("direct participant changed: %#v", member)
				}
			}
			if teamCount != 1 {
				t.Fatalf("expected exactly one team binding: %#v", tx.participants)
			}
		})
	}
}

func TestLogicalAnchorDoesNotMaterializeNewLegacyParticipants(t *testing.T) {
	tx := &legacyBindingTestTx{participants: []legacyTestParticipant{{ID: "logical", TeamID: transactionTestTeamID, Position: 2, Weight: 19, Active: false}, {ID: "legacy", TeamID: transactionTestTeamID, UserID: transactionTestUserID, Position: 4, Weight: 13, Active: true}}}
	const newUser = "55555555-5555-4555-8555-555555555555"
	if err := syncRoundRobinWithTeamPreserving(context.Background(), tx, transactionTestOrganizationID, transactionTestTeamID, []string{newUser}, []string{newUser}); err != nil {
		t.Fatal(err)
	}
	if len(tx.participants) != 1 || tx.participants[0].ID != "logical" || tx.participants[0].Active || tx.participants[0].Weight != 19 {
		t.Fatalf("existing logical anchor changed/duplicated: %#v", tx.participants)
	}
}

type legacyTestParticipant struct {
	ID, TeamID, UserID string
	Position, Weight   int
	Active             bool
}
type legacyBindingTestTx struct {
	teamMutationTestTx
	participants   []legacyTestParticipant
	outsideEntries int
	countReads     int
	insertAttempts int
	countErrAt     int
}

func (tx *legacyBindingTestTx) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	if strings.Contains(sql, "from public.round_robin_members") {
		if args[0] != transactionTestOrganizationID || args[1] != "77777777-7777-4777-8777-777777777777" {
			return teamMutationErrorRow{err: errors.New("unscoped queue read")}
		}
		if strings.Contains(sql, "select count(*)") {
			tx.countReads++
			if tx.countErrAt == tx.countReads {
				return teamMutationErrorRow{err: errors.New("participant count unavailable")}
			}
			return teamMutationRevisionRow(int64(tx.outsideEntries + len(tx.participants)))
		}
		if strings.Contains(sql, "select exists") {
			for _, participant := range tx.participants {
				if participant.UserID == args[2].(string) {
					return teamMutationBooleanRow(true)
				}
			}
			return teamMutationBooleanRow(false)
		}
	}
	return tx.teamMutationTestTx.QueryRow(ctx, sql, args...)
}

func (tx *legacyBindingTestTx) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	if !strings.Contains(sql, "from public.round_robin_members rrm") {
		return nil, errors.New("unexpected query")
	}
	var rows [][]any
	logicalPresent := false
	for _, p := range tx.participants {
		logicalPresent = logicalPresent || (p.TeamID == args[1].(string) && p.UserID == "")
	}
	for _, p := range tx.participants {
		if p.TeamID == args[1].(string) && p.UserID != "" {
			rows = append(rows, []any{p.ID, "77777777-7777-4777-8777-777777777777", p.UserID, p.Position, p.Weight, int64(1), int64(1), p.Active, logicalPresent})
		}
	}
	return &teamRegressionRows{rows: rows}, nil
}
func (tx *legacyBindingTestTx) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	if strings.Contains(sql, "set user_id = null") {
		for _, p := range tx.participants {
			if p.TeamID == args[2].(string) && p.UserID == "" {
				return pgconn.NewCommandTag("UPDATE 0"), nil
			}
		}
		for i := range tx.participants {
			if tx.participants[i].ID == args[3].(string) {
				tx.participants[i].UserID = ""
				tx.participants[i].Active = args[4].(bool)
				return pgconn.NewCommandTag("UPDATE 1"), nil
			}
		}
	} else if strings.Contains(sql, "delete from public.round_robin_members") {
		for i, p := range tx.participants {
			if p.ID == args[1].(string) {
				tx.participants = append(tx.participants[:i], tx.participants[i+1:]...)
				return pgconn.NewCommandTag("DELETE 1"), nil
			}
		}
	} else if strings.Contains(sql, "insert into public.round_robin_members") {
		tx.insertAttempts++
		for _, p := range tx.participants {
			if p.UserID == args[3].(string) {
				return pgconn.NewCommandTag("INSERT 0 0"), nil
			}
		}
		tx.participants = append(tx.participants, legacyTestParticipant{ID: "new", TeamID: args[2].(string), UserID: args[3].(string), Weight: args[4].(int), Position: args[5].(int), Active: true})
		return pgconn.NewCommandTag("INSERT 0 1"), nil
	}
	return pgconn.CommandTag{}, errors.New("unexpected mutation")
}

type teamRegressionRows struct {
	teamMutationEmptyRows
	rows  [][]any
	index int
}

func (r *teamRegressionRows) Next() bool {
	if r.index >= len(r.rows) {
		return false
	}
	r.index++
	return true
}
func (r *teamRegressionRows) Scan(dest ...any) error {
	row := r.rows[r.index-1]
	if len(row) != len(dest) {
		return errors.New("unexpected destinations")
	}
	for i, value := range row {
		switch out := dest[i].(type) {
		case *string:
			*out = value.(string)
		case *int:
			*out = value.(int)
		case *int64:
			*out = value.(int64)
		case *bool:
			*out = value.(bool)
		default:
			return errors.New("unexpected destination type")
		}
	}
	return nil
}
