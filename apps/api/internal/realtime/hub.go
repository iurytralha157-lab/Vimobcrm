package realtime

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

const subscriptionBufferSize = 64

type Hub struct {
	mu            sync.RWMutex
	nextEventID   atomic.Uint64
	subscriptions map[string]map[*subscription]struct{}
}

type subscription struct {
	organizationID string
	userID         string
	events         chan Event
}

func NewHub() *Hub {
	return &Hub{
		subscriptions: map[string]map[*subscription]struct{}{},
	}
}

func (hub *Hub) Subscribe(ctx context.Context, organizationID string, userID string) (<-chan Event, func()) {
	sub := &subscription{
		organizationID: organizationID,
		userID:         userID,
		events:         make(chan Event, subscriptionBufferSize),
	}

	hub.mu.Lock()
	if hub.subscriptions[organizationID] == nil {
		hub.subscriptions[organizationID] = map[*subscription]struct{}{}
	}
	hub.subscriptions[organizationID][sub] = struct{}{}
	hub.mu.Unlock()

	var once sync.Once
	unsubscribe := func() {
		once.Do(func() {
			hub.mu.Lock()
			if subscribers := hub.subscriptions[organizationID]; subscribers != nil {
				delete(subscribers, sub)
				if len(subscribers) == 0 {
					delete(hub.subscriptions, organizationID)
				}
			}
			hub.mu.Unlock()
			close(sub.events)
		})
	}

	go func() {
		<-ctx.Done()
		unsubscribe()
	}()

	return sub.events, unsubscribe
}

func (hub *Hub) Publish(event Event) {
	if hub == nil || event.OrganizationID == "" || event.Type == "" {
		return
	}

	event.ID = fmt.Sprintf("%d", hub.nextEventID.Add(1))
	if event.CreatedAt.IsZero() {
		event.CreatedAt = time.Now().UTC()
	}
	if event.Data == nil {
		event.Data = map[string]any{}
	}

	hub.mu.RLock()
	subscribers := make([]*subscription, 0, len(hub.subscriptions[event.OrganizationID]))
	for sub := range hub.subscriptions[event.OrganizationID] {
		subscribers = append(subscribers, sub)
	}
	hub.mu.RUnlock()

	for _, sub := range subscribers {
		select {
		case sub.events <- event:
		default:
			// Drop stale invalidation events instead of letting a slow client block writes.
		}
	}
}
