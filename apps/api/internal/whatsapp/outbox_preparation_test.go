package whatsapp

import (
	"errors"
	"testing"
	"time"
)

func TestWhatsAppPreparationBudgetAndTypedFailures(t *testing.T) {
	for _, scenario := range []struct {
		value any
		want  int
	}{
		{float64(0), 0}, {float64(5), 5}, {float64(6), 6}, {float64(-1), 6},
		{"999999999999999999999999", 6}, {"broken", 6}, {float64(1.5), 6},
	} {
		if got := whatsappOutboxPreparationCount(map[string]any{"preparation_attempts": scenario.value}); got != scenario.want {
			t.Fatalf("preparation budget %v = %d, want %d", scenario.value, got, scenario.want)
		}
	}
	if whatsappOutboxPreparationCount(nil) != 0 {
		t.Fatal("new intent must start with an empty preparation budget")
	}
	for count, delay := range []time.Duration{5, 10, 20, 40, 80, 160} {
		if got := whatsappOutboxPreparationDelay(count + 1); got != delay*time.Second {
			t.Fatalf("preparation delay %d = %s", count+1, got)
		}
	}
	for _, status := range []int{400, 401, 403, 404, 410, 422, 429, 500, 503} {
		want := status < 429
		if got := permanentWhatsAppPreparationError(storageSigningHTTPError{statusCode: status}); got != want {
			t.Fatalf("preparation HTTP %d permanent=%v, want %v", status, got, want)
		}
	}
	if !permanentWhatsAppPreparationError(ErrStorageNotConfigured) || permanentWhatsAppPreparationError(errors.New("temporary transport")) {
		t.Fatal("preparation configuration and temporary transport must have separate outcomes")
	}
}
