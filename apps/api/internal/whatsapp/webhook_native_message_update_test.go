package whatsapp

import "testing"

func TestNativeEvolutionMessageUpdateReceiptShape(t *testing.T) {
	// This is the current direct receipt shape used by the ingress lane test.
	receipt, err := decodeNativeEvolutionPayload([]byte(`{
		"event":"messages.update",
		"data":{"key":{"id":"outbound-1"},"status":"delivered","timestamp":1788966000}
	}`))
	if err != nil {
		t.Fatal(err)
	}
	receiptEvent := nativeEvolutionEventName(receipt, "")
	receiptStatuses := extractNativeEvolutionStatuses(receipt)
	if !nativeEvolutionMessageUpdateIsReceipt(receiptEvent, receipt, receiptStatuses) ||
		len(receiptStatuses) != 1 || receiptStatuses[0].Status != "delivered" ||
		len(receiptStatuses[0].MessageIDs) != 1 || receiptStatuses[0].MessageIDs[0] != "outbound-1" {
		t.Fatalf("messages.update receipt = %#v, want one delivered status for outbound-1", receiptStatuses)
	}

	content, err := decodeNativeEvolutionPayload([]byte(`{
		"event":"messages.update",
		"data":{"key":{"id":"inbound-1","remoteJid":"5511999999999@s.whatsapp.net"},"message":{"conversation":"Resposta do cliente"}}
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if statuses := extractNativeEvolutionStatuses(content); len(statuses) != 0 ||
		nativeEvolutionMessageUpdateIsReceipt(nativeEvolutionEventName(content, ""), content, statuses) {
		t.Fatalf("content without delivery status was classified as a receipt: %#v", statuses)
	}
	if messages := extractNativeEvolutionMessages(content); len(messages) != 1 || messages[0].Content != "Resposta do cliente" {
		t.Fatalf("content update must retain its message path: %#v", messages)
	}

	mixed, err := decodeNativeEvolutionPayload([]byte(`{
		"event":"messages.update",
		"data":{"key":{"id":"inbound-2","remoteJid":"5511999999999@s.whatsapp.net"},"status":"delivered","message":{"conversation":"Conteudo junto do status"}}
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if statuses := extractNativeEvolutionStatuses(mixed); nativeEvolutionMessageUpdateIsReceipt(nativeEvolutionEventName(mixed, ""), mixed, statuses) {
		t.Fatal("mixed content and delivery status must not be classified as a receipt")
	}
}
