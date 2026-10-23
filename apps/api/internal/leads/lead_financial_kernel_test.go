package leads

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/propertyscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestLeadFinancialRepositoryRejectsInvalidExplicitValuesBeforePool(t *testing.T) {
	actor := tenant.Context{OrganizationID: historyPageTestOrg, UserID: creationLeadID, MemberRole: "member", Permissions: []string{permissions.LeadCreate}}
	for _, raw := range []string{"NaN", "-1", "0x1p2", "1e-9999999", strings.Repeat("0", 41)} {
		t.Run(raw, func(t *testing.T) {
			// A zero Repository has no pool. Returning this error proves that a
			// direct internal caller cannot bypass validation and reach the DB.
			_, err := (Repository{}).Create(context.Background(), actor, createInput{Name: "Synthetic financial lead", InterestValue: &raw})
			if !errors.Is(err, ErrLeadFinancialValuesInvalid) {
				t.Fatal("Create reached storage or lost its financial error", err)
			}
			_, err = (Repository{}).Update(context.Background(), actor, creationLeadID, updateInput{InterestValue: patchString{Set: true, Value: &raw}})
			if !errors.Is(err, ErrLeadFinancialValuesInvalid) {
				t.Fatal("Update reached storage or lost its financial error", err)
			}
		})
	}
	percentage := "100.0000000000000000001"
	if _, err := (Repository{}).Update(context.Background(), actor, creationLeadID, updateInput{CommissionPercentage: patchString{Set: true, Value: &percentage}}); !errors.Is(err, ErrLeadFinancialValuesInvalid) {
		t.Fatal("direct percentage update bypassed its exact bound", err)
	}
	actor.Permissions = nil
	bad := "NaN"
	if _, err := (Repository{}).Create(context.Background(), actor, createInput{InterestValue: &bad}); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatal("financial checks replaced the creation authorization gate", err)
	}
}

type leadFinancialPropertyTx struct {
	pgx.Tx
	price, percentage pgtype.Text
	query             string
	args              []any
	reads             int
	err               error
}

func (tx *leadFinancialPropertyTx) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	tx.query, tx.args = query, args
	tx.reads++
	return leadFinancialPropertyRow{tx}
}

type leadFinancialPropertyRow struct{ tx *leadFinancialPropertyTx }

func (row leadFinancialPropertyRow) Scan(values ...any) error {
	if row.tx.err != nil {
		return row.tx.err
	}
	*values[0].(*pgtype.Text), *values[1].(*pgtype.Text) = row.tx.price, row.tx.percentage
	return nil
}

func leadFinancialPropertyActor() tenant.Context {
	return tenant.Context{OrganizationID: historyPageTestOrg, UserID: creationLeadID, MemberRole: "member", Permissions: []string{permissions.PropertyManage}}
}

func TestLeadFinancialSelectedPropertyRejectsInvalidCanonicalValues(t *testing.T) {
	actor := leadFinancialPropertyActor()
	for _, scenario := range []struct{ name, price, percentage string }{
		{"nonfinite price", "NaN", "5"}, {"negative price", "-650000", "5"},
		{"underflow price", "1e-9999", "5"}, {"nonfinite commission", "650000", "Infinity"},
		{"negative commission", "650000", "-0.1"}, {"excess commission", "650000", "150"},
		{"exact excess commission", "650000", "100." + strings.Repeat("0", 90) + "1"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			tx := &leadFinancialPropertyTx{price: pgtype.Text{String: scenario.price, Valid: true}, percentage: pgtype.Text{String: scenario.percentage, Valid: true}}
			propertyID := creationLeadID
			input := updateInput{PropertyID: patchString{Set: true, Value: &propertyID}}
			err := (Repository{}).applySelectedPropertyCommercialValues(context.Background(), tx, actor, leadSnapshot{}, &input)
			if !errors.Is(err, ErrLeadFinancialValuesInvalid) || tx.reads != 1 {
				t.Fatal("canonical property values bypassed the pre-write financial contract", err)
			}
			if tx.args[0] != actor.OrganizationID || tx.args[1] != propertyID || !strings.Contains(tx.query, propertyscope.VisibilitySQL("property", "$3", "$4", "$5")) {
				t.Fatal("source guard lost the existing organization/property scope")
			}
		})
	}
}

func TestLeadFinancialSelectedPropertyPreservesPrecisionAndNoopBehavior(t *testing.T) {
	actor := leadFinancialPropertyActor()
	propertyID := creationLeadID
	price, percentage := "650000."+strings.Repeat("1", 90), "7."+strings.Repeat("5", 90)
	tx := &leadFinancialPropertyTx{price: pgtype.Text{String: price, Valid: true}, percentage: pgtype.Text{String: percentage, Valid: true}}
	input := updateInput{PropertyID: patchString{Set: true, Value: &propertyID}}
	if err := (Repository{}).applySelectedPropertyCommercialValues(context.Background(), tx, actor, leadSnapshot{}, &input); err != nil || *input.InterestValue.Value != price || *input.CommissionPercentage.Value != percentage {
		t.Fatal("canonical property values were truncated or rejected by wire limits", err)
	}
	for _, mode := range []string{"no property patch", "same property", "detach"} {
		t.Run(mode, func(t *testing.T) {
			input, current := updateInput{}, leadSnapshot{PropertyID: propertyID, InterestValue: "NaN", DealStatus: "won"}
			if mode == "same property" {
				input.PropertyID = patchString{Set: true, Value: &propertyID}
			} else if mode == "detach" {
				input.PropertyID = patchString{Set: true}
			}
			tx := &leadFinancialPropertyTx{}
			if err := (Repository{}).applySelectedPropertyCommercialValues(context.Background(), tx, actor, current, &input); err != nil || tx.reads != 0 {
				t.Fatal("unrelated legacy state began blocking or querying", err)
			}
			if mode == "detach" && (!input.InterestValue.Set || input.InterestValue.Value != nil || !input.CommissionPercentage.Set || input.CommissionPercentage.Value != nil) {
				t.Fatal("detach stopped clearing its commercial fields")
			}
		})
	}
}

func TestLeadFinancialSelectedPropertyPreservesViewerAndMissingScope(t *testing.T) {
	actor := leadFinancialPropertyActor()
	actor.Permissions = []string{permissions.PropertyView}
	propertyID := creationLeadID
	input := updateInput{PropertyID: patchString{Set: true, Value: &propertyID}}
	tx := &leadFinancialPropertyTx{price: pgtype.Text{String: "650000", Valid: true}}
	if err := (Repository{}).applySelectedPropertyCommercialValues(context.Background(), tx, actor, leadSnapshot{}, &input); err != nil || input.CommissionPercentage.Set || !strings.Contains(tx.query, "null::text") || strings.Contains(tx.query, "property.commission_percentage") {
		t.Fatal("source validation exposed managed commission to a scoped viewer", err)
	}
	tx = &leadFinancialPropertyTx{err: pgx.ErrNoRows}
	input = updateInput{PropertyID: patchString{Set: true, Value: &propertyID}}
	if err := (Repository{}).applySelectedPropertyCommercialValues(context.Background(), tx, actor, leadSnapshot{}, &input); !errors.Is(err, ErrInvalidReference) || input.InterestValue.Set || input.CommissionPercentage.Set {
		t.Fatal("missing/hidden property no longer fails before copying values", err)
	}
}
