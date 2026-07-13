package whatsapp

import (
	"reflect"
	"testing"
)

func TestWhatsAppHandlerHasNoOrganizationWideRealtimePublisher(t *testing.T) {
	handlerType := reflect.TypeOf(Handler{})
	if _, exists := handlerType.FieldByName("publisher"); exists {
		t.Fatal("WhatsApp handler must not publish conversation/session data to the organization-wide realtime hub")
	}
}
