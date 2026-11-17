package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"testing"
)

func TestWhatsAppMediaTransportErrorRedactsSignedURLAndPreservesClassification(t *testing.T) {
	for _, scenario := range []struct {
		name  string
		cause error
	}{
		{"deadline", context.DeadlineExceeded},
		{"canceled", context.Canceled},
		{"network timeout", &net.DNSError{Err: "synthetic timeout", Name: "synthetic.invalid", IsTimeout: true}},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			const origin = "http://127.0.0.1:1"
			const signedPath = "/private-synthetic-object?token=synthetic-signed-secret"
			repo := Repository{functions: functionsClient{
				evolutionGoAPIURL: origin,
				httpClient: &http.Client{Transport: storageURLTestTransport(func(*http.Request) (*http.Response, error) {
					return nil, scenario.cause
				})},
			}}
			_, err := repo.downloadWhatsAppMediaURL(context.Background(), origin+signedPath)
			if err == nil {
				t.Fatal("synthetic transport failure was accepted")
			}
			for _, rendered := range []string{
				err.Error(), fmt.Sprintf("%v", err), fmt.Sprintf("%+v", err),
				fmt.Errorf("wrapped: %w", err).Error(), errors.Join(errors.New("synthetic sibling"), err).Error(),
				normalizeWhatsAppMediaProviderRecoveryError(err).Error(),
			} {
				for _, forbidden := range []string{origin, "private-synthetic-object", "synthetic-signed-secret"} {
					if strings.Contains(rendered, forbidden) {
						t.Fatalf("transport error exposes request URL component %q", forbidden)
					}
				}
			}
			if got, want := err.Error(), "whatsapp provider operation failed: whatsapp provider outcome is unknown: media provider request failed"; got != want {
				t.Fatalf("transport error = %q, want stable redacted text %q", got, want)
			}
			if !errors.Is(err, ErrProviderFailed) || !errors.Is(err, ErrProviderOutcomeUnknown) || !errors.Is(err, scenario.cause) {
				t.Fatal("transport error lost its provider or original cause classification")
			}
			var networkError net.Error
			if !errors.As(err, &networkError) {
				t.Fatal("transport error lost its network error type")
			}
			if code, permanent := classifyWhatsAppMediaDownloadError(err); code != mediaErrorOutcomeUnknown || permanent {
				t.Fatalf("transport retry classification = %s/%t", code, permanent)
			}
			if permanentWhatsAppPreparationError(err) || isWhatsAppMediaProviderDisconnected(err) {
				t.Fatal("transport failure was mistaken for a permanent preparation or disconnected-session failure")
			}
		})
	}
}
