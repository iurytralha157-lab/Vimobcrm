package leads

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type creationOutcomeTestTx struct {
	pgx.Tx
	ready         bool
	reads         int
	sequence      []string
	args          [][]any
	writeError    error
	zeroRows      bool
	propertyID    string
	propertyQuery string
	propertyError error
}
type creationOutcomeTestRow struct {
	tx        *creationOutcomeTestTx
	readiness bool
	id        string
	scanError error
}

func (row creationOutcomeTestRow) Scan(values ...any) error {
	if row.scanError != nil {
		return row.scanError
	}
	if row.readiness {
		*values[0].(*bool) = row.tx.ready
	} else {
		id := row.id
		if id == "" {
			id = creationLeadID
		}
		*values[0].(*string) = id
	}
	return nil
}
func (tx *creationOutcomeTestTx) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	tx.reads++
	if strings.Contains(query, "from public.properties") {
		tx.propertyQuery = query
		tx.args = append(tx.args, args)
		return creationOutcomeTestRow{tx: tx, id: tx.propertyID, scanError: tx.propertyError}
	}
	return creationOutcomeTestRow{tx: tx, readiness: strings.Contains(query, "to_regprocedure")}
}
func (tx *creationOutcomeTestTx) Exec(_ context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	tx.args = append(tx.args, args)
	if strings.HasPrefix(query, "update public.leads") {
		tx.sequence = append(tx.sequence, "update")
	} else {
		tx.sequence = append(tx.sequence, args[2].(string))
	}
	if tx.writeError != nil {
		return pgconn.CommandTag{}, tx.writeError
	}
	if tx.zeroRows {
		return pgconn.NewCommandTag("UPDATE 0"), nil
	}
	return pgconn.NewCommandTag("UPDATE 1"), nil
}
func (*creationOutcomeTestTx) Commit(context.Context) error {
	panic("creation kernel must not commit separately from its receipt")
}

func creationOutcomeActor() tenant.Context {
	return tenant.Context{OrganizationID: creationOrganizationID, UserID: importDistributionActorID, MemberRole: "member", Permissions: []string{permissions.LeadCreate, permissions.LeadImport, permissions.LeadOperate, permissions.LeadViewOwn, permissions.PropertyView}}
}
func creationOutcomeSnapshot() leadSnapshot {
	return leadSnapshot{ID: creationLeadID, AssignedUserID: importDistributionActorID, DealStatus: "open", PropertyID: "44444444-4444-4444-8444-444444444444", Data: map[string]any{"organization_id": creationOrganizationID}}
}

func TestNewWonCreationRequiresOperateAndReadinessBeforeAnyLeadWrite(t *testing.T) {
	actor := creationOutcomeActor()
	actor.Permissions = []string{permissions.LeadCreate, permissions.LeadViewOwn}
	for _, importing := range []bool{false, true} {
		tx := &creationOutcomeTestTx{ready: true}
		_, err := prepareLeadCreationOutcome(context.Background(), tx, actor, createInput{DealStatus: "won", ImportMode: importing})
		if !errors.Is(err, tenant.ErrOrganizationAccessDenied) || tx.reads != 0 || len(tx.sequence) != 0 {
			t.Fatalf("permission bypass: %v %#v", err, tx)
		}
	}
	actor = creationOutcomeActor()
	tx := &creationOutcomeTestTx{}
	if _, err := prepareLeadCreationOutcome(context.Background(), tx, actor, createInput{DealStatus: "won"}); !errors.Is(err, ErrLeadCreationWorkflowUnavailable) || tx.reads != 1 || len(tx.sequence) != 0 {
		t.Fatalf("missing migration reached write: %v", err)
	}
	tx = &creationOutcomeTestTx{ready: true}
	out, err := prepareLeadCreationOutcome(context.Background(), tx, actor, createInput{DealStatus: "won"})
	if err != nil || out.InitialStatus != "open" || !out.Deferred || out.LeadID != creationLeadID || strings.Join(tx.sequence, ",") != "defer" {
		t.Fatalf("won was not deferred: %#v %v", out, err)
	}
	if tx.args[0][0] != actor.OrganizationID || tx.args[0][1] != creationLeadID {
		t.Fatal("guard lost exact tenant/lead scope")
	}
}

func creationOutcomeOperations(tx *creationOutcomeTestTx, before leadSnapshot, finalStatus string) leadCreationOutcomeOperations {
	reads := 0
	return leadCreationOutcomeOperations{
		snapshot: func() (leadSnapshot, error) {
			reads++
			result := before
			if reads > 1 {
				result.DealStatus = finalStatus
			}
			return result, nil
		},
		status: func(leadSnapshot) (string, error) { return finalStatus, nil },
		reserve: func(current leadSnapshot, patch updateInput) (*wonLeadPropertyReservation, error) {
			tx.sequence = append(tx.sequence, "reserve")
			if current.DealStatus != "open" || patch.DealStatus.Value == nil || *patch.DealStatus.Value != "won" {
				return nil, ErrInvalidReference
			}
			return &wonLeadPropertyReservation{PropertyID: current.PropertyID}, nil
		},
		effects: func(_ leadSnapshot, _ updateInput, reservation *wonLeadPropertyReservation) error {
			if reservation == nil {
				return ErrLeadReservationUnverified
			}
			tx.sequence = append(tx.sequence, "effects")
			return nil
		},
	}
}

func TestNewWonCreationUsesScopedCanonicalUpdateBeforeEffectsAndLeavesCommitToCaller(t *testing.T) {
	tx := &creationOutcomeTestTx{}
	actor, before := creationOutcomeActor(), creationOutcomeSnapshot()
	result, err := runLeadCreationOutcome(context.Background(), tx, actor, createInput{DealStatus: "won"}, leadCreationOutcome{LeadID: before.ID, Deferred: true}, creationOutcomeOperations(tx, before, "won"))
	if err != nil || !result.Input.DealStatus.Set || result.Before.DealStatus != "open" {
		t.Fatalf("missing transition: %#v %v", result, err)
	}
	if got := strings.Join(tx.sequence, ","); got != "reserve,apply,update,effects,done" {
		t.Fatalf("unsafe transaction sequence: %s", got)
	}
	if tx.args[1][0] != actor.OrganizationID || tx.args[1][1] != before.ID || tx.args[1][2] != "won" {
		t.Fatal("commercial update lost scope/outcome")
	}
}

func TestNewWonCreationNeverUpdatesUnavailablePropertyOrOutOfScopeLead(t *testing.T) {
	for _, scenario := range []string{"no operate", "other assignee", "foreign organization", "unavailable property", "status drift", "assignee drift", "write failure", "no updated row", "effects failure"} {
		t.Run(scenario, func(t *testing.T) {
			tx := &creationOutcomeTestTx{}
			actor, before := creationOutcomeActor(), creationOutcomeSnapshot()
			want := tenant.ErrOrganizationAccessDenied
			switch scenario {
			case "no operate":
				actor.Permissions = []string{permissions.LeadCreate, permissions.LeadViewOwn}
			case "other assignee":
				before.AssignedUserID = "other"
			case "foreign organization":
				before.Data = map[string]any{"organization_id": "foreign"}
				want = ErrInvalidReference
			case "unavailable property":
				want = ErrLeadPropertyUnavailable
			case "status drift", "assignee drift":
				want = ErrLeadChanged
			case "write failure":
				want = errors.New("synthetic write failure")
				tx.writeError = want
			case "no updated row":
				want = ErrLeadNotFound
				tx.zeroRows = true
			case "effects failure":
				want = errors.New("synthetic reservation event/outbox failure")
			}
			ops := creationOutcomeOperations(tx, before, "won")
			if scenario == "unavailable property" {
				ops.reserve = func(leadSnapshot, updateInput) (*wonLeadPropertyReservation, error) { return nil, want }
			}
			if scenario == "effects failure" {
				ops.effects = func(leadSnapshot, updateInput, *wonLeadPropertyReservation) error { return want }
			}
			if scenario == "status drift" || scenario == "assignee drift" {
				reads := 0
				ops.snapshot = func() (leadSnapshot, error) {
					reads++
					result := before
					if reads > 1 {
						result.DealStatus = "won"
						if scenario == "status drift" {
							result.DealStatus = "open"
						} else {
							result.AssignedUserID = "other"
						}
					}
					return result, nil
				}
			}
			_, err := runLeadCreationOutcome(context.Background(), tx, actor, createInput{DealStatus: "won"}, leadCreationOutcome{LeadID: before.ID, Deferred: true}, ops)
			if !errors.Is(err, want) {
				t.Fatalf("err=%v want=%v", err, want)
			}
			if scenario == "no operate" || scenario == "other assignee" || scenario == "foreign organization" || scenario == "unavailable property" {
				if len(tx.sequence) != 0 {
					t.Fatalf("unsafe write reached: %v", tx.sequence)
				}
			}
			if strings.Contains(strings.Join(tx.sequence, ","), "done") {
				t.Fatal("failed creation was finalized")
			}
		})
	}
}

func TestOpenCreationWithoutGuardPreservesLegacyButCannotCommitImplicitWon(t *testing.T) {
	tx := &creationOutcomeTestTx{}
	actor := creationOutcomeActor()
	created, err := prepareLeadCreationOutcome(context.Background(), tx, actor, createInput{DealStatus: "open"})
	if err != nil || created.Deferred || created.InitialStatus != "open" || len(tx.sequence) != 0 {
		t.Fatalf("legacy open changed: %#v %v", created, err)
	}
	for _, status := range []string{"open", "lost", "won"} {
		before := creationOutcomeSnapshot()
		before.DealStatus = status
		_, err := runLeadCreationOutcome(context.Background(), tx, actor, createInput{DealStatus: "open"}, created, creationOutcomeOperations(tx, before, status))
		if errors.Is(err, ErrLeadCreationWorkflowUnavailable) != (status == "won") {
			t.Fatalf("legacy %s unsafe outcome: %v", status, err)
		}
	}
}

func TestNewCreationStageStatusGuardIsScopedBackendOnlyAndKeepsLegacyAndAssigneeAutomation(t *testing.T) {
	raw, err := os.ReadFile("../../../../supabase/migrations/20261013033112_defer_new_lead_stage_status_until_commercial_transition.sql")
	if err != nil {
		t.Fatal(err)
	}
	source := strings.Join(strings.Fields(string(raw)), " ")
	for _, required := range []string{"security invoker", "from public, anon, authenticated", "p_organization_id is null or p_lead_id is null or p_phase is null", "p_organization_id::text || '/' || p_lead_id::text, true", "creation_scope = new.organization_id::text || '/' || new.id::text", "pg_catalog.pg_has_role(request_role, 'postgres', 'member')", "old.stage_id is not distinct from new.stage_id and not apply_status", "if scoped_creation and creation_phase = 'defer' then continue; end if;", "if apply_status then continue; end if;", "where member.organization_id = new.organization_id"} {
		if !strings.Contains(source, required) {
			t.Fatalf("guard missing %q", required)
		}
	}
	if strings.Contains(source, "historical_import_effects_suppressed()") || strings.Contains(source, "new.metadata") || strings.Contains(source, "insert into public.commissions") {
		t.Fatal("guard broadened to global suppression, browser metadata or duplicate financial workflow")
	}
	helper, err := os.ReadFile("lead_creation_outcome.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{"trigger_create_commission_on_won", "public.create_commission_on_won()", "financial_trigger.tgenabled in ('O','A')", "current_setting('session_replication_role') = 'origin'"} {
		if !strings.Contains(string(helper), required) {
			t.Fatalf("readiness does not confirm canonical financial trigger: %s", required)
		}
	}
	repository, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	start := strings.Index(string(repository), "func (repo Repository) createNewLead(")
	end := strings.Index(string(repository)[start:], "func (repo Repository) registerReentry(")
	body := string(repository)[start : start+end]
	if strings.Index(body, "prepareLeadCreationOutcome(") > strings.Index(body, "insert into public.leads") || strings.Index(body, "finishLeadCreationOutcome(") > strings.Index(body, "commitLeadImportCreation(") {
		t.Fatal("readiness/finalization escaped the creation transaction")
	}
	if !strings.Contains(body, "creation.InitialStatus,") || !strings.Contains(body, "creation.LeadID,") {
		t.Fatal("INSERT bypasses deferred status/resource scope")
	}
	if strings.Index(body, "lockLeadCreationProperty(") < 0 || strings.Index(body, "lockLeadCreationProperty(") > strings.Index(body, "insert into public.leads") {
		t.Fatal("new contenders acquire FK locks before the commercial property lock")
	}
}

func TestNewCreationPropertyLockPrecedesFKWithoutReservingAndUsesTenant(t *testing.T) {
	actor := creationOutcomeActor()
	propertyID := "44444444-4444-4444-8444-444444444444"
	for _, deferred := range []bool{false, true} {
		tx := &creationOutcomeTestTx{propertyID: propertyID}
		if err := lockLeadCreationProperty(context.Background(), tx, actor, createInput{PropertyID: &propertyID}, leadCreationOutcome{Deferred: deferred}); err != nil {
			t.Fatal(err)
		}
		for _, required := range []string{"creation_property.organization_id=$1::uuid and creation_property.id=$2::uuid", "creation_property.responsible_user_id = $4::uuid", "creation_property.created_by = $4::uuid", "leader.organization_id = creation_property.organization_id", "member_membership.membership_generation = member.membership_generation", "for update of creation_property"} {
			if !strings.Contains(tx.propertyQuery, required) {
				t.Fatalf("property lock omitted current canonical visibility: %s", required)
			}
		}
		if len(tx.args) != 1 || len(tx.args[0]) != 5 || tx.args[0][0] != actor.OrganizationID || tx.args[0][1] != propertyID || tx.args[0][2] != false || tx.args[0][3] != actor.UserID || tx.args[0][4] != false || len(tx.sequence) != 0 {
			t.Fatal("property lock mutated availability or crossed tenant/capability")
		}
	}
	tx := &creationOutcomeTestTx{propertyID: "foreign"}
	if err := lockLeadCreationProperty(context.Background(), tx, actor, createInput{PropertyID: &propertyID}, leadCreationOutcome{Deferred: true}); !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("wrong property accepted: %v", err)
	}
}

func TestNewCreationPropertyLockRechecksCurrentScopeBeforeAnyLeadWrite(t *testing.T) {
	propertyID := "44444444-4444-4444-8444-444444444444"
	for _, deferred := range []bool{false, true} {
		actor := creationOutcomeActor()
		actor.Permissions = []string{permissions.LeadCreate, permissions.LeadOperate, permissions.LeadViewOwn}
		tx := &creationOutcomeTestTx{propertyID: propertyID}
		if err := lockLeadCreationProperty(context.Background(), tx, actor, createInput{PropertyID: &propertyID}, leadCreationOutcome{Deferred: deferred}); !errors.Is(err, ErrInvalidReference) || tx.reads != 0 || len(tx.sequence) != 0 {
			t.Fatalf("own property bypassed read permission: %v %#v", err, tx)
		}
		actor = creationOutcomeActor()
		tx = &creationOutcomeTestTx{propertyError: pgx.ErrNoRows}
		if err := lockLeadCreationProperty(context.Background(), tx, actor, createInput{PropertyID: &propertyID}, leadCreationOutcome{Deferred: deferred}); !errors.Is(err, ErrInvalidReference) || tx.reads != 1 || len(tx.sequence) != 0 {
			t.Fatalf("visibility lost after prevalidation reached write: %v %#v", err, tx)
		}
	}
}

func TestNewOpenCreationWithGuardDoesNotCreateAnExtraCommercialUpdate(t *testing.T) {
	tx := &creationOutcomeTestTx{}
	before := creationOutcomeSnapshot()
	ops := creationOutcomeOperations(tx, before, "open")
	ops.reserve = func(leadSnapshot, updateInput) (*wonLeadPropertyReservation, error) {
		panic("unchanged open may not reserve")
	}
	ops.effects = func(leadSnapshot, updateInput, *wonLeadPropertyReservation) error {
		panic("unchanged open may not create effects")
	}
	_, err := runLeadCreationOutcome(context.Background(), tx, creationOutcomeActor(), createInput{DealStatus: "open"}, leadCreationOutcome{LeadID: before.ID, Deferred: true}, ops)
	if err != nil || strings.Join(tx.sequence, ",") != "done" {
		t.Fatalf("open flow changed: %v %v", err, tx.sequence)
	}
}

func TestNewWonWorkflowUnavailableHasExplicitRetryableUnmutatedContract(t *testing.T) {
	response := httptest.NewRecorder()
	writeLeadError(response, httptest.NewRequest(http.MethodPost, "/v1/leads", nil), ErrLeadCreationWorkflowUnavailable)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "lead_creation_workflow_unavailable") || !strings.Contains(response.Body.String(), "Nenhum contato foi gravado") {
		t.Fatalf("unexpected readiness contract: %d %s", response.Code, response.Body.String())
	}
}

func TestWonImportReentryWithoutOperateKeepsItsSeparatePermissionAndCommercialState(t *testing.T) {
	actor := creationOutcomeActor()
	actor.Permissions = []string{permissions.LeadImport, permissions.LeadViewOwn}
	input := createInput{Name: "Synthetic existing won", ImportMode: true, DealStatus: "won"}
	existing := existingLeadMatch{ID: creationLeadID, AssignedUserID: actor.UserID}
	if err := authorizeLeadReentry(actor, input, existing); err != nil {
		t.Fatalf("existing import was denied by new outcome gate: %v", err)
	}
	executor := &importReentryCaptureExecutor{tag: pgconn.NewCommandTag("UPDATE 1")}
	if err := applyConservativeLeadReentry(context.Background(), executor, actor.OrganizationID, existing.ID, input); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(executor.query, "deal_status =") || strings.Contains(executor.query, "stage_id =") || strings.Contains(executor.query, "property_id =") {
		t.Fatal("closed import reentry changed its commercial state")
	}
	tx := &creationOutcomeTestTx{ready: true}
	if _, err := prepareLeadCreationOutcome(context.Background(), tx, actor, input); !errors.Is(err, tenant.ErrOrganizationAccessDenied) || tx.reads != 0 {
		t.Fatal("new import win reused the reentry permission bypass")
	}
	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	start := strings.Index(string(source), "func (repo Repository) registerReentry(")
	end := strings.Index(string(source)[start:], "func (repo Repository) resolveDestination(")
	if strings.Contains(string(source)[start:start+end], "prepareLeadCreationOutcome(") {
		t.Fatal("new-creation gate leaked into reentry")
	}
}
