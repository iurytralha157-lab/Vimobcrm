package whatsapp

import (
	"context"
	"net/http"
	"sync"
	"time"
)

// Only Storage work is shared. Tenant/SID checks and post-I/O authorization
// remain in each caller. The client pointer is an opaque, immutable-config
// namespace; credentials are never part of a key or a diagnostic.
type whatsAppMediaSigningKey struct {
	organizationID string
	objectPath     string
	bucket         string
	origin         string
	client         *http.Client
}

type whatsAppMediaSigningFlight struct {
	ctx     context.Context
	cancel  context.CancelFunc
	done    chan struct{}
	waiters int
	entry   cachedWhatsAppMediaSignedURL
	err     error
}

type boundedWhatsAppMediaSigningFlights struct {
	mu         sync.Mutex
	maxEntries int
	entries    map[whatsAppMediaSigningKey]*whatsAppMediaSigningFlight
}

func newBoundedWhatsAppMediaSigningFlights(maxEntries int) *boundedWhatsAppMediaSigningFlights {
	if maxEntries < 1 {
		maxEntries = whatsappMediaSignedURLCacheMaxEntries
	}
	return &boundedWhatsAppMediaSigningFlights{
		maxEntries: maxEntries,
		entries:    make(map[whatsAppMediaSigningKey]*whatsAppMediaSigningFlight),
	}
}

var whatsappMediaSigningFlights = newBoundedWhatsAppMediaSigningFlights(whatsappMediaSignedURLCacheMaxEntries)

func (flights *boundedWhatsAppMediaSigningFlights) Do(
	ctx context.Context,
	key whatsAppMediaSigningKey,
	sign func(context.Context) (cachedWhatsAppMediaSignedURL, error),
	publish func(cachedWhatsAppMediaSignedURL),
) (cachedWhatsAppMediaSignedURL, error) {
	flights.mu.Lock()
	if err := ctx.Err(); err != nil {
		flights.mu.Unlock()
		return cachedWhatsAppMediaSignedURL{}, err
	}
	flight := flights.entries[key]
	if flight == nil {
		if len(flights.entries) >= flights.maxEntries {
			// Saturation preserves the original direct signing behavior; it must
			// neither grow the registry nor reject an otherwise valid caller.
			flights.mu.Unlock()
			entry, err := sign(ctx)
			if ctx.Err() != nil {
				return cachedWhatsAppMediaSignedURL{}, ctx.Err()
			}
			if err == nil && entry.url != "" {
				publish(entry)
			}
			return entry, err
		}
		// A request cancellation must not become the signing context of other
		// waiters. Keep the existing Storage cap while the last waiter owns it.
		flightCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		flight = &whatsAppMediaSigningFlight{ctx: flightCtx, cancel: cancel, done: make(chan struct{})}
		flights.entries[key] = flight
	}
	flight.waiters++
	start := flight.waiters == 1
	flights.mu.Unlock()
	if start {
		go flights.run(key, flight, sign, publish)
	}
	defer flights.release(key, flight)
	select {
	case <-ctx.Done():
		return cachedWhatsAppMediaSignedURL{}, ctx.Err()
	case <-flight.done:
		if err := ctx.Err(); err != nil {
			return cachedWhatsAppMediaSignedURL{}, err
		}
		return flight.entry, flight.err
	}
}

func (flights *boundedWhatsAppMediaSigningFlights) run(
	key whatsAppMediaSigningKey,
	flight *whatsAppMediaSigningFlight,
	sign func(context.Context) (cachedWhatsAppMediaSignedURL, error),
	publish func(cachedWhatsAppMediaSignedURL),
) {
	entry, err := sign(flight.ctx)
	flights.mu.Lock()
	defer flights.mu.Unlock()
	if flight.ctx.Err() != nil {
		entry, err = cachedWhatsAppMediaSignedURL{}, flight.ctx.Err()
	}
	if flights.entries[key] == flight {
		if err == nil && entry.url != "" {
			publish(entry)
		}
		delete(flights.entries, key)
	}
	flight.entry, flight.err = entry, err
	close(flight.done)
	flight.cancel()
}

func (flights *boundedWhatsAppMediaSigningFlights) release(key whatsAppMediaSigningKey, flight *whatsAppMediaSigningFlight) {
	flights.mu.Lock()
	defer flights.mu.Unlock()
	flight.waiters--
	if flight.waiters == 0 && flights.entries[key] == flight {
		delete(flights.entries, key)
		flight.cancel()
	}
}
