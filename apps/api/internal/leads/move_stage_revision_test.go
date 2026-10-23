package leads

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const moveRevisionOrg = "11111111-1111-4111-8111-111111111111"
const moveRevisionLead = "22222222-2222-4222-8222-222222222222"
const moveRevisionStage = "33333333-3333-4333-8333-333333333333"
const moveRevisionDestination = "44444444-4444-4444-8444-444444444444"

// Exercise the production snapshot reader and gate without opening a connection.
// Only the locked snapshot and its separate post-lock pool check are allowed;
// any other read/write panics through the embedded, nil pgx.Tx.
type moveRevisionTx struct {
	pgx.Tx
	organization string
	status       string
	updatedAt    any
	reads        int
	poolReads    int
	poolAccess   *bool
}

func (tx *moveRevisionTx) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	if strings.Contains(query, "select private.queue_pool_read_access") {
		if tx.reads != 1 || tx.poolReads != 0 || len(args) != 3 || args[0] != tx.organization || args[1] != moveRevisionLead {
			panic("move pool authorization must follow the exact tenant lead lock once")
		}
		actor, ok := args[2].(*string)
		if !ok || actor != nil {
			panic("move pool authorization must detect both visible and hidden pools")
		}
		tx.poolReads++
		return historyScopeRow{scan: func(dest ...any) error {
			*dest[0].(**bool) = tx.poolAccess
			return nil
		}}
	}
	tx.reads++
	if tx.reads != 1 || !strings.Contains(query, "where l.organization_id = $1::uuid") ||
		!strings.Contains(query, "and l.id = $2::uuid") || !strings.Contains(query, "for no key update of l") {
		panic("move gate must only read the tenant-scoped locked snapshot")
	}
	return moveRevisionRow{tx: tx, found: len(args) == 2 && args[0] == tx.organization && args[1] == moveRevisionLead}
}

type moveRevisionRow struct {
	tx    *moveRevisionTx
	found bool
}

func (row moveRevisionRow) Scan(dest ...any) error {
	if !row.found {
		return pgx.ErrNoRows
	}
	*dest[0].(*string) = moveRevisionLead
	*dest[1].(*pgtype.Text) = pgtype.Text{}
	*dest[2].(*string) = "Synthetic lead"
	for _, index := range []int{3, 4, 5, 7, 9, 10, 11, 12, 13} {
		*dest[index].(*pgtype.Text) = pgtype.Text{}
	}
	*dest[6].(*pgtype.Text) = pgtype.Text{String: moveRevisionStage, Valid: true}
	*dest[8].(*string) = row.tx.status
	data, err := json.Marshal(map[string]any{"updated_at": row.tx.updatedAt})
	if err != nil {
		return err
	}
	*dest[14].(*[]byte) = data
	return nil
}

func moveRevisionActor() tenant.Context {
	return tenant.Context{OrganizationID: moveRevisionOrg, UserID: "synthetic-admin", MemberRole: "admin"}
}

func TestMoveStageRevisionRejectsStaleClosureInUnchangedStage(t *testing.T) {
	base := time.Date(2026, 10, 16, 12, 0, 0, 123456000, time.UTC)
	for _, status := range []string{"won", "lost"} {
		t.Run(status, func(t *testing.T) {
			// Another session closed the lead one microsecond later, in the same
			// stage. The old expectedStageId alone would still match.
			tx := &moveRevisionTx{organization: moveRevisionOrg, status: status, updatedAt: base.Add(time.Microsecond).Format(time.RFC3339Nano)}
			input := moveStageInput{StageID: moveRevisionDestination, ExpectedStageID: patchString{Set: true, Value: stringPointer(moveRevisionStage)}, ExpectedUpdatedAt: &base}
			_, err := (Repository{}).lockLeadForStageMove(context.Background(), tx, moveRevisionActor(), moveRevisionLead, input)
			if !errors.Is(err, ErrLeadChanged) || tx.reads != 1 || tx.poolReads != 1 || tx.status != status {
				t.Fatalf("stale closure must stop before effects: status=%q reads=%d err=%v", tx.status, tx.reads, err)
			}
		})
	}
}

func TestMoveStageRevisionRejectsVisibleAndHiddenPoolsBeforeRevision(t *testing.T) {
	base := time.Now().UTC()
	for _, access := range []bool{false, true} {
		tx := &moveRevisionTx{organization: moveRevisionOrg, status: "open", updatedAt: "invalid", poolAccess: &access}
		_, err := (Repository{}).lockLeadForStageMove(context.Background(), tx, moveRevisionActor(), moveRevisionLead, moveStageInput{StageID: moveRevisionDestination, ExpectedUpdatedAt: &base})
		if !errors.Is(err, tenant.ErrOrganizationAccessDenied) || tx.reads != 1 || tx.poolReads != 1 {
			t.Fatalf("pool move crossed the claim boundary: access=%t reads=%d pool_reads=%d error=%v", access, tx.reads, tx.poolReads, err)
		}
	}
}

func TestMoveStageRevisionExactComparisonAndSameStageReorder(t *testing.T) {
	base := time.Date(2026, 10, 16, 12, 0, 0, 123456000, time.UTC)
	for _, testCase := range []struct {
		name     string
		stored   any
		expected time.Time
		target   string
		conflict bool
	}{
		{"unchanged move allowed", base.Format(time.RFC3339Nano), base, moveRevisionDestination, false},
		{"same-stage reorder allowed", base.Format(time.RFC3339Nano), base, moveRevisionStage, false},
		{"stale reorder rejected", base.Add(time.Microsecond).Format(time.RFC3339Nano), base, moveRevisionStage, true},
		{"millisecond rounding rejected", base.Format(time.RFC3339Nano), base.Truncate(time.Millisecond), moveRevisionDestination, true},
		{"equivalent timezone allowed", base.In(time.FixedZone("synthetic", -10800)).Format(time.RFC3339Nano), base, moveRevisionDestination, false},
		{"missing stored revision rejected", nil, base, moveRevisionDestination, true},
		{"invalid stored revision rejected", "invalid", base, moveRevisionDestination, true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			tx := &moveRevisionTx{organization: moveRevisionOrg, status: "open", updatedAt: testCase.stored}
			current, err := (Repository{}).lockLeadForStageMove(context.Background(), tx, moveRevisionActor(), moveRevisionLead, moveStageInput{StageID: testCase.target, ExpectedUpdatedAt: &testCase.expected})
			if errors.Is(err, ErrLeadChanged) != testCase.conflict || (!testCase.conflict && (err != nil || current.StageID != moveRevisionStage)) {
				t.Fatalf("revision result: current=%+v err=%v", current, err)
			}
		})
	}
}

func TestMoveStageRevisionLegacyContractProtectsClosedLead(t *testing.T) {
	for _, status := range []string{"open", "won", "lost"} {
		for _, target := range []string{moveRevisionStage, moveRevisionDestination} {
			t.Run(status+"/"+target, func(t *testing.T) {
				tx := &moveRevisionTx{organization: moveRevisionOrg, status: status}
				_, err := (Repository{}).lockLeadForStageMove(context.Background(), tx, moveRevisionActor(), moveRevisionLead, moveStageInput{StageID: target})
				wantConflict := status != "open" && target != moveRevisionStage
				if errors.Is(err, ErrLeadChanged) != wantConflict || (!wantConflict && err != nil) {
					t.Fatalf("legacy status=%s target=%s: %v", status, target, err)
				}
			})
		}
	}
	base := time.Date(2026, 10, 16, 12, 0, 0, 123456000, time.UTC)
	for _, status := range []string{"won", "lost"} {
		tx := &moveRevisionTx{organization: moveRevisionOrg, status: status, updatedAt: base.Format(time.RFC3339Nano)}
		if _, err := (Repository{}).lockLeadForStageMove(context.Background(), tx, moveRevisionActor(), moveRevisionLead, moveStageInput{StageID: moveRevisionDestination, ExpectedUpdatedAt: &base}); err != nil {
			t.Fatalf("fresh acknowledged %s move should remain allowed: %v", status, err)
		}
	}
}

func TestMoveStageRevisionPreservesTenantPermissionAndStageGuards(t *testing.T) {
	base := time.Now().UTC()
	input := moveStageInput{StageID: moveRevisionDestination, ExpectedUpdatedAt: &base}
	for _, testCase := range []struct {
		name  string
		org   string
		actor tenant.Context
		input moveStageInput
		want  error
	}{
		{"foreign organization is not found", "55555555-5555-4555-8555-555555555555", moveRevisionActor(), input, ErrLeadNotFound},
		{"read-only cannot inspect conflict", moveRevisionOrg, tenant.Context{OrganizationID: moveRevisionOrg, UserID: "synthetic-viewer"}, input, tenant.ErrOrganizationAccessDenied},
		{"stage conflict remains distinct", moveRevisionOrg, moveRevisionActor(), moveStageInput{StageID: moveRevisionDestination, ExpectedStageID: patchString{Set: true, Value: stringPointer(moveRevisionDestination)}}, ErrLeadStageChanged},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			tx := &moveRevisionTx{organization: testCase.org, status: "won", updatedAt: "invalid"}
			_, err := (Repository{}).lockLeadForStageMove(context.Background(), tx, testCase.actor, moveRevisionLead, testCase.input)
			if !errors.Is(err, testCase.want) {
				t.Fatalf("guard order: got %v, want %v", err, testCase.want)
			}
		})
	}
}

func TestMoveStageRevisionRequestAndHTTPConflict(t *testing.T) {
	var request MoveStageRequest
	decoder := json.NewDecoder(strings.NewReader(`{"stageId":"` + moveRevisionDestination + `","expectedUpdatedAt":"2026-10-16T12:00:00.123456Z"}`))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		t.Fatal(err)
	}
	input, err := request.Validate()
	if err != nil || input.ExpectedUpdatedAt == nil || input.ExpectedUpdatedAt.Nanosecond() != 123456000 {
		t.Fatalf("exact revision lost in request: %+v %v", input, err)
	}
	zero := time.Time{}
	if _, err := (MoveStageRequest{StageID: moveRevisionDestination, ExpectedUpdatedAt: &zero}).Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("zero revision accepted: %v", err)
	}
	if err := json.Unmarshal([]byte(`{"expectedUpdatedAt":"malformed"}`), &request); err == nil {
		t.Fatal("malformed timestamp accepted")
	}
	if _, err := (MoveStageRequest{StageID: moveRevisionDestination}).Validate(); err != nil {
		t.Fatalf("legacy request rejected before locked status can be checked: %v", err)
	}
	response := httptest.NewRecorder()
	writeLeadError(response, httptest.NewRequest(http.MethodPost, "/v1/leads/synthetic/move-stage", nil), ErrLeadChanged)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), `"code":"lead_changed"`) {
		t.Fatalf("revision conflict must remain 409 lead_changed: %d %s", response.Code, response.Body.String())
	}
}

func TestMoveStageRevisionGatePrecedesEverySideEffect(t *testing.T) {
	raw, err := os.ReadFile("move_stage_transaction.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) moveStageTx(")
	end := len(source) - start
	if start < 0 || end < 0 {
		t.Fatal("could not isolate MoveStage")
	}
	move := source[start : start+end]
	gate := strings.Index(move, "repo.lockLeadForStageMove(")
	for _, effect := range []string{"repo.resolveMoveStageDestination(", "repo.resolveMoveStageDealStatus(", "repo.lockWonLeadPropertyForUpdate(", "update public.leads", "repo.reserveWonLeadProperty(", "repo.releaseReopenedLeadProperty(", "repo.insertDealStatusActivities(", "repo.enqueueDealWonNotifications(", "insert into public.audit_logs"} {
		if position := strings.Index(move, effect); gate < 0 || position <= gate {
			t.Fatalf("revision gate must precede %s", effect)
		}
	}
	if strings.Contains(move, "tx.Commit(") {
		t.Fatal("transaction kernel must not commit before caller's ledger")
	}
	wrapper, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	wrapperSource := string(wrapper)
	wrapperStart := strings.Index(wrapperSource, "func (repo Repository) MoveStage(")
	if wrapperStart < 0 {
		t.Fatal("manual wrapper missing")
	}
	wrapperSource = wrapperSource[wrapperStart:]
	wrapperEnd := strings.Index(wrapperSource, "func (repo Repository) Assign(")
	if wrapperEnd < 0 {
		t.Fatal("manual wrapper boundary missing")
	}
	wrapperSource = wrapperSource[:wrapperEnd]
	kernel, commit := strings.Index(wrapperSource, "repo.moveStageTx("), strings.Index(wrapperSource, "tx.Commit(ctx)")
	if kernel < 0 || commit <= kernel {
		t.Fatal("manual commit must follow the guarded transaction kernel")
	}
}
