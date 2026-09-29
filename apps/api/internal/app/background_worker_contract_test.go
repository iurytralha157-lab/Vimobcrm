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

func TestAppBackgroundWorkerStartsUseGlobalGateWhileRealtimeStaysAvailable(t *testing.T) {
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
		if !ok || (key != "backgroundWorkers.Run" && key != "backgroundWorkers.RunWithError" && key != "callRecordingWorkers.RunWithError") {
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
		"billingReconciler.Start":                                 1,
		"attentionRepository.StartWorker":                         1,
		"gamificationRepository.StartWorker":                      1,
		"leadsRepository.StartRedistributionWorker":               1,
		"leadsRepository.StartNotificationDispatchWorker":         1,
		"propertiesRepository.StartAssetCleanupWorker":            1,
		"publicationsRepository.StartWorker":                      1,
		"developmentsRepository.StartReservationExpirationWorker": 1,
		"automationsRepository.StartRuntimeWorker":                1,
		"whatsappHandler.StartAIWorker":                           1,
		"whatsappHandler.StartOutboxWorker":                       1,
		"webhookWorkerHandler.StartWebhookWorker":                 1,
		"whatsappHandler.StartMediaWorker":                        1,
		"whatsappHandler.StartCallRecordingWorker":                1,
		"whatsappHandler.StartSessionSupervisor":                  1,
		"metaHandler.StartWebhookWorker":                          1,
		"metaHandler.StartConversionFeedbackWorker":               1,
		"portalsRepository.StartImportReportWorker":               1,
		"webhooksRepository.StartDeliveryWorker":                  1,
	}
	actual := make(map[string]int, len(expected))
	realtimeStarts := 0

	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		key, ok := selectorKey(call.Fun)
		if !ok || !strings.HasPrefix(selectorMethod(call.Fun), "Start") {
			return true
		}
		if key == "realtimeHub.StartWithPrune" {
			realtimeStarts++
			if positionInsideAny(call.Pos(), gateRanges) {
				t.Error("durable realtime startup must not be enclosed by the background-worker gate")
			}
			if len(call.Args) != 2 {
				t.Errorf("realtime startup has %d arguments, want context and worker-owner flag", len(call.Args))
			} else if ownerFlag, ok := selectorKey(call.Args[1]); !ok || ownerFlag != "cfg.BackgroundWorkersEnabled" {
				t.Error("realtime retention pruning must follow cfg.BackgroundWorkersEnabled")
			}
			return true
		}
		if key == "realtimeHub.Start" {
			t.Error("unconditional realtime startup would run retention pruning on a worker-disabled replica")
			return true
		}
		if key == "whatsappHandler.StartCallRecordingWorker" {
			if len(call.Args) != 4 {
				t.Errorf("call recording startup has %d arguments, want context, logger, mode and session allowlist", len(call.Args))
			} else {
				mode, ok := call.Args[2].(*ast.UnaryExpr)
				if !ok || mode.Op != token.NOT {
					t.Error("recording-only mode must be the inverse of the global worker flag")
				} else if flag, ok := selectorKey(mode.X); !ok || flag != "cfg.BackgroundWorkersEnabled" {
					t.Error("recording-only mode must be the inverse of cfg.BackgroundWorkersEnabled")
				}
				allowlist, ok := call.Args[3].(*ast.SelectorExpr)
				if !ok || allowlist.Sel.Name != "CanarySessionIDs" {
					t.Error("recording-only worker must receive EVOLUTION_GO_CANARY_SESSION_IDS")
				} else if source, ok := selectorKey(allowlist.X); !ok || source != "cfg.EvolutionGo" {
					t.Error("recording-only worker must receive cfg.EvolutionGo.CanarySessionIDs")
				}
			}
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
	if realtimeStarts != 1 {
		t.Errorf("realtime startup calls = %d, want 1", realtimeStarts)
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

func TestBlockingBackgroundWorkersAreStartedAsynchronously(t *testing.T) {
	source, err := os.ReadFile("app.go")
	if err != nil {
		t.Fatalf("read app.go: %v", err)
	}

	for _, call := range []string{
		"go propertiesRepository.StartAssetCleanupWorker(ctx, logger)",
		"go webhooksRepository.StartDeliveryWorker(ctx, logger)",
	} {
		if count := strings.Count(string(source), call); count != 1 {
			t.Fatalf("app.go contains %q %d times, want exactly once", call, count)
		}
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
