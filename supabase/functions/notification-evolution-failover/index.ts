import { serveRetiredWhatsAppFunction } from "../_shared/retired.ts";

// External notification delivery is owned exclusively by the canonical Go
// worker. Keeping this fail-closed tombstone prevents the legacy failover from
// racing the durable outbox or sending a second WhatsApp message.
serveRetiredWhatsAppFunction("notification-evolution-failover");
