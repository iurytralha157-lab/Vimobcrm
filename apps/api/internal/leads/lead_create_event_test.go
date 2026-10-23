package leads

import (
	"context"
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/realtime"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestCreatedLeadHTTPReceiptAndOrganizationSubscribersCannotRevealRouting(t *testing.T) {
	hub := realtime.NewHub()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	actorEvents, unsubscribeActor := hub.Subscribe(ctx, creationOrganizationID, "actor")
	defer unsubscribeActor()
	unrelatedEvents, unsubscribeUnrelated := hub.Subscribe(ctx, creationOrganizationID, "unrelated-broker")
	defer unsubscribeUnrelated()
	foreignEvents, unsubscribeForeign := hub.Subscribe(ctx, "55555555-5555-4555-8555-555555555555", "foreign-broker")
	defer unsubscribeForeign()
	actor := tenant.Context{OrganizationID: creationOrganizationID, UserID: "actor", Permissions: []string{permissions.LeadViewOwn, permissions.LeadCreate}}
	lead := creationFixture()
	result := CreateResult{Lead: lead, AssignedUserName: "Outro corretor", Reentry: true, DistributionOutcome: CreateDistributionOutcomeAssigned}

	recorder := httptest.NewRecorder()
	httpserver.WriteJSON(recorder, http.StatusCreated, createLeadResponse(actor, result))
	if recorder.Code != http.StatusCreated {
		t.Fatalf("receipt status=%d, want 201", recorder.Code)
	}
	var response CreateResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	assertCreationReceipt(t, response)

	handler := NewHandler(Repository{}, hub)
	handler.publishLeadCreationEvent(actor, result.Lead.ID)
	for _, subscription := range []<-chan realtime.Event{actorEvents, unrelatedEvents} {
		select {
		case event := <-subscription:
			if event.Type != "lead.created" || event.OrganizationID != creationOrganizationID {
				t.Fatalf("unexpected creation invalidation: %#v", event)
			}
			if !reflect.DeepEqual(event.Data, map[string]any{"leadId": creationLeadID}) {
				t.Fatalf("organization-wide invalidation exposed lead or routing data: %#v", event.Data)
			}
		default:
			t.Fatal("creation must still invalidate organization subscribers")
		}
	}
	select {
	case event := <-foreignEvents:
		t.Fatalf("creation invalidation crossed organizations: %#v", event)
	default:
	}
}

func TestCreateHandlerUsesOnlyLimitedCreationPublication(t *testing.T) {
	file, err := parser.ParseFile(token.NewFileSet(), "handler.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	var create *ast.FuncDecl
	for _, declaration := range file.Decls {
		if function, ok := declaration.(*ast.FuncDecl); ok && function.Recv != nil && function.Name.Name == "Create" {
			create = function
		}
	}
	if create == nil {
		t.Fatal("production creation handler was not found")
	}
	publications := 0
	ast.Inspect(create.Body, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		if selector.Sel.Name == "publishLeadEvent" {
			t.Fatal("Create must not bypass the limited creation-event contract")
		}
		if selector.Sel.Name == "publishLeadCreationEvent" {
			publications++
			if len(call.Args) != 2 {
				t.Fatal("creation publication must receive only tenant and lead ID")
			}
		}
		return true
	})
	if publications != 1 {
		t.Fatalf("production Create calls limited publisher %d times, want exactly one", publications)
	}
}
