package app

import (
	"os"
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
