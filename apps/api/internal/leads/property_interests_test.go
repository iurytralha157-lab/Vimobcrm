package leads

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func propertyInterestsSnapshot() leadSnapshot {
	a, b := pipelinePostgresID(901), pipelinePostgresID(902)
	return leadSnapshot{ID: pipelinePostgresID(900), PropertyID: a, InterestPropertyID: a, DealStatus: "open",
		Data: map[string]any{"property_id": a, "interest_property_id": a, "metadata": map[string]any{"interestPropertyIds": []any{a, b}}}}
}

func propertyInterestsInput(t *testing.T, body string) updateInput {
	t.Helper()
	var request UpdateRequest
	if err := json.Unmarshal([]byte(body), &request); err != nil {
		t.Fatal(err)
	}
	input, err := request.Validate()
	if err != nil {
		t.Fatal(err)
	}
	return input
}

func TestLeadPropertyInterestsQuickPrimaryPreservesSecondariesAndExplicitReplacements(t *testing.T) {
	current := propertyInterestsSnapshot()
	a, b, c := current.PropertyID, pipelinePostgresID(902), pipelinePostgresID(903)
	for _, scenario := range []struct {
		name, body, primary string
		want                []string
		added, removed      int
	}{
		{"quick primary keeps every interest", `{"propertyId":"` + c + `","interestPropertyId":"` + c + `"}`, c, []string{c, a, b}, 1, 0},
		{"one primary alias follows same contract", `{"interestPropertyId":"` + c + `"}`, c, []string{c, a, b}, 1, 0},
		{"commercial primary alias is not masked by the old interest link", `{"propertyId":"` + c + `"}`, c, []string{c, a, b}, 1, 0},
		{"explicit list removal also selects first remaining", `{"interestPropertyIds":["` + b + `"]}`, b, []string{b}, 0, 1},
		{"explicit list and primary keep requested primary first", `{"propertyId":"` + c + `","interestPropertyIds":["` + b + `","` + c + `"]}`, c, []string{c, b}, 1, 1},
		{"clear list clears both effective links", `{"interestPropertyIds":[]}`, "", []string{}, 0, 2},
		{"clear both aliases cannot revive old metadata", `{"propertyId":null,"interestPropertyId":null}`, "", []string{}, 0, 2},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			input := propertyInterestsInput(t, scenario.body)
			change, err := normalizeLeadPropertyInterests(current, &input)
			if err != nil || change == nil {
				t.Fatalf("normalize change=%#v error=%v", change, err)
			}
			if !reflect.DeepEqual(input.InterestPropertyIDs.Value, scenario.want) || selectedLeadPropertyID(current, input) != scenario.primary {
				t.Fatalf("primary/list disagreement: %#v", input)
			}
			if change.Added != scenario.added || change.Removed != scenario.removed || !isUUID(change.OperationID) {
				t.Fatalf("change receipt=%#v", change)
			}
			if !reflect.DeepEqual(input.Metadata["interestPropertyIds"], scenario.want) {
				t.Fatal("effective collection was not persisted into metadata")
			}
		})
	}
}

func TestLeadPropertyInterestsRejectAmbiguousAliasesAndOverflowWithoutDroppingAnInterest(t *testing.T) {
	current := propertyInterestsSnapshot()
	a, c := current.PropertyID, pipelinePostgresID(903)
	for _, body := range []string{
		`{"propertyId":"` + a + `","interestPropertyId":"` + c + `"}`,
		`{"propertyId":null,"interestPropertyId":null,"interestPropertyIds":["` + a + `"]}`,
	} {
		input := propertyInterestsInput(t, body)
		if _, err := normalizeLeadPropertyInterests(current, &input); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("ambiguous payload was accepted: %v", err)
		}
	}
	ids := []any{}
	for id := 901; id < 921; id++ {
		ids = append(ids, pipelinePostgresID(id))
	}
	current.Data["metadata"] = map[string]any{"interestPropertyIds": ids}
	input := propertyInterestsInput(t, `{"propertyId":"`+pipelinePostgresID(999)+`"}`)
	if _, err := normalizeLeadPropertyInterests(current, &input); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("full collection silently lost an interest: %v", err)
	}
}

func TestLeadPropertyInterestsNoopAndUnrelatedEditsDoNotInventAnEvent(t *testing.T) {
	current := propertyInterestsSnapshot()
	for _, body := range []string{`{"name":"Other contact name"}`, `{"propertyId":"` + current.PropertyID + `"}`} {
		input := propertyInterestsInput(t, body)
		if change, err := normalizeLeadPropertyInterests(current, &input); err != nil || change != nil {
			t.Fatalf("unchanged collection invented an event: change=%#v err=%v", change, err)
		}
		if input.Name.Set && (input.MetadataSet || input.PropertyID.Set || input.InterestPropertyIDs.Set) {
			t.Fatal("ordinary contact edit rewrote property metadata")
		}
	}
}

func TestLeadPropertyInterestsSecondaryEditNeverRelinksTheReservedLegacyPrimary(t *testing.T) {
	current := propertyInterestsSnapshot()
	current.PropertyID, current.DealStatus = "", "won"
	current.Data["property_id"] = nil
	input := propertyInterestsInput(t, `{"interestPropertyIds":["`+current.InterestPropertyID+`"]}`)
	change, err := normalizeLeadPropertyInterests(current, &input)
	if err != nil || change == nil || input.PropertyID.Set || input.InterestPropertyID.Set || leadPropertyLinkChanged(current, input) {
		t.Fatalf("secondary removal rewrote a won lead's existing primary: %#v, %v", input, err)
	}
}

func TestLeadPropertyInterestsAuditRecordsSecondaryChangesWithoutPublicIdentifiers(t *testing.T) {
	current := propertyInterestsSnapshot()
	input := propertyInterestsInput(t, `{"interestPropertyIds":["`+current.PropertyID+`"]}`)
	change, err := normalizeLeadPropertyInterests(current, &input)
	if err != nil || change == nil {
		t.Fatal(err)
	}
	before, after := changedLeadAuditData(current.Data, input.auditData())
	if !reflect.DeepEqual(before["interest_property_ids"], change.Before) || !reflect.DeepEqual(after["interest_property_ids"], change.After) {
		t.Fatalf("secondary IDs missing from private audit: before=%#v after=%#v", before, after)
	}
	logs := []map[string]any{{"old_data": before, "new_data": after}}
	redactLeadHistoryAuditLogs(logs)
	publicJSON, _ := json.Marshal(logs)
	if strings.Contains(string(publicJSON), "interest_property_ids") || strings.Contains(string(publicJSON), pipelinePostgresID(902)) {
		t.Fatal("private secondary property identifiers escaped into public audit history")
	}
	actor := tenant.Context{OrganizationID: pipelinePostgresID(990), UserID: pipelinePostgresID(991)}
	tx := &propertyInterestsActivityTx{}
	if err := (Repository{}).insertLeadPropertyInterestsActivity(context.Background(), tx, actor, current.ID, change); err != nil {
		t.Fatal(err)
	}
	if len(tx.args) != 6 || tx.args[0] != actor.OrganizationID || tx.args[1] != current.ID || tx.args[2] != actor.UserID || tx.args[3] != "property_interests_changed" {
		t.Fatalf("activity lost tenant/lead/actor: %#v", tx.args)
	}
	metadata := tx.args[5].(string)
	if strings.Contains(metadata, current.PropertyID) || strings.Contains(metadata, pipelinePostgresID(902)) || !strings.Contains(metadata, change.OperationID) || !strings.Contains(metadata, `"removed_count":1`) {
		t.Fatalf("activity must contain counts and operation identity only: %s", metadata)
	}
	tx.failure = errors.New("synthetic activity failure")
	if err := (Repository{}).insertLeadPropertyInterestsActivity(context.Background(), tx, actor, current.ID, change); !errors.Is(err, tx.failure) {
		t.Fatal("activity failure was swallowed instead of rolling back its caller")
	}
}

func TestLeadPropertyInterestsRetainedLinksDoNotGrantNewPropertyAccess(t *testing.T) {
	current := propertyInterestsSnapshot()
	actor := tenant.Context{OrganizationID: pipelinePostgresID(990), UserID: pipelinePostgresID(991), Permissions: []string{permissions.LeadOperate}}
	input := propertyInterestsInput(t, `{"interestPropertyIds":["`+current.PropertyID+`","`+pipelinePostgresID(902)+`"]}`)
	if _, err := normalizeLeadPropertyInterests(current, &input); err != nil {
		t.Fatal(err)
	}
	tx := &propertyReferenceScopeTx{exists: true}
	if err := (Repository{}).validateUpdatePropertyReferences(context.Background(), tx, actor, current, input); err != nil {
		t.Fatalf("preserving tenant-owned interests required unrelated new access: %v", err)
	}
	input = propertyInterestsInput(t, `{"propertyId":"`+pipelinePostgresID(903)+`"}`)
	if _, err := normalizeLeadPropertyInterests(current, &input); err != nil {
		t.Fatal(err)
	}
	if err := (Repository{}).validateUpdatePropertyReferences(context.Background(), tx, actor, current, input); !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("new hidden property bypassed scope: %v", err)
	}
	missing := &propertyReferenceScopeTx{exists: false}
	if err := (Repository{}).validateUpdatePropertyReferences(context.Background(), missing, actor, current, updateInput{InterestPropertyIDs: patchStringSlice{Set: true, Value: []string{current.PropertyID}}}); !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("retaining a foreign/missing interest bypassed tenant existence: %v", err)
	}
}

type propertyInterestsActivityTx struct {
	pgx.Tx
	args    []any
	failure error
}

func (tx *propertyInterestsActivityTx) Exec(_ context.Context, _ string, args ...any) (pgconn.CommandTag, error) {
	tx.args = args
	return pgconn.NewCommandTag("INSERT 0 1"), tx.failure
}
