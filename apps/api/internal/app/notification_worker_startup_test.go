package app

import "testing"

func TestNotificationDispatchWorkerStartupIsOptIn(t *testing.T) {
	started := 0
	start := func() { started++ }

	if got := startNotificationDispatchWorker(false, start); got {
		t.Fatal("disabled notification dispatch worker reported as started")
	}
	if started != 0 {
		t.Fatalf("disabled notification dispatch worker started %d times", started)
	}

	if got := startNotificationDispatchWorker(true, start); !got {
		t.Fatal("enabled notification dispatch worker reported as disabled")
	}
	if started != 1 {
		t.Fatalf("enabled notification dispatch worker started %d times, want 1", started)
	}
}
