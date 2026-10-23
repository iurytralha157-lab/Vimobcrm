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

func TestNotificationDispatchWorkerIsOnlyWiredBehindOptInGate(t *testing.T) {
	source, err := os.ReadFile("app.go")
	if err != nil {
		t.Fatalf("read app.go: %v", err)
	}

	const startCall = "leadsRepository.StartNotificationDispatchWorker(ctx, logger)"
	if count := strings.Count(string(source), startCall); count != 1 {
		t.Fatalf("notification dispatch worker has %d startup calls, want exactly one gated call", count)
	}
	const gatedStartup = "startNotificationDispatchWorker(cfg.Notifications.DispatchWorkerEnabled, func() {\n\t\t\t" + startCall + "\n\t\t})"
	if !strings.Contains(string(source), gatedStartup) {
		t.Fatal("notification dispatch worker startup is not guarded by the opt-in config flag")
	}
}

func TestNotificationDispatchWorkerDeploymentDefaultsAreFailClosed(t *testing.T) {
	for _, test := range []struct {
		path string
		line string
	}{
		{path: "../../../../.env.example", line: "NOTIFICATION_DISPATCH_WORKER_ENABLED=false"},
		{path: "../../../../deploy/portainer-stack.yml", line: "NOTIFICATION_DISPATCH_WORKER_ENABLED: ${NOTIFICATION_DISPATCH_WORKER_ENABLED:-false}"},
		{path: "../../../../deploy/portainer-stack.build.yml", line: "NOTIFICATION_DISPATCH_WORKER_ENABLED: ${NOTIFICATION_DISPATCH_WORKER_ENABLED:-false}"},
	} {
		source, err := os.ReadFile(test.path)
		if err != nil {
			t.Fatalf("read %s: %v", test.path, err)
		}
		if count := strings.Count(string(source), test.line); count != 1 {
			t.Errorf("%s contains the fail-closed worker setting %d times, want exactly once", test.path, count)
		}
	}
}

// The zero-device queue is a SQL subqueue of the existing gated worker. Keep
// it in this startup inventory without inventing another background goroutine.
func TestNotificationDispatchWorkerIncludesBoundedWhatsAppWaitingSubqueue(t *testing.T) {
	const migrationPath = "../../../../supabase/migrations/20261012053044_whatsapp_inbound_push_preflight_order.sql"
	migration, err := os.ReadFile(migrationPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, contract := range []string{
		"create table private.whatsapp_inbound_push_waiting (",
		"create table private.whatsapp_inbound_push_waiting_seed (",
		"perform private.seed_whatsapp_inbound_push_waiting(100);",
		"perform private.recover_whatsapp_inbound_push_waiting(v_batch_size);",
		"if p_channels is null or ''push''=any(p_channels) then",
		"limit p_limit", "for update skip locked",
	} {
		if !strings.Contains(string(migration), contract) {
			t.Errorf("notification SQL subqueue inventory is missing %q", contract)
		}
	}
	outbox, err := os.ReadFile("../leads/notification_delivery_outbox.go")
	if err != nil {
		t.Fatal(err)
	}
	expire := strings.Index(string(outbox), "select private.expire_whatsapp_inbound_push_waiting(100)")
	claim := strings.Index(string(outbox), "from private.claim_notification_deliveries(")
	if expire < 0 || claim < 0 || expire > claim {
		t.Fatal("waiting expiry must commit separately before the claim's authorization locks")
	}
	inventory, err := os.ReadFile("../../../../docs/notification-delivery-architecture.md")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(inventory), "Subfila SQL de push WhatsApp sem dispositivo") {
		t.Fatal("notification subqueue missing from worker inventory")
	}
	protocol, err := os.ReadFile("../../../../supabase/migrations/20261012061151_whatsapp_inbound_push_worker_protocol.sql")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(protocol), "notification.metadata->>''event_key''=''whatsapp_inbound_attendant''") ||
		!strings.Contains(string(protocol), "right(p_worker_id,11)=''|wa_push_v2''") ||
		!strings.HasSuffix(notificationWorkerCapabilitySuffix(t, outbox), "|wa_push_v2") {
		t.Fatal("WhatsApp SQL subqueue must withhold this event from incompatible worker replicas")
	}
	if !strings.Contains(notificationWorkerCapabilitySuffix(t, outbox), "|push_device_v3|") {
		t.Fatal("notification worker must retain the current push-device capability alongside WhatsApp")
	}
}

// Check the suffix used by the worker's return expression, allowing a constant
// rename or multiple capabilities without accepting an unused marker string.
func notificationWorkerCapabilitySuffix(t *testing.T, source []byte) string {
	t.Helper()
	file, err := parser.ParseFile(token.NewFileSet(), "notification_delivery_outbox.go", source, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, declaration := range file.Decls {
		function, ok := declaration.(*ast.FuncDecl)
		if !ok || function.Name.Name != "normalizedNotificationWorkerID" || function.Body == nil {
			continue
		}
		constants := map[string]ast.Expr{}
		ast.Inspect(function.Body, func(node ast.Node) bool {
			declaration, ok := node.(*ast.GenDecl)
			if !ok || declaration.Tok != token.CONST {
				return true
			}
			for _, specification := range declaration.Specs {
				value := specification.(*ast.ValueSpec)
				for index, name := range value.Names {
					if index < len(value.Values) {
						constants[name.Name] = value.Values[index]
					}
				}
			}
			return false
		})
		var suffix string
		ast.Inspect(function.Body, func(node ast.Node) bool {
			returned, ok := node.(*ast.ReturnStmt)
			if !ok || len(returned.Results) != 1 {
				return true
			}
			addition, ok := returned.Results[0].(*ast.BinaryExpr)
			if !ok || addition.Op != token.ADD {
				return true
			}
			expression := addition.Y
			if identifier, ok := expression.(*ast.Ident); ok {
				expression = constants[identifier.Name]
			}
			if literal, ok := expression.(*ast.BasicLit); ok && literal.Kind == token.STRING {
				suffix, _ = strconv.Unquote(literal.Value)
			}
			return true
		})
		return suffix
	}
	return ""
}

func TestNotificationWorkerCapabilityInventoryIgnoresUnusedMarkers(t *testing.T) {
	for _, test := range []struct{ name, body, expected string }{
		{"renamed-combined-capabilities", `const capabilities = "|push_device_v3|wa_push_v2"; return "worker" + capabilities`, "|push_device_v3|wa_push_v2"},
		{"unused-marker", `const stale = "|push_device_v3|wa_push_v2"; return "worker" + "|old"`, "|old"},
		{"no-appended-capability", `const unused = "|wa_push_v2"; return "worker"`, ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := []byte("package leads; func normalizedNotificationWorkerID() string {" + test.body + "}")
			if got := notificationWorkerCapabilitySuffix(t, source); got != test.expected {
				t.Fatalf("suffix=%q expected=%q", got, test.expected)
			}
		})
	}
}
