package realtime

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"
)

func TestHubPublishesOnlyToMatchingOrganization(t *testing.T) {
	hub := NewHub()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	orgEvents, unsubscribeOrg := hub.Subscribe(ctx, "org-1", "user-1")
	defer unsubscribeOrg()
	otherEvents, unsubscribeOther := hub.Subscribe(ctx, "org-2", "user-2")
	defer unsubscribeOther()

	hub.Publish(NewEvent("lead.updated", "org-1", "user-1", map[string]any{"leadId": "lead-1"}))

	select {
	case event := <-orgEvents:
		if event.Type != "lead.updated" {
			t.Fatalf("expected lead.updated event, got %q", event.Type)
		}
		if event.Data["leadId"] != "lead-1" {
			t.Fatalf("expected lead id in event data, got %#v", event.Data["leadId"])
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for matching organization event")
	}

	select {
	case event := <-otherEvents:
		t.Fatalf("unexpected event for other organization: %#v", event)
	case <-time.After(25 * time.Millisecond):
	}
}

func TestHubTargetsOnlyExplicitAudience(t *testing.T) {
	hub := NewHub()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	targetEvents, unsubscribeTarget := hub.Subscribe(ctx, "org-1", "user-target")
	defer unsubscribeTarget()
	otherEvents, unsubscribeOther := hub.Subscribe(ctx, "org-1", "user-other")
	defer unsubscribeOther()

	hub.Publish(NewTargetedEvent(
		"access.permissions.changed",
		"org-1",
		"user-target",
		map[string]any{"targetUserId": "user-target"},
	))

	select {
	case event := <-targetEvents:
		if event.Type != "access.permissions.changed" {
			t.Fatalf("expected targeted event, got %q", event.Type)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for targeted event")
	}

	select {
	case event := <-otherEvents:
		t.Fatalf("unexpected targeted event for another user: %#v", event)
	case <-time.After(25 * time.Millisecond):
	}
}

func TestHubBackpressureCollapsesToObservableReset(t *testing.T) {
	hub := NewHub()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	events, unsubscribe := hub.Subscribe(ctx, "org-1", "user-1")
	defer unsubscribe()

	for index := 0; index <= subscriptionBufferSize; index++ {
		hub.Publish(NewEvent(
			"lead.updated",
			"org-1",
			"user-1",
			map[string]any{"leadId": fmt.Sprintf("lead-%d", index)},
		))
	}

	select {
	case event := <-events:
		if event.Type != EventReset {
			t.Fatalf("expected backpressure reset, got %q", event.Type)
		}
		if event.Data["reason"] != "subscriber_backpressure" {
			t.Fatalf("expected backpressure reason, got %#v", event.Data["reason"])
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for backpressure reset")
	}

	if stats := hub.Stats(); stats.Dropped == 0 {
		t.Fatal("expected dropped/backpressure metric to be observable")
	}
}

func TestHubPublishAndUnsubscribeCanRaceWithoutPanic(t *testing.T) {
	hub := NewHub()

	for iteration := 0; iteration < 200; iteration++ {
		ctx, cancel := context.WithCancel(context.Background())
		_, unsubscribe := hub.Subscribe(ctx, "org-1", fmt.Sprintf("user-%d", iteration))

		var wait sync.WaitGroup
		wait.Add(2)
		go func() {
			defer wait.Done()
			hub.Publish(NewEvent("lead.updated", "org-1", "", nil))
		}()
		go func() {
			defer wait.Done()
			unsubscribe()
			cancel()
		}()
		wait.Wait()
	}
}
