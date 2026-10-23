package leads

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestManualDuplicateRequiresOperateEvenWhenActorCanCreateAndViewOwn(t *testing.T) {
	ctx := tenant.Context{UserID: "actor", OrganizationID: "org", Permissions: []string{permissions.LeadCreate, permissions.LeadViewOwn}}
	lead := existingLeadMatch{ID: "lead", AssignedUserID: "actor"}
	if err := authorizeLeadReentry(ctx, createInput{}, lead); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("create/view-only actor must not modify existing contact: %v", err)
	}
	ctx.Permissions = append(ctx.Permissions, permissions.LeadOperate)
	if err := authorizeLeadReentry(ctx, createInput{}, lead); err != nil {
		t.Fatal(err)
	}
	lead.AssignedUserID = "other"
	if err := authorizeLeadReentry(ctx, createInput{}, lead); !errors.Is(err, ErrLeadAlreadyExists) {
		t.Fatalf("operate must not widen the resource boundary: %v", err)
	}
}

func TestImportReentryRetainsSeparatelyAuthorizedImportPermission(t *testing.T) {
	ctx := tenant.Context{UserID: "actor", OrganizationID: "org", Permissions: []string{permissions.LeadImport, permissions.LeadViewOwn}}
	if err := authorizeLeadReentry(ctx, createInput{ImportMode: true}, existingLeadMatch{AssignedUserID: "actor"}); err != nil {
		t.Fatal(err)
	}
}

func TestManualReentryPreservesCommercialStateAndMissingOptionalContactData(t *testing.T) {
	for _, status := range []string{"open", "lost", "won"} {
		t.Run(status, func(t *testing.T) {
			executor := &importReentryCaptureExecutor{tag: pgconn.NewCommandTag("UPDATE 1")}
			input := createInput{Name: "Contact", DealStatus: status, StageID: stringPointer("new-stage"), PropertyID: stringPointer("new-property")}
			if err := applyConservativeLeadReentry(context.Background(), executor, "org", "lead", input); err != nil {
				t.Fatal(err)
			}
			if executor.args[0] != "org" || executor.args[1] != "lead" || executor.args[3] != nil || executor.args[4] != nil {
				t.Fatalf("unscoped or destructive contact update: %#v", executor.args)
			}
			for _, protected := range []string{"deal_status =", "stage_id =", "pipeline_id =", "lost_at =", "won_at =", "assigned_user_id =", "property_id =", "valor_interesse =", "board_order_at ="} {
				if strings.Contains(executor.query, protected) {
					t.Fatalf("implicit duplicate changes %s", protected)
				}
			}
		})
	}
}

func TestManualAutomaticQueueKeepsSelectedTagsWithoutQueueMatch(t *testing.T) {
	const selected = "11111111-1111-4111-8111-111111111111"
	tags, err := leadIntakeTagIDs(createInput{TagIDs: []string{selected}}, nil)
	if err != nil || len(tags) != 1 || tags[0] != selected {
		t.Fatalf("selected tags lost: %v %v", tags, err)
	}
}

func TestManualClosedReentryNeverCallsDistributionThatCanMoveItsStage(t *testing.T) {
	for _, status := range []string{"lost", "won", ""} {
		if manualReentryAllowsRedistribution(createInput{DealStatus: status}) {
			t.Fatalf("closed/unknown outcome %q can be rerouted", status)
		}
	}
	if !manualReentryAllowsRedistribution(createInput{DealStatus: "open"}) {
		t.Fatal("open business lost its configured queue policy")
	}
	if manualReentryAllowsRedistribution(createInput{DealStatus: "open", ImportMode: true}) {
		t.Fatal("import can redistribute an existing business")
	}
}
