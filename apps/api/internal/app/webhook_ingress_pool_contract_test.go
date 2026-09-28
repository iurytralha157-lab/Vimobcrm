package app

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"strconv"
	"strings"
	"testing"
)

func TestEvolutionWebhookIngressAndOutboundUseSeparateHandlers(t *testing.T) {
	file, err := parser.ParseFile(token.NewFileSet(), "routes.go", nil, parser.AllErrors)
	if err != nil {
		t.Fatalf("parse routes.go: %v", err)
	}

	expected := map[string]string{
		"GET /v1/whatsapp/webhook/evolution-go":             "webhookWorkerHandler.EvolutionGoWebhook",
		"POST /v1/whatsapp/webhook/evolution-go":            "webhookWorkerHandler.EvolutionGoWebhook",
		"POST /v1/whatsapp/conversations/{id}/attendance":   "whatsappHandler.JoinConversationAttendance",
		"POST /v1/whatsapp/conversations/{id}/send-message": "whatsappHandler.SendMessage",
	}
	counts := make(map[string]int, len(expected))
	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok || len(call.Args) != 2 {
			return true
		}
		method, ok := selectorKey(call.Fun)
		if !ok || (method != "mux.Handle" && method != "mux.HandleFunc") {
			return true
		}
		literal, ok := call.Args[0].(*ast.BasicLit)
		if !ok {
			return true
		}
		pattern, err := strconv.Unquote(literal.Value)
		if err != nil {
			t.Errorf("invalid route pattern %q: %v", literal.Value, err)
			return true
		}
		want, checked := expected[pattern]
		if !checked {
			return true
		}
		counts[pattern]++
		found := false
		ast.Inspect(call.Args[1], func(child ast.Node) bool {
			if key, ok := selectorKey(childAsExpr(child)); ok && key == want {
				found = true
			}
			return true
		})
		if !found {
			t.Errorf("%s must use %s", pattern, want)
		}
		return true
	})
	for pattern := range expected {
		if counts[pattern] != 1 {
			t.Errorf("%s registrations = %d, want 1", pattern, counts[pattern])
		}
	}
}

func TestWebhookHandlerFallsBackAndOnlyOpensWorkerPoolWhenEnabled(t *testing.T) {
	source, err := os.ReadFile("app.go")
	if err != nil {
		t.Fatalf("read app.go: %v", err)
	}
	appSource := string(source)
	if strings.Count(appSource, "webhookWorkerHandler := whatsappHandler") != 1 {
		t.Fatal("webhook HTTP handler must fall back to the main handler when the worker pool is disabled")
	}
	const gate = "if cfg.BackgroundWorkersEnabled && cfg.WhatsApp.WebhookWorkerEnabled {"
	start := strings.Index(appSource, gate)
	end := strings.Index(appSource, "\n\twhatsappRuntimeStats = whatsappHandler.RuntimeStats")
	if start < 0 || end <= start {
		t.Fatal("dedicated webhook pool must be gated by both background-worker flags")
	}
	workerSetup := appSource[start:end]
	for _, required := range []string{
		"workerDBConfig.MaxConns = cfg.WhatsApp.WebhookWorkerDBMaxConns",
		"webhookWorkerRepository := whatsappRepository.WithWorkerDatabase(",
		"webhookWorkerHandler = whatsappHandler.WithWorkerRepository(webhookWorkerRepository)",
	} {
		if !strings.Contains(workerSetup, required) {
			t.Errorf("worker pool setup is missing %q", required)
		}
	}
	if strings.Count(appSource, "webhookWorkerHandler:     webhookWorkerHandler,") != 1 {
		t.Fatal("route dependencies must receive the gated webhook worker handler")
	}
}

func childAsExpr(node ast.Node) ast.Expr {
	expression, _ := node.(ast.Expr)
	return expression
}
