package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestWhatsAppMediaSigningCoalescesConcurrentMisses(t *testing.T) {
	const organizationID = "00000000-0000-0000-0000-000000000021"
	objectPath := "orgs/" + organizationID + "/sessions/local-signing/incoming/concurrent.png"
	whatsappMediaSignedURLCache.Delete(objectPath)
	t.Cleanup(func() { whatsappMediaSignedURLCache.Delete(objectPath) })
	var calls atomic.Int32
	entered := make(chan struct{}, 2)
	release := make(chan struct{})
	var releaseOnce sync.Once
	allowResponse := func() { releaseOnce.Do(func() { close(release) }) }
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		entered <- struct{}{}
		select {
		case <-release:
			_ = json.NewEncoder(w).Encode(map[string]string{"signedURL": "/object/sign/whatsapp-media/local"})
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(server.Close)
	t.Cleanup(allowResponse)
	repo := Repository{storage: storageClient{projectURL: server.URL, apiKey: "local-fixture", httpClient: server.Client()}}
	results := make(chan error, 2)
	requestURL := func() {
		url, ttl, err := repo.signedWhatsAppMessageMediaURLWithTTL(context.Background(), organizationID, objectPath)
		if err == nil && (url == "" || ttl < 1 || ttl > 840) {
			t.Errorf("invalid signing result: nonempty=%t ttl=%d", url != "", ttl)
		}
		results <- err
	}
	go requestURL()
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("first Storage request did not start")
	}
	go requestURL()
	// The first response remains blocked while the overlapping caller arrives.
	// An uncoalesced implementation reaches Storage a second time immediately.
	select {
	case <-entered:
	case <-time.After(250 * time.Millisecond):
	}
	allowResponse()
	for range 2 {
		select {
		case err := <-results:
			if err != nil {
				t.Fatal(err)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("signing caller did not finish")
		}
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("overlapping cache misses made %d Storage signing requests; want 1", got)
	}
}

func waitForSigningWaiters(t *testing.T, flights *boundedWhatsAppMediaSigningFlights, key whatsAppMediaSigningKey, want int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		flights.mu.Lock()
		flight := flights.entries[key]
		got := 0
		if flight != nil {
			got = flight.waiters
		}
		flights.mu.Unlock()
		if got == want {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("signing waiter count did not become %d", want)
}

func localSigningEntry(value string) cachedWhatsAppMediaSignedURL {
	return cachedWhatsAppMediaSignedURL{url: value, expiresAt: time.Now().Add(time.Minute)}
}

func TestWhatsAppMediaSigningCancellationKeepsOtherWaiterAlive(t *testing.T) {
	for _, cancelFirst := range []bool{true, false} {
		t.Run(map[bool]string{true: "original", false: "joining"}[cancelFirst], func(t *testing.T) {
			flights := newBoundedWhatsAppMediaSigningFlights(2)
			key := whatsAppMediaSigningKey{objectPath: "same-object"}
			firstCtx, cancelFirstCtx := context.WithCancel(context.Background())
			secondCtx, cancelSecondCtx := context.WithCancel(context.Background())
			t.Cleanup(cancelFirstCtx)
			t.Cleanup(cancelSecondCtx)
			results := make(chan error, 2)
			release := make(chan struct{})
			var calls, published atomic.Int32
			sign := func(ctx context.Context) (cachedWhatsAppMediaSignedURL, error) {
				calls.Add(1)
				deadline, ok := ctx.Deadline()
				if !ok || time.Until(deadline) > 20*time.Second || time.Until(deadline) <= 0 {
					t.Error("shared Storage context lost the original 20-second cap")
				}
				select {
				case <-release:
					return localSigningEntry("shared"), nil
				case <-ctx.Done():
					return cachedWhatsAppMediaSignedURL{}, ctx.Err()
				}
			}
			publish := func(cachedWhatsAppMediaSignedURL) { published.Add(1) }
			go func() { _, err := flights.Do(firstCtx, key, sign, publish); results <- err }()
			waitForSigningWaiters(t, flights, key, 1)
			go func() { _, err := flights.Do(secondCtx, key, sign, publish); results <- err }()
			waitForSigningWaiters(t, flights, key, 2)
			if cancelFirst {
				cancelFirstCtx()
			} else {
				cancelSecondCtx()
			}
			if err := <-results; !errors.Is(err, context.Canceled) {
				t.Fatalf("cancelled caller returned %v", err)
			}
			waitForSigningWaiters(t, flights, key, 1)
			close(release)
			if err := <-results; err != nil {
				t.Fatalf("surviving caller failed: %v", err)
			}
			waitForSigningWaiters(t, flights, key, 0)
			if calls.Load() != 1 || published.Load() != 1 {
				t.Fatalf("calls=%d publications=%d; want one shared result", calls.Load(), published.Load())
			}
		})
	}
}

func TestWhatsAppMediaSigningLastCancelCannotPublishOrRemoveReplacement(t *testing.T) {
	flights := newBoundedWhatsAppMediaSigningFlights(1)
	key := whatsAppMediaSigningKey{objectPath: "replace-after-cancel"}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	oldEntered, oldRelease, oldFinished := make(chan struct{}), make(chan struct{}), make(chan struct{})
	oldResult := make(chan error, 1)
	var publications atomic.Int32
	publish := func(cachedWhatsAppMediaSignedURL) { publications.Add(1) }
	go func() {
		_, err := flights.Do(ctx, key, func(signCtx context.Context) (cachedWhatsAppMediaSignedURL, error) {
			close(oldEntered)
			<-oldRelease // Simulate a transport returning success after cancellation.
			defer close(oldFinished)
			if !errors.Is(signCtx.Err(), context.Canceled) {
				t.Error("last waiter did not cancel Storage work")
			}
			return localSigningEntry("must-not-publish"), nil
		}, publish)
		oldResult <- err
	}()
	<-oldEntered
	flights.mu.Lock()
	oldFlight := flights.entries[key]
	flights.mu.Unlock()
	cancel()
	if err := <-oldResult; !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled caller returned %v", err)
	}
	waitForSigningWaiters(t, flights, key, 0)
	newEntered, newRelease := make(chan struct{}), make(chan struct{})
	newResult := make(chan error, 1)
	go func() {
		entry, err := flights.Do(context.Background(), key, func(context.Context) (cachedWhatsAppMediaSignedURL, error) {
			close(newEntered)
			<-newRelease
			return localSigningEntry("replacement"), nil
		}, publish)
		if err == nil && entry.url != "replacement" {
			t.Error("replacement returned the cancelled flight result")
		}
		newResult <- err
	}()
	<-newEntered
	close(oldRelease)
	<-oldFinished
	<-oldFlight.done
	// Completion of the old transport cannot delete the new registered flight.
	flights.mu.Lock()
	current := flights.entries[key]
	flights.mu.Unlock()
	if current == nil {
		t.Fatal("cancelled flight removed its replacement")
	}
	if publications.Load() != 0 {
		t.Fatal("cancelled flight published a late result")
	}
	close(newRelease)
	if err := <-newResult; err != nil {
		t.Fatal(err)
	}
	waitForSigningWaiters(t, flights, key, 0)
	if publications.Load() != 1 {
		t.Fatalf("publications=%d; want only the replacement", publications.Load())
	}
}

func TestWhatsAppMediaSigningFailureAndEmptyResultAllowRetry(t *testing.T) {
	for _, failure := range []string{"error", "empty"} {
		t.Run(failure, func(t *testing.T) {
			flights := newBoundedWhatsAppMediaSigningFlights(1)
			key := whatsAppMediaSigningKey{objectPath: failure}
			var calls, publications int
			sign := func(context.Context) (cachedWhatsAppMediaSignedURL, error) {
				calls++
				if calls == 1 {
					if failure == "error" {
						return cachedWhatsAppMediaSignedURL{}, errors.New("local Storage failure")
					}
					return cachedWhatsAppMediaSignedURL{}, nil
				}
				return localSigningEntry("retry-success"), nil
			}
			publish := func(cachedWhatsAppMediaSignedURL) { publications++ }
			entry, err := flights.Do(context.Background(), key, sign, publish)
			if entry.url != "" || (failure == "error" && err == nil) || (failure == "empty" && err != nil) {
				t.Fatal("failure contract changed")
			}
			waitForSigningWaiters(t, flights, key, 0)
			entry, err = flights.Do(context.Background(), key, sign, publish)
			if err != nil || entry.url != "retry-success" || calls != 2 || publications != 1 {
				t.Fatalf("retry result=%q err=%v calls=%d publications=%d", entry.url, err, calls, publications)
			}
		})
	}
}

func TestWhatsAppMediaSigningNamespaceIsolation(t *testing.T) {
	base := whatsAppMediaSigningKey{organizationID: "org-a", objectPath: "path-a", bucket: "bucket-a", origin: "http://local-a", client: &http.Client{}}
	for _, dimension := range []string{"organization", "path", "bucket", "origin", "client"} {
		t.Run(dimension, func(t *testing.T) {
			other := base
			switch dimension {
			case "organization":
				other.organizationID = "org-b"
			case "path":
				other.objectPath = "path-b"
			case "bucket":
				other.bucket = "bucket-b"
			case "origin":
				other.origin = "http://local-b"
			case "client":
				other.client = &http.Client{}
			}
			flights := newBoundedWhatsAppMediaSigningFlights(2)
			entered, release, results := make(chan struct{}, 2), make(chan struct{}), make(chan error, 2)
			sign := func(context.Context) (cachedWhatsAppMediaSignedURL, error) {
				entered <- struct{}{}
				<-release
				return localSigningEntry("isolated"), nil
			}
			for _, key := range []whatsAppMediaSigningKey{base, other} {
				go func() {
					_, err := flights.Do(context.Background(), key, sign, func(cachedWhatsAppMediaSignedURL) {})
					results <- err
				}()
			}
			for range 2 {
				select {
				case <-entered:
				case <-time.After(2 * time.Second):
					t.Fatal("different Storage namespaces shared a flight")
				}
			}
			close(release)
			for range 2 {
				if err := <-results; err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}

func TestWhatsAppMediaSigningSaturationPreservesDirectBehavior(t *testing.T) {
	flights := newBoundedWhatsAppMediaSigningFlights(1)
	key := whatsAppMediaSigningKey{objectPath: "occupies-slot"}
	entered, release, done := make(chan struct{}), make(chan struct{}), make(chan error, 1)
	go func() {
		_, err := flights.Do(context.Background(), key, func(context.Context) (cachedWhatsAppMediaSignedURL, error) {
			close(entered)
			<-release
			return localSigningEntry("registered"), nil
		}, func(cachedWhatsAppMediaSignedURL) {})
		done <- err
	}()
	<-entered
	callerCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	entry, err := flights.Do(callerCtx, whatsAppMediaSigningKey{objectPath: "overflow"}, func(signCtx context.Context) (cachedWhatsAppMediaSignedURL, error) {
		if signCtx != callerCtx {
			t.Error("saturated registry changed direct caller context")
		}
		flights.mu.Lock()
		count := len(flights.entries)
		flights.mu.Unlock()
		if count != 1 {
			t.Errorf("registry grew past its cap: %d", count)
		}
		return localSigningEntry("direct"), nil
	}, func(cachedWhatsAppMediaSignedURL) {})
	close(release)
	if err != nil || entry.url != "direct" {
		t.Fatalf("direct fallback failed: %v", err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	waitForSigningWaiters(t, flights, key, 0)
}

func TestWhatsAppMediaSigningCancelledCallerBeforeJoinDoesNotStartStorage(t *testing.T) {
	flights := newBoundedWhatsAppMediaSigningFlights(1)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := flights.Do(ctx, whatsAppMediaSigningKey{}, func(context.Context) (cachedWhatsAppMediaSignedURL, error) {
		t.Error("already cancelled caller reached Storage")
		return localSigningEntry("unexpected"), nil
	}, func(cachedWhatsAppMediaSignedURL) { t.Error("already cancelled caller published a result") })
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled result: %v", err)
	}
}

func TestWhatsAppMediaSigningSaturatedCancelledResultIsNotPublished(t *testing.T) {
	flights := newBoundedWhatsAppMediaSigningFlights(1)
	key := whatsAppMediaSigningKey{objectPath: "registered"}
	entered, release, done := make(chan struct{}), make(chan struct{}), make(chan error, 1)
	go func() {
		_, err := flights.Do(context.Background(), key, func(context.Context) (cachedWhatsAppMediaSignedURL, error) {
			close(entered)
			<-release
			return localSigningEntry("registered"), nil
		}, func(cachedWhatsAppMediaSignedURL) {})
		done <- err
	}()
	<-entered
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	_, err := flights.Do(ctx, whatsAppMediaSigningKey{objectPath: "overflow"}, func(context.Context) (cachedWhatsAppMediaSignedURL, error) {
		cancel()
		return localSigningEntry("late-direct"), nil
	}, func(cachedWhatsAppMediaSignedURL) { t.Error("cancelled direct result was published") })
	close(release)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("saturated cancelled result: %v", err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	waitForSigningWaiters(t, flights, key, 0)
}

func TestWhatsAppMediaSigningCachedTTLIsNotExtended(t *testing.T) {
	const organizationID = "00000000-0000-0000-0000-000000000021"
	objectPath := "orgs/" + organizationID + "/sessions/local-signing/incoming/remaining.png"
	whatsappMediaSignedURLCache.Store(objectPath, cachedWhatsAppMediaSignedURL{url: "local-existing", expiresAt: time.Now().Add(3 * time.Second)})
	t.Cleanup(func() { whatsappMediaSignedURLCache.Delete(objectPath) })
	url, ttl, err := (Repository{}).signedWhatsAppMessageMediaURLWithTTL(context.Background(), organizationID, objectPath)
	if err != nil || url != "local-existing" || ttl < 1 || ttl > 3 {
		t.Fatalf("remaining TTL changed: %d err=%v", ttl, err)
	}
}
