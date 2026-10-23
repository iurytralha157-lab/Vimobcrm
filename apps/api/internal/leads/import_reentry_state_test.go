package leads

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type importReentryStateRow struct {
	organizationID, leadID string
	values                 [8]pgtype.Text
	err                    error
}

func (row importReentryStateRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	*dest[0].(*string) = row.leadID
	*dest[1].(*string) = row.organizationID
	for index, value := range row.values {
		*dest[index+2].(*pgtype.Text) = value
	}
	return nil
}

type importReentryStateQueryer struct {
	row        importReentryStateRow
	query      string
	args       []any
	requestCtx context.Context
}

func (queryer *importReentryStateQueryer) QueryRow(ctx context.Context, query string, args ...any) pgx.Row {
	queryer.query, queryer.args, queryer.requestCtx = query, args, ctx
	return queryer.row
}

func TestImportReentryStateKeepsCommercialReferencesIndependentOfPropertyReadScope(t *testing.T) {
	const leadID = "88888888-8888-4888-8888-888888888888"
	for _, status := range []string{"open", "won", "lost"} {
		t.Run(status, func(t *testing.T) {
			values := [8]pgtype.Text{}
			for index, value := range []string{
				"11111111-1111-4111-8111-111111111112",
				"11111111-1111-4111-8111-111111111113",
				"Original stage", "55555555-5555-4555-8555-555555555555",
				"PRIVATE-PROPERTY", "750000", "Original lost reason", status,
			} {
				values[index] = pgtype.Text{String: value, Valid: true}
			}
			queryer := &importReentryStateQueryer{row: importReentryStateRow{
				organizationID: importDistributionOrganizationID, leadID: leadID, values: values,
			}}
			ctx := context.Background()
			state, err := loadImportReentryState(ctx, queryer, importDistributionOrganizationID, leadID)
			if err != nil {
				t.Fatal(err)
			}
			actual := []*string{state.PipelineID, state.StageID, state.StageName, state.PropertyID,
				state.PropertyCode, state.InterestValue, state.LostReason}
			for index, value := range actual {
				if value == nil || *value != values[index].String {
					t.Fatalf("commercial field %d was filtered or changed: %v", index, value)
				}
			}
			if state.DealStatus != status || queryer.requestCtx != ctx ||
				!reflect.DeepEqual(queryer.args, []any{importDistributionOrganizationID, leadID}) {
				t.Fatal("commercial snapshot changed status, transaction context or organization/lead arguments")
			}
			query := strings.Join(strings.Fields(queryer.query), " ")
			for _, expected := range []string{
				"where l.organization_id = $1::uuid", "and l.id = $2::uuid",
				"s.organization_id = l.organization_id", "coalesce(l.interest_property_id, l.property_id)::text",
			} {
				if !strings.Contains(query, expected) {
					t.Fatalf("missing commercial scope/reference guard %q: %s", expected, query)
				}
			}
			for _, forbidden := range []string{"visible_property", "public.properties", "metadata", "cpf", "assigned_user_id"} {
				if strings.Contains(query, forbidden) {
					t.Fatalf("private commercial history query included unrelated or caller-filtered field %q", forbidden)
				}
			}
		})
	}
}

func TestImportReentryStatePreservesNullReferences(t *testing.T) {
	const leadID = "88888888-8888-4888-8888-888888888888"
	queryer := &importReentryStateQueryer{row: importReentryStateRow{
		organizationID: importDistributionOrganizationID, leadID: leadID,
	}}
	state, err := loadImportReentryState(context.Background(), queryer, importDistributionOrganizationID, leadID)
	if err != nil || !reflect.DeepEqual(state, importReentryState{DealStatus: "open"}) {
		t.Fatalf("null commercial state changed: state=%+v error=%v", state, err)
	}
}

func TestImportReentryStateRejectsMissingMismatchedAndFailedRows(t *testing.T) {
	const leadID = "88888888-8888-4888-8888-888888888888"
	failure := errors.New("synthetic query error")
	for _, test := range []struct {
		name string
		row  importReentryStateRow
		want error
	}{
		{"missing row", importReentryStateRow{err: pgx.ErrNoRows}, ErrLeadNotFound},
		{"different organization", importReentryStateRow{organizationID: "99999999-9999-4999-8999-999999999999", leadID: leadID}, ErrLeadNotFound},
		{"different lead", importReentryStateRow{organizationID: importDistributionOrganizationID, leadID: "99999999-9999-4999-8999-999999999999"}, ErrLeadNotFound},
		{"query error", importReentryStateRow{err: failure}, failure},
		{"request canceled", importReentryStateRow{err: context.Canceled}, context.Canceled},
	} {
		t.Run(test.name, func(t *testing.T) {
			queryer := &importReentryStateQueryer{row: test.row}
			state, err := loadImportReentryState(context.Background(), queryer, importDistributionOrganizationID, leadID)
			if !errors.Is(err, test.want) || !reflect.DeepEqual(state, importReentryState{}) {
				t.Fatalf("unexpected rejected commercial state: state=%+v error=%v want=%v", state, err, test.want)
			}
		})
	}
}
