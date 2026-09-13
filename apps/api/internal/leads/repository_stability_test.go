package leads

import (
	"context"
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type nullableRequiredTextRow struct {
	textIndexes []int
}

func (row nullableRequiredTextRow) Scan(destinations ...any) error {
	for _, index := range row.textIndexes {
		if index < 0 || index >= len(destinations) {
			return fmt.Errorf("nullable text destination %d is out of range", index)
		}
		if _, ok := destinations[index].(*pgtype.Text); !ok {
			return fmt.Errorf("destination %d has type %T, want *pgtype.Text", index, destinations[index])
		}
	}

	for index, destination := range destinations {
		value := reflect.ValueOf(destination)
		if value.Kind() != reflect.Pointer || value.IsNil() {
			return fmt.Errorf("destination %d has type %T, want non-nil pointer", index, destination)
		}
		value.Elem().Set(reflect.Zero(value.Elem().Type()))
	}
	return nil
}

func TestScanPipelineBoardLeadDefaultsNullableRequiredText(t *testing.T) {
	lead, _, err := scanPipelineBoardLead(nullableRequiredTextRow{
		textIndexes: []int{4, 17}, // source and deal_status
	}, false)
	if err != nil {
		t.Fatalf("scan pipeline board lead: %v", err)
	}
	if lead.Source != "manual" {
		t.Fatalf("source = %q, want manual", lead.Source)
	}
	if lead.DealStatus != "open" {
		t.Fatalf("deal status = %q, want open", lead.DealStatus)
	}
}

func TestScanLeadDefaultsNullableRequiredText(t *testing.T) {
	lead, err := scanLead(nullableRequiredTextRow{
		textIndexes: []int{5, 6, 7}, // source, status and deal_status
	})
	if err != nil {
		t.Fatalf("scan lead: %v", err)
	}
	if lead.Source != "manual" {
		t.Fatalf("source = %q, want manual", lead.Source)
	}
	if lead.Status != "new" {
		t.Fatalf("status = %q, want new", lead.Status)
	}
	if lead.DealStatus != "open" {
		t.Fatalf("deal status = %q, want open", lead.DealStatus)
	}
}

func TestTextValueWithDefaultRejectsBlankDatabaseValues(t *testing.T) {
	if got := textValueWithDefault(pgtype.Text{String: "   ", Valid: true}, "open"); got != "open" {
		t.Fatalf("blank value = %q, want open", got)
	}
	if got := textValueWithDefault(pgtype.Text{String: "won", Valid: true}, "open"); got != "won" {
		t.Fatalf("non-blank value = %q, want won", got)
	}
}

type assignmentValidationQueryer struct {
	exists  bool
	queries int
}

func (queryer *assignmentValidationQueryer) QueryRow(context.Context, string, ...any) pgx.Row {
	queryer.queries++
	return assignmentValidationBoolRow{value: queryer.exists}
}

type assignmentValidationBoolRow struct {
	value bool
}

func (row assignmentValidationBoolRow) Scan(destinations ...any) error {
	*(destinations[0].(*bool)) = row.value
	return nil
}

func TestAssignmentValidatorsUseProvidedQueryer(t *testing.T) {
	repository := Repository{} // A pool access would panic; only the supplied queryer is valid here.
	organizationID := "11111111-1111-4111-8111-111111111111"
	userID := "22222222-2222-4222-8222-222222222222"
	teamID := "33333333-3333-4333-8333-333333333333"
	queryer := &assignmentValidationQueryer{exists: true}

	if err := repository.validateAssignedUser(context.Background(), queryer, organizationID, &userID); err != nil {
		t.Fatalf("validate assigned user: %v", err)
	}
	if err := repository.validateLeadTeam(context.Background(), queryer, tenant.Context{
		OrganizationID: organizationID,
		IsSuperAdmin:   true,
	}, &teamID); err != nil {
		t.Fatalf("validate lead team: %v", err)
	}
	if queryer.queries != 2 {
		t.Fatalf("queries = %d, want 2", queryer.queries)
	}
}

func TestTransactionalAssignmentValidationUsesCurrentTransaction(t *testing.T) {
	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository.go: %v", err)
	}
	source := string(raw)
	required := []string{
		"repo.validateAssignedUser(ctx, tx, tenantContext.OrganizationID, input.AssignedUserID.Value)",
		"repo.validateLeadTeam(ctx, tx, tenantContext, input.TeamID.Value)",
		"repo.validateAssignedUser(ctx, tx, tenantContext.OrganizationID, input.AssignedUserID)",
	}
	for _, call := range required {
		if !strings.Contains(source, call) {
			t.Fatalf("transactional validation call %q is missing", call)
		}
	}
}
