package app

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"strings"
	"testing"
)

type sourceRange struct {
	start token.Pos
	end   token.Pos
}

func TestAppBackgroundWorkerStartsUseGlobalGate(t *testing.T) {
	fileSet := token.NewFileSet()
	file, err := parser.ParseFile(fileSet, "app.go", nil, parser.AllErrors)
	if err != nil {
		t.Fatalf("parse app.go: %v", err)
	}

	var gateRanges []sourceRange
	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		key, ok := selectorKey(call.Fun)
		if !ok || (key != "backgroundWorkers.Run" && key != "backgroundWorkers.RunWithError") {
			return true
		}
		for _, argument := range call.Args {
			function, ok := argument.(*ast.FuncLit)
			if ok {
				gateRanges = append(gateRanges, sourceRange{start: function.Pos(), end: function.End()})
			}
		}
		return true
	})

	expected := map[string]int{
		"realtimeHub.Start":                                       1,
		"billingReconciler.Start":                                 1,
		"attentionRepository.StartWorker":                         1,
		"gamificationRepository.StartWorker":                      1,
		"leadsRepository.StartRedistributionWorker":               1,
		"leadsRepository.StartNotificationDispatchWorker":         1,
		"publicationsRepository.StartWorker":                      1,
		"developmentsRepository.StartReservationExpirationWorker": 1,
		"automationsRepository.StartRuntimeWorker":                1,
		"whatsappHandler.StartAIWorker":                           1,
		"whatsappHandler.StartOutboxWorker":                       1,
		"whatsappHandler.StartWebhookWorker":                      1,
		"whatsappHandler.StartSessionSupervisor":                  1,
		"metaHandler.StartWebhookWorker":                          1,
		"metaHandler.StartConversionFeedbackWorker":               1,
		"portalsRepository.StartImportReportWorker":               1,
	}
	actual := make(map[string]int, len(expected))

	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		key, ok := selectorKey(call.Fun)
		if !ok || !strings.HasPrefix(selectorMethod(call.Fun), "Start") {
			return true
		}

		actual[key]++
		if !positionInsideAny(call.Pos(), gateRanges) {
			t.Errorf("%s is not enclosed by the API background-worker gate", key)
		}
		return true
	})

	for key, want := range expected {
		if got := actual[key]; got != want {
			t.Errorf("%s startup calls = %d, want %d", key, got, want)
		}
	}
}

func TestBackgroundWorkerGlobalGateIsDocumentedEnabledByDefault(t *testing.T) {
	source, err := os.ReadFile("../../../../.env.example")
	if err != nil {
		t.Fatalf("read .env.example: %v", err)
	}
	const setting = "API_BACKGROUND_WORKERS_ENABLED=true"
	if count := strings.Count(string(source), setting); count != 1 {
		t.Fatalf(".env.example contains %q %d times, want exactly once", setting, count)
	}
}

func selectorKey(expression ast.Expr) (string, bool) {
	selector, ok := expression.(*ast.SelectorExpr)
	if !ok {
		return "", false
	}
	receiver, ok := selector.X.(*ast.Ident)
	if !ok {
		return "", false
	}
	return receiver.Name + "." + selector.Sel.Name, true
}

func selectorMethod(expression ast.Expr) string {
	selector, ok := expression.(*ast.SelectorExpr)
	if !ok {
		return ""
	}
	return selector.Sel.Name
}

func positionInsideAny(position token.Pos, ranges []sourceRange) bool {
	for _, candidate := range ranges {
		if position >= candidate.start && position <= candidate.end {
			return true
		}
	}
	return false
}
