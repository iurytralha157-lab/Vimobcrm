package leads

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const creationLeadID = "11111111-1111-4111-8111-111111111111"
const creationOrganizationID = "22222222-2222-4222-8222-222222222222"

type leadCreationRow struct {
	lead Lead
	err  error
}

func (row leadCreationRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	for _, destination := range dest {
		value := reflect.ValueOf(destination)
		value.Elem().Set(reflect.Zero(value.Elem().Type()))
	}
	*dest[0].(*string) = row.lead.ID
	*dest[1].(*string) = row.lead.OrganizationID
	*dest[2].(*string) = row.lead.Name
	for index, value := range map[int]string{
		3: row.lead.Email, 4: row.lead.Phone, 5: "spreadsheet", 9: row.lead.Message,
		13: row.lead.PipelineID, 14: row.lead.StageID, 15: row.lead.AssignedUserID, 16: row.lead.TeamID,
	} {
		*dest[index].(*pgtype.Text) = pgtype.Text{String: value, Valid: value != ""}
	}
	*dest[38].(*time.Time) = row.lead.CreatedAt
	*dest[39].(*time.Time) = row.lead.UpdatedAt
	return nil
}

type leadCreationTx struct {
	row         leadCreationRow
	commitError error
	committed   bool
	sequence    []string
	query       string
	args        []any
}

func (tx *leadCreationTx) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	tx.sequence = append(tx.sequence, "read")
	tx.query, tx.args = query, args
	if tx.committed {
		return leadCreationRow{err: errors.New("read after commit")}
	}
	return tx.row
}

func (tx *leadCreationTx) Commit(context.Context) error {
	tx.sequence = append(tx.sequence, "commit")
	if tx.commitError != nil {
		return tx.commitError
	}
	tx.committed = true
	return nil
}

func creationFixture() Lead {
	return Lead{
		ID: creationLeadID, OrganizationID: creationOrganizationID, Name: "Contato sintético",
		Email: "synthetic@example.com", Phone: "+5511999990000", Message: "Conteúdo protegido",
		AssignedUserID: "other-user", PipelineID: "33333333-3333-4333-8333-333333333333",
		StageID: "44444444-4444-4444-8444-444444444444", CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
}

func TestCreateCommittedOutsideReadScopeReturnsReceipt(t *testing.T) {
	for _, name := range []string{"explicit assignment to another broker", "automatic distribution to another broker", "reentry loses visibility after redistribution"} {
		t.Run(name, func(t *testing.T) {
			viewer := tenant.Context{OrganizationID: creationOrganizationID, UserID: "actor", Permissions: []string{permissions.LeadViewOwn, permissions.LeadCreate}}
			tx := &leadCreationTx{row: leadCreationRow{lead: creationFixture()}}
			lead, err := commitLeadCreation(context.Background(), tx, viewer, creationLeadID)
			if err != nil || !tx.committed {
				t.Fatalf("committed creation must succeed outside read scope: %v, committed=%v", err, tx.committed)
			}
			if !reflect.DeepEqual(tx.sequence, []string{"read", "commit"}) {
				t.Fatalf("unexpected query/commit order: %v", tx.sequence)
			}
			if lead.AssignedUserID != "other-user" || lead.PipelineID == "" || lead.StageID == "" {
				t.Fatal("internal event snapshot must retain the actual routing destination")
			}
			response := createLeadResponse(viewer, CreateResult{Lead: lead, Reentry: strings.HasPrefix(name, "reentry"), AssignedUserName: "Outro corretor", DistributionOutcome: CreateDistributionOutcomeAssigned})
			assertCreationReceipt(t, response)
		})
	}
}

func TestCreateResponseUsesFinalReadPermissionAndOrganization(t *testing.T) {
	lead := creationFixture()
	lead.TeamID = "team-b"
	for _, tt := range []struct {
		name    string
		viewer  tenant.Context
		visible bool
	}{
		{"own assigned lead", tenant.Context{OrganizationID: creationOrganizationID, UserID: "other-user", Permissions: []string{permissions.LeadViewOwn}}, true},
		{"same assignee without own view", tenant.Context{OrganizationID: creationOrganizationID, UserID: "other-user", Permissions: []string{permissions.LeadCreate}}, false},
		{"all view", tenant.Context{OrganizationID: creationOrganizationID, UserID: "auditor", Permissions: []string{permissions.LeadViewAll}}, true},
		{"led broker cross team remains readable", tenant.Context{OrganizationID: creationOrganizationID, UserID: "leader", Permissions: []string{permissions.LeadViewTeam}, LedUserIDs: []string{"other-user"}, LedTeamIDs: []string{"team-a"}}, true},
		{"historical team cannot reveal outsider", tenant.Context{OrganizationID: creationOrganizationID, UserID: "leader", Permissions: []string{permissions.LeadViewTeam}, LedTeamIDs: []string{"team-b"}}, false},
		{"other organization even with all view", tenant.Context{OrganizationID: "55555555-5555-4555-8555-555555555555", UserID: "auditor", Permissions: []string{permissions.LeadViewAll}}, false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			response := createLeadResponse(tt.viewer, CreateResult{Lead: lead, AssignedUserName: "Outro corretor", DistributionOutcome: CreateDistributionOutcomeAssigned})
			if response.LeadVisible != tt.visible {
				t.Fatalf("leadVisible=%v, want %v", response.LeadVisible, tt.visible)
			}
			if !tt.visible {
				if tt.viewer.OrganizationID != lead.OrganizationID {
					if response.Data != nil || response.LeadID != "" || response.AssignedUserName != "" {
						t.Fatal("cross-organization response must expose neither data nor receipt ID")
					}
					return
				}
				assertCreationReceipt(t, response)
				return
			}
			if response.Data == nil || response.Data.Email != lead.Email || response.Data.ID != lead.ID {
				t.Fatal("visible lead must preserve its actual response")
			}
		})
	}
}

func TestCreateSnapshotFailureCannotCommit(t *testing.T) {
	readFailure := errors.New("synthetic scan failure")
	for _, tt := range []struct {
		name string
		row  leadCreationRow
		want error
	}{
		{"query failure", leadCreationRow{err: readFailure}, readFailure},
		{"missing row", leadCreationRow{err: pgx.ErrNoRows}, ErrLeadNotFound},
		{"other organization row", leadCreationRow{lead: Lead{ID: creationLeadID, OrganizationID: "55555555-5555-4555-8555-555555555555"}}, ErrLeadNotFound},
		{"different lead row", leadCreationRow{lead: Lead{ID: "66666666-6666-4666-8666-666666666666", OrganizationID: creationOrganizationID}}, ErrLeadNotFound},
	} {
		t.Run(tt.name, func(t *testing.T) {
			tx := &leadCreationTx{row: tt.row}
			lead, err := commitLeadCreation(context.Background(), tx, tenant.Context{OrganizationID: creationOrganizationID}, creationLeadID)
			if !errors.Is(err, tt.want) || lead.ID != "" || tx.committed || !reflect.DeepEqual(tx.sequence, []string{"read"}) {
				t.Fatalf("read error must leave caller's rollback path intact: lead=%v, err=%v, sequence=%v", lead.ID, err, tx.sequence)
			}
			if len(tx.args) < 2 || tx.args[0] != creationOrganizationID || tx.args[1] != creationLeadID || !strings.Contains(tx.query, "l.organization_id = $1::uuid") {
				t.Fatal("snapshot query must constrain organization and lead independently of read scope")
			}
		})
	}
}

func TestCreateCommitFailureCannotReturnSuccess(t *testing.T) {
	want := errors.New("synthetic commit failure")
	tx := &leadCreationTx{row: leadCreationRow{lead: creationFixture()}, commitError: want}
	lead, err := commitLeadCreation(context.Background(), tx, tenant.Context{OrganizationID: creationOrganizationID}, creationLeadID)
	if !errors.Is(err, want) || lead.ID != "" || tx.committed || !reflect.DeepEqual(tx.sequence, []string{"read", "commit"}) {
		t.Fatalf("commit failure must return no success snapshot: lead=%v, err=%v, sequence=%v", lead.ID, err, tx.sequence)
	}
}

func assertCreationReceipt(t *testing.T, response CreateResponse) {
	t.Helper()
	if response.Data != nil || response.LeadVisible || response.LeadID != creationLeadID || response.AssignedUserName != "" {
		t.Fatalf("unexpected limited receipt: %#v", response)
	}
	encoded, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(encoded, &payload); err != nil {
		t.Fatal(err)
	}
	for key := range payload {
		switch key {
		case "data", "leadId", "leadVisible", "reentry", "distributionOutcome":
		default:
			t.Fatalf("receipt exposed unexpected field %q", key)
		}
	}
	if payload["data"] != nil || strings.Contains(string(encoded), "Conteúdo protegido") || strings.Contains(string(encoded), "synthetic@example.com") {
		t.Fatal("out-of-scope receipt must not serialize protected lead contents")
	}
}
