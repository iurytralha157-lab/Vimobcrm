package whatsapp

import (
	"errors"
	"testing"
)

func TestSingleOrphanReadStatusKeepsMixedReceiptsInRetry(t *testing.T) {
	single := []byte(`{"event":"Receipt","data":{"Type":"read","IsFromMe":true,"MessageIDs":["provider-one"],"Timestamp":"2026-09-27T12:00:00Z"}}`)
	status, ok := singleOrphanReadStatus(single)
	if !ok || status.Status != "read" || len(status.MessageIDs) != 1 || status.MessageIDs[0] != "provider-one" {
		t.Fatalf("single read status = %#v, %v", status, ok)
	}
	for _, raw := range [][]byte{
		[]byte(`{"event":"Receipt","data":{"Type":"read","MessageIDs":["provider-one","provider-two"]}}`),
		[]byte(`{"event":"Receipt","data":{"Type":"delivered","MessageIDs":["provider-one"]}}`),
		[]byte(`{"event":"Message","data":{"Type":"read","MessageIDs":["provider-one"]}}`),
		[]byte(`not-json`),
	} {
		if _, ok := singleOrphanReadStatus(raw); ok {
			t.Fatal("mixed, other-status, other-event or malformed receipt was admitted")
		}
	}
}

func TestNotificationTargetNotFoundIsTypedAndDoesNotExposeProviderID(t *testing.T) {
	matched, err := nativeNotificationReceiptOutcomeMatched("not_found")
	if matched || !errors.Is(err, errNativeNotificationReceiptTargetNotFound) {
		t.Fatalf("not_found = matched:%v error:%v", matched, err)
	}
	if _, err := nativeNotificationReceiptOutcomeMatched("ambiguous"); errors.Is(err, errNativeNotificationReceiptTargetNotFound) {
		t.Fatal("ambiguous must never be classified as an orphan")
	}
}
