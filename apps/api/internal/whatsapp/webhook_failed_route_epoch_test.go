package whatsapp

import (
	"errors"
	"fmt"
	"testing"
)

func TestDeterministicUnsupportedWebhookDoesNotRetryAsTransient(t *testing.T) {
	for _, cause := range []error{
		errNativeWebhookUnsupported,
		fmt.Errorf("native dispatch: %w", errNativeWebhookMessageLikeUnsupported),
	} {
		if !isDeterministicUnsupportedWebhook(cause) {
			t.Fatalf("deterministic unsupported cause classified as transient: %v", cause)
		}
		if got := failedWebhookLastError(cause); got != errNativeWebhookUnsupported.Error() &&
			got != errNativeWebhookMessageLikeUnsupported.Error() {
			t.Fatalf("wrapped unsupported cause lost canonical candidate code: %q", got)
		}
	}
	for _, cause := range []error{
		errors.New("provider timed out"),
		errors.New("native WhatsApp processor does not support this event"),
	} {
		if isDeterministicUnsupportedWebhook(cause) {
			t.Fatalf("untyped cause classified as deterministic: %v", cause)
		}
	}
}
