import assert from "node:assert/strict";
import test from "node:test";
import type { WhatsAppMessage } from "@/hooks/use-whatsapp-conversations";
import { canQuoteWhatsAppMessage, toWhatsAppQuote } from "./message-actions";

const received = {
  id: "00000000-0000-4000-8000-000000000001", message_id: "provider-a",
  message_type: "image", content: null, media_filename: "fachada.jpg",
  from_me: false, status: "received", sender_name: "Lead A", metadata: {}, can_quote: true,
} as WhatsAppMessage;

test("quote accepts a canonical inbound and preserves filename and provider reference", () => {
  assert.equal(canQuoteWhatsAppMessage(received), true);
  assert.deepEqual(toWhatsAppQuote(received), {
    id: received.id, message_id: "provider-a", available: true, from_me: false,
    content: undefined, message_type: "image", media_filename: "fachada.jpg", sender_name: "Lead A",
    sender_user_id: undefined,
  });
});

test("outbound quote preserves the canonical CRM author without attributing from_me to the viewer", () => {
  const quote = toWhatsAppQuote({ ...received, from_me: true, sender_name: "Outro corretor", sender_user_id: "broker-other" });
  assert.equal(quote.sender_name, "Outro corretor");
  assert.equal(quote.sender_user_id, "broker-other");
});
test("local, unknown, failed, queued, deleted and reaction targets cannot become a new quote", () => {
  for (const status of ["pending", "queued", "sending", "confirming", "failed", "deleted"]) {
    assert.equal(canQuoteWhatsAppMessage({ ...received, status }), false, status);
  }
  assert.equal(canQuoteWhatsAppMessage({ ...received, metadata: { local_delivery_state: "failed" } }), false);
  assert.equal(canQuoteWhatsAppMessage({ ...received, id: "message-client-local" }), false);
  assert.equal(canQuoteWhatsAppMessage({ ...received, message_type: "reaction" }), false);
});

test("quote requires an explicit server capability, including observed and promoted history", () => {
  assert.equal(canQuoteWhatsAppMessage({ ...received, can_quote: false }), false);
  assert.equal(canQuoteWhatsAppMessage({ ...received, can_quote: undefined }), false);
  assert.equal(canQuoteWhatsAppMessage({ ...received, can_quote: false,
    metadata: { whatsapp_attendance_capture: { state: "observed_unattended" } } }), false);
});
