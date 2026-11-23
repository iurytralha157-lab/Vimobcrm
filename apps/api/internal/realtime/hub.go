package realtime

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	subscriptionBufferSize = 128
	listenerBatchSize      = 256
	defaultReplayLimit     = 512
	realtimeRetention      = 72 * time.Hour
	publishTimeout         = 2 * time.Second
	startupTimeout         = 10 * time.Second
	pruneInterval          = time.Hour
	tailerMinimumInterval  = 100 * time.Millisecond
	tailerMaximumInterval  = time.Second
)

type Stats struct {
	Published       uint64 `json:"published"`
	Persisted       uint64 `json:"persisted"`
	PublishFailures uint64 `json:"publishFailures"`
	Delivered       uint64 `json:"delivered"`
	Dropped         uint64 `json:"dropped"`
	Replayed        uint64 `json:"replayed"`
	TailerErrors    uint64 `json:"tailerErrors"`
	Subscribers     int64  `json:"subscribers"`
}

type Replay struct {
	Events []Event
	Reset  *Event
	Cursor uint64
}

type Hub struct {
	mu            sync.Mutex
	nextEventID   atomic.Uint64
	subscriptions map[string]map[*subscription]struct{}
	store         EventStore
	logger        *slog.Logger
	cursor        uint64
	wake          chan struct{}

	startMu sync.Mutex
	started bool
	cancel  context.CancelFunc

	published       atomic.Uint64
	persisted       atomic.Uint64
	publishFailures atomic.Uint64
	delivered       atomic.Uint64
	dropped         atomic.Uint64
	replayed        atomic.Uint64
	tailerErrors    atomic.Uint64
	subscriberCount atomic.Int64
}

type subscription struct {
	organizationID string
	userID         string
	events         chan Event
	done           chan struct{}
	enqueueMu      sync.Mutex
	unsubscribe    sync.Once
}

func NewHub() *Hub {
	return newHub(nil, slog.Default())
}

func NewDurableHub(store EventStore, logger *slog.Logger) *Hub {
	return newHub(store, logger)
}

func newHub(store EventStore, logger *slog.Logger) *Hub {
	if logger == nil {
		logger = slog.Default()
	}
	return &Hub{
		subscriptions: map[string]map[*subscription]struct{}{},
		store:         store,
		logger:        logger,
		wake:          make(chan struct{}, 1),
	}
}

func (hub *Hub) Start(ctx context.Context, prune bool) error {
	if hub == nil || hub.store == nil {
		return nil
	}

	hub.startMu.Lock()
	defer hub.startMu.Unlock()
	if hub.started {
		return nil
	}
	tailerCtx, cancel := context.WithCancel(ctx)

	startCtx, startCancel := context.WithTimeout(tailerCtx, startupTimeout)
	defer startCancel()
	cursor, err := hub.store.LatestID(startCtx)
	if err != nil {
		cancel()
		return fmt.Errorf("initialize realtime tailer: %w", err)
	}

	hub.mu.Lock()
	hub.cursor = cursor
	hub.mu.Unlock()
	hub.started = true
	hub.cancel = cancel
	go hub.tailLoop(tailerCtx, cursor)
	if prune {
		go hub.pruneLoop(tailerCtx)
	}
	return nil
}

func (hub *Hub) Close() {
	if hub == nil {
		return
	}
	hub.startMu.Lock()
	if hub.cancel != nil {
		hub.cancel()
		hub.cancel = nil
	}
	hub.startMu.Unlock()
}

func (hub *Hub) Subscribe(ctx context.Context, organizationID string, userID string) (<-chan Event, func()) {
	events, unsubscribe, _ := hub.subscribe(ctx, organizationID, userID)
	return events, unsubscribe
}

func (hub *Hub) subscribe(ctx context.Context, organizationID string, userID string) (<-chan Event, func(), uint64) {
	sub := &subscription{
		organizationID: strings.TrimSpace(organizationID),
		userID:         strings.TrimSpace(userID),
		events:         make(chan Event, subscriptionBufferSize),
		done:           make(chan struct{}),
	}

	hub.mu.Lock()
	if hub.subscriptions[sub.organizationID] == nil {
		hub.subscriptions[sub.organizationID] = map[*subscription]struct{}{}
	}
	hub.subscriptions[sub.organizationID][sub] = struct{}{}
	cursor := hub.cursor
	hub.mu.Unlock()
	hub.subscriberCount.Add(1)

	unsubscribe := func() {
		sub.unsubscribe.Do(func() {
			hub.mu.Lock()
			if subscribers := hub.subscriptions[sub.organizationID]; subscribers != nil {
				delete(subscribers, sub)
				if len(subscribers) == 0 {
					delete(hub.subscriptions, sub.organizationID)
				}
			}
			hub.mu.Unlock()
			hub.subscriberCount.Add(-1)
			close(sub.done)
			// The event channel intentionally remains open. Publish can hold a
			// snapshot containing this subscription; not closing prevents a
			// send-on-closed-channel panic after a committed domain mutation.
		})
	}

	go func() {
		select {
		case <-ctx.Done():
			unsubscribe()
		case <-sub.done:
		}
	}()

	return sub.events, unsubscribe, cursor
}

func (hub *Hub) Publish(event Event) {
	if hub == nil || strings.TrimSpace(event.OrganizationID) == "" || strings.TrimSpace(event.Type) == "" {
		return
	}

	event = normalizeEvent(event)
	hub.published.Add(1)

	if hub.store == nil {
		event.ID = fmt.Sprintf("%d", hub.nextEventID.Add(1))
		hub.dispatch(event, 0)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), publishTimeout)
	_, err := hub.store.Append(ctx, event)
	cancel()
	if err != nil {
		hub.publishFailures.Add(1)
		reset := newResetEvent(
			event.OrganizationID,
			0,
			"publish_not_persisted",
			1,
		)
		reset.ID = fmt.Sprintf("transient-%d", hub.nextEventID.Add(1))
		hub.logger.Error(
			"durable realtime publish failed; requesting a local subscriber resync",
			"event_type", event.Type,
			"organization_id", event.OrganizationID,
			"error", err,
		)
		hub.dispatch(*reset, 0)
		return
	}

	hub.persisted.Add(1)
	// Only the tailer dispatches durable events, so a local write cannot overtake a remote one.
	select {
	case hub.wake <- struct{}{}:
	default:
	}
}

func (hub *Hub) Replay(
	ctx context.Context,
	organizationID string,
	userID string,
	afterID uint64,
	limit int,
) (Replay, error) {
	if hub == nil || hub.store == nil {
		return Replay{}, nil
	}

	latestID, err := hub.store.LatestID(ctx)
	if err != nil {
		return Replay{}, err
	}
	return hub.replayThrough(ctx, organizationID, userID, afterID, latestID, limit)
}

func (hub *Hub) replayThrough(ctx context.Context, organizationID, userID string, afterID, latestID uint64, limit int) (Replay, error) {
	if limit <= 0 || limit > defaultReplayLimit {
		limit = defaultReplayLimit
	}
	if latestID == afterID {
		return Replay{Cursor: latestID, Events: []Event{}}, nil
	}
	if latestID < afterID {
		return Replay{
			Cursor: latestID,
			Reset:  newResetEvent(organizationID, latestID, "cursor_ahead_of_log", 0),
		}, nil
	}

	oldestID, err := hub.store.OldestID(ctx)
	if err != nil {
		return Replay{}, err
	}
	if oldestID == 0 || afterID < oldestID-1 {
		return Replay{
			Cursor: latestID,
			Reset:  newResetEvent(organizationID, latestID, "cursor_expired", 0),
		}, nil
	}

	events, err := hub.store.ListSubscriberAfter(ctx, organizationID, userID, afterID, latestID, limit+1)
	if err != nil {
		return Replay{}, err
	}
	if len(events) > limit {
		return Replay{
			Cursor: latestID,
			Reset:  newResetEvent(organizationID, latestID, "replay_limit_exceeded", len(events)),
		}, nil
	}

	hub.replayed.Add(uint64(len(events)))
	return Replay{Events: events, Cursor: latestID}, nil
}

func (hub *Hub) Stats() Stats {
	if hub == nil {
		return Stats{}
	}
	return Stats{
		Published:       hub.published.Load(),
		Persisted:       hub.persisted.Load(),
		PublishFailures: hub.publishFailures.Load(),
		Delivered:       hub.delivered.Load(),
		Dropped:         hub.dropped.Load(),
		Replayed:        hub.replayed.Load(),
		TailerErrors:    hub.tailerErrors.Load(),
		Subscribers:     hub.subscriberCount.Load(),
	}
}

func (hub *Hub) tailLoop(ctx context.Context, cursor uint64) {
	interval := tailerMinimumInterval
	for {
		delivered, err := hub.drainStore(ctx, &cursor)
		if err != nil && ctx.Err() == nil {
			hub.tailerErrors.Add(1)
			hub.logger.Warn("realtime tailer query failed; retrying", "error", err, "retry_in", interval)
		}
		if delivered > 0 {
			interval = tailerMinimumInterval
		} else if interval < tailerMaximumInterval {
			interval *= 2
			if interval > tailerMaximumInterval {
				interval = tailerMaximumInterval
			}
		}

		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-hub.wake:
			timer.Stop()
		case <-timer.C:
		}
	}
}

func (hub *Hub) drainStore(ctx context.Context, cursor *uint64) (int, error) {
	delivered := 0
	for {
		events, err := hub.store.ListAfter(ctx, *cursor, 0, listenerBatchSize)
		if err != nil {
			return delivered, err
		}
		if len(events) == 0 {
			return delivered, nil
		}

		for _, event := range events {
			eventID, err := strconv.ParseUint(event.ID, 10, 64)
			if err != nil {
				return delivered, fmt.Errorf("invalid durable realtime cursor %q: %w", event.ID, err)
			}
			if eventID <= *cursor {
				return delivered, fmt.Errorf("non-increasing durable realtime cursor %d after %d", eventID, *cursor)
			}
			hub.dispatch(event, eventID)
			*cursor = eventID
			delivered++
		}
		if len(events) < listenerBatchSize {
			return delivered, nil
		}
	}
}

func (hub *Hub) pruneLoop(ctx context.Context) {
	timer := time.NewTimer(time.Minute)
	defer timer.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			pruneCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
			deleted, err := hub.store.PruneBefore(pruneCtx, time.Now().Add(-realtimeRetention))
			cancel()
			if err != nil {
				hub.logger.Warn("realtime retention prune failed", "error", err)
			} else if deleted > 0 {
				hub.logger.Info("realtime retention prune completed", "deleted", deleted)
			}
			timer.Reset(pruneInterval)
		}
	}
}

func (hub *Hub) dispatch(event Event, cursor uint64) {
	// Registering a subscriber uses the same lock as the cursor update and snapshot.
	hub.mu.Lock()
	if cursor > hub.cursor {
		hub.cursor = cursor
	}
	subscribers := make([]*subscription, 0, len(hub.subscriptions[event.OrganizationID]))
	for sub := range hub.subscriptions[event.OrganizationID] {
		if event.AudienceUserID != "" && !strings.EqualFold(event.AudienceUserID, sub.userID) {
			continue
		}
		subscribers = append(subscribers, sub)
	}
	hub.mu.Unlock()

	for _, sub := range subscribers {
		delivered, dropped := sub.enqueue(event)
		if delivered {
			hub.delivered.Add(1)
		}
		if dropped > 0 {
			hub.dropped.Add(uint64(dropped))
			hub.logger.Warn(
				"realtime subscriber backpressure collapsed into reset",
				"organization_id", sub.organizationID,
				"user_id", sub.userID,
				"dropped", dropped,
				"cursor", event.ID,
			)
		}
	}
}

func (sub *subscription) enqueue(event Event) (bool, int) {
	sub.enqueueMu.Lock()
	defer sub.enqueueMu.Unlock()

	select {
	case <-sub.done:
		return false, 0
	default:
	}

	select {
	case sub.events <- event:
		return true, 0
	default:
	}

	dropped := 1
	for {
		select {
		case <-sub.events:
			dropped++
		default:
			reset := newResetEvent(
				sub.organizationID,
				parseCursor(event.ID),
				"subscriber_backpressure",
				dropped,
			)
			if reset.ID == "0" {
				reset.ID = event.ID
			}
			select {
			case sub.events <- *reset:
				return true, dropped
			default:
				return false, dropped
			}
		}
	}
}

func normalizeEvent(event Event) Event {
	event.OrganizationID = strings.TrimSpace(event.OrganizationID)
	event.UserID = strings.TrimSpace(event.UserID)
	event.AudienceUserID = strings.TrimSpace(event.AudienceUserID)
	event.Type = strings.TrimSpace(event.Type)
	if event.CreatedAt.IsZero() {
		event.CreatedAt = time.Now().UTC()
	} else {
		event.CreatedAt = event.CreatedAt.UTC()
	}
	if event.Data == nil {
		event.Data = map[string]any{}
	}
	return event
}

func newResetEvent(organizationID string, cursor uint64, reason string, dropped int) *Event {
	return &Event{
		ID:             strconv.FormatUint(cursor, 10),
		Type:           EventReset,
		OrganizationID: organizationID,
		Data: map[string]any{
			"cursor":  strconv.FormatUint(cursor, 10),
			"reason":  reason,
			"dropped": dropped,
		},
		CreatedAt: time.Now().UTC(),
	}
}

func parseCursor(value string) uint64 {
	cursor, _ := strconv.ParseUint(strings.TrimSpace(value), 10, 64)
	return cursor
}
