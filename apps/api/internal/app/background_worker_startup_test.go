package app

import (
	"errors"
	"testing"
)

func TestBackgroundWorkerStartupRunHonorsGlobalGate(t *testing.T) {
	started := 0
	start := func() {
		started++
	}

	if newBackgroundWorkerStartup(false).Run(start) {
		t.Fatal("disabled global gate reported a worker as started")
	}
	if started != 0 {
		t.Fatalf("disabled global gate started %d workers, want 0", started)
	}

	if !newBackgroundWorkerStartup(true).Run(start) {
		t.Fatal("enabled global gate reported a worker as disabled")
	}
	if started != 1 {
		t.Fatalf("enabled global gate started %d workers, want 1", started)
	}
}

func TestBackgroundWorkerStartupRunWithErrorHonorsGlobalGate(t *testing.T) {
	wantErr := errors.New("safe startup failure")
	started := 0
	start := func() error {
		started++
		return wantErr
	}

	wasStarted, err := newBackgroundWorkerStartup(false).RunWithError(start)
	if wasStarted || err != nil || started != 0 {
		t.Fatalf("disabled global gate returned started=%v err=%v calls=%d", wasStarted, err, started)
	}

	wasStarted, err = newBackgroundWorkerStartup(true).RunWithError(start)
	if !wasStarted || !errors.Is(err, wantErr) || started != 1 {
		t.Fatalf("enabled global gate returned started=%v err=%v calls=%d", wasStarted, err, started)
	}
}

func TestBackgroundWorkerStartupRejectsNilCallbacks(t *testing.T) {
	if newBackgroundWorkerStartup(true).Run(nil) {
		t.Fatal("nil worker callback reported as started")
	}
	if started, err := newBackgroundWorkerStartup(true).RunWithError(nil); started || err != nil {
		t.Fatalf("nil error callback returned started=%v err=%v", started, err)
	}
}
